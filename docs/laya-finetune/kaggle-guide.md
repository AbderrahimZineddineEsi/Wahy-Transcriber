# Fine-tuning Laya on Kaggle — step by step

Written 2026-10-25. You train; this explains every step and how to read the results. The data and the reasons behind it
are in [data.md](data.md). Files:

* the dataset folder: `data/laya_datagen/datasets/laya_v1/` (built by [notebooks/data/laya_dataset.ipynb](../../notebooks/data/laya_dataset.ipynb))
* the notebook to run on Kaggle: [notebooks/kaggle/laya_finetune_kaggle.ipynb](../../notebooks/kaggle/laya_finetune_kaggle.ipynb). It is the
  Laya repo's `laya_finetune_typed_decisions_2xT4_kaggle.ipynb` adapted to our data, with each change marked **CHANGED**.

## 1. What the pipeline does (the Laya repo's notebook, and our changes)

| stage | original notebook | ours | why |
|---|---|---|---|
| base model | `convaiinnovations/laya` | **`convaiinnovations/laya-multilingual`** | the original is the English checkpoint (ModernBERT-large); ours is mmBERT-base, which reads Arabic and is what the app runs |
| data | `LocalLLaMA/typed-decisions` from the Hub | our `train.jsonl` per variant | |
| items | `items_from_rows` in a notebook cell → `train_items.pt` | each GPU process builds them from the JSONL | same function, simpler; takes seconds |
| training | `train_ddp.py`: DDP on 2 GPUs, AdamW, cosine LR, fp16, RLCD | the same script, hyperparameters as arguments | |
| calibration set | `split_calibration`: random 10 % of the *training items* (max 400) | **our `val.jsonl`** (9 whole lectures, 779 items) | random items share lectures and near-duplicates with training: the temperature would be fitted on easier-than-real data and come out over-confident |
| monitoring | training loss only | + **val loss / accuracy after each epoch** | the overfitting check |
| evaluation | typed-decisions accuracy / Brier / ECE | `eval_laya.py`: per label source, rejection quality, prior correction, thresholds, span length, boundary | what matters for Wahy |
| export | push to a public Hub repo | saved to the Output tab; optional push to a **private** repo | |
| runs | one | **three variants in a row**, each failure isolated | so you can leave it running |

### The training loop, in detail ([backend/laya_datagen/kaggle/train_ddp.py](../../backend/laya_datagen/kaggle/train_ddp.py))
* **DDP.** `torchrun --nproc_per_node=2` starts one process per T4. Each holds a full copy of the model, trains on half of
  the items (`train_items[rank::world_size]`), and the gradients are averaged across the two GPUs at every backward pass
  (NCCL all-reduce). The item list is trimmed to an even count first: if one GPU ran one micro-batch more, it would wait
  forever for the other at the all-reduce (#678 in the Laya repo).
* **Batching.** 8 sequences per forward pass per GPU × 2 GPUs × 4 accumulation steps = an **effective batch of 64**.
  Gradient accumulation sums the gradients of 4 micro-batches before one optimizer step. That gives the update of a
  batch of 64 with the memory of a batch of 8.
* **Optimizer.** AdamW, weight decay 0.01, **two learning rates**: 2.5e-5 for the pretrained encoder (move it gently) and
  1e-4 for the small decision head on top. Cosine decay to 1e-6 over all updates, gradient clipping at norm 1.0.
* **Memory / speed.** fp16 autocast with a `GradScaler` (the T4 has fast fp16 tensor cores and no bf16), gradient
  checkpointing in the encoder and head: the activations are recomputed in the backward pass instead of stored (~30 % more
  compute, much less memory).
* **The loss, RLCD** (`laya.train.rlcd_loss`, [train.py:499](../../.venv/lib/python3.14/site-packages/laya/train.py#L499)) is
  two terms:
  1. **soft cross-entropy** between the model's softmax over the options and our gold vector, and
  2. a **GRPO-style policy-gradient term.** For each item, draw 4 noisy versions of the logits (Gaussian noise × σ). Score
     each one's distribution with a strictly proper scoring rule: log score + 0.75 × spherical score
     (`laya.common.proper_reward`). Push the logits toward the samples that scored above the group's mean (the advantage).
     A *proper* scoring rule is maximised in expectation only by reporting the true probabilities, so the reward favours
     honest confidence, which is where Laya's "calibrated decisions" come from.
  σ is annealed linearly from 0.4 (explore) to 0.1 (exploit) over the epochs (`sigma_at`). Laya's own docs note that on
  their benchmark (#741) the extra term measured **no gain over soft cross-entropy alone**. `--loss soft-ce` is the
  ablation if you want to test that on our data.
* **After each epoch** (GPU 0): val loss / accuracy, overall and per question, at temperature 1, and a rolling checkpoint
  (`checkpoint_latest/`, deleted at the end once the final model is saved).
* **Calibration.** The model in eval mode scores the val items. `fit_temperature_map` finds the *T* that minimises the
  cross-entropy of `softmax(logits / T)` against the val targets, one *T* for all "choice" questions (verdict and boundary
  together: per-option-count buckets need 2,000 records, we have 779). It is clamped to [0.5, 5] and written into the saved
  config. `laya.load` applies it at inference, so the app gets calibrated probabilities with no change on its side.

### Will it fit, and how long
mmBERT-base is ~125 M parameters without the embeddings (307 M with its 256k-token vocabulary). Sequences are at most 1,024
tokens (median ~660 including the question), micro-batch 8, fp16 with checkpointing: far below the T4's 15 GB.

Time, estimated (the first `=== Epoch 1/4 Completed in …s` line gives the real number):

| step | estimate |
|---|---|
| install + model download | ~5 min |
| base Laya on the test set (1,523 rows) | ~3 min |
| one variant: 4 epochs (~4,300 items each, ~3,400 for `soft_balanced`) + val checks + calibration | ~15–25 min |
| evaluation of one variant | ~3 min |
| **whole notebook, 3 variants** | **~1–1.5 h** (a background run may last 12 h) |

## 2. Step by step

### a. Upload the dataset (once)
1. Zip the folder: `cd data/laya_datagen/datasets && zip -r laya_v1.zip laya_v1` (46 MB unzipped).
2. kaggle.com → **Datasets → New Dataset** → drop `laya_v1.zip` (Kaggle unzips it and keeps the folders) → title
   `laya-v1` → visibility **Private** → Create.

If you rebuild the data later, use **New Version** on the same dataset.

### b. Create the notebook
1. kaggle.com → **Code → New Notebook → File → Import Notebook** → upload `notebooks/kaggle/laya_finetune_kaggle.ipynb`.
2. Right-hand panel → **Settings**: *Accelerator* **GPU T4 x2**, *Internet* **On** (needs a phone-verified account),
   *Persistence* off is fine.
3. **Add Input** → *Your Datasets* → `laya-v1`. The notebook finds it wherever Kaggle mounts it (it looks for `manifest.json`).
4. Only if you want the models on the Hugging Face Hub: *Add-ons → Secrets* → add `HF_TOKEN` (a *write* token), then set
   `PUSH_TO_HUB = True` and `HUB_PREFIX = "<your-username>/laya-wahy"` in section 4. The repos are created **private**.

### c. Check it interactively (~10 min), then leave it running
1. Run sections 1–3 (GPU check, install, dataset + model). You should see the 8 files with their row counts and
   `base checkpoint: … jhu-clsp/mmBERT-base`.
2. Optional: run section 5 (base Laya) to see the evaluation work.
3. **Save Version → Save & Run All (Commit)** → Save. It runs from scratch in the background, browser closed. Follow it under
   *Your Work → the notebook → Versions*. Everything lands in the version's **Output** tab:

```
/kaggle/working/models/<variant>/     the fine-tuned checkpoint (loads with laya.load) + train_log.json
/kaggle/working/results/*.json        one evaluation per model (+ baseline_*.json, status.json, comparison.md, curves.png)
/kaggle/working/logs/*.log            the full output of each training / evaluation run
```

The settings that are worth changing, in section 4 (`TRAIN_ARGS`, passed to `train_ddp.py`):

| argument | default | what it does | when to touch it |
|---|---|---|---|
| `--epochs` | 4 | passes over the training data (~270 optimizer updates in total for `soft_asis`) | val loss rising after epoch 2–3 → 3 epochs; still falling at 4 → 5–6 |
| `--lr-encoder` | 2.5e-5 | how fast the pretrained encoder changes | the most sensitive one; 1e-5–5e-5 is the sane range |
| `--lr-head` | 1e-4 | the decision head's rate | rarely |
| `--micro-batch` / `--grad-accum` | 8 / 4 | effective batch = micro × 2 GPUs × accum = 64 | out of memory → 4 / 8 (same effective batch) |
| `--loss` | `rlcd` | `soft-ce` = the cross-entropy term alone | the RLCD ablation |
| `--sigma-start` / `--sigma-end` | 0.4 / 0.1 | RLCD exploration noise | leave |
| `VARIANTS` | the 3 | which runs, in order | drop one to save time |

## 3. Reading the outputs

### The training log (section 6)
```
[laya-wahy-soft_asis] 4306 train items (2863 rows), 779 val items (515 rows) | 2153 per rank | 4 epochs | ~272 optimizer updates
  val before training: {'all': {'loss': …, 'accuracy': …}, 'verdict': …, 'boundary': …}
  Epoch 1/4 | Step 50 | Loss: … | LR: …
=== Epoch 1/4 Completed in …s | Avg Loss: … | val loss … acc … (verdict …, boundary …) ===
Fitted calibration temperatures (choice, score, noul): [T, 1.0, 1.0]
```
* *skipped* must be `{}`. *val before training* is base Laya on the val lectures: the starting point.
* The **training loss** is the RLCD loss: its policy-gradient part is noisy and can be negative, so read the trend, not the
  value. The val loss is a plain cross-entropy (lower is better).
* **Overfitting:** val loss going up while training loss keeps going down → fewer epochs. With ~4,300 items and 4 epochs
  this is unlikely but worth checking (section 8 plots it).
* **Temperature** (section 8 prints it with its issues): *T* > 1 means the model was over-confident on val and gets
  softened, *T* < 1 sharpened. It lands on 0.5 or 5 (the clamp) → something is off. "Came back unchanged at 1.0" → the val
  items gave the fit nothing to correct. Compare the *ECE at T = 1 → at fitted T*: the fit should lower it.
* A warning *"predictions collapsed to the class prior"* means the model outputs the same answer for everything: training
  failed (too few updates or a bad learning rate).

### The comparison (section 7)
One table per test group (**you**, **you + Sonnet**, **Sonnet · review lessons**, **Sonnet · other lectures**,
**written text**), one line per model: base Laya (zero-shot), the three variants, and the baselines (the span-length /
shallow-field regressions, and cached JEV / Gemini / base-Laya answers on the cards they cover: see the *cards* column).
Every rate is `value [95 % interval]`.

| column | meaning | why you care |
|---|---|---|
| verdict accuracy | predicted verdict = label | overall |
| not-a-quote recall | false findings it catches / all false findings | how much of the engine's noise it removes |
| not-a-quote precision | of the cards it rejects, how many are really not quotes | |
| **real wrongly rejected** | real quotes it calls "not a quote" / all real quotes | **the costly error**: a quote the app would hide |
| AUC | how well P(not a quote) ranks false findings above real ones, threshold-free | compares models independently of the threshold |
| ECE | expected calibration error: gap between confidence and accuracy, averaged over 15 bins | 0 = when it says 90 %, it is right 90 % of the time |
| boundary accuracy | on real quotes with a boundary label | the second question |

Starting points to beat on **your 198 cards** (from [data.md](data.md)): base Laya zero-shot 59.1 % accuracy and **42.7 %**
real quotes wrongly rejected (boundary 32.9 %); span length alone 79.3 % and 12.9 %; JEV 86.4 % / 0.0 % but it catches only 21 % of false findings; Gemini 89.8 % / 0.0 % / 42 %.

### Details on your labels (section 9)
Per model:
* **the confusion matrix** (gold × predicted),
* **prior-corrected**: the decisions after shifting from the training balance (48.5 % or 25 % "not a quote") to the
  app's ~10 %. This is the number to compare with the balanced variant: if *soft_asis prior-corrected* ≈ *soft_balanced*,
  rebalancing bought nothing that a correction couldn't,
* **the threshold sweep**: reject only when P(not a quote) ≥ t. Each step up rejects fewer real quotes and catches fewer
  false findings. Pick the t whose *wrongly rejected* you can live with; that is the setting to use in the app,
* **by span length**: the shortcut check (the length-only regression rejects all 11 of your 1–3-word real quotes),
* **the reliability bins**: mean predicted P(not a quote) vs the observed share per bin. Calibrated = the two columns match,
* the boundary confusion matrix.

Read the three comparisons the variants were designed for:
* `soft_asis` vs `hard_asis`: what soft labels buy (expect mostly calibration, ECE, and little accuracy),
* `soft_asis` vs `soft_balanced`: what rebalancing does to *real wrongly rejected* vs *not-a-quote recall*,
* each vs base Laya and the baselines.

With 27 "not a quote" cards in your part, a difference inside the intervals is not a difference. Look at **you + Sonnet**
(1,243 cards) for the more precise picture, and at **Sonnet · other lectures** for generalisation to speakers that are not
Bin Baz.

## 4. Running the evaluation yourself
The same script runs anywhere (GPU or CPU, ~4 s per card on CPU):
```bash
python data/laya_datagen/datasets/laya_v1/eval_laya.py predict --model <model folder or Hub id> --name mine \
    --test data/laya_datagen/datasets/laya_v1/test_user.jsonl --out results/mine.json \
    --baselines data/laya_datagen/datasets/laya_v1/baselines.json --train-false-share 0.4852
python data/laya_datagen/datasets/laya_v1/eval_laya.py compare results/*.json
```
`--train-false-share` turns on the prior-corrected numbers: take it from `manifest.json → variants → <name> →
train_false_share`. The JSON results also contain every prediction (`predictions`), for your own analysis.

## 5. Using the model in the app
1. Get the model: the version's **Output** tab → `models/<variant>/` → download (or, with `PUSH_TO_HUB`, it is at
   `<your-username>/laya-wahy-<variant>`, private). Put the folder somewhere stable, e.g.
   `data/laya_models/laya-wahy-soft_asis/` (it must contain `rl_agent_config.json`, `model.safetensors`, `encoder/`,
   `tokenizer/`).
2. The app needs no code change. In the AI settings, Laya provider → checkpoint **custom** → the folder path (or the Hub id;
   a private repo needs `HF_TOKEN` in the backend's environment) → *Load*. The backend calls `laya.load(path)`
   ([backend/laya_engine.py](../../backend/laya_engine.py), `/api/laya/load` in [backend/app.py](../../backend/app.py)), which
   applies the fitted temperature. The app already strips the engine fields before calling Laya
   ([ai-verifier.js:1052](../../js/ai-verifier.js#L1052)), matching training.
3. Note for this machine: the installed PyTorch (CUDA 13 build) has no kernels for the GTX 1050 ("no kernel image is
   available"). Laya runs on CPU here (~4 s per finding) unless PyTorch is replaced by a CUDA 12 build that still supports
   Pascal GPUs.

## 6. If something goes wrong
| symptom | fix |
|---|---|
| `Expected 2 GPUs` | Settings → Accelerator → GPU T4 x2 |
| `pip` / download fails | Internet is off, or the account is not phone-verified |
| `IndexError` at `glob(... manifest.json)` | the dataset is not added as input (Add Input) |
| CUDA out of memory | `--micro-batch 4 --grad-accum 8` |
| one variant says *training failed* | `logs/train_<variant>.log` has the traceback; the other variants still ran |
| the run hangs at an epoch end | DDP waiting on an uneven batch; should not happen (the items are trimmed to an even count). Stop the version and rerun |
| temperature on the 0.5 / 5 clamp | the model is badly over- or under-confident on val: check the val curves and the learning rate |
| `Old scripts in the dataset` (run 2, section 3) | upload the rebuilt `laya_v1.zip` as a **New Version** of the dataset |

## 7. Run 2: learning curve + boundary fix ([notebooks/kaggle/laya_learning_curve_kaggle.ipynb](../../notebooks/kaggle/laya_learning_curve_kaggle.ipynb))
Written 2026-10-26, after run 1 (`notebooks/kaggle/finished/laya-wahy-finetuning-finished.ipynb`). Same data, val and test as run 1.

**Why the boundary collapsed in run 1.** 81 % of the training boundary labels are `COMPLETE_SPAN` (Sonnet marks 84–87 % of
its quotes complete; you mark 38–52 % of the same engines' quotes complete, the written text ~60 %). "Always complete" is
then the cheapest answer, and on val (86 % complete) it scores 86 % accuracy, which hid it. Measured with **balanced
accuracy** (mean recall of the 4 classes), every run-1 model is at 0.25 = "always complete". A no-model word-overlap rule
(`eval_laya.rule_boundary`: do the corpus words next to the span appear in the ASR next to it?) reaches 0.51 on your cards,
0.67 on the written text; JEV / Gemini reach 0.40–0.42 on your cards.

**What the run does** (~1 h 45 min, one commit):
- `curve_100`, `curve_25/50/75`: soft labels, 2 epochs, on all / ¾ / ½ / ¼ of the training lectures (nested, review lessons and
  batch lectures subsampled separately). Flat from 75 → 100 % = more of the same data will not help.
- `bnd_x3`, `bnd_x6`: all the data + `--boundary-oversample 3 / 6` (every `MISSING_*` boundary item repeated 3× / 6× per epoch;
  verdict items untouched). Success = boundary balanced accuracy above the rule's, with the verdict no worse than `curve_100`.

**Steps:** rebuild done (`data/laya_datagen/laya_v1.zip` carries the new scripts) → kaggle.com → your `laya_v1` dataset →
**New Version** → drop the zip → then Import the notebook, same settings as run 1 (T4 ×2, Internet on, `HF_TOKEN` secret),
**Save & Run All (Commit)**. Outputs: `results/learning_curve.png`, `results/boundary.md`, `results/comparison.md`; the kept models
(`curve_100`, `bnd_x3`, `bnd_x6`) go to private Hub repos `ZenoAbderrahim/laya-wahy-lc-<run>`.

## 8. Run 3: envelope v2 — passages, neighbours, yes/no boundary ([notebooks/kaggle/laya_v2_ablation_kaggle.ipynb](../../notebooks/kaggle/laya_v2_ablation_kaggle.ipynb))
Written 2026-10-27. Why and what: [envelope-v2.md](envelope-v2.md). Same labels and split as runs 1–2, new input.

**The five models** (2 epochs each, run 2's recipe, micro-batch 4 × 8 accumulation = the same effective batch of 64 now
that inputs reach 2048 tokens; a "cut off: yes" answer weighs 3× in the loss):

| run | what it adds | answers |
|---|---|---|
| `base` | the v2 fixes only (field order, no duplicate text, 2048, yes/no boundary + evidence) | what the fixes alone give |
| `passages` | + consecutive verses as one row (D) | D's share |
| `neighbours` | + nearest findings, no verdicts (A) | A's share |
| `both` | D + A | the candidate for the app |
| `both_synth` | D + A + counterfactual "cut off" rows | does fake-but-exact boundary data help the boundary? |

Plus the **before line**: your app model `laya-wahy-soft_asis` on the v1 test file. All are scored per verse on the
same cards (`eval_laya.per_verse`).

**Steps**
1. Build the data (once, local; ~1 h the first time after `js/ai-verifier.js` changed, minutes after):
   ```bash
   .venv/bin/python -c "from backend.laya_datagen import laya_v2 as V; m = V.build(); print(V.validate()); print(V.zip_dataset())"
   ```
   It writes `data/laya_datagen/datasets/laya_v2/` and `data/laya_datagen/laya_v2.zip`.
2. kaggle.com → *Datasets* → **New Dataset** → drop `laya_v2.zip` → name it `laya_v2` (a new dataset, not a version of
   `laya_v1`: the notebook finds it by the name in `manifest.json`).
3. *Code* → **Import notebook** → `notebooks/kaggle/laya_v2_ablation_kaggle.ipynb` → *Add Input* → `laya_v2` →
   settings as before (GPU T4 ×2, Internet on, `HF_TOKEN` secret: needed for the "before" line, your app model is private).
4. Run sections 1–4 interactively (~5 min) to check the GPUs, the dataset and the table of rows; then **Save Version →
   Save & Run All (Commit)**. Expect ~3–3.5 h.
5. When it is done: version → *Output* → download `results/` (a few MB) → unzip into `data/laya_datagen/results/run3/` →
   open `notebooks/results/laya_v2_compare.ipynb` and run it.
6. To use a model in the app: it is pushed to `ZenoAbderrahim/laya-wahy-v2-<run>` (private). Put that id in the AI tab's
   Laya checkpoint and load it: the app reads `wahy_envelope: 2` from its config and switches to passages / neighbours /
   yes-no boundary by itself (the checkpoint label shows `· v2`). Your current model keeps working unchanged.

**How to read it** (the compare notebook prints all of it):
* *by context* → *short (1-3 words) with a same-surah verse around*: the الواقعة 89 failure. The "real rejected" count
  should fall to ~0 for `passages` / `neighbours` / `both`.
* *not-a-quote recall* on your cards must not fall: A's risk is learning "has a neighbour → accept" (only 13 training
  examples say otherwise).
* boundary: *start / end cut off* balanced accuracy vs the rule's; `both_synth` vs `both` is the counterfactual data's effect.
* the val table in section 9: the yes/no balanced accuracy per epoch should rise well above 0.5.
* the last section of the compare notebook lists the verses whose answer changed: read the *broken* ones.
