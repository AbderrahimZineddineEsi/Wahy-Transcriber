# Notebooks

Run local notebooks from anywhere inside the repo (they look for `backend/` upward); the Kaggle ones only run on Kaggle.

## `data/` — building and labelling the Laya data (local, in this order)

| notebook | what it does |
|---|---|
| [laya_data_generation.ipynb](data/laya_data_generation.ipynb) | Bin Baz lessons + ASR → engine findings, labelled from the written text |
| [laya_review.ipynb](data/laya_review.ipynb) | your review stages, the AI labellers compared on your cards |
| [laya_autolabel.ipynb](data/laya_autolabel.ipynb) | Sonnet labels on the YouTube / Bin Baz lecture batches |
| [laya_lectures.ipynb](data/laya_lectures.ipynb) | lecture batch 2 (download, transcribe, detect) |
| [laya_engine_v5.ipynb](data/laya_engine_v5.ipynb) | engine v5 vs v3 / v4 on the labelled findings |
| [laya_dataset.ipynb](data/laya_dataset.ipynb) | builds `laya_v1` (runs 1–2) — `laya_v2` is built by `backend/laya_datagen/laya_v2.py` (see `docs/laya-finetune/kaggle-guide.md` §8) |

## `kaggle/` — fine-tuning runs (upload to Kaggle, GPU T4 ×2)

| run | notebook | dataset | finished copy (outputs) |
|---|---|---|---|
| 1 | [laya_finetune_kaggle.ipynb](kaggle/laya_finetune_kaggle.ipynb) — soft / balanced / hard labels | `laya_v1` | [finished/laya-wahy-finetuning-finished.ipynb](kaggle/finished/laya-wahy-finetuning-finished.ipynb) |
| 2 | [laya_learning_curve_kaggle.ipynb](kaggle/laya_learning_curve_kaggle.ipynb) — learning curve + boundary oversampling | `laya_v1` | [finished/laya-learning-curve-kaggle-finished.ipynb](kaggle/finished/laya-learning-curve-kaggle-finished.ipynb) |
| 3 | [laya_v2_ablation_kaggle.ipynb](kaggle/laya_v2_ablation_kaggle.ipynb) — envelope v2: passages / neighbours / yes-no boundary | `laya_v2` | [finished/wahy-finetuning-laya-v2.ipynb](kaggle/finished/wahy-finetuning-laya-v2.ipynb) |
| 4 | [laya_run4_kaggle.ipynb](kaggle/laya_run4_kaggle.ipynb) — verdict-only / boundary-only / repeat | `laya_v2` (new version) | [finished/wahy-laya-finetuning-run4.ipynb](kaggle/finished/wahy-laya-finetuning-run4.ipynb) |
| 5 | [laya_run5_kaggle.ipynb](kaggle/laya_run5_kaggle.ipynb) — passages on v1 envelope (verdict only) | `laya_v2` | [finished/wahy-laya-finetuning-run5.ipynb](kaggle/finished/wahy-laya-finetuning-run5.ipynb) |
| 6 | [laya_run6_kaggle.ipynb](kaggle/laya_run6_kaggle.ipynb) — envelope v3: clean boundary cues + mixed single & passages | `laya_v2` | (ready to run: [wahy-laya-finetuning-run6.ipynb](wahy-laya-finetuning-run6.ipynb)) |

## `results/` — reading a run's results locally

| notebook | what it does |
|---|---|
| [laya_v2_compare.ipynb](results/laya_v2_compare.ipynb) | run 3: the downloaded `results/` folder → tables, slices, the cards whose answer changed |
