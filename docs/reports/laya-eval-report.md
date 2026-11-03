# Laya checkers on the same test cards (2026-10-27)

Every verifier scored on the `laya_v1` test set (1,523 rows) with the same input Laya gets, plus Sonnet (the labeller)
checked against all 440 of your labels. Follows run 2 (`notebooks/kaggle/finished/laya-learning-curve-kaggle-finished.ipynb`).

## Verdict on your 198 test cards

| checker | accuracy | your fakes caught | real quotes wrongly rejected | AUC |
|---|---|---|---|---|
| Sonnet high, no written text | 96.0 % | 81.5 % | 0 % | 0.91 (hard answers) |
| Sonnet high, with written text | 97.0 % | 85.2 % | 0 % | 0.93 (hard answers) |
| soft_asis (run 1) | 91.4 % | 77.8 % | 6.4 % | 0.944 |
| hard_asis (run 1) | 90.4 % | 85.2 % | 8.8 % | 0.945 |
| curve_100 (run 2) | 89.4 % | 85.2 % | 9.9 % | 0.945 |
| JEV (probabilities) | 88.9 % | 18.5 % | 0 % | 0.858 |
| 7 shallow fields (LR) | 83.8 % | 66.7 % | 13.5 % | 0.857 |
| base Laya | 59.1 % | 85.2 % | 42.7 % | 0.763 |
| GPT-4o mini (100 of these cards) | 75 % | 36 % | 18.6 % | 0.72 |

On Sonnet's labels JEV ranks as well as the fine-tuned models (AUC 0.95–0.97), but its default 0.5 threshold catches only
40–48 % of fakes. On your labels only the fine-tuned models (and Sonnet) are close to your standard.

## Boundary (balanced accuracy, your cards)

Sonnet 0.79–0.83 · word-overlap rule 0.51 · JEV 0.47 · bnd_x6 0.35 · base Laya 0.31 · bnd_x3 0.28 · other fine-tuned 0.25.

## Sonnet vs you, all 440 cards

- Real vs not a quote: 95.4 % agreement (96.2 % with the written text); 46/55 of your fakes caught; 6/339 real called fake.
- Boundary: 87–89 % agreement; Sonnet calls 58 % complete, you 54 %.
- Main difference: your "quoted by meaning" cards: Sonnet calls 21 of 45 real (that class is not in Laya's data).
- So the training labels are trustworthy. The earlier explanation of the boundary collapse ("Sonnet is lenient") was
  wrong: the 84–87 % "complete" in training comes from different cards (v5 / loose findings on YouTube lectures), not a
  different standard.

## How it was made

- `backend/laya_datagen/teacher_eval.py`: sends each test row's `state` + `questions` (Laya's exact input) to
  - JEV (`typesafe/jev-1.14`, OpenRouter Decisions API): 1,523 rows, $0.097;
  - base Laya (`convaiinnovations/laya-multilingual`), locally: 63 min on the GTX 1050, through the binbaz-rag venv
    (cu126 torch, the project venv's cu130 torch has no sm_61 kernels), wrapped in `systemd-inhibit`;
  - GPT-4o mini (OpenRouter chat, `temperature 0`, JSON reply; P(verdict) from the logprobs of the label token):
    100 of your test cards + 100 Sonnet cards from the same review lessons, $0.03.

  Raw replies are cached per row (re-running resumes). Scoring is `eval_laya.evaluate`, the code the Kaggle runs use.
  `python -m backend.laya_datagen.teacher_eval {jev,laya,chat,report}`.
- `backend/laya_datagen/sonnet_eval.py`: Sonnet high via `claude -p`, same guide / card text / batch of 10 as
  `autolabel.py`, on all 440 of your cards (stages 2 / 4 + negatives sprint), with and without Bin Baz's written text.
  Answers in `labels/sonnet_user_{nowritten,written}.json` (no exporter reads them). 88 calls, ~25 min.
  `python -m backend.laya_datagen.sonnet_eval run` / `report`.
- The fine-tuned models' numbers come from the two Kaggle notebooks (same `test.jsonl`), not re-run locally.
