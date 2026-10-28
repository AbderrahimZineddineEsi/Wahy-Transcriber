# Tahqeeq

### Transcription that Preserves the Wahy

**An Arabic transcription-correction pipeline that detects Quranic ayat and Hadith quotations in speech transcripts, then helps restore their canonical wording.**

Tahqeeq is designed for short Arabic fatwa videos, where a speaker may quote an ayah or Hadith while explaining a ruling. Speech recognition can introduce errors into sacred-text quotations. Tahqeeq aims to identify those quotations, match them to trusted written sources, and recover missing or misrecognized words without treating AI output as religious authority.

## Project Scope

Tahqeeq focuses on **short fatwa videos**, often around two to three minutes—not long lectures requiring full lecture structuring.

Its core tasks are:

- Detect Quranic ayat and Hadith quotations in Arabic transcripts.
- Distinguish genuine quotations from ordinary speech that merely resembles sacred text.
- Detect incomplete quotation boundaries or missing words.
- Match detected spans to canonical written sources.
- Restore the source wording while preserving traceability.

A later stage may identify and split multiple distinct fatwas or questions within a video. This is secondary to reliable quotation detection and correction.

## Current Architecture

| Component | Role |
|---|---|
| ASR input | Whisper API transcription or a user-provided transcript |
| Detection engine | Current V5 engine for Quran and Hadith quotation detection |
| Fine-tuned classifier | `convaiinnovations/laya-multilingual` for quotation validity and completeness review |
| Source matching | Find corresponding canonical Quran/Hadith text |
| Auto-healing | Propose minimal source-supported completions and re-check them |
| Later segmentation | Split multiple fatwas/questions only when the video actually contains them |

The current engine favors **recall over precision**: it is more willing to flag a possible quotation than miss one. This makes the reviewer and source-matching stages especially important.

## Roadmap

### 1. Compare the Quran Engine with QDetect

**Priority: Very high**

[QDetect](https://github.com/SElBeltagy/Quran_Detector) is a relevant baseline for locating Quranic verse fragments in Arabic text, including partial or slightly corrupted quotations.

Compare:

- **A:** Tahqeeq V5 Quran detection.
- **B:** QDetect.
- **C:** V5 + fine-tuned Laya reviewer.
- **D:** QDetect with equivalent evaluation and post-processing, where practical.

Test exact quotations, partial verses, ASR-corrupted text, incomplete boundaries, and ordinary speech that resembles an ayah.

Use the same normalized text and held-out examples.

**Important:** QDetect is a Quran-only baseline. It does not replace Tahqeeq's Hadith detection. Compare Quran detection head-to-head and evaluate Hadith detection separately.

### 2. Test a Quran/Hadith-Specialized Whisper Model

**Priority: Very high**

A promising open checkpoint is [`Abu-Dju/whisper-large-v3-ar`](https://huggingface.co/Abu-Dju/whisper-large-v3-ar), a Whisper Large V3 fine-tune intended for Quran, Hadith, and general Modern Standard Arabic.

Its model card reports strong results on its own evaluation splits, but these results do not guarantee better performance on real fatwa videos or against the Whisper API.

Compare:

- Whisper API — current baseline.
- Original Whisper Large V3.
- Specialized Quran/Hadith Whisper Large V3.
- Optionally, another practical Arabic ASR baseline.

Evaluate both overall Arabic transcription quality and the accuracy of words inside Quran/Hadith quotation spans. Measure whether the transcript preserves enough context for the detector to distinguish quotations from explanations and paraphrases.

**Hardware:** the specialized checkpoint has around 2B parameters, with roughly 4 GB required for BF16 weights alone. It is not a realistic fit for a 3 GB GTX 1050. Test it in Kaggle or Colab.

The checkpoint produces unvowelled Imlāʾī text according to its model card. Canonical source matching and restoration of tashkīl remain separate tasks.

### 3. Build Better Non-Quotation Examples

**Priority: Very high**

The initial dataset contained roughly 280 quotation examples and 26 non-quotation examples. The difficult negative is not simply text absent from a Hadith corpus: it may be ordinary Arabic speech that overlaps with a source's wording without being an actual quotation in context.

Target these hard negatives:

- Scholar explanations that paraphrase a text.
- Common religious phrases resembling part of an ayah or Hadith.
- Speech containing overlapping word sequences from a source.
- Incorrect or stitched-together phrases.
- ASR errors that accidentally resemble sacred text.
- High-overlap matches whose context does not support treating the span as a quotation.

Efficient candidate-mining approaches:

1. Review recurring false positives from the current engine.
2. Mine near-matches using lexical overlap or edit distance.
3. Prioritize uncertain cases and recurring failure patterns.
4. Ask an LLM to propose candidate hard negatives, then verify labels against context before training.

Do not label text “not a quote” merely because it is absent from the corpus. The label must represent whether the speaker is actually quoting the source.

### 4. Evaluate Laya as a Multi-Task Reviewer

**Priority: High**

Separate the review decisions:

1. Is the span a genuine quotation or ordinary speech?
2. If it is a quotation, is the detected span complete?
3. If incomplete, what is the smallest defensible completion?
4. Does the proposed text match a canonical source?

Compare:

- Fine-tuned Laya vs its base model.
- Laya vs a prompt-based LLM reviewer.
- Engine-only vs engine + reviewer.
- Reviewer alone vs reviewer supported by source-matching evidence.

Measure quotation precision/recall/F1, boundary accuracy, completeness accuracy, and false acceptance of non-quotations.

Correctly recognizing a quotation does not automatically mean the model has found the correct boundaries or can safely restore its missing words.

### 5. Add a Guarded Auto-Healing Loop

**Priority: High**

When a genuine quotation appears incomplete:

1. Retrieve plausible canonical source matches.
2. Propose the smallest missing span supported by the source.
3. Ask the reviewer to check quotation validity and completeness again.
4. Stop after a small, fixed number of attempts.
5. Flag unresolved cases for human review instead of silently rewriting them.

Compare one-pass correction against iterative auto-healing.

Record the original span, source match, proposed correction, reviewer decision, and final output. This makes errors auditable and prevents unconstrained rewriting.

### 6. Separate Detection from Canonical Restoration

**Priority: High**

Treat these as separate tasks:

- **Detection:** Is there a quotation in this span?
- **Source matching:** Which ayah or Hadith, if any, corresponds to it?
- **Boundary recovery:** Where does the quotation begin and end?
- **Canonical restoration:** What is the exact written source wording?
- **Attribution:** What source information can be reliably shown?

For Quran, use a trusted canonical Quran text as the authority for restored wording. For Hadith, retain source and edition/numbering metadata where available.

The ASR transcript and an LLM-generated completion should never become the canonical reference.

### 7. Add Final End-to-End Validation

**Priority: Medium-high**

After detection and correction, validate that:

- Every corrected quotation points to a source.
- No words outside the quotation were changed unintentionally.
- Orthography and tashkīl are handled consistently.
- A paraphrase was not converted into a direct quotation.
- Uncertain matches are flagged.
- The system has not added unsupported words to an incomplete match.

Compare rule-based checks, Laya, and a prompt-based LLM reviewer on a manually audited subset. Agreement is a useful signal, not proof of correctness.

### 8. Detect Multiple Fatwas Only When Needed

**Priority: Medium**

If a short video contains multiple distinct questions or fatwas, a later segmentation stage can identify the boundaries and split them into separate segments.

It should not impose lecture-style chapters or split every change of topic.

Evaluate boundary precision/recall and whether each segment retains the complete question and answer. Include single-fatwa videos to measure over-splitting.

### 9. Improve Source Transparency and Usability

**Priority: Medium**

- Show the original transcript beside the corrected quotation.
- Highlight exactly which words were changed or restored.
- Link each match to its source or identifier.
- Allow users to accept or reject proposed corrections.
- Maintain an audit trail of source match, confidence, and reviewer outcome.
- Flag uncertain matches for review.
- Preserve source provenance and licensing information.

## Benchmark Plan

| Comparison | What it measures |
|---|---|
| Whisper API vs specialized Whisper Large V3 | ASR quality on real fatwa videos |
| Original vs specialized Whisper | Benefit of domain-specific fine-tuning |
| Tahqeeq V5 vs QDetect | Quran detection quality only |
| V5 vs V5 + Laya | Value of the reviewer |
| Reviewer vs reviewer + auto-healing | Benefit and risk of iterative correction |
| Exact lookup vs fuzzy/semantic source matching | Recovery from ASR errors |
| Rule-based checks vs AI final reviewer | Value of end-to-end validation |

## Evaluation Metrics

| Task | Metrics |
|---|---|
| ASR | WER and CER, including separate Quran/Hadith span results |
| Quotation detection | Precision, recall, F1, false positives per minute |
| Source matching | Top-1 accuracy, Recall@k, exact canonical match rate |
| Boundary detection | Start/end boundary accuracy, exact-span match |
| Completeness review | Precision, recall, F1 |
| Auto-healing | Exact restoration rate, unsupported-edit rate, successful repairs |
| Final validation | False correction rate, attribution accuracy, human-review rate |
| Segmentation | Boundary precision/recall, over-splitting rate |
| System | Latency, cost per video, memory use |

Since the current engine prioritizes recall, do not optimize only for F1. Report precision and recall separately, and choose thresholds according to the cost of false detections versus missed quotations.

## Recommended Experiment Order

1. Freeze a manually verified set of real short fatwa videos and transcripts.
2. Establish V5-only baseline metrics.
3. Compare V5 with QDetect on Quran examples only.
4. Test specialized Whisper in Kaggle/Colab and compare ASR quality.
5. Evaluate Laya on hard negatives and incomplete quotations.
6. Add source-grounded auto-healing and measure exact restoration versus unsupported edits.
7. Evaluate the complete pipeline on unseen videos.
8. Add multiple-fatwa segmentation only after quotation handling is reliable.

## Principles

- **Canonical sources are authoritative; ASR and LLMs are not.**
- Do not turn paraphrases into direct quotations.
- Every correction should be traceable to a source.
- Prefer flagged uncertainty over an unsupported repair.
- Preserve the original transcript and an audit trail.
- Evaluate Quran and Hadith separately when a baseline covers only one.
- Human review remains appropriate for ambiguous matches and uncertain corrections.

## Models and Resources

- [Tahqeeq repository](https://github.com/AbderrahimZineddineEsi/Wahy-Transcriber)
- [QDetect Quran Detector](https://github.com/SElBeltagy/Quran_Detector)
- [Specialized Whisper Large V3 Arabic](https://huggingface.co/Abu-Dju/whisper-large-v3-ar)
- [Quran/Hadith ASR resource and training code](https://github.com/DrAliGomaa/quran-hadith-asr)
- [Laya multilingual model](https://huggingface.co/convaiinnovations/laya-multilingual)

---

*Roadmap note: model-card scores are specific to their authors' evaluation setups. Measure performance on held-out fatwa videos before concluding that a model or pipeline change improves Tahqeeq.*
