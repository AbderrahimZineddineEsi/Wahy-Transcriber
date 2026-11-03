# Handoff: Laya fine-tuning, state at 2026-10-27

For the next person or AI (including the owner). Read this first, then `docs/laya-finetune/envelope-v2.md` and
`docs/laya-finetune/kaggle-guide.md` (§8 = run 3/4 steps). Nothing from the latest session is committed to git.

## The project in one paragraph
Wahy Transcriber finds Quran/hadith quotes in lecture transcripts (engine v3/v4/v5 in `js/engine*.js`). **Laya** is a small
local model (mmBERT-base, `convaiinnovations/laya-multilingual`) fine-tuned to verify each finding: *is it a real quote?*
(`verdict`: CORRECT / FALSE / NOT_SURE) and *is the span cut off?* (boundary). Data: labelled findings from lectures
(`backend/laya_datagen/`, labels by the owner, Sonnet 5.5, and Bin Baz written text). Training runs on Kaggle (2x T4); the
app runs the model locally on a GTX 1050 (3 GB).

## History
| run | what | result |
|---|---|---|
| 1 | `laya_v1` data, 3 variants (soft_asis / soft_balanced / hard_asis) | soft_asis = app model `ZenoAbderrahim/laya-wahy-soft_asis`: verdict acc ~91 %, AUC 0.944 on the owner's 198 cards. **Boundary head collapsed** (always "complete", balanced acc 0.25). |
| 2 | learning curve + boundary oversampling | `curve_100` verdict AUC 0.945; more data flat after 50 % on Sonnet labels; oversampling lifted boundary only to 0.28-0.35; the no-model word-overlap rule (0.51) beat every model. |
| GPU fix | project `.venv` had torch cu130 (no sm_61 kernels) so Laya ran on CPU | installed torch 2.14.1+cu126 in `.venv`; app now runs on the GTX 1050 (~0.8 s/finding). |
| 3 | envelope v2 ablation (see below) | notebook `notebooks/kaggle/finished/wahy-finetuning-laya-v2.ipynb` |
| 4 | **ready, not yet run** | `notebooks/kaggle/laya_run4_kaggle.ipynb` |

## The problem that started run 3
Short verses inside a recitation were rejected (الواقعة 89 between 88 and 90; عبس 35-36; المدثر 10). Cause: 86 % of
1-3-word Quran spans in the training data are FALSE, so the model learned "short = coincidence". Measured on verse 89 with the
v1 model: neighbours listed 0.28 -> 0.68 (P real), verses 88-90 as one passage 0.87, neighbours' verdicts added nothing.

## Envelope v2 (what changed in the input; full spec in `docs/laya-finetune/envelope-v2.md`)
- **Passages (D):** consecutive verses of one surah (gap <= 2 words) = one finding. Runs > 6 verses are split into equal
  parts (7 -> 4+3, never 6+1). Overlapping windows were considered and rejected.
- **Neighbours (A):** nearest other findings (<= 40 words) listed with reference, same_surah, ayah_distance, gap text; no verdicts
  (avoids order dependence and error spreading).
- Lecture fields before the corpus text; duplicate `current_ayah_text` removed; max_len 2048 (short inputs cost the same).
- Boundary = two yes/no (`noul`) questions `start_missing` / `end_missing` + word-overlap evidence fields
  (`prefix_words_heard` / `suffix_words_heard`). Reason: the owner plans an **auto-heal** feature that needs the side.
- **One builder for app and data:** `buildLayaV2Requests` in `js/ai-verifier.js`; the datagen calls it through
  `backend/laya_datagen/js/harness.js` (`EngineBridge.laya_v2`). Never fork it. Changing it means rebuilding the dataset.
- Checkpoints carry `wahy_envelope: 2`, `wahy_envelope_options`, optionally `wahy_questions` in `rl_agent_config.json`
  (`train_ddp.py --cfg-extra`); `/api/laya/status` reports it as `envelope`; the app switches builder by it. v1 models and
  the base model work unchanged. A verdict-only checkpoint (`wahy_questions: ["verdict"]`) is asked only the verdict and the
  app takes the boundary from `boundaryByRule` (word-overlap).

## Run 3 results (5 v2 models vs the app model, per verse, same 1,523 test verses)
- Short-verse fix works where aimed: real verses rejected inside a passage 3/64 -> 0/64 (you+Sonnet).
- **But the verdict got worse:** your-cards AUC 0.945 (run 2 curve_100) -> 0.857-0.890; not-a-quote recall 85 % -> 48-70 %.
  Best v2 was `both` (AUC 0.890, acc 88.4 % vs 91.4 % before).
- **Boundary still collapsed** (balanced 0.5 on yes/no) for base/passages/neighbours/both; only `both_synth` (counterfactual
  boundary rows) moved (0.60/0.59) and still lost to the rule (0.69/0.75).
- Hypothesis (untested): boundary items compete with the verdict in the shared encoder (also seen in run 2).

## Run 4 (next step, ~2 h on Kaggle)
`both_verdict` (v2 D+A, verdict only), `v1_verdict` (old envelope, verdict only; control), `boundary_only` (both_synth data,
boundary only), `both` (run 3's both again = noise check). Also boundary scored with thresholds tuned on val (`--tune-val`).
**Decision rule:** if `both_verdict` recovers verdict AUC (~0.94+) and keeps the passage gains, use it in the app (boundary
from the rule). If `v1_verdict` is equally good, the boundary was the culprit; if both are low, the v2 input itself hurts.

## What to do next
1. Kaggle: dataset `laya_v2` -> **New Version** with `data/laya_datagen/laya_v2.zip` (rebuild: see below if scripts changed).
2. Import `notebooks/kaggle/laya_run4_kaggle.ipynb` (T4 x2, Internet on, `HF_TOKEN` secret), Save & Run All.
3. Download `results/` -> `data/laya_datagen/results/run4/`; open `notebooks/results/laya_v2_compare.ipynb` (`RUN = "run4"`).
   This notebook was NOT executed end to end (my test run failed on its output path); run it and fix if needed.
4. If a model wins: load `ZenoAbderrahim/laya-wahy-r4-<run>` in the app's Laya checkpoint field.
5. Later ideas: auto-heal using `boundaryStartMissingP/EndMissingP`; label more hard negatives (FALSE with a same-surah
   neighbour: only 13 in train); calibration; boundary may stay on the rule.

## Commands
```bash
# tests (1 pre-existing failure: backend/tests/tafrigh/test_review_flow.py::test_review_endpoint_survives_a_server_reload)
.venv/bin/python -m pytest -q
# rebuild laya_v2 (needs the inventory; ~26 min the first time, engines cached afterwards; build ~1.5 min)
.venv/bin/python -c "from backend.laya_datagen import laya_v2 as V; V.build(); print(V.validate()); print(V.zip_dataset())"
# GPU check
.venv/bin/python -c "import torch; print(torch.randn(8,device='cuda').sum())"
```

## Gotchas learned the hard way
- `harness.js` must build `v5:loose` via `localStorage.wahyEngine="v5:loose"` (it now checks the profile); a wrong build
  silently dropped 1,412 rows once. Wrong cache entries of 2026-10-27 were deleted.
- Finding keys (`doc|start-end|unit`) do not include the engine: `laya_v2.make_row` counts a label only in its own engine run.
- Editing `js/ai-verifier.js` changes the harness fingerprint -> datagen caches rebuild; build via a saved inventory pickle if
  the same session rebuilds repeatedly.
- `matplotlib` is not in `.venv` (Kaggle has it); the local compare notebook does not need it.
- Do not `pkill -f` a pattern that appears in your own command (exit 144).
- Laptop sleep kills CUDA runs: wrap long jobs in `systemd-inhibit --what=sleep:idle`.

## Where things are
- Code: `backend/laya_datagen/{laya_v2.py,laya_dataset.py,inventory.py,engine_bridge.py,js/harness.js,kaggle/train_ddp.py,kaggle/eval_laya.py}`,
  `js/ai-verifier.js` (v2 section 1a'), `backend/laya_engine.py`, `backend/app.py`.
- Data: `data/laya_datagen/` (ignored by git): `datasets/laya_v1`, `datasets/laya_v2`, `laya_v2.zip`, `labels/`, `cache/`.
- Docs: `docs/laya-finetune/` (data.md, envelope-v2.md, kaggle-guide.md), `docs/reports/`, `docs/plans/`, `docs/README.md`.
- Notebooks: `notebooks/README.md` indexes them. Backup before the reorg: `archive/2026-10-27-before-reorg.tar.gz`.
- Owner prefs (memory): wants to learn fine-tuning; plain explanations; honest opinions; ask them to save open notebooks before editing.
