Below is the complete, step-by-step execution specification designed for the **Antigravity AGY Agent (`gemini 3.8 flash`)** to implement the **AI Tafrigh Phase** in the `Wahy-Transcriber` repository. Save this specification as `agy_tafrigh_phase_execution_plan.md` in the root of `Wahy-Transcriber-main/` and pass it directly to the AGY agent.

---

# AGY Agent Execution Plan: Wahy-Transcriber — AI Tafrigh Phase

## 0. Agent Operating Directives & Non-Negotiable Principles

You are an autonomous coding agent operating on the `Wahy-Transcriber` repository. Your task is to design, implement, and verify the **AI Tafrigh Phase**, which transforms an ASR transcript of an Islamic lecture (*dars*) into a clean, student-friendly transcription while strictly preserving the speaker's exact words.

### Non-Negotiable Engineering Guardrails

* **Absolute Faithfulness:** The output must be a faithful transcription of everything the shaykh and other speakers say, applying light structural formatting only. Never summarize, paraphrase, remove repetitions, or silently alter wording.


* **Immutable Source of Truth:** The original ASR text and its source character offsets and timestamps are strictly immutable. All typo corrections must be stored as separate versions so they can be reviewed, compared, and reverted.


* **Index-Based Model Outputs Only:** Models must never generate free-form replacement text that overwrites the original transcript without validation. Always use index-based outputs: word/character split indices for segment splitting, and `(span, replacement)` character edits for typo corrections.


* **Explicit Uncertainty & No Fabricated Offsets:** Uncertain model decisions must be routed to a human review queue rather than silently committed. Never fabricate precise character offsets or timestamps; if an offset/timestamp mapping after splitting is unreliable, mark it explicitly as unreliable.


* **Experiment-First Architecture:** Wherever a design choice is marked *"to be decided by testing"* (such as `per_sentence` vs. `windowed` mode, `independent_questions` vs. `split_as_tag_option` in JEV, parallel vs. sequential JEV requests, detection boundaries in segmentation, and gated vs. always-on typo correction), build both options behind configuration flags and log metrics so empirical runs decide the winner.



---

## 1. Repository Audit & Target Directory Architecture

### 1.1 Existing Codebase Integration Points

Inspect the existing repository files before writing new modules:

* `backend/app.py`: Existing backend API server to extend with Tafrigh pipeline, review queue, and run comparison endpoints.


* `backend/transcriber.py` & `backend/media_processor.py`: Existing ASR transcription and media handling modules providing initial segments and timestamps.


* `backend/laya_engine.py`, `backend/laya_converter.py`, & `backend/finetune_laya.py`: Existing Laya integration and fine-tuning scripts that must share a unified classification interface with JEV.


* `js/engine.js` & `js/ai-verifier.js`: Existing Qur'an/Hadith detection engine and AI verification logic whose boundary signals feed into Stage 1 Segmentation.


* `js/state.js`, `js/editor.js`, `js/render.js`, `js/events.js`, `index.html`, & `css/styles.css`: Existing frontend state, editor, and rendering modules to connect with the deterministic renderer and review queue.



### 1.2 Target File Tree to Create

Create the following modular Python package under `backend/tafrigh/` and test suite under `backend/tests/tafrigh/`:

```text
Wahy-Transcriber-main/
├── backend/
│   ├── tafrigh/
│   │   ├── __init__.py
│   │   ├── models.py            # Deliverable 1: Immutable segments, spans, versions, OutlineState
│   │   ├── schemas.py           # Deliverable 1: Model output JSON schemas & dynamic choice builders
│   │   ├── validators.py        # Deliverable 2: Split, Edit, and Outline transition validators
│   │   ├── segmenter.py         # Deliverable 3: Stage 1 Punctuation + Qur'an/Hadith/Matn segmentation
│   │   ├── matn_aligner.py      # Deliverable 3: Stage 2 Sequential pointer fuzzy matn alignment
│   │   ├── unit_of_work.py      # Deliverable 4: Shared UnitOfWork abstraction (target + context range)
│   │   ├── adapters/
│   │   │   ├── __init__.py
│   │   │   ├── base.py          # Abstract Classifier, Splitter, and Corrector interfaces
│   │   │   ├── gemini_adapter.py# Gemini Flash-Lite adapter (per_sentence & windowed + context caching)
│   │   │   ├── jev_adapter.py   # JEV adapter (independent_questions & split_as_tag_option, parallel/seq)
│   │   │   └── laya_adapter.py  # Laya adapter implementing the exact JEV conceptual interface
│   │   ├── pipeline.py          # Deliverable 4: Orchestrator for Stages 1–7 in both processing modes
│   │   ├── outline_repair.py    # Deliverable 5: Stage 6 Post-pass global outline verification & repair
│   │   ├── review_queue.py      # Deliverable 5: Uncertain decision aggregator & human review actions
│   │   ├── run_logger.py        # Deliverable 6: manifest.json, requests.jsonl, results.jsonl, reports
│   │   ├── compare_runs.py      # Deliverable 6: Multi-run side-by-side comparison CLI & diff tool
│   │   ├── training_store.py    # Deliverable 7: Canonical append-only JSONL store & PII anonymizer
│   │   ├── exporters.py         # Deliverable 7: JEV/Laya & LLM chat-jsonl training exporters
│   │   ├── pilot_tools.py       # Deliverable 8: Stratified sampling, bootstrap labeling, IAA, synthetic typos
│   │   ├── evaluation.py        # Deliverable 8: Full metric suite against gold JSONL
│   │   └── renderer.py          # Deliverable 9: Stage 7 Deterministic Markdown/HTML/JSON renderer
│   └── tests/
│       └── tafrigh/
│           ├── test_models_and_schemas.py
│           ├── test_validators.py
│           ├── test_segmenter_and_matn.py
│           ├── test_pipeline_modes.py
│           ├── test_outline_repair.py
│           ├── test_logging_and_training.py
│           ├── test_evaluation.py
│           └── test_renderer.py

```

### Phase 1 Pre-Flight Checkboxes

* [ ] Inspect `backend/app.py`, `backend/laya_engine.py`, `backend/laya_converter.py`, and `js/engine.js` to confirm existing data formats.


* [ ] Create `backend/tafrigh/` and `backend/tests/tafrigh/` directories with `__init__.py` files.
* [ ] Add `pydantic>=2.0`, `pytest`, `rapidfuzz` (or `difflib` fallback) to `backend/requirements.txt` if not already present.



---

## 2. Deliverable 1: Data Model & Model Output Schemas

**Files:** `backend/tafrigh/models.py`, `backend/tafrigh/schemas.py`

**Tests:** `backend/tests/tafrigh/test_models_and_schemas.py`

### 2.1 Detailed Implementation Instructions

1. **Define Structural Enums (`models.py`):**
* `StructuralTag(str, Enum)`:
* `PARAGRAPH = "paragraph"` (ordinary explanatory text)


* `LIST_INTRO = "list_intro"`

* `LIST_ITEM = "list_item"`

* `HEADING = "heading"` (with `level: int` and valid `parent_id: Optional[str]`)


* `MATN_SECTION = "matn_section"` (the shaykh reading the original matn as a distinct section)


* `CONTINUATION = "continuation"` (continues the previous segment without starting a new paragraph/line; rendering depends on the previous segment)


* `COMMENT = "comment"` (incidental speech outside the substantive explanation)




* `CommentKind(str, Enum)`:
* `SNEEZE = "sneeze"`, `STUDENT_QUESTION = "student_question"`, `INTERRUPTION = "interruption"`, `ATTENDEE_EXCHANGE = "attendee_exchange"`, `OTHER_INCIDENTAL = "other_incidental"`.


* Store `commentKind` as a hidden attribute whenever `tag == StructuralTag.COMMENT` so visual rendering can be changed later without re-running models.




* `LabelProvenance(str, Enum)`:
* `MODEL_PROPOSED = "model_proposed"`, `HUMAN_CONFIRMED = "human_confirmed"`, `HUMAN_CORRECTED = "human_corrected"`, `GOLD = "gold"`.






2. **Define Immutable Source Segment & Token Indexing (`models.py`):**
* `WordToken(BaseModel)`: `word_index: int`, `text: str`, `char_start: int`, `char_end: int`, `confidence: Optional[float] = None`.


* `SourcePosition(BaseModel)`: `char_start: int`, `char_end: int`, `start_time: Optional[float]`, `end_time: Optional[float]`, `mapping_reliable: bool = True`.


* `TextEdit(BaseModel)`: `start: int`, `end: int`, `replacement: str`, `is_valid_word_substitution: Optional[bool] = None`, `reason: Optional[str] = None`.


* `SegmentVersion(BaseModel)`: `version_id: str`, `edits: List[TextEdit]`, `corrected_text: str`, `provenance: LabelProvenance`, `created_at: str`, `reviewer_note: Optional[str] = None`.


* `TranscriptSegment(BaseModel)`:
* `id: str` (stable deterministic ID, e.g., `seg_0001` or `seg_0001_sub_0` after split).


* `parent_segment_id: Optional[str] = None` (links subsegments back to the original unsplit segment).


* `original_text: str` (enforced immutable via Pydantic `frozen` or property setter rejection).


* `source_pos: SourcePosition` (immutable original character offsets and timestamps).


* `tokens: List[WordToken]` (automatically populated from `original_text` preserving exact character spans so word-index splitting is 100% deterministic).


* `detection_signals: List[Dict[str, Any]]` (Qur'an, Hadith, and Matn alignment evidence attached to the segment).


* `proposed_decision: Optional[StructuralDecision] = None` and `final_decision: Optional[StructuralDecision] = None`.


* `versions: List[SegmentVersion] = []` (history of typo correction versions; `active_version_id: Optional[str] = None`).


* `review_flags: List[str] = []`.






3. **Define Span-Level State for Matn and Sharh (`models.py`):**
* Because `matn` and `sharh` (`charh`) are spans across several segments rather than only per-segment tags, implement `LectureSpan(BaseModel)`:


* `span_id: str`
* `span_type: Literal["matn", "sharh", "plain"]`

* `segment_ids: List[str]`

* `spoken_text: str` (exact ASR/corrected text read by the shaykh)


* `canonical_matn_text: Optional[str] = None` (canonical text from the aligned matn file)


* `matn_line_range: Optional[Tuple[int, int]] = None`

* `has_variant_wording: bool = False` (flagged when the shaykh read a wording variant compared to canonical matn)






4. **Define `OutlineState` & Dynamic TOC / Choice Generation (`models.py`):**
* `HeadingEntry(BaseModel)`: `segment_id: str`, `level: int`, `title_text: str`, `parent_id: Optional[str]`.


* `TOCConfig(BaseModel)`: `max_level1_headings: int = 50`, `recent_level2_siblings_count: int = 5`, `include_active_branch: bool = True`.


* `OutlineState(BaseModel)`:
* Stores `headings: List[HeadingEntry]`, `last_confirmed_heading_id: Optional[str]`, `active_spine: Dict[int, HeadingEntry]` (maps heading level $1 \dots k$ to the currently open heading at that level), and `last_segment_tag: Optional[StructuralTag]`.


* Method `get_partial_toc(config: TOCConfig) -> List[Dict]`: Returns all Level-1 headings plus the relevant Level-2 headings (specifically those under the current Level-1 heading and the most recent Level-2 heading), omitting deep subsection clutter.


* Method `get_allowed_structural_choices(include_split_option: bool = False) -> List[Dict]`: Dynamically generates valid tag/level/parent choices based on current outline state:


* Always allows `paragraph`, `list_intro`, `matn_section`, `comment`.


* Allows `list_item` only if the preceding non-comment segment is `list_intro`, `list_item`, or `continuation` inside a list.


* Allows `continuation` only if `last_segment_tag` is not `None`.


* Dynamically populates valid `heading` choices:
* `heading (level=1, parent=None)` is always allowed.


* For each open level $L$ in `active_spine`, allows `heading (level=L+1, parent=active_spine[L].segment_id)`.


* Prevents inventing arbitrary hierarchy levels (e.g., jumping from Level 1 to Level 3 when no Level 2 is open) or invalid parent IDs.




* If `include_split_option=True` (for JEV `split_as_tag_option` experiment), appends `needs_splitting` to the choice list.








5. **Define Model Output Contracts (`schemas.py`):**
* Keep model-specific parsing strictly separated from `TranscriptSegment` and `StructuralDecision`.


* `GeminiSingleOutputSchema(BaseModel)`:
* `tag: Optional[StructuralTag] = None` (discarded if `needsSplitting == True`)


* `level: Optional[int] = None`

* `parent: Optional[str] = None`

* `commentKind: Optional[CommentKind] = None`

* `hasTypo: bool`

* `needsSplitting: bool`

* `splitPoints: List[int] = []` (word indices where each split point is the 0-based index of the first word of a new subsegment)


* `edits: List[TextEdit] = []` (character `(start, end, replacement)` spans)


* `confidence: Optional[float] = None`



* `GeminiWindowItemSchema(GeminiSingleOutputSchema)`: Adds `id: str` (must match target segment ID).


* `GeminiWindowOutputSchema(BaseModel)`: `decisions: List[GeminiWindowItemSchema]`.


* `JEVRequestConfig(BaseModel)`:
* `jev_layout: Literal["independent_questions", "split_as_tag_option"] = "independent_questions"`

* `execution_order: Literal["parallel", "sequential"] = "parallel"`

* `batch_questions_in_single_request: bool = False` (configurable once confirmed against the real JEV API).







### 2.2 Assumptions & Open Experimental Questions

* **Assumptions:** Word tokenization for `splitPoints` uses whitespace-delimited tokens where punctuation attached to a word stays with that word token, while exact character spans `(char_start, char_end)` are recorded on every `WordToken`.


* **Open for Experiment:** Optimal `TOCConfig` window size and whether `splitPoints` are more reliably predicted by Gemini as word indices (with `[word_idx]` brackets injected in the prompt) vs. character offsets.



### 2.3 Verification & Checkboxes for Deliverable 1

* [ ] Implement `backend/tafrigh/models.py` and `backend/tafrigh/schemas.py`.


* [ ] Write unit tests in `backend/tests/tafrigh/test_models_and_schemas.py` verifying:
* [ ] Attempting to mutate `segment.original_text` or `segment.source_pos` raises an error.


* [ ] Example segment `فهذا[0] هو[1] الأصل[2] الأول[3] وسنذكر[4] الآن[5] شروط[6] الصلاة[7] وهي[8] تسعة[9] الأول[10] الإسلام[11]` tokenizes into 12 `WordToken` objects with exact character spans.


* [ ] `OutlineState.get_allowed_structural_choices()` rejects Level-3 headings when no Level-2 heading is active, and generates exact valid parent IDs.


* [ ] `OutlineState.get_partial_toc()` returns all Level-1 headings plus only the relevant Level-2 headings.




* [ ] Run `pytest backend/tests/tafrigh/test_models_and_schemas.py` and verify 100% pass rate.

---

## 3. Deliverable 2: Validation Logic for Splits, Edits, and Outline Transitions

**Files:** `backend/tafrigh/validators.py`

**Tests:** `backend/tests/tafrigh/test_validators.py`

### 3.1 Detailed Implementation Instructions

1. **Split Validator (`validate_and_apply_splits`):**
* Input: `segment: TranscriptSegment`, `split_points: List[int]` (word indices where each index marks the first word of a new subsegment).


* Validation rules:
* `split_points` must be non-empty, strictly sorted in ascending order (`split_points == sorted(set(split_points))`), and every index $idx$ must satisfy $0 < idx < len(segment.tokens)$.


* Slice the original text using the exact `char_start` of each split token:
* Subsegment $0$ spans `original_text[0 : tokens[split_points[0]].char_start]`.


* Subsegment $k$ spans `original_text[tokens[split_points[k-1]].char_start : tokens[split_points[k]].char_start]`.


* Last subsegment spans `original_text[tokens[split_points[-1]].char_start : len(original_text)]`.




* **Exact Reconstruction Assertion:** Verify `"".join(sub_texts) == segment.original_text` (including all original whitespace and punctuation).


* **Offset & Timestamp Mapping:**
* Character offsets map deterministically: `sub_char_start = segment.source_pos.char_start + local_start`.


* Timestamp mapping: If word-level timestamps exist, use exact word timestamps (`mapping_reliable = True`); if only segment-level start/end timestamps exist, do **not** fabricate precise timestamps—either set subsegment inner timestamps to `None` or proportional estimates marked with `mapping_reliable = False` and add `"UNRELIABLE_TIMESTAMP_MAPPING"` to `review_flags`.




* **Discard Mixed Tag:** When `needsSplitting` is `True`, discard any tag returned for the original mixed segment.


* **Failure Handling:** If `split_points` is empty, out of bounds, or fails exact reconstruction, keep `segment` unsplit, add `"SPLIT_VALIDATION_FAILED"` to `segment.review_flags`, and return `ValidationResult(is_valid=False, ...)`.






2. **Edit Validator (`validate_and_apply_edits`):**
* Input: `segment: TranscriptSegment`, `edits: List[TextEdit]`, `max_change_ratio: float = 0.30`.


* Validation rules:
* Sort edits by `start` ascending.


* Verify for each edit: `0 <= edit.start <= edit.end <= len(segment.original_text)`.


* Verify non-overlap: for every adjacent pair $(e_i, e_{i+1})$, require $e_i.\text{end} \le e_{i+1}.\text{start}$.


* Compute total character change ratio:

$$\text{change\_ratio} = \frac{\sum_{e \in \text{edits}} \max(e.\text{end} - e.\text{start}, \text{len}(e.\text{replacement}))}{\max(1, \text{len}(\text{segment.original\_text}))}$$


* If `change_ratio > max_change_ratio`, reject automatic application, keep original text as active, store the rejected proposal for training capture, and append `"EDIT_CAP_EXCEEDED"` to `segment.review_flags`.


* If valid, construct `corrected_text` by applying spans from right to left on `segment.original_text`, append a new `SegmentVersion(provenance=LabelProvenance.MODEL_PROPOSED)` to `segment.versions`, and leave `segment.original_text` untouched.






3. **Structural Transition Validator (`validate_structural_transition`):**
* Input: `decision: StructuralDecision`, `outline_state: OutlineState`.


* Validation rules:
* If `decision.tag == StructuralTag.HEADING`:
* `decision.level` must be an integer $\ge 1$.


* If `decision.level == 1`, `decision.parent_id` must be `None`.


* If `decision.level > 1`, level $L-1$ must exist in `outline_state.active_spine` and `decision.parent_id` must equal `outline_state.active_spine[L-1].segment_id`.




* If `decision.tag != StructuralTag.HEADING`: `decision.level` and `decision.parent_id` must be `None`.


* If `decision.tag == StructuralTag.LIST_ITEM`: verify `outline_state.in_list_context` is `True` (preceded by `list_intro` or `list_item` or `continuation` inside a list); otherwise return `is_valid=False, error="ORPHAN_LIST_ITEM"`.


* If `decision.tag == StructuralTag.CONTINUATION`: verify `outline_state.last_segment_tag is not None`; otherwise return `is_valid=False, error="LEADING_CONTINUATION"`.







### 3.2 Verification & Checkboxes for Deliverable 2

* [ ] Implement `backend/tafrigh/validators.py`.


* [ ] Write unit tests in `backend/tests/tafrigh/test_validators.py` covering:
* [ ] Prompt benchmark test case: Splitting `فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة الأول الإسلام` with `splitPoints=[4, 10]` produces 3 subsegments (`فهذا هو الأصل الأول `, `وسنذكر الآن شروط الصلاة وهي تسعة `, `الأول الإسلام`) that concatenate to the exact original string and discard the parent tag.


* [ ] Out-of-bounds or unsorted `splitPoints` (e.g., `[0, 15]`, `[8, 4]`) fail validation, preserve the original segment, and append `"SPLIT_VALIDATION_FAILED"`.


* [ ] Overlapping `TextEdit` spans (e.g., `[0, 5]` and `[3, 7]`) and excessive edits (`change_ratio > 0.30`) are rejected and flagged.


* [ ] Valid non-overlapping `TextEdit` spans create a new `SegmentVersion` while `segment.original_text` remains identical.


* [ ] Invalid heading jumps (e.g., H1 $\to$ H3) and invalid `parent_id` values are rejected by `validate_structural_transition`.




* [ ] Run `pytest backend/tests/tafrigh/test_validators.py` and verify 100% pass rate.

---

## 4. Deliverable 3: Stage 1 Segmentation & Stage 2 Matn Alignment Module

**Files:** `backend/tafrigh/segmenter.py`, `backend/tafrigh/matn_aligner.py`

**Tests:** `backend/tests/tafrigh/test_segmenter_and_matn.py`

### 4.1 Detailed Implementation Instructions

1. **Stage 1 Segmentation (`segmenter.py`):**
* Implement `segment_transcript(raw_text: str, asr_words: List[Dict], detection_spans: List[Dict], use_detection_boundaries: bool = True) -> List[TranscriptSegment]`.


* Collect candidate split boundaries from:
1. ASR punctuation marks (`.`, `؟`, `!`, `؛`, `\n`).


2. When `use_detection_boundaries=True` (configurable hypothesis flag to validate via evaluation), start and end character offsets of Qur'an, Hadith, and Matn spans from the detection engine.




* **Overlapping Boundary Resolution:**
* If two detection spans overlap (e.g., a Hadith quotation inside a Matn passage, or a Qur'an ayah inside a Hadith), resolve boundaries using strict priority: `Matn > Quran > Hadith > ASR_Punctuation`.


* Never split inside an atomic Qur'an ayah span unless it is a multi-ayah block with commentary interspersed.


* Ensure concatenating all resulting `TranscriptSegment.original_text` values equals `raw_text` exactly (`"".join(s.original_text for s in segments) == raw_text`).






2. **Stage 2 Matn Alignment (`matn_aligner.py`):**
* Support three matn configurations in `MatnConfig`:
* `mode = "upload"` (user-supplied matn text)


* `mode = "builtin"` (loaded from `data/matns/<matn_id>.txt`)


* `mode = "no_matn"` (plain lecture; bypasses matn alignment and falls back to general classifier).




* **Arabic Normalization Utility (`normalize_arabic_for_alignment`):**
* Strip tashkeel/diacritics (`[\u064B-\u065F\u0670]`), tatweel (`\u0640`), normalize hamza forms (`أ`, `إ`, `آ` $\to$ `ا`), `ة` $\to$ `ه`, `ى` $\to$ `ي` while maintaining an index map back to the original canonical matn characters.




* **Sequential Pointer Alignment Engine (`SequentialMatnAligner`):**
* Maintain `pointer_line_idx: int = 0` representing the shaykh's current position in the matn.


* For each segment (or contiguous candidate window of segments), compute fuzzy token-level similarity against normalized matn lines using a spatial prior centered at `pointer_line_idx`:



$$\text{score}(i) = \text{fuzzy\_similarity}(\text{seg}, \text{matn\_line}_i) - \lambda_{\text{skip}} \cdot \text{penalty}(i - \text{pointer\_line\_idx})$$


* Explicitly handle:
* **In-order progression:** $i = \text{pointer\_line\_idx}$ or $\text{pointer\_line\_idx} + 1$ (zero penalty).


* **Repeated lines:** $i \in [\text{pointer\_line\_idx} - 3, \text{pointer\_line\_idx}]$ (shaykh re-reading the matn line for emphasis; small penalty).


* **Skipped lines:** $i > \text{pointer\_line\_idx} + 1$ (moderate decay penalty up to configurable `max_lookahead_lines = 15`).


* **ASR errors & edition/wording variants:** If similarity is high ($\ge 0.72$) but normalized words differ, align the segment, store both `spoken_text` and `canonical_matn_text`, and set `has_variant_wording = True`.






* **Evidence vs. Decision Separation (`MatnMatchEvidence`):**
* A match is **evidence**, not an automatic `matn_section` decision.


* Compute and attach `MatnMatchEvidence` to each segment:
* `matched_line_indices: List[int]`, `coverage_ratio: float` (fraction of the matn line/passage covered), `similarity_score: float`, `starts_at_segment_boundary: bool`, `word_count: int`, `pointer_delta: int`, `canonical_text: str`, `has_variant_wording: bool`, `is_candidate_standalone_matn: bool`.




* **Standalone vs. Embedded Quote Heuristic (`is_candidate_standalone_matn`):**
* Mark `True` only when the match covers a full matn line/clause (`coverage_ratio >= 0.65` or `word_count >= 6`), starts at a segment boundary (or immediately after a matn reading cue like `قال المصنف رحمه الله`), and is followed by explanation.


* Mark `False` when a short phrase (`coverage_ratio < 0.50` and `word_count < 6`) is quoted mid-sentence inside the shaykh's explanation (`sharh`) so it is never turned into a standalone `المتن:` section.






* **Outside-Matn Detection Continuity:**
* Ensure that for all segments outside `matn_section` spans (i.e., inside the `sharh`), Qur'an and Hadith detection results from `js/engine.js` / backend detector remain active and attached to `segment.detection_signals`.







### 4.2 Verification & Checkboxes for Deliverable 3

* [ ] Implement `backend/tafrigh/segmenter.py` and `backend/tafrigh/matn_aligner.py`.


* [ ] Write unit tests in `backend/tests/tafrigh/test_segmenter_and_matn.py` verifying:
* [ ] Segmentation with overlapping Qur'an/Hadith/Matn boundaries preserves 100% of characters and resolves overlaps without splitting mid-ayah.


* [ ] Sequential pointer tracks in-order matn reading, repeated matn lines, and skipped lines accurately.


* [ ] Short 2–3 word matn quotes inside a `sharh` sentence produce `MatnMatchEvidence(is_candidate_standalone_matn=False)`.


* [ ] Edition/wording differences between spoken text and canonical matn set `has_variant_wording=True` and preserve both strings.




* [ ] Run `pytest backend/tests/tafrigh/test_segmenter_and_matn.py` and verify 100% pass rate.

---

## 5. Deliverable 4: Processing Pipeline, Unit of Work, Modes & Pluggable Model Adapters

**Files:** `backend/tafrigh/unit_of_work.py`, `backend/tafrigh/adapters/base.py`, `backend/tafrigh/adapters/gemini_adapter.py`, `backend/tafrigh/adapters/jev_adapter.py`, `backend/tafrigh/adapters/laya_adapter.py`, `backend/tafrigh/pipeline.py`

**Tests:** `backend/tests/tafrigh/test_pipeline_modes.py`

### 5.1 Detailed Implementation Instructions

1. **Shared Abstraction (`unit_of_work.py`):**
* Implement `UnitOfWork(BaseModel)` representing a single scheduling unit for both `per_sentence` and `windowed` modes:


* `uow_id: str`
* `target_segments: List[TranscriptSegment]` (length $1$ in `per_sentence` mode; length up to `window_size` in `windowed` mode)


* `context_before: List[TranscriptSegment]` (read-only preceding sentences, configurable `context_before_count`)


* `context_after: List[TranscriptSegment]` (read-only following sentences, configurable `context_after_count`)


* `partial_toc: List[Dict[str, Any]]` (from `OutlineState.get_partial_toc()`)


* `current_position_index: int` and `last_confirmed_heading: Optional[HeadingEntry]`

* `allowed_choices: List[Dict[str, Any]]` (dynamically generated from `OutlineState`)




* Implement `build_units_of_work(segments, mode, window_size=20, context_before=3, context_after=3)`:
* Partition `segments` into non-overlapping `target_segments` slices so **every segment is owned by exactly one `UnitOfWork**` and never receives two primary decisions.


* Populate `context_before` and `context_after` from adjacent slices as read-only context.






2. **Pluggable Model Adapters (`backend/tafrigh/adapters/`):**
* **Static Prefix Context Caching:**
* Separate prompt construction into `STATIC_SYSTEM_PREFIX` (role instructions, structural tag definitions, comment policy, JSON schema definitions) and `DYNAMIC_TARGET_PAYLOAD` (`UnitOfWork` context, TOC, target sentences with `[word_idx]` annotations, matn/Qur'an/Hadith evidence).


* In `GeminiAdapter`, support Gemini API `cached_content` for `STATIC_SYSTEM_PREFIX` and record `cached_tokens` on every request.




* **`GeminiAdapter` (`gemini_adapter.py`):**
* Supports both `per_sentence` and `windowed` modes.


* Supports configurable typo correction strategies (`typo_strategy: Literal["gated", "always_correct", "asr_confidence_gated"]`) so recall vs. cost can be empirically evaluated.


* Implements dedicated methods:
* `classify_uow(uow: UnitOfWork) -> List[GeminiWindowItemSchema]`

* `get_split_points(segment: TranscriptSegment, context: UnitOfWork) -> List[int]`

* `get_typo_edits(segment: TranscriptSegment, context: UnitOfWork) -> List[TextEdit]`





* **`JEVAdapter` (`jev_adapter.py`) & `LayaAdapter` (`laya_adapter.py`):**
* Define abstract base class `ChoiceClassifierAdapter` in `base.py` implemented by both `JEVAdapter` and `LayaAdapter` (wrapping `backend/laya_engine.py`) so Laya can replace JEV without any pipeline redesign.


* Support only `per_sentence` mode unless `supports_multi_item_window` is explicitly enabled and verified.


* Implement both experimental `jev_layout` configurations:


1. `independent_questions`:
* Question 1 (Structure): Choice list contains **only real structural tags** (`OutlineState.get_allowed_structural_choices(include_split_option=False)`).


* Question 2 (`hasTypo`): Boolean choice `["true", "false"]`.


* Question 3 (`needsSplitting`): Boolean choice `["true", "false"]`.


* Support both `execution_order = "parallel"` (fire Q1, Q2, Q3 concurrently via `asyncio.gather` / `ThreadPoolExecutor`; if `needsSplitting` returns `true`, discard Q1's tag result) and `execution_order = "sequential"` (fire `needsSplitting` first; if `true`, skip Q1 and immediately request split indices from Gemini).




2. `split_as_tag_option`:
* Question 1 (Structure + Split): Choice list includes `"needs_splitting"` alongside real structural tags (`include_split_option=True`).


* Question 2 (`hasTypo`): Boolean choice `["true", "false"]`.










3. **Pipeline Orchestrator (`pipeline.py`):**
* Execute the 7 stages cleanly:
* **Stage 1 & 2:** Run `segment_transcript` and `SequentialMatnAligner`.


* **Stage 3, 4, 5 (`per_sentence` mode):**
* For each segment, build `UnitOfWork(len=1)` from current `OutlineState`.


* Query active adapter (`gemini_all`, `jev_hybrid`, or `laya_hybrid`).


* If `needsSplitting == True`:
* Discard initial tag.


* Obtain `splitPoints` (already in Gemini response, or via `gemini_adapter.get_split_points()` when using JEV/Laya).


* Validate via `validate_and_apply_splits()`.


* If valid, replace mixed segment with subsegments and classify each subsegment sequentially with updated `OutlineState`.




* Validate structural transition via `validate_structural_transition()`; if invalid, retry once with strict allowed choices or fallback to `paragraph` with `"INVALID_TRANSITION_FALLBACK"` review flag.


* Update `OutlineState` and `LectureSpan` (`matn`/`sharh` span state).


* If `hasTypo == True` (or `typo_strategy == "always_correct"`): obtain `(span, replacement)` edits and validate via `validate_and_apply_edits()`.




* **Stage 3, 4, 5 (`windowed` mode):**
* Build `UnitOfWork(len=window_size)` starting from current `OutlineState`.


* Call `gemini_adapter.classify_uow(uow)`.


* **Window Completeness & Order Check:** Verify `[d.id for d in response.decisions] == [s.id for s in uow.target_segments]` (every target ID returned once, no unknown IDs, exact order preserved).


* If completeness check fails: retry the window once; if the retry still fails, fall back to `per_sentence` mode for the missing/invalid IDs and log `fallback_triggered = True` in `requests.jsonl`.


* Apply decisions sequentially across the window, updating `OutlineState` after each segment so headings introduced earlier in the window are valid parents for later segments in the same window.


* If any segment inside the window has `needsSplitting == True` or fails `validate_structural_transition()`, handle that segment via targeted `per_sentence` subsegment classification / re-query and log the fallback.









### 5.2 Verification & Checkboxes for Deliverable 4

* [ ] Implement `unit_of_work.py`, `adapters/base.py`, `adapters/gemini_adapter.py`, `adapters/jev_adapter.py`, `adapters/laya_adapter.py`, and `pipeline.py`.


* [ ] Write unit and mock-integration tests in `backend/tests/tafrigh/test_pipeline_modes.py` verifying:
* [ ] No segment ever receives two primary decisions across adjacent windows.


* [ ] `windowed` mode validates in-window heading introductions (e.g., Segment 3 introduces an H1 heading, Segment 5 introduces an H2 child under Segment 3).


* [ ] When a mocked `windowed` response omits an ID or scrambles ID order, the pipeline retries once and then falls back to `per_sentence` mode for the affected IDs while logging the fallback.


* [ ] In `jev_hybrid` mode with `execution_order="parallel"`, when `needsSplitting` is `True`, the parallel tag result is discarded, Gemini provides `splitPoints`, and JEV classifies the resulting subsegments.


* [ ] `LayaAdapter` passes the exact same contract test suite as `JEVAdapter`.




* [ ] Run `pytest backend/tests/tafrigh/test_pipeline_modes.py` and verify 100% pass rate.

---

## 6. Deliverable 5: Stage 6 Outline Repair Pass & Review Queue

**Files:** `backend/tafrigh/outline_repair.py`, `backend/tafrigh/review_queue.py`

**Tests:** `backend/tests/tafrigh/test_outline_repair.py`

### 6.1 Detailed Implementation Instructions

1. **Stage 6 Outline Repair Pass (`outline_repair.py`):**
* Because a single misclassified early heading can corrupt the partial TOC for downstream segments, implement `run_outline_repair_pass(segments: List[TranscriptSegment], outline_state: OutlineState, model_adapter: Optional[BaseAdapter] = None) -> OutlineRepairReport`:


* **Global Tree Anomalies Detected:**
1. **Level Jumps / Orphaned Subheadings:** A heading at level $L > 1$ whose parent was later demoted or invalidated.


2. **Single-Child Heading Chains:** An H1 heading that has only a single H2 child and no sibling H2s across the lecture (flag as suspicious hierarchy inflation).


3. **False Heading Inside Matn/List:** A heading tag occurring inside an active `list_item` sequence without closing the list, or a short rhetorical question misclassified as a heading.


4. **Broken Matn/Sharh Span Alternation:** Consecutive `matn_section` segments separated by a single short `continuation` that should be unified into one `matn` span.




* **Repair Action:** Re-normalize parent pointers and heading levels deterministically where unambiguous, or re-query the heading spine in a single global outline verification request, recording proposed changes and adding `"OUTLINE_REPAIR_APPLIED"` or `"OUTLINE_REPAIR_REVIEW"` to `segment.review_flags`.


* **Parallel Processing Support:** Provide `partition_lecture_by_anchors(segments)` which splits a long lecture at high-confidence standalone `matn_section` anchors so chunks can be processed in parallel and reconciled during `run_outline_repair_pass`.






2. **Review Queue (`review_queue.py`):**
* Implement `ReviewQueueManager` to collect, filter, and resolve all segments with non-empty `review_flags` or `confidence < confidence_threshold`:


* Supported flags: `LOW_CONFIDENCE`, `SPLIT_VALIDATION_FAILED`, `EDIT_CAP_EXCEEDED`, `UNRELIABLE_TIMESTAMP_MAPPING`, `MATN_VARIANT_WORDING`, `INVALID_TRANSITION_FALLBACK`, `WINDOW_FALLBACK_USED`, `OUTLINE_REPAIR_REVIEW`.


* Implement human review resolution methods (`confirm_decision`, `correct_decision`, `reject_decision`) that update `final_decision`, set `provenance` to `HUMAN_CONFIRMED` or `HUMAN_CORRECTED`, and immediately trigger a write to the canonical training data store (Deliverable 7).







### 6.2 Verification & Checkboxes for Deliverable 5

* [ ] Implement `backend/tafrigh/outline_repair.py` and `backend/tafrigh/review_queue.py`.


* [ ] Write unit tests in `backend/tests/tafrigh/test_outline_repair.py` verifying:
* [ ] Corrupted early heading level propagation is detected and repaired or flagged in Stage 6.


* [ ] `ReviewQueueManager` captures all flagged segments and records `HUMAN_CONFIRMED` / `HUMAN_CORRECTED` provenance upon review.




* [ ] Run `pytest backend/tests/tafrigh/test_outline_repair.py` and verify 100% pass rate.

---

## 7. Deliverable 6: Run Logging, Performance Reporting & Run Comparison Tool

**Files:** `backend/tafrigh/run_logger.py`, `backend/tafrigh/compare_runs.py`

**Tests:** `backend/tests/tafrigh/test_logging_and_training.py`

### 7.1 Detailed Implementation Instructions

1. **Per-Run Folder & Artifact Logger (`run_logger.py`):**
* Create a unique, immutable run directory for every execution: `runs/<YYYYMMDD_HHMMSS>_<lecture_slug>_<label>/` (if a folder name collision occurs, append a short random suffix so runs never overwrite each other).


* Write the four mandatory artifacts:
1. `manifest.json`: Full run configuration including `run_id`, `processing_mode` (`per_sentence` | `windowed`), `window_size`, `context_before`, `context_after`, `models` (classifier, splitter, corrector names and versions), `jev_layout`, `jev_execution_order`, `typo_strategy`, `use_detection_boundaries`, `toc_config`, `prompt_version`, `schema_version`, `asr_model`, `transcript_id`, `matn_id`, `git_commit_hash`, `random_seed`, `started_at`, `completed_at`.


2. `requests.jsonl`: Append one JSON object per API call with `request_id`, `model`, `unit_of_work_ids` (list of segment IDs), `purpose` (`classify`, `hasTypo`, `needsSplitting`, `split`, `correct`, `outline_repair`), `input_tokens`, `output_tokens`, `cached_tokens`, `latency_ms`, `cost_estimate_usd`, `retries`, `errors`, `timeouts`, `parse_failures`, `validation_failures`, `fallback_triggered`.


3. `results.jsonl`: One JSON object per final segment with `segment_id`, `parent_segment_id`, `original_text`, `source_pos`, `proposed_decision`, `final_decision` (`tag`, `level`, `parent`, `commentKind`), `hasTypo`, `edits`, `splitPoints`, `confidence`, `review_flags`, `matn_match`, and `originating_request_ids`.


4. `report.json` & `report.md`: Aggregate metrics computed at run completion (and printed as a formatted summary table to the console):


* Total requests, total input/output/cached tokens, total cost (USD), wall-clock time (seconds).


* Latency `p50`, `p95`, and `max` (ms) broken down by `purpose`.


* Normalized cost and latency **per lecture** and **per 100 sentences**.


* Failure rate, retry rate, window-to-sentence fallback rate, split-validation failure rate, edit-cap rejection rate.


* Review-flag counts by flag type and structural tag distribution.


* When `--gold-path` is provided, include all evaluation metrics from Deliverable 8.








2. **Multi-Run Comparison CLI (`compare_runs.py`):**
* CLI usage: `python -m backend.tafrigh.compare_runs runs/run_A runs/run_B [runs/run_C ...] --output comparison.md`.


* Outputs:
* Side-by-side Markdown and console table comparing configuration (`mode`, `model`, `jev_layout`), accuracy/F1 metrics, total cost, cost per 100 sentences, latency (`p50`/`p95`/wall-clock), and failure/fallback rates.


* **Per-Segment Disagreement Diff:** For any pair of runs on the same `transcript_id`, output a detailed diff listing every segment where `tag`, `level`, `parent`, `needsSplitting`, `splitPoints`, `hasTypo`, or `edits` differ between the two runs.







### 7.2 Verification & Checkboxes for Deliverable 6

* [ ] Implement `backend/tafrigh/run_logger.py` and `backend/tafrigh/compare_runs.py`.


* [ ] Verify that executing a pipeline run creates `manifest.json`, `requests.jsonl`, `results.jsonl`, `report.json`, and `report.md` in `runs/<timestamp>_<lecture>_<label>/` and prints the console summary.


* [ ] Test `compare_runs.py` on two mock run folders and verify it generates the side-by-side table and per-segment disagreement diff.



---

## 8. Deliverable 7: Canonical Training-Data Store & Exporters

**Files:** `backend/tafrigh/training_store.py`, `backend/tafrigh/exporters.py`

**Tests:** `backend/tests/tafrigh/test_logging_and_training.py`

### 8.1 Detailed Implementation Instructions

1. **Canonical Append-Only Store (`training_store.py`):**
* Store records in local append-only JSONL (`data/training_store/canonical_decisions.jsonl`) with `record_id`, `schema_version`, `run_id`, `transcript_id`, `segment_id`, `timestamp`.


* Every record must preserve **all information needed for any future model conversion** so no data is lost if the target model changes:


* `original_text` and `source_pos`

* `context_shown`: `context_before`, `context_after`, `partial_toc`, `current_position_index`, `last_confirmed_heading`, `detection_signals`, and `matn_evidence`

* `dynamic_choice_list`: The **exact dynamically generated choice list** presented to the model at inference time


* `raw_model_output` and `parsed_model_output`

* `validation_result`: Whether splits, edits, and transitions passed or failed


* `final_accepted_decision`: Final structural decision, `splitPoints`, and `edits` (`start`, `end`, `replacement`, `is_valid_word_substitution`)


* `review_status`: `provenance` (`model_proposed`, `human_confirmed`, `human_corrected`, `gold`), `review_action` (`unreviewed`, `confirmed`, `corrected`, `rejected`), `rejected_proposal`, and `human_corrected_value`

* `privacy_metadata`: `consent_verified: bool`, `source_lecture_id: str`, `anonymized: bool`, `audio_stored: bool = False` (never store audio by default).




* **Privacy & Anonymization (`anonymize_personal_details`):**
* Provide a regex + dictionary-based scrubber to replace personal attendee names or phone/contact details inside `comment` or `student_question` segments with `[اسم طالب]` / `[بيانات شخصية]` while leaving classical scholarly names (e.g., *Imam Malik*, *Al-Shafi'i*) untouched.






2. **Model-Specific Exporters (`exporters.py`):**
* Enforce a strict filter: **only export records where `provenance in {"human_confirmed", "human_corrected", "gold"}**` (never export unreviewed `model_proposed` outputs for training unless an explicit `--include-unreviewed-debug` flag is passed for dry-run testing).


* Implement two separated exporters:
1. `export_for_jev_or_laya(canonical_jsonl_path, output_path)`: Converts records into the classification-with-dynamic-choices format compatible with JEV and `backend/laya_converter.py` / `backend/finetune_laya.py`.


2. `export_for_llm_chat_jsonl(canonical_jsonl_path, output_path, include_hard_negatives=True)`: Converts records (especially human-corrected disagreements, valid-word typo substitutions, and split index examples) into multi-turn chat/instruction JSONL for LLM fine-tuning.







### 8.2 Verification & Checkboxes for Deliverable 7

* [ ] Implement `backend/tafrigh/training_store.py` and `backend/tafrigh/exporters.py`.


* [ ] Write unit tests in `backend/tests/tafrigh/test_logging_and_training.py` verifying:
* [ ] Every pipeline run and human review action appends a complete record with `dynamic_choice_list` and `rejected_proposal` preserved.


* [ ] `exporters.py` excludes `model_proposed` unreviewed records and exports only `human_confirmed`, `human_corrected`, and `gold` records.


* [ ] `anonymize_personal_details` masks attendee PII without corrupting Arabic religious terminology.




* [ ] Run `pytest backend/tests/tafrigh/test_logging_and_training.py` and verify 100% pass rate.

---

## 9. Deliverable 8: Annotation Format, Pilot-Set Tooling & Evaluation Harness

**Files:** `backend/tafrigh/pilot_tools.py`, `backend/tafrigh/evaluation.py`

**Tests:** `backend/tests/tafrigh/test_evaluation.py`

### 9.1 Detailed Implementation Instructions

1. **Gold Annotation Schema (`GoldSegmentRecord`):**
* Use one JSON object per line in `.jsonl` files matching the exact specification:


```json
{
  "id": "seg_0042",
  "text": "فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة الأول الإسلام",
  "tag": null,
  "level": null,
  "parent": null,
  "hasTypo": false,
  "edits": [{"start": 0, "end": 4, "replacement": "فهذا", "is_synthetic": false, "is_valid_word_sub": false}],
  "needsSplitting": true,
  "splitPoints": [4, 10],
  "subsegments": [
    {"id": "seg_0042_sub_0", "text": "فهذا هو الأصل الأول ", "tag": "paragraph", "level": null, "parent": null},
    {"id": "seg_0042_sub_1", "text": "وسنذكر الآن شروط الصلاة وهي تسعة ", "tag": "list_intro", "level": null, "parent": null},
    {"id": "seg_0042_sub_2", "text": "الأول الإسلام", "tag": "list_item", "level": null, "parent": null}
  ],
  "commentKind": null,
  "matnMatch": {"line": 12, "coverage": 0.95}
}

```




2. **Pilot-Set & Annotation Tooling (`pilot_tools.py`):**
* **Stratified Passage Selector (`select_stratified_pilot_passages`):**
* Scans candidate transcripts to select 3–5 passages (300–500 sentences total) stratified across rare phenomena: incidental comments (`sneeze`, `student_question`), `matn`/`sharh` transitions, short partial quotations inside `sharh`, long run-on mixed-role segments (`needsSplitting`), and suspected ASR errors.




* **Bootstrap Pre-Labeling & Blind Split Manager (`prepare_annotation_batches`):**
* Pre-labels passages with a strong model (`gemini_all`) for human correction, while holding back a **blind subset** (e.g., 20% of segments exported with blank labels) to prevent annotator anchoring.


* Generates a 100-sentence dual-annotator overlap batch and a dedicated held-out split (`pilot_heldout_laya.jsonl`) reserved strictly for future Laya evaluation/fine-tuning.




* **Inter-Annotator Agreement Calculator (`compute_iaa`):**
* Computes Cohen's $\kappa$ on the 100 double-annotated sentences for structural `tag`, `heading` level/parent, `needsSplitting`, and `hasTypo` to establish the human ceiling.




* **Synthetic Valid-Word Substitution Generator (`inject_synthetic_valid_word_typos`):**
* Injects realistic Arabic ASR valid-word phonetic substitutions (e.g., `الحق` $\leftrightarrow$ `الخلق`, `العلم` $\leftrightarrow$ `الحلم`, `شرط` $\leftrightarrow$ `شوط`, `الوصية` $\leftrightarrow$ `الوضعية`) with `is_synthetic=True, is_valid_word_sub=True` so typo recall on valid-word substitutions can be stress-tested and reported separately from real ASR errors.






3. **Comprehensive Evaluation Harness (`evaluation.py`):**
* Implement `evaluate_run_against_gold(results_jsonl_path, gold_jsonl_path, manifest_path) -> EvaluationReport` computing every required metric:


* **Per-Class Precision, Recall, and F1** for `paragraph`, `list_intro`, `list_item`, `heading`, `matn_section`, `continuation`, `comment` (plus macro-F1 across non-paragraph classes; explicitly warn against using overall accuracy since `paragraph` dominates).


* **Heading Hierarchy & Parent Accuracy:** Exact level match rate, exact `parent_id` match rate, and tree-edit distance.


* **List Accuracy:** `list_intro` + `list_item` span boundary F1 and item count accuracy.


* **Matn/Sharh Separation:** Span-level IoU and token-level F1 for `matn` vs. `sharh`, plus false-positive rate on short embedded matn quotes inside `sharh`.


* **Comment Accuracy:** Precision/recall on `comment` and classification accuracy on `commentKind`.


* **Split Accuracy & Text Preservation:** Precision/recall on `needsSplitting`, exact match on `splitPoints`, $\pm 1$ word tolerance match on `splitPoints`, and **Exact Text Preservation Rate** (must be $100\%$).


* **Typo Detection & Correction Quality:**
* `hasTypo` recall and precision reported separately for: (a) real ASR errors, and (b) synthetic valid-word substitutions.


* Correction exact span match rate, character F1 improvement toward reference text, and **Non-Typo Wording Preservation Rate** (verifying zero unintended wording changes outside typo spans).









### 9.2 Verification & Checkboxes for Deliverable 8

* [ ] Implement `backend/tafrigh/pilot_tools.py` and `backend/tafrigh/evaluation.py`.


* [ ] Write unit tests in `backend/tests/tafrigh/test_evaluation.py` verifying:
* [ ] Per-class P/R/F1, heading parent accuracy, split point accuracy, and separated real vs. synthetic typo recall calculate accurately on synthetic gold + prediction fixtures.


* [ ] `compute_iaa` calculates Cohen's $\kappa$ accurately on dual-annotator fixtures.




* [ ] Run `pytest backend/tests/tafrigh/test_evaluation.py` and verify 100% pass rate.

---

## 10. Deliverable 9: Deterministic Renderer & Full Application Integration

**Files:** `backend/tafrigh/renderer.py`, `backend/app.py`, `js/render.js`, `js/editor.js`, `js/events.js`, `index.html`, `css/styles.css`

**Tests:** `backend/tests/tafrigh/test_renderer.py`

### 10.1 Detailed Implementation Instructions

1. **Stage 7 Deterministic Renderer (`backend/tafrigh/renderer.py`):**
* Once the structural representation (`segments`, `versions`, `outline_state`, `lecture_spans`) is finalized, rendering must be **100% deterministic** with zero LLM calls.


* Implement `RenderConfig(BaseModel)`:
* `matn_display_source: Literal["spoken", "canonical"] = "spoken"` (open decision configurable per render; when `has_variant_wording == True`, attach a footnote/badge showing the alternate wording).


* `show_comments: bool = True`, `comment_style: Literal["aside_box", "footnote", "dimmed_inline"] = "aside_box"`.


* `use_corrected_text: bool = True` (renders active `SegmentVersion.corrected_text` while keeping `original_text` accessible for diff/revert).




* **Rendering Rules (`render_to_markdown`, `render_to_html`, `render_to_structured_json`):**
* **`heading`:** Render as `#`, `##`, `###` according to validated `level`.


* **`matn_section` & `sharh` spans:**
* When entering a `matn` span, render:
`**المتن:** [text read by the shaykh]`

* When transitioning from a `matn` span into explanation (`sharh`), render:
`**الشرح:** [faithfully transcribed explanation]`



* **`paragraph`:** Starts a new paragraph block (`\n\n`).


* **`list_intro` & `list_item`:** Render `list_intro` as a paragraph ending with `:`, followed by each `list_item` on a bulleted/numbered line (`- ...`).


* **`continuation`:** Appends directly to the immediately preceding rendered block (`paragraph`, `list_item`, `matn_section`, or `comment`) separated by a single space without starting a new paragraph or line.


* **`comment`:** Never delete incidental speech; render visually distinct (e.g., `<aside class="tafrigh-comment" data-comment-kind="student_question">[تنبيه عارض: ...]</aside>` in HTML or a blockquote `> *[تعليق عارض]* ...` in Markdown) using the stored `commentKind`.






2. **Backend API & Frontend UI Integration (`backend/app.py`, `js/`):**
* In `backend/app.py`, mount the Tafrigh endpoints:


* `POST /api/tafrigh/run`: Accepts transcript segments, `matn_config`, `processing_mode` (`per_sentence` | `windowed`), `model_candidate` (`gemini_all` | `jev_hybrid` | `laya_hybrid`), `jev_layout`, and executes the pipeline, returning the rendered output, review queue items, and run report.


* `POST /api/tafrigh/review-action`: Accepts `confirm`, `correct`, or `reject` on any segment or typo edit, updates the active version/tag, re-runs deterministic rendering immediately, and logs to `training_store.py`.


* `GET /api/tafrigh/runs` & `POST /api/tafrigh/compare`: Exposes run reports and side-by-side comparison diffs to the UI.




* In `js/render.js`, `js/editor.js`, `index.html`, and `css/styles.css`:


* Add styles for `.tafrigh-matn-block` (**المتن:**), `.tafrigh-sharh-block` (**الشرح:**), `.tafrigh-comment` (visually distinct incidental speech with `data-comment-kind` badge), and `.tafrigh-diff-popover` (allowing students/editors to inspect original ASR text vs. versioned typo edits and revert with one click).







### 10.2 Verification & Checkboxes for Deliverable 9

* [ ] Implement `backend/tafrigh/renderer.py` and integrate endpoints into `backend/app.py` and frontend rendering into `js/render.js` and `css/styles.css`.


* [ ] Write unit tests in `backend/tests/tafrigh/test_renderer.py` verifying:
* [ ] **المتن:** and **الشرح:** blocks render in the exact target format.


* [ ] `continuation` segments merge inline into the previous segment (`paragraph`, `list_item`, or `matn_section`) without creating a line break.


* [ ] `comment` segments are rendered visually distinct with their `commentKind` metadata intact and are never omitted.


* [ ] Changing `comment_style` or `matn_display_source` re-renders deterministically in $<10\text{ ms}$ with zero model calls.




* [ ] Run `pytest backend/tests/tafrigh/test_renderer.py` and verify 100% pass rate.

---

## 11. Master Experimental Matrix & Final Verification Protocol for AGY

Once all 9 deliverables and their unit test suites pass, execute the following end-to-end verification script to confirm the experimental harness is ready for real pilot data:

### Final Execution Checkboxes

* [ ] **Step 1 (Full Unit & Integration Test Suite):** Run `pytest backend/tests/tafrigh/ -v` and confirm all tests pass with 0 errors.
* [ ] **Step 2 (Dry-Run Experimental Matrix):** Run the pipeline on a sample lecture fixture across the required experimental configurations and verify separate run folders are created under `runs/`:


* [ ] Run 1: Candidate A (`gemini_all`), `mode=per_sentence`, `typo_strategy=gated`.


* [ ] Run 2: Candidate A (`gemini_all`), `mode=windowed` (`window_size=20`), `typo_strategy=gated`.


* [ ] Run 3: Candidate A (`gemini_all`), `mode=per_sentence`, `typo_strategy=always_correct`.


* [ ] Run 4: Candidate B (`jev_hybrid`), `mode=per_sentence`, `jev_layout=independent_questions`, `execution_order=parallel`.


* [ ] Run 5: Candidate B (`jev_hybrid`), `mode=per_sentence`, `jev_layout=independent_questions`, `execution_order=sequential`.


* [ ] Run 6: Candidate B (`jev_hybrid`), `mode=per_sentence`, `jev_layout=split_as_tag_option`.




* [ ] **Step 3 (Comparison Tool Verification):** Execute `python -m backend.tafrigh.compare_runs runs/*` and verify the side-by-side Markdown table and per-segment disagreement diff are generated cleanly.


* [ ] **Step 4 (Faithfulness Invariant Audit):** Confirm via automated assertion across all 6 runs that every segment's `original_text` and `source_pos` remain 100% identical to the input ASR transcript, every split reconstructs the original string character-for-character, and zero `comment` segments were deleted.