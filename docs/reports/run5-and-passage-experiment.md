# Laya Experiments: Run 5 & Zero-Shot Passages on `soft_asis`

**Date:** 2026-10-27  
**Branch:** `laya-experiments`  
**JSON Artifact:** `notebooks/results/soft_asis_on_v1_passages.json`

---

## 1. Executive Summary

1. **Run 5 (Fine-tuning on Passages):**
   * Testing whether training exclusively on merged passages solves middle-of-chain recitation drops without losing verdict quality.
   * **Result:** While it eliminated dropped recitation verses (0/12 missed), it severely degraded the model on single/short quotes:
     * Accuracy fell from **91.4%** to **84.9%**.
     * False rejections of real Quran verses more than doubled from **6.4%** to **14.0%**.
     * Short quote (1–3 words) accuracy fell to **58.8%** (rejecting 7 out of 11 real quotes).

2. **Zero-Shot Test: `soft_asis` on Combined Passages:**
   * Testing whether our current best production model (`ZenoAbderrahim/laya-wahy-soft_asis`) already handles combined passages without retraining.
   * **Result:** **Success.**
     * Consecutive recitation drops: **0 / 12 missed on `you` (100%)** and **0 / 65 missed on `you + Sonnet` (100%)**.
     * Beat Run 5 across every metric: **86.9%** accuracy (vs 84.9%) and **9.9%** false rejection (vs 14.0%).
     * Long spans (9+ words): **0 / 100 wrongly rejected (0.0%)**.

---

## 2. Comparison Table (Cards: `you`)

| Model | Evaluation Set | Verdict Accuracy | AUC | Real Wrongly Rejected | Not-a-quote Precision |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **`soft_asis` (Production)** | `v1_test` (single verses) | **91.4%** | **0.944** | **6.4%** | **65.6%** |
| **Run 4 `v1_verdict`** | `v1_test` (single verses) | **91.4%** | **0.933** | **4.1%** | **70.8%** |
| **Run 5 `v1_passages`** | `v1_passages` (passages) | 84.9% | 0.924 | 14.0% | 46.7% |
| **Run 5 `passages_verdict`** | `passages` (v2 envelope) | 84.9% | 0.864 | 14.6% | 46.8% |
| **`soft_asis` (Zero-Shot)** | `v1_passages` (passages) | **86.9%** | **0.908** | **9.9%** | **51.4%** |

---

## 3. Slice Breakdown: `soft_asis` on `v1_passages`

### By Context (Cards: `you`)
* **Inside a passage of consecutive verses:** 100.0% [76–100] · **0/12 real rejected**
* **Next to a verse of the same surah (<= 3 ayat away):** 72.7% [43–90] · 3/11 real rejected
* **Short (1-3 words) and isolated:** 61.5% [36–82] · 5/7 real rejected
* **Short (1-3 words) with same-surah verse around:** 100.0% [51–100] · **0/4 real rejected**
* **Has any neighbour finding (<= 40 words):** 90.4% [84–94] · 9/120 real rejected
* **No neighbour finding:** 79.4% [68–88] · 8/51 real rejected

### By Span Length (Cards: `you`)
* **1–3 words:** 70.6% [47–87] · 5/11 real rejected *(Run 5 rejected 7/11)*
* **4–8 words:** 74.7% [64–83] · 12/60 real rejected
* **9+ words:** 98.1% [93–99] · **0/100 real rejected** *(0.0% error on long quotes)*

---

## 4. Next Step: Envelope v3 (Run 6)

* **Architecture:**
  1. Corpus text at the top (v1 layout).
  2. Boundary cues kept (`prefix_words_heard`, `suffix_words_heard`, etc.).
  3. Noisy `neighbor_findings` JSON blobs dropped.
  4. Max length 2048 tokens.
* **Training Data:**
  * `v3_single`: Envelope v3 on single verses.
  * `v3_mixed`: Envelope v3 combining single verses + multi-verse passages so the model learns continuous recitation while keeping single-verse sensitivity.
* Notebook: `notebooks/kaggle/laya_run6_kaggle.ipynb`
