# What data Laya needs, and why

Written 2026-10-25 for the first fine-tune of Laya on Wahy's findings (`laya_v1`). Every number below comes from the
data as it was on that date; re-run [notebooks/data/laya_dataset.ipynb](../../notebooks/data/laya_dataset.ipynb) to see them live.
Training it is in [kaggle-guide.md](kaggle-guide.md).

## 1. The task: two questions about one finding

The engine scans a lecture's speech-to-text (ASR) and flags spans that look like a Quran verse or a hadith. Laya gets **one
finding at a time** and answers two multiple-choice questions:

| question | options | asked for |
|---|---|---|
| `verdict` | `CORRECT` (a real quote) · `FALSE` (not a quote: ordinary speech that shares words) · `NOT_SURE` | every finding |
| `boundary_status` | `COMPLETE_SPAN` · `MISSING_START` · `MISSING_END` · `MISSING_BOTH` | real quotes only |

Both questions, with their instructions and the meaning of each option, are written once in the app:
`WahyAiVerifier.buildCanonicalDecisionEnvelope` ([js/ai-verifier.js:34](../../js/ai-verifier.js#L34)). Laya reads the
question text too: it is not a fixed classifier with 3 + 4 outputs, it is a **typed-decision model**. The model reads
`[CLS] question + instructions [SEP] [MASK] option 1 [MASK] option 2 … [SEP] state [SEP]` and scores each option at its
`[MASK]` position ([laya/common.py `build_sequence` / `build_head`](../../.venv/lib/python3.14/site-packages/laya/common.py#L157)).
So one row of data gives **two training items**, one per question: our 2,863 training rows become 4,306 items.

## 2. The input: the envelope's `state`

Train / serve parity is the first rule: Laya must be trained on exactly the input the app will send it. The records
already carry the envelope the app builds, and the exporter only removes the two engine fields (section 7). For one
finding the state is:

| field | what it gives the model |
|---|---|
| `source_type`, `candidate_reference` | QURAN / HADITH / ADHKAR and which verse or hadith the engine thinks it is |
| `canonical_corpus_text` | the text it would be a quote of (vocalised) |
| `context_before`, `matched_span_in_lecture`, `context_after` | the ASR span and 25 words on each side: *is the speaker quoting, or just talking?* |
| `unmatched_corpus_prefix_words` / `_suffix_words` | the 10 corpus words just before / after the matched part |
| `immediate_transcript_before` / `_after` | the 8 ASR words just before / after the span: compared with the two lines above, they answer *was the quote cut off?* |
| `quran_neighboring_context` | the previous / next verse (Quran only) |
| `has_citation_cue` | did the speaker say something like «قال الله تعالى» / «قال ﷺ» just before |

A real row (your label, test set), from Bin Baz lesson 180. The engine matched «وأقوموا الصلاة وآتوا الزكاة واركعوه» (ASR spelling)
to Al-Baqara 2:43. You answered *real quote, missing end*: the ASR right after the span says «عن راكعين», which is
«مَعَ الرَّاكِعِينَ», the end of the verse, and the span stops before it:

```json
"canonical_corpus_text": "وَأَقِيمُوا الصَّلَاةَ وَآتُوا الزَّكَاةَ وَارْكَعُوا",
"context_before": "… يقول الله جل وعلا في فتابه المبين،",
"matched_span_in_lecture": "وأقوموا الصلاة وآتوا الزكاة واركعوه",
"unmatched_corpus_suffix_words": "مَعَ الرَّاكِعِينَ",
"immediate_transcript_after": "عن راكعين. في آيات كثيرات نبرفها سبحانه في",
"has_citation_cue": true
gold: verdict CORRECT 0.98 · boundary MISSING_END 0.95
```

And a typical "not a quote" (Sonnet's label, training set): «الحق والباطل،» matched to Ar-Ra'd 13:17, in the middle of
«فمنهما تعرف أحكام الله … ويره الحق والباطل، فالواجب على كل مسلم أن يتفقه في دينه». Two common words, no citation cue, ordinary
speech. gold: `FALSE 0.92`.

### How long the input is, and what gets cut
Laya reads at most `max_len = 1024` tokens (the multilingual checkpoint's own setting, and what the app passes). The verdict
question (instructions + options) takes 178 tokens and the boundary question 242, which leaves 845 / 781 tokens for the state.
Over the 4,386 train + test rows:

| state tokens | median 480 | p90 631 | p95 690 | p99 889 | max 3,180 |
|---|---|---|---|---|---|

When the state is too long, `build_sequence` keeps its **start** and drops the end (training and the app alike, so
parity holds). 55 rows lose the end of their state for the verdict, 87 for the boundary question, and in **15 rows the cut
reaches the matched span itself**, because a long `canonical_corpus_text` (a whole hadith) comes earlier in the JSON. Those
rows are kept: the app would send Laya the same truncated input. Putting the span before the corpus text in the envelope
would fix them, but it changes the app's input, so it is a change for a later version (the envelope and the training data
must change together).

## 3. The labels: probability vectors, not class ids

Laya's trainer reads `gold: {question: {probabilities: {option: p}}}` (`laya.train.target_from_gold`,
[train.py:167](../../.venv/lib/python3.14/site-packages/laya/train.py#L167)). It trains the model's softmax over the
options toward that vector. We use this for **soft labels**: the labelled option gets `1 − ε` and the other options share ε.

**Why.** Some labels are wrong. With one-hot targets (ε = 0) the cross-entropy keeps pushing a training card's logits apart
without limit, including on the ~3 % of Sonnet cards where Sonnet is wrong. The model learns to be extremely sure, and
being extremely sure *and wrong* is what a confidence threshold in the app cannot recover from. With `1 − ε` the optimum of
the soft cross-entropy is `p = 1 − ε`, so the model is pulled toward "confident, not certain". A wrong label then costs a
bounded amount instead of dominating the gradient. This is label smoothing, with ε set per source to roughly how often that
source is wrong:

| source | agreement with you | ε verdict | ε boundary |
|---|---|---|---|
| you | (the reference) | 0.02 | 0.05 |
| Bin Baz written text | 155 / 156 verdicts, **128 / 152 boundaries** (not blind: stage 2 showed you its label) | 0.03 | 0.15 |
| Sonnet 5.5 high | 58 / 60 verdicts, 23 / 24 boundaries (blind tests, `agent_eval/report_r1/r2.md`) | 0.08 | 0.10 |
| Sonnet 5.5 medium | not measured apart from high | 0.12 | 0.15 |

(`EPS_BY_SOURCE` in [export.py](../../backend/laya_datagen/export.py).) The written text's boundary disagreements all go
one way: you saw words cut off that it did not (12 × *missing end* vs *complete*, 6 × *missing start* vs *complete* …),
because it marks the quote in the *written* lesson while you judged what was *said*. ε is larger than the measured error
for Sonnet (58/60 is 3 %, but on 60 cards the 95 % interval goes down to ~88 % agreement).

Two things smoothing does **not** do. It does not weight cards: Laya has no per-sample weights, so your card and a Sonnet
card count the same in the average loss, and only the sharpness of the target differs. And it does not calibrate the model:
calibration is fitted after training on held-out data (section 6). Variant `hard_asis` (ε = 0) measures what smoothing buys.

## 4. Where the labels come from

One label per finding (`inventory.usable`), with priority **you > Bin Baz written text > Sonnet high > Sonnet medium**.
JEV, Gemini and base Laya answers exist but are never labels: they agree with you on only 78 %, 81 % and 52 % of verdicts.

| lectures | what they are | your labels | written text | Sonnet |
|---|---|---|---|---|
| 15 review lessons | Bin Baz lessons you labelled in `laya_review.ipynb` | 395 | 453 | 875 |
| batch 1 (25) | 20 YouTube (10 sheikhs) + 5 Bin Baz | – | 63 | 1,468 |
| batch 2 (46) | 38 YouTube (12 sheikhs) + 8 Bin Baz | – | 66 | 1,883 |

The written-text labels are automatic: binbaz.org publishes each lesson's written transcript with the quotes marked; a
finding that lands on a marked quote is *real* (`pos_strong`), one that lands on a different marked quote is *not a quote*
(`wrong_id`) ([label.py](../../backend/laya_datagen/label.py)). Your choice: **the written text is used for testing only**,
never for training. 302 findings in the train / val lectures are dropped because of it.

## 5. The split, and why it is by whole lecture

A lecture holds many findings that are not independent: several engines (v3, v4, v5, the loose profile) find the **same
quote** with slightly different spans, and every finding shares the speaker, the topic and the ASR's error style of its
lecture. Split card by card, and a near-copy of a test card would be in training: the test would measure memory, not
generalisation. So every lecture goes entirely to one split ([laya_dataset.assign_splits](../../backend/laya_datagen/laya_dataset.py)):

| split | lectures | rows | what for |
|---|---|---|---|
| **test** | 6 review lessons (180, 561, 565, 821, 1937, 2950) + 14 batch lectures: 1 per YouTube sheikh (12) + 2 Bin Baz | 1,523 | the scores |
| **val** | 9 batch lectures (1 of every other sheikh + 2 Bin Baz) | 515 | the calibration temperature + the overfitting check |
| **train** | the other 9 review lessons + 48 batch lectures | 2,863 | training |

What the test holds:

| test group | cards | real | not a quote |
|---|---|---|---|
| **you** | 198 | 171 | 27 |
| Sonnet · review lessons (Bin Baz) | 449 | 162 | 287 |
| Sonnet · other lectures (12 YouTube sheikhs + 2 Bin Baz) | 596 | 329 | 267 |
| you + Sonnet (the combined score) | 1,243 | 662 | 581 |
| written text | 280 | 274 | 6 |

Sonnet's test cards are much harder on rejection than yours (53 % "not a quote", mostly loose-profile look-alikes, vs
14 %). That is why each group is scored separately as well as combined.

The 6 review lessons were chosen so that your labels split almost exactly in half (198 test / 197 train, 27 / 28 "not a
quote"). Training on 197 of your cards is your choice. They are the only gold-standard labels, and the only ones from the
precise engines' stream, like the app's. The cost is a smaller test: on 27 "not a quote" cards one mistake moves the
recall by ~4 points, so the evaluation prints a 95 % interval next to every rate.

Near-duplicates (several spans of one quote) are all kept: they are different inputs and can have different boundary
labels, and the lecture split keeps them together.

## 6. Class balance and calibration

| | "not a quote" share |
|---|---|
| train (`soft_asis`, `hard_asis`) | **48.5 %** |
| train (`soft_balanced`) | 25.0 % (1,965 rows: Sonnet's negatives downsampled at random, yours all kept) |
| your test cards | 13.6 % |
| the app's real stream (v4 / v5 precision ~90 %) | ~10 % |

The negatives are mostly the loose engine profile's look-alikes (88 % of training negatives), mined on purpose because the
precise engines make few mistakes. A classifier learns the class prior along with everything else: trained at 48 %, it
says "not a quote" more readily than a 10 % stream warrants. Three ways to deal with it:

1. **Leave it, correct afterwards.** By Bayes, `p_app(c | x) ∝ p_train(c | x) · π_app(c) / π_train(c)`. The evaluation
   reports every model's decisions both raw and prior-corrected to 10 %, plus a threshold sweep (reject only if
   P(not a quote) ≥ t).
2. **Rebalance the data** (`soft_balanced`). Closer to the real stream, but ~900 negatives are thrown away.
3. **Reweight the loss.** Laya's trainer has no per-sample weights, so this is not available without changing it.

Temperature calibration is separate from the prior. After training, one scalar *T* per question type is fitted on the
**val** lectures so that `softmax(logits / T)` gives confidences that match accuracy (`laya.calibrate.fit_temperature_map`).
Two details matter here:
* The original notebook fits *T* on a random 10 % of the training items. These share lectures and near-duplicates with
  training, so the model looks better on them than on new lectures, and *T* comes out too small (over-confident). We fit on
  whole held-out lectures instead.
* Per-option-count buckets need 2,000 records (`MIN_BUCKET_N`). We have 779 val items, so **verdict and boundary share one
  "choice" temperature**. The evaluation reports ECE per question so you can see if that hurts one of them.

`NOT_SURE`: one card in all the usable data (in a training lesson). That slot only ever receives the ε/2 smoothing mass,
so the model learns "NOT_SURE ≈ 1–4 %" and in practice never picks it: the verdict head behaves as binary.

## 7. What is hidden from the model, and the shortcut check

`engine_score` and `engine_confidence_band` are removed from the state (`engine_agnostic` profile, `ENGINE_STATE_KEYS` in
[export.py](../../backend/laya_datagen/export.py)). They describe the engine, not the lecture: the score alone gets AUC 0.89
on the test lessons, so Laya would learn "high score ⇒ real", which breaks as soon as the engine changes. The app removes
them too before calling Laya (`LAYA_HIDDEN_STATE_KEYS`, [ai-verifier.js:1052](../../js/ai-verifier.js#L1052)).

What cannot be hidden is the span itself, and **its length alone is a strong signal**. In training:

| span words | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10+ |
|---|---|---|---|---|---|---|---|---|---|
| rows | 534 | 468 | 378 | 272 | 198 | 137 | 116 | 80 | 678 |
| share "not a quote" | 92 % | 81 % | 55 % | 44 % | 31 % | 26 % | 25 % | 8 % | 9 % |

A logistic regression on the span length only (fit on train, [laya_dataset.shortcut_baselines](../../backend/laya_datagen/laya_dataset.py)),
and the cached teacher answers, on the test set:

| on your 198 cards | cards | accuracy | "not a quote" caught | real quotes wrongly rejected | AUC |
|---|---|---|---|---|---|
| **base Laya, zero-shot** (run 2026-10-25 on the v1 test rows) | 198 | 59.1 % | 85.2 % (23 / 27) | **42.7 % (73 / 171)** | 0.76 |
| span length only (LR) | 198 | 79.3 % | 29.6 % (8 / 27) | 12.9 % | 0.72 |
| 7 shallow fields (LR) | 198 | 83.8 % | 66.7 % | 13.5 % | 0.86 |
| JEV (cached) | 147 | 86.4 % | 20.8 % | 0.0 % | 0.60 |
| Gemini (cached) | 147 | 89.8 % | 41.7 % | 0.0 % | 0.71 |
| base Laya (cached, older envelopes) | 111 | 54.0 % | 88.9 % | 48.0 % | 0.70 |

| on you + Sonnet (1,243 cards) | accuracy | "not a quote" caught | real wrongly rejected | AUC |
|---|---|---|---|---|
| span length only (LR) | 81.7 % | 78.7 % | 15.7 % | 0.89 |
| 7 shallow fields (LR) | 85.5 % | 89.3 % | 17.8 % | 0.93 |

Base Laya is the "before" picture. It rejects too much and is far too sure: on the cards where it says ~92 % "not a
quote", only 33 % really are, and its boundary accuracy is 32.9 % (mostly *missing both* for complete spans). Fine-tuning
has a lot of room. And 7 cheap numbers already get 85 % on the big test. The trap shows on your cards by span length: the length-only model rejects
**all 11** of your real quotes of 1–3 words («وَالْعَصْرِ», «فاستقم كما أمرت»…). Laya has to beat these lines overall *and*
not repeat that failure on short spans; the evaluation's *by span length* table is where to look.

## 8. What is not in v1

* **Quoted by meaning** (243 cards): not an option of Laya's question. Your choice: excluded for v1. Note that the
  question's own `NOT_SURE` text already says "partial paraphrase / meaning-only allusion", while the app's strict-mode
  prompt for LLMs calls paraphrases FALSE. Adding them means deciding which one, and changing the question in
  `ai-verifier.js` and the exporter together.
* **JEV / Gemini / base Laya answers**: comparison baselines only (cached in `baselines.json`), never training labels.
* **Engine fields**: hidden (section 7).

## 9. The files (`data/laya_datagen/datasets/laya_v1/`)

```
soft_asis/{train,val}.jsonl       2,863 / 515 rows   soft labels, as is
soft_balanced/{train,val}.jsonl   1,965 / 515 rows   soft labels, train "not a quote" downsampled to 25 %
hard_asis/{train,val}.jsonl       2,863 / 515 rows   one-hot labels
test.jsonl / test_user.jsonl      1,523 / 198 rows   shared test (soft gold; scored on the hard label in meta)
baselines.json                    shortcut regressions + cached JEV / Gemini / base-Laya answers on test rows
manifest.json                     counts per split × source × verdict × boundary, ε table, lecture lists, label-file hashes
train_ddp.py, eval_laya.py        the Kaggle training and evaluation scripts
```

One row = `{id, state, questions, gold, meta}`. Laya reads the first four. `meta` (lecture, split, speaker, engine, label
source, hard label, span length…) is ignored by the trainer and used by the evaluation.

## How it was made

* **Path.** Read the Laya repo's Kaggle notebook (cloned read-only) and `laya/train.py`, `common.py`, `calibrate.py`
  (the installed 0.4.12 differs from the repo's 0.4.15 only in two cosmetic functions). Found the notebook trains the English
  checkpoint and calibrates on a random item slice. Measured token lengths, label agreement, and the shortcut regression.
  Settled the decisions with you: test = your labels + Sonnet's spread over many lectures + the written text, 200 of your
  labels trained on, written text test-only, quoted-by-meaning excluded, three variants (soft as is / soft balanced / hard).
* **Code.** `backend/laya_datagen/laya_dataset.py` (split, rows, balancing, shortcut baselines, build, validate, truncation),
  `export.to_laya_row` extended with a label override and per-question ε (`EPS_BY_SOURCE`), `backend/laya_datagen/kaggle/`
  (`train_ddp.py` adapted from the notebook, every change marked `# CHANGED`; `eval_laya.py`),
  `notebooks/data/laya_dataset.ipynb`, `notebooks/kaggle/laya_finetune_kaggle.ipynb`.
* **Checks.** Every file loaded with Laya's own `read_jsonl` + `items_from_rows` at 1024 / 256: 0 skipped (4,306 train items
  for 2,863 rows), plus `laya.train.dry_run`. `train_ddp.py` ran end to end with `torchrun --nproc_per_node=2` on CPU (gloo)
  with a 2-layer random checkpoint and 24 rows. The Kaggle notebook's cells ran locally with the paths swapped, the training
  loop included. `eval_laya.py` was run with base Laya on your 198 test cards (CPU). Tests:
  `pytest backend/tests/laya_datagen/` (46 passed, 5 new in `test_laya_dataset.py`).
* **Commands.** `.venv/bin/python -m pytest backend/tests/laya_datagen -q` ·
  `jupyter-execute --inplace notebooks/data/laya_dataset.ipynb` ·
  `torchrun --standalone --nproc_per_node=2 data/laya_datagen/datasets/laya_v1/train_ddp.py <ckpt> <out> --train … --val … --limit 24`.
  No paid model was called.
