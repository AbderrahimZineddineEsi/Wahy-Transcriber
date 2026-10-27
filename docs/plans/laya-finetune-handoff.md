# Handoff — prepare Laya's fine-tuning data + guides (the user trains on Kaggle)

**For:** a fresh Claude Code session, **Opus 5.5, high effort**. Read this file, then do the work in order. Written
2026-10-25.

## Who you are working with — read this first

The user is a **fifth-year AI student**. This fine-tuning is the part of the whole project they were aiming for from the
start, and they want to **learn it**, not just get files. So:

- Explain every decision as you make it: what it is, why it matters for *this* model and *this* data, what would go wrong
  otherwise, and what the alternatives are. Teach at a master's level (they know what a loss, a split or calibration is;
  connect it to how Laya actually does it).
- Prefer showing over telling: small tables of real counts from the data, a few real example rows (Arabic text included),
  the actual numbers behind each choice.
- Point them to the exact lines of the Laya code / notebook you are describing, so they can read along.
- Where a choice is genuinely theirs (label policy, class balance, what counts as success), lay out the options with your
  recommendation and **ask** — don't silently decide.
- Plain, clear prose; no jargon walls. They do not care about the engine algorithm or the UI: don't explain those beyond
  what the data needs.

## Where things stand (what you can rely on)

- **The task Laya learns** — for one engine finding (a span of the lecture's speech-to-text that the engine thinks is a
  Quran / hadith quote) answer two questions: `verdict` (real quote / not a quote / unsure) and `boundary_status`
  (complete / missing start / missing end / missing both — only for real quotes). Laya's input is the **envelope** the app
  builds: `WahyAiVerifier.buildCanonicalDecisionEnvelope(det, words, 25)` in `js/ai-verifier.js` → `{state, questions}`.
  Train / serve parity matters: training rows must use exactly that envelope (the records already carry it).
- **Labels are ready** — `docs/reports/laya-data-report.md` (read it): 5,203 usable findings, 2,239 "not a quote",
  2,886 real quotes with a boundary label, from the user's labels, Bin Baz's written text and Sonnet 5.5 (high). JEV,
  Gemini and base Laya answers exist too but are **not** training labels.
- **Code you will reuse:**
  - `backend/laya_datagen/inventory.py` — `collect()` (every finding record with its envelope), `answers()` (labels per
    reviewer), `usable()` (one label per finding, priority user > written text > Sonnet high > Sonnet medium, with
    "places" = near-duplicate spans merged), `splits()`.
  - `backend/laya_datagen/export.py` — `to_laya_row()` already writes Laya's training format `{state, questions, gold}`
    with soft labels (`EPS` per label source), the `engine_agnostic` profile (drops `engine_score` /
    `engine_confidence_band` from the state so Laya cannot shortcut on the engine's confidence) and `assign_splits()` by
    lecture. It predates Sonnet labels: its `EPS` has no entry for them.
  - `data/laya_datagen/datasets/human/` — an older export (v4 only, 308 rows): an example of the output, not the data to use.
- **Laya itself** — `pip show laya` → 0.4.12, installed in `.venv`. Training code: `.venv/lib/python3.14/site-packages/laya/train.py`
  (`TrainConfig`, `read_jsonl`, `items_from_rows`, `target_from_gold` / `target_from_expected`, `soft_ce_loss`,
  `rlcd_loss`, `split_calibration`, `train_cli.py`). The README is in `laya-0.4.12.dist-info/METADATA` (sections
  *Fine-Tuning* and *Calibration*; note: "`laya-multilingual` has no fitted temperatures at all", and it reads up to
  8,192 tokens with `max_len=8192`). Base checkpoint the app uses: `convaiinnovations/laya-multilingual` (see
  `backend/laya_datagen/teachers/laya_local.py`, `backend/laya_engine.py`).
- **The Kaggle notebook (find it, read all of it):** `notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb` in
  `https://github.com/NandhaKishorM/laya` (linked from the README; there is also an Apple-Silicon / CPU script
  `notebooks/laya_finetune_typed_decisions_mps.py`, and docs at `https://nandhakishorm.github.io/laya/`). It runs on
  Kaggle's free 2xT4 GPUs (DDP) and does the whole loop: build a dataset, train with RLCD (proper-scoring-rule rewards,
  GRPO-style policy gradient), fit calibration temperatures, evaluate, push to the Hub. Fetch it read-only (`gh` /
  raw.githubusercontent / WebFetch); do not modify the user's copies of anything.

## The work, in order

### 1. Understand the notebook and the trainer (and teach it)
Read the Kaggle notebook end to end and the parts of `laya/train.py` it calls. Write down, for the user:
- the exact row schema it consumes (our rows use `gold: {qid: {probabilities}}`; `expected: {qid: label}` also works),
  where in the notebook the dataset is built and how to replace that with our files;
- what each training stage does and why (soft cross-entropy vs RLCD, the sigma schedule, the calibration split and
  temperature fitting, evaluation, export / Hub push), with the hyperparameters and their defaults;
- what fits on 2xT4 (batch size, `max_len`, mixed precision, time per epoch for ~3.5k rows — estimate it).
Check the envelope token lengths of our rows against `max_len` (report the distribution).

### 2. Settle the data decisions with the user
Present each with real counts, your recommendation and the trade-off, then ask:
- **Split** — recommended: **test = the 15 reviewed Bin Baz lessons** (`lectures.REVIEWED`), scored on **the user's own
  labels** there (the gold standard); **train / val = the lecture batches**, split by lecture (never by row: near-duplicate
  spans of one quote and the context of one lecture must not leak across splits). Nothing from the test lessons is trained on.
- **Soft labels per source** — e.g. user 0.02, written text 0.05, Sonnet high ~0.08–0.10, Sonnet medium 0.15: explain
  label noise (Sonnet agreed with the user on 58 / 60 blind-test cards) and what the smoothing does to the loss and to
  calibration.
- **"Quoted by meaning" (243 cards)** — not an option of Laya's question today. Recommended: exclude for this first
  model; adding a 4th verdict means changing the app's question (`ai-verifier.js`) and the export together.
- **"Unsure"** — 1 card: the verdict head is effectively binary; say what that means for the 3-way head.
- **Class balance** — train is ~45 % "not a quote", the app's real stream ~10 %. Discuss reweighting vs leaving it and
  correcting with calibration / a decision threshold; recommend measuring on the test set both ways.
- **Shortcuts** — engine fields are dropped (engine-agnostic); check whether span length or other state fields predict
  the label on their own (a 5-minute baseline: logistic regression on length only) — a good learning exercise.
- **Near-duplicates** — keep both spans (different inputs, possibly different boundary labels) but always in the same split.

### 3. Build the data preparation (script + notebook)
`backend/laya_datagen/laya_dataset.py` (functions) + `notebooks/data/laya_dataset.ipynb` (runs them, shows the tables) that
write a Kaggle-ready folder, e.g. `data/laya_datagen/datasets/laya_v1/`:
`train.jsonl`, `val.jsonl`, `test.jsonl` (+ `test_user.jsonl` = rows labelled by the user), `manifest.json` (counts per
split × verdict × source × boundary, eps table, profile, label-file hashes, engine names, date). Reuse `inventory` +
`export.to_laya_row` (extend it for Sonnet sources rather than writing a second exporter). Keep `meta` per row
(doc, engine, label source, flags) — the trainer ignores it, the analysis needs it.
Validate locally, **without training**: load the files with Laya's own reader (`read_jsonl` + `items_from_rows`, or the
trainer's dry-run path if the notebook has one) on CPU, check every row produces items, and print 3 example rows.
Add a small `tests/laya_datagen/test_laya_dataset.py` (schema, no test lesson in train/val, no doc in two splits).

### 4. Documentation for learning — `docs/laya-finetune/data.md`
"What data Laya needs, and why": the two questions; the envelope fields (what each one gives the model); gold as
probability vectors and soft labels; where the labels come from and how much to trust each; the split and leakage; class
balance and calibration; what is deliberately hidden from the model (engine fields) and why; what we did not include
(by meaning, JEV / Gemini). Real examples and counts throughout.

### 5. Kaggle guide — `docs/laya-finetune/kaggle-guide.md`
Step by step for the user to do themselves: upload the folder as a Kaggle Dataset; copy the notebook; accelerator 2xT4,
internet on, HF token as a Kaggle secret; the exact cells / variables to change to point at our files; each
hyperparameter worth touching and what it does; how long it should take; how to read the training curves, the
calibration output and the evaluation. Then **our** evaluation: a short cell or script for `test_user.jsonl` — confusion
matrix, "not a quote" precision / recall (the rejection quality), share of real quotes wrongly rejected (the cost the user
cares most about), boundary accuracy, a calibration / reliability check, compared with base Laya and JEV on the same
cards (their answers are cached: `inventory.answers()`). Finally: how to download / push the model and point the app's
local Laya at it (`backend/laya_engine.py`, the `local_laya` provider).

## Rules
- Do not touch `js/**`, `index.html`, the engines or the UI. No git commits unless asked.
- Never call paid models (no labelling is needed). Keys live in `.env`; never print them.
- Do not train locally beyond a CPU dry run of a few rows; training is on Kaggle, by the user.
- Before editing a notebook the user has open, ask them to save it ([[notebook-edit-handshake]] in memory); prefer new files.
- Ask before any label-policy change (by meaning, unsure, weights).

## Done means
- The user understands (and you have explained) the notebook's pipeline and every data decision; the open decisions were
  asked and answered.
- `laya_dataset.py` + `notebooks/data/laya_dataset.ipynb` produce the Kaggle-ready folder; Laya's own reader loads it; tests pass.
- `docs/laya-finetune/data.md` and `docs/laya-finetune/kaggle-guide.md` exist, with real numbers and examples.
- A short "how it was made" section at the end of `data.md` (the user asks for this at the end of every task).
