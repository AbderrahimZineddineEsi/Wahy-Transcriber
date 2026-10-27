"""2xT4 DDP fine-tune of laya-multilingual on the Wahy quote-verification data (one variant per run).

Adapted from cell 8 of the Laya repo's notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb; every change
is marked `# CHANGED`. Training semantics (items, encoding, RLCD, sigma schedule, temperature fit) are the
canonical primitives in `laya.train` / `laya.common` / `laya.calibrate`, as in the original.

    torchrun --standalone --nproc_per_node=2 train_ddp.py MODEL_DIR OUTPUT_DIR --train train.jsonl --val val.jsonl

Runs on CPU too (gloo backend, no AMP) so it can be smoke-tested on a tiny checkpoint before Kaggle.
"""
import argparse, os, sys, time, json, random, math, shutil
import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from safetensors.torch import load_file
from transformers import AutoTokenizer

from laya.common import build_model, collate_items
from laya.calibrate import fit_temperature_map
from laya.train import (
    calibration_records,
    calibration_report,
    encode_item,
    evaluate_records,
    items_from_rows,
    read_jsonl,
    rlcd_loss,
    save_checkpoint,
    sigma_at,
    soft_ce_loss,
)


def parse_args():
    # CHANGED: hyperparameters are arguments (the original hard-codes them), defaults = the original's values
    p = argparse.ArgumentParser()
    p.add_argument("model_dir")
    p.add_argument("output_dir")
    p.add_argument("--train", required=True)
    p.add_argument("--val", required=True)
    p.add_argument("--name", default="laya-wahy")
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--micro-batch", type=int, default=8)      # sequences per forward pass per GPU
    p.add_argument("--grad-accum", type=int, default=4)       # effective batch = 8 * 2 GPUs * 4 = 64
    p.add_argument("--group-size", type=int, default=4)       # RLCD noisy samples per item
    p.add_argument("--lr-encoder", type=float, default=2.5e-5)
    p.add_argument("--lr-head", type=float, default=1.0e-4)
    p.add_argument("--sigma-start", type=float, default=0.4)
    p.add_argument("--sigma-end", type=float, default=0.1)
    p.add_argument("--loss", choices=("rlcd", "soft-ce"), default="rlcd")
    p.add_argument("--max-len", type=int, default=1024)
    p.add_argument("--head-max-len", type=int, default=256)
    p.add_argument("--limit", type=int, default=0, help="use only the first N rows of each file (smoke test)")
    # CHANGED: 81 % of the training boundary items are COMPLETE_SPAN and laya_v1 collapsed to always answering it; this
    # repeats every boundary item labelled MISSING_* N times in total (1 = off), in every epoch. Verdict items are untouched.
    p.add_argument("--boundary-oversample", type=int, default=1)
    # CHANGED (laya_v2): the boundary is two yes/no questions (start_missing / end_missing) and "yes" is ~10 % of them.
    # Every yes/no item whose target is "true" weighs this much in the loss (1 = off); Laya has no per-sample weights,
    # so the loss below is laya.train.rlcd_loss / soft_ce_loss with a weighted mean instead of a plain one.
    p.add_argument("--noul-true-weight", type=float, default=1.0)
    # CHANGED (laya_v2): JSON merged into the saved rl_agent_config.json, e.g. {"wahy_envelope": 2, "wahy_envelope_options":
    # {"passages": true, "neighbours": true}}: the app reads it to send the envelope this checkpoint was trained on.
    p.add_argument("--cfg-extra", default="{}")
    # CHANGED (run 4): train only some questions (item kinds: verdict, boundary, start_missing, end_missing), e.g.
    # "verdict" for a verdict-only model. Run 2 and run 3 showed the boundary items pulling the verdict down in the
    # shared encoder; this is the test. Val items are filtered the same way (calibration + curves).
    p.add_argument("--questions", default="", help="comma list of item kinds to keep (default: all)")
    p.add_argument("--keep-rolling-checkpoint", action="store_true")
    return p.parse_args()


def is_incomplete_boundary(item):
    """A boundary_status item whose target's top option is not COMPLETE_SPAN (options in the question's order)."""
    names = list(item["q"]["crit"])
    if "COMPLETE_SPAN" not in names:
        return False
    t = item["target"]
    return max(range(len(t)), key=t.__getitem__) != names.index("COMPLETE_SPAN")


def is_true_noul(item):
    """A yes/no item whose target leans to "true" (options are [false, true])."""
    return item["q"]["t"] == "noul" and item["target"][1] > 0.5


def item_kind(item):
    """verdict (3-option choice) / boundary (v1: the 4-option choice) / start_missing, end_missing (v2: yes/no)."""
    if item["q"]["t"] == "noul":
        return "end_missing" if "END" in str(item["q"].get("ins", ""))[:40] else "start_missing"
    return {3: "verdict", 4: "boundary"}.get(item["k"], "other")


def weighted_rlcd_loss(logits, target, mask, qtype, sigma, weights, samples=4, w_sph=0.75, w_rps=1.0):
    """laya.train.rlcd_loss with a weighted mean over rows (weights all 1 = the original, same value)."""
    from laya.common import proper_reward
    from laya.train import _MASKED
    k = mask.sum(-1, keepdim=True).float()
    fmask = mask.float()
    eps = torch.randn((samples,) + logits.shape, device=logits.device) * sigma * fmask
    eps = (eps - eps.sum(-1, keepdim=True) / k) * fmask
    z = logits.detach().unsqueeze(0) + eps
    q = torch.softmax(z.masked_fill(~mask, _MASKED), -1)
    with torch.no_grad():
        r = proper_reward(q, target.unsqueeze(0), qtype, fmask, w_sph=w_sph, w_rps=w_rps)
        adv = r - r.mean(0, keepdim=True)
        adv = adv / (adv.std() + 1e-6)
    logp = -(((z - logits.unsqueeze(0)) ** 2) * fmask).sum(-1) / (2 * sigma ** 2)
    w = weights / weights.sum()
    pg = -(adv * logp * w.unsqueeze(0)).sum() / samples
    ce = -(target * torch.log_softmax(logits.masked_fill(~mask, _MASKED), -1) * mask).sum(-1)
    return pg + (ce * w).sum()


def weighted_soft_ce_loss(logits, target, mask, weights):
    from laya.train import _MASKED
    ce = -(target * torch.log_softmax(logits.masked_fill(~mask, _MASKED), -1) * mask).sum(-1)
    return (ce * weights).sum() / weights.sum()


def balanced_accuracy(records):
    """Mean recall over the gold classes present: 'always the majority class' scores 1 / classes, not the class share."""
    hit, n = {}, {}
    for _, logits, target, k in records:
        g = max(range(k), key=lambda i: target[i])
        n[g] = n.get(g, 0) + 1
        hit[g] = hit.get(g, 0) + int(max(range(k), key=lambda i: logits[i]) == g)
    return round(sum(hit[g] / n[g] for g in n) / len(n), 4) if n else None


def main():
    args = parse_args()
    # CHANGED: gloo + CPU when there is no GPU (local smoke test); the original assumes NCCL + CUDA
    cuda = torch.cuda.is_available()
    dist.init_process_group("nccl" if cuda else "gloo")
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ.get("LOCAL_RANK", "0"))
    if cuda:
        torch.cuda.set_device(local_rank)
    device = torch.device("cuda", local_rank) if cuda else torch.device("cpu")

    model_dir, output_dir = args.model_dir, args.output_dir

    with open(os.path.join(model_dir, "rl_agent_config.json")) as f:
        cfg = json.load(f)
    cfg["gradient_checkpointing"] = True
    cfg["max_tokens_per_batch"] = 4096
    cfg["max_len"] = args.max_len
    cfg["head_max_len"] = args.head_max_len
    max_len = cfg["max_len"]
    head_max_len = cfg["head_max_len"]

    tok = AutoTokenizer.from_pretrained(os.path.join(model_dir, "tokenizer"))
    model = build_model(cfg, encoder_dir=os.path.join(model_dir, "encoder"))

    weights = load_file(os.path.join(model_dir, "model.safetensors"))
    model.load_state_dict(weights, strict=True)
    model.float()   # CHANGED (explicit, as laya.train.load_checkpoint does): fp32 master weights; autocast does the fp16

    model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.head_checkpointing = True
    model.to(device)
    model.train()

    ddp_model = DDP(model, device_ids=[local_rank] if cuda else None, find_unused_parameters=True)

    # CHANGED: every rank builds the items from our JSONL (deterministic, a few seconds) instead of a .pt from a
    # notebook cell, and the calibration set is our val.jsonl (whole held-out lectures), not `split_calibration`'s
    # random 10 % of training items: those share lectures and near-duplicate spans with training, so a temperature
    # fitted on them is fitted on easier-than-real data and comes out over-confident.
    def load(path):
        rows = read_jsonl(path)
        if args.limit:
            rows = rows[:args.limit]
        items, skipped = items_from_rows(tok, rows, max_len, head_max_len)
        return items, skipped, len(rows)

    train_items, tr_skipped, n_tr = load(args.train)
    calib_items, va_skipped, n_va = load(args.val)
    kinds = {k.strip() for k in args.questions.split(",") if k.strip()}
    if kinds:   # CHANGED (see --questions)
        train_items = [it for it in train_items if item_kind(it) in kinds]
        calib_items = [it for it in calib_items if item_kind(it) in kinds]
        assert train_items and calib_items, f"no items of kinds {sorted(kinds)}"
    n_oversampled = 0
    if args.boundary_oversample > 1:   # CHANGED (see --boundary-oversample); before the shuffle, so every rank agrees
        extra = [it for it in train_items if is_incomplete_boundary(it)] * (args.boundary_oversample - 1)
        n_oversampled = len(extra)
        train_items += extra

    # Trim before sharding so every rank gets the same count (drops at most
    # world_size-1 items). Otherwise ranks can run different numbers of
    # micro-batches and DDP deadlocks on the unmatched all-reduce (#678).
    random.Random(20260922).shuffle(train_items)   # CHANGED: rows are grouped by lecture in the file; mix before sharding
    train_items = train_items[:len(train_items) // world_size * world_size]
    my_items = train_items[rank::world_size]

    EPOCHS = args.epochs
    MICRO_BATCH = args.micro_batch
    GRAD_ACCUM = args.grad_accum
    GROUP_SIZE = args.group_size
    LR_ENCODER = args.lr_encoder
    LR_HEAD = args.lr_head
    SIGMA_START = args.sigma_start
    SIGMA_END = args.sigma_end

    enc_params = [p for n, p in ddp_model.named_parameters() if "encoder." in n]
    head_params = [p for n, p in ddp_model.named_parameters() if "encoder." not in n]

    optimizer = torch.optim.AdamW([
        {"params": enc_params, "lr": LR_ENCODER},
        {"params": head_params, "lr": LR_HEAD}
    ], weight_decay=0.01)

    total_updates = math.ceil(math.ceil(len(my_items) / MICRO_BATCH) / GRAD_ACCUM) * EPOCHS   # CHANGED: counts the last partial window (laya.train.optimizer_updates)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, total_updates), eta_min=1e-6)
    scaler = torch.amp.GradScaler("cuda", enabled=cuda)

    history = {"name": args.name, "args": vars(args), "world_size": world_size, "train_rows": n_tr, "val_rows": n_va,
               "train_items": len(train_items), "val_items": len(calib_items), "skipped": {"train": tr_skipped, "val": va_skipped},
               "boundary_oversampled_items": n_oversampled,
               "noul_true_items": sum(is_true_noul(it) for it in train_items),
               "optimizer_updates": total_updates, "steps": [], "epochs": []}
    if rank == 0:
        print(f"[{args.name}] {len(train_items)} train items ({n_tr} rows, {n_oversampled} of them boundary repeats), "
              f"{len(calib_items)} val items ({n_va} rows) "
              f"| {len(my_items)} per rank | {EPOCHS} epochs | {total_updates} optimizer updates | skipped {tr_skipped} {va_skipped}", flush=True)
    t0 = time.time()

    def val_metrics():
        # CHANGED: the original never looks at held-out data during training. Val loss / accuracy per epoch
        # (temperature 1) is the overfitting check: train loss going down while val loss goes up = memorising.
        model.eval()
        recs = calibration_records(model, tok, calib_items, device, max_len, head_max_len, batch_size=16)
        model.train()
        by_q = {}
        kinds = ["all"] + sorted({item_kind(it) for it in calib_items})
        for name in kinds:
            sub = [r for r, it in zip(recs, calib_items) if name == "all" or item_kind(it) == name]
            m = evaluate_records(sub)
            by_q[name] = {"loss": m["loss"], "accuracy": m["accuracy"], "ece": m["ece"], "items": m["items"]}
            # CHANGED: val is 86 % COMPLETE_SPAN / ~92 % "not cut off", so accuracy can mean "learned nothing"; this cannot
            if name not in ("all", "verdict"):
                by_q[name]["balanced_accuracy"] = balanced_accuracy(sub)
        return by_q

    if rank == 0:
        history["val_before"] = val_metrics()
        print(f"  val before training: {history['val_before']}", flush=True)
    dist.barrier()

    for epoch in range(EPOCHS):
        random.seed(42 + epoch + rank)
        random.shuffle(my_items)
        epoch_loss, n_batches = 0.0, 0
        optimizer.zero_grad(set_to_none=True)
        accum_step = 0

        sigma = sigma_at(epoch, EPOCHS, SIGMA_START, SIGMA_END)
        steps_per_epoch = math.ceil(len(my_items) / MICRO_BATCH)

        for b_idx in range(0, len(my_items), MICRO_BATCH):
            chunk = my_items[b_idx:b_idx + MICRO_BATCH]
            if not chunk:
                continue

            encoded = [encode_item(tok, it, max_len, head_max_len) for it in chunk]
            batch = collate_items([encoded], tok.pad_token_id)
            weights = torch.tensor([args.noul_true_weight if is_true_noul(it) else 1.0 for it in chunk], device=device)

            with torch.autocast(device.type, dtype=torch.float16, enabled=cuda):
                logits, act = ddp_model(
                    batch["input_ids"].to(device),
                    batch["attention_mask"].to(device),
                    batch["marker_pos"].to(device),
                    batch["marker_mask"].to(device),
                    batch["qtype"].to(device)
                )

            logits = logits.float()
            mask = batch["marker_mask"].to(device)
            target = batch["target"].to(device)

            # Canonical objective: RLCD policy gradient over noisy logits + full
            # soft cross-entropy guidance (`laya.train.rlcd_loss`).
            if args.loss == "rlcd" and args.noul_true_weight == 1.0:
                loss = rlcd_loss(logits, target, mask, batch["qtype"].to(device), sigma,
                                 samples=GROUP_SIZE, w_sph=0.75, w_rps=1.0)
            elif args.loss == "rlcd":   # CHANGED (see --noul-true-weight)
                loss = weighted_rlcd_loss(logits, target, mask, batch["qtype"].to(device), sigma, weights,
                                          samples=GROUP_SIZE, w_sph=0.75, w_rps=1.0)
            elif args.noul_true_weight == 1.0:   # CHANGED: optional plain soft cross-entropy (laya.train's other objective)
                loss = soft_ce_loss(logits, target, mask)
            else:
                loss = weighted_soft_ce_loss(logits, target, mask, weights)

            window_start = (accum_step // GRAD_ACCUM) * GRAD_ACCUM
            window_size = min(GRAD_ACCUM, steps_per_epoch - window_start)
            scaled = loss / window_size
            scaler.scale(scaled).backward()
            accum_step += 1

            if accum_step % GRAD_ACCUM == 0 or (b_idx + MICRO_BATCH) >= len(my_items):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(ddp_model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)

            epoch_loss += loss.item()
            n_batches += 1

            if rank == 0 and (n_batches % 50) == 0:
                cur_lr = scheduler.get_last_lr()[0]
                history["steps"].append({"epoch": epoch + 1, "step": n_batches, "loss": loss.item(), "lr": cur_lr})
                print(f"  Epoch {epoch+1}/{EPOCHS} | Step {n_batches} | Loss: {loss.item():.4f} | LR: {cur_lr:.2e}", flush=True)

        dist.barrier()
        if rank == 0:
            vm = val_metrics()
            history["epochs"].append({"epoch": epoch + 1, "train_loss": epoch_loss / max(1, n_batches), "sigma": sigma,
                                      "seconds": time.time() - t0, "val": vm})
            parts = ", ".join(f"{k} {v['accuracy']:.4f}" + (f" / balanced {v['balanced_accuracy']}" if "balanced_accuracy" in v else "")
                              for k, v in vm.items() if k != "all")
            print(f"=== Epoch {epoch+1}/{EPOCHS} Completed in {time.time()-t0:.1f}s | Avg Loss: {epoch_loss/max(1, n_batches):.4f} "
                  f"| val loss {vm['all']['loss']:.4f} acc {vm['all']['accuracy']:.4f} ({parts}) ===", flush=True)

            # Overwrite a single rolling checkpoint after each epoch so a crash,
            # OOM, or Kaggle session timeout doesn't lose all prior training.
            ckpt_dir = os.path.join(output_dir, "checkpoint_latest")
            save_checkpoint(model, tok, dict(cfg, max_len=max_len, head_max_len=head_max_len), ckpt_dir)
            with open(os.path.join(ckpt_dir, "checkpoint_meta.json"), "w") as f:
                json.dump({"epoch": epoch + 1, "total_epochs": EPOCHS, "avg_loss": epoch_loss / max(1, n_batches)}, f, indent=2)
            print(f"  Saved rolling checkpoint (epoch {epoch+1}/{EPOCHS}) to {ckpt_dir}", flush=True)
        dist.barrier()

    # Post-training temperature calibration on rank 0
    if rank == 0:
        print("\nFitting post-training calibration temperatures on val...", flush=True)
        del optimizer, scaler, scheduler
        if cuda:
            torch.cuda.empty_cache()
        model.eval()
        try:
            records = calibration_records(model, tok, calib_items, device, max_len, head_max_len, batch_size=16)
            fitted = fit_temperature_map(records)
            fitted_temps = fitted["temperature"]
            history["calibration"] = {"temperature": fitted_temps, "temperature_by_options": fitted["temperature_by_options"],
                                      "n_by_bucket": fitted["n_by_bucket"], "clamped": fitted.get("temperature_clamped"),
                                      "report": calibration_report(records, fitted_temps),
                                      "val_at_t1": evaluate_records(records),
                                      "val_at_fitted": evaluate_records(records, fitted_temps, fitted["temperature_by_options"])}
            print("Fitted calibration temperatures (choice, score, noul):", [round(t, 3) for t in fitted_temps], flush=True)
        except Exception as e:
            print("Temperature fitting fallback:", e, flush=True)
            fitted_temps, fitted = None, {"temperature_by_options": {}}

        out_cfg = dict(cfg, max_len=max_len, head_max_len=head_max_len)
        out_cfg["fine_tuned"] = True
        out_cfg["model_name"] = args.name   # CHANGED
        out_cfg.update(json.loads(args.cfg_extra))   # CHANGED (see --cfg-extra)
        if fitted_temps is not None:
            out_cfg["temperature"] = fitted_temps
            # This fit carries per-bucket overrides; inherited ones would shadow them.
            out_cfg.pop("temperature_by_options", None)
            if fitted["temperature_by_options"]:
                out_cfg["temperature_by_options"] = fitted["temperature_by_options"]
        save_checkpoint(model, tok, out_cfg, output_dir)
        history["seconds"] = time.time() - t0
        with open(os.path.join(output_dir, "train_log.json"), "w") as f:   # CHANGED: curves + calibration for the notebook
            json.dump(history, f, indent=1)
        if not args.keep_rolling_checkpoint:   # CHANGED: the final model is saved; free ~0.6 GB of Kaggle output
            shutil.rmtree(os.path.join(output_dir, "checkpoint_latest"), ignore_errors=True)
        print(f"Model successfully saved to {output_dir}!", flush=True)

    dist.destroy_process_group()


if __name__ == "__main__":
    main()
