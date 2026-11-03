# Graph Report - Wahy-Transcriber  (2026-11-03)

## Corpus Check
- 163 files · ~302,210 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2431 nodes · 6353 edges · 99 communities (88 shown, 11 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 655 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Cross-module Tests
- Tafrigh Pipeline & Adapters
- Transcript Segments & Rendering
- AI Verifier Frontend
- Lecture State & Storage
- Unit of Work & Adapters Base
- Main UI Rendering
- Agent Eval & Auto-labelling
- Tafrigh Core Models
- Source Positions & Matn
- Transcript Editor & FN Studio
- Review Stages & Sprints
- Detection Engine v5
- Model Edits & Corpus Sources
- Teacher Model Clients
- Label Reconciliation & Review
- Teacher Eval & Run Comparison
- Quotation Matcher JS
- Laya v1 Dataset Builder
- Laya Evaluation Metrics
- Verification & Outline Repair
- Bin Baz Lesson Scraper
- Engine Evaluation
- Media Download & Audio
- Laya Data Design
- Speech Segmentation
- Engine JS Test Harness
- Transcribe UI Events
- Ground Truth Alignment
- Engine Python-Node Bridge
- Kaggle DDP Training
- Laya v2 Dataset Builder
- Tafrigh Run Save Endpoints
- Tafrigh Pipeline Core
- Training Store & Evaluation
- FastAPI Tafrigh Runs
- Lecture Cache Processing
- AI Request Options UI
- Internationalization (i18n)
- Laya Datagen Labelling
- Tafrigh Prep UI
- GT Parsing & Labelling
- Whisper Transcription Backends
- Kaggle Runs 1-2
- Datagen Inventory
- Gemini Adapter & Pipeline Tests
- OpenRouter & API Tests
- Corpus Loader
- Detection Engine v4
- App Workspaces UI
- Kaggle Runs 5-6 & Passages
- Kaggle Runs 3-4 & Envelope v2
- Local Fine-tune Script
- Verification UI Sections
- Review Notes & Engine Fixes
- Laya Row Export
- Training Store & Exporters
- Tafrigh API Models Report
- Transcribe API Endpoints
- Tafrigh Laya Export
- Future Work Ideas
- Caption Export (SRT/ASS)
- Saved Lectures Manager
- Datagen Plan & Label Tiers
- Benchmark Metrics
- Label Reviewer CLI
- Dataset Tokenising & Zip
- Local Laya Verifier
- Engine v5 Handoff Docs
- Hadith Corpus Settings
- Read-only API Routes
- Label Card HTML
- Diagnostic Error Modal
- Backend Error Handling
- Colab Runner
- Run 5-6 Results
- Loose Profile & Negatives
- Engine v5 Fix Notes
- ASR Spelling Variants
- Sonnet Labelling Eval
- Run Result Comparison
- Progress Tracking
- Reconcile Function & Tests
- Project Overview & GPU Setup
- Run Comparison & Laya Converter
- Index Page & Styling
- Envelope v2 Design
- Run 6 Comparison Chart
- Datagen ASR
- Rule-based Boundary Baseline
- Logistic Regression Baseline
- OpenRouter UI Controls
- Run Script

## God Nodes (most connected - your core abstractions)
1. `TranscriptSegment` - 111 edges
2. `TafrighPipeline` - 69 edges
3. `StructuralTag` - 58 edges
4. `GeminiAdapter` - 47 edges
5. `OutlineState` - 40 edges
6. `SourcePosition` - 40 edges
7. `StructuralDecision` - 39 edges
8. `JEVAdapter` - 38 edges
9. `api_tafrigh_run()` - 37 edges
10. `BaseModel` - 35 edges

## Surprising Connections (you probably didn't know these)
- `Section 5: cards whose answer changed (fixed / broken)` --references--> `per_verse()`  [INFERRED]
  notebooks/md/results__laya_v2_compare.md → backend/laya_datagen/kaggle/eval_laya.py
- `Step 3: launch FastAPI backend and expose it via Cloudflare Tunnel` --references--> `Expose environment configuration (e.g. from Colab secrets or environment…`  [INFERRED]
  notebooks/md/colab__wahy_colab_runner.md → backend/app.py
- `Notebook: laya_lectures (batch 2 download + ASR + engine v4)` --semantically_similar_to--> `notebooks/data/laya_lectures.ipynb`  [INFERRED] [semantically similar]
  notebooks/md/data__laya_lectures.md → docs/plans/lectures-batch2-handoff.md
- `Answer scheme: verdict + boundary + extra toggles` --semantically_similar_to--> `Boundary scheme (COMPLETE_SPAN / MISSING_START / MISSING_END / MISSING_BOTH)`  [INFERRED] [semantically similar]
  notebooks/md/data__laya_review.md → backend/laya_datagen/agent_eval_files/instructions.md
- `Answer scheme: verdict + boundary + extra toggles` --semantically_similar_to--> `Verdict scheme (CORRECT / IN_HADITH / PARAPHRASE / FALSE / NOT_SURE)`  [INFERRED] [semantically similar]
  notebooks/md/data__laya_review.md → backend/laya_datagen/agent_eval_files/instructions.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Engine v5 fix switches (each independently toggleable)** — docs_reports_engine_v5_report_fix_variants, docs_reports_engine_v5_report_fix_seed2, docs_reports_engine_v5_report_fix_cues, docs_reports_engine_v5_report_fix_short, docs_reports_engine_v5_report_fix_multi, docs_reports_engine_v5_report_fix_ref, docs_reports_engine_v5_report_fix_chain, docs_reports_engine_v5_report_fix_merge, docs_reports_engine_v5_report_fix_free, docs_reports_engine_v5_report_fix_fused, docs_reports_engine_v5_report_fix_qul, docs_reports_engine_v5_report_fix_muq [EXTRACTED 1.00]
- **AI provider configuration cards (Gemini, OpenRouter, Laya)** — index_geminiconfigcard, index_openrouterconfigcard, index_layaconfigcard [EXTRACTED 1.00]
- **Six workspaces switched from the header navigation** — index_section_input, index_section_display, index_section_editor, index_section_datasets, index_section_ai_logs, index_section_training_data [EXTRACTED 1.00]
- **Laya v1 data design (soft labels, lecture split, hidden engine fields, label priority)** — docs_laya_finetune_data_soft_labels, docs_laya_finetune_data_lecture_level_split, docs_laya_finetune_data_engine_fields_hidden, docs_laya_finetune_data_label_priority, docs_laya_finetune_data_class_balance_prior [EXTRACTED 1.00]
- **Envelope v2 changes (passages, neighbours, yes/no boundary with evidence)** — docs_laya_finetune_envelope_v2_passages, docs_laya_finetune_envelope_v2_neighbor_findings, docs_laya_finetune_envelope_v2_yes_no_boundary, docs_laya_finetune_envelope_v2_boundary_evidence [EXTRACTED 1.00]
- **Run 6 compared model variants** — notebooks_results_run6_comparison_r6_before_soft_asis_app, notebooks_results_run6_comparison_r6_v3_single, notebooks_results_run6_comparison_r6_v3_mixed [EXTRACTED 1.00]
- **ASR spelling-variant problems handled by one matcher** — docs_review_notes_asr_long_vowels, docs_review_notes_asr_word_endings, docs_review_notes_first_letters_prefixes, docs_review_notes_split_word_ayah, docs_review_notes_qul_qal [INFERRED 0.85]
- **Quote detection, AI verification and training-data capture flow** — index_section_display, index_ai_verification_quickbar, index_ai_request_telemetry_table, index_laya_dataset_bank_panel, index_section_training_data [INFERRED 0.85]
- **Laya fine-tuning run sequence (runs 1, 2, 3, 5/6)** — docs_laya_finetune_kaggle_guide_run1, docs_laya_finetune_kaggle_guide_run2, docs_laya_finetune_kaggle_guide_run3, docs_reports_run5_and_passage_experiment_run5, docs_reports_run5_and_passage_experiment_run6_variants [INFERRED 0.85]
- **Negatives sourcing flow for Laya (loose engine, new lectures, Sonnet labels)** — docs_plans_engine_v5_handoff_loose_profile_goal, docs_reports_engine_v5_report_loose_profile, docs_plans_lectures_batch2_handoff_sheikh_selection, future_work_hard_negatives [INFERRED 0.85]
- **Laya Kaggle fine-tuning run series (runs 1-6, each fixing the previous run's finding)** — notebooks_md_kaggle__finished__laya_wahy_finetuning_finished, notebooks_md_kaggle__finished__laya_learning_curve_kaggle_finished, notebooks_md_kaggle__finished__wahy_finetuning_laya_v2_run3, notebooks_md_kaggle__finished__wahy_laya_finetuning_run4, notebooks_md_kaggle__finished__wahy_laya_finetuning_run5, notebooks_md_kaggle__finished__wahy_laya_finetuning_run6_finished [EXTRACTED 1.00]
- **Run 3 envelope v2 ablation (base, passages, neighbours, both, both_synth)** — notebooks_md_kaggle__finished__wahy_finetuning_laya_v2_run3_base, notebooks_md_kaggle__finished__wahy_finetuning_laya_v2_run3_passages, notebooks_md_kaggle__finished__wahy_finetuning_laya_v2_run3_neighbours, notebooks_md_kaggle__finished__wahy_finetuning_laya_v2_run3_both, notebooks_md_kaggle__finished__wahy_finetuning_laya_v2_run3_both_synth [EXTRACTED 1.00]
- **Runs 4-6 diagnosis chain: verdict-only controls, v1-layout passages, envelope v3 candidates** — notebooks_md_kaggle__finished__wahy_laya_finetuning_run4_both_verdict, notebooks_md_kaggle__finished__wahy_laya_finetuning_run4_v1_verdict, notebooks_md_kaggle__finished__wahy_laya_finetuning_run5_v1_passages, notebooks_md_kaggle__finished__wahy_laya_finetuning_run5_passages_verdict, notebooks_md_kaggle__finished__wahy_laya_finetuning_run6_finished_v3_single, notebooks_md_kaggle__finished__wahy_laya_finetuning_run6_finished_v3_mixed [INFERRED 0.85]
- **Laya data workflow: lectures -> autolabel -> engine v5 loose -> dataset** — notebooks_md_data__laya_lectures, notebooks_md_data__laya_autolabel, notebooks_md_data__laya_engine_v5, notebooks_md_data__laya_dataset [INFERRED 0.85]
- **Review stages 1-7 of laya_review** — notebooks_md_data__laya_review_stage1_gt_check, notebooks_md_data__laya_review_stage2_gt_findings, notebooks_md_data__laya_review_stage3_missed_gt, notebooks_md_data__laya_review_stage4_other_findings, notebooks_md_data__laya_review_stage5_model_check, notebooks_md_data__laya_review_stage6_negatives_sprint, notebooks_md_data__laya_review_stage7_ai_labeller_test [EXTRACTED 1.00]
- **Colab runner three-step flow** — notebooks_md_colab__wahy_colab_runner_step1_setup, notebooks_md_colab__wahy_colab_runner_step2_preload_models, notebooks_md_colab__wahy_colab_runner_step3_cloudflare_tunnel [EXTRACTED 1.00]

## Communities (99 total, 11 thin omitted)

### Community 0 - "Cross-module Tests"
Cohesion: 0.05
Nodes (58): JEVAPIError, test_detects_verse_and_hadith_with_app_envelope(), bridge(), find(), span(), test_consecutive_short_ayat(), test_endings_and_dropped_letters_full_ayah(), test_fragment_of_common_words() (+50 more)

### Community 1 - "Tafrigh Pipeline & Adapters"
Cohesion: 0.06
Nodes (25): BaseAdapter, ChoiceClassifierAdapter, JEVAdapter, LayaAdapter, TafrighPipeline, GeminiWindowItemSchema, JEVRequestConfig, PipelineConfig (+17 more)

### Community 2 - "Transcript Segments & Rendering"
Cohesion: 0.08
Nodes (31): api_tafrigh_clone_run(), api_tafrigh_review_action(), api_tafrigh_run(), api_tafrigh_save_run(), _load_tafrigh_session(), _save_tafrigh_session(), CommentKind, LabelProvenance (+23 more)

### Community 3 - "AI Verifier Frontend"
Cohesion: 0.08
Nodes (67): aiRunLabel(), assertOpenRouterChatModelExists(), boundaryByRule(), boundaryFromYesNo(), buildCanonicalDecisionEnvelope(), buildGeminiRequestBody(), buildGroupMergeContext(), buildJevPayload() (+59 more)

### Community 4 - "Lecture State & Storage"
Cohesion: 0.06
Nodes (61): activeEngineName(), alignTranscriptSegToUnit(), beginNewLectureRun(), BUILTIN_ADHKAR_DATA, clearVerificationRecordsDB(), currentLectureRunEntry(), currentRunContent(), currentState (+53 more)

### Community 5 - "Unit of Work & Adapters Base"
Cohesion: 0.07
Nodes (17): annotate_segment_with_word_indices(), _clean_int(), GeminiAdapter, GeminiAPIError, helper_field(), list_gemini_models(), normalize_openrouter_model(), normalize_split_points() (+9 more)

### Community 6 - "Main UI Rendering"
Cohesion: 0.07
Nodes (59): buildFormattedPlainOrMarkdownLecture(), buildLectureHtmlContent(), checkAndUpdateLayaBackendStatus(), closeSaveTafrighRunModal(), decorateTafrighReviewInline(), executeTafrighReviewAction(), exportLectureAsJSON(), exportLectureAsMarkdown() (+51 more)

### Community 7 - "Agent Eval & Auto-labelling"
Cohesion: 0.08
Nodes (33): card_text(), _gemini_guided(), guide(), _jev_guided(), _key_map_path(), _kind(), _marked(), prepare() (+25 more)

### Community 8 - "Tafrigh Core Models"
Cohesion: 0.07
Nodes (18): _outline(), BaseModel, HeadingEntry, OutlineState, StructuralDecision, TOCConfig, tokenize_words(), WordToken (+10 more)

### Community 9 - "Source Positions & Matn"
Cohesion: 0.08
Nodes (21): compute_fuzzy_similarity(), MatnConfig, normalize_arabic_for_alignment(), SequentialMatnAligner, field_validator(), dec(), MatnMatchEvidence, model_validator() (+13 more)

### Community 10 - "Transcript Editor & FN Studio"
Cohesion: 0.06
Nodes (36): addReferenceToFinding(), alignAndRetimeWords(), applyLectureTextEdits(), applySpanEditModal(), buildMatnDropdownSnippet(), closeSpanEditModal(), commitFnDhikrToAdhkarDatabase(), commitFnQuoteHelper() (+28 more)

### Community 11 - "Review Stages & Sprints"
Cohesion: 0.09
Nodes (32): spot_check(), extra(), summ(), build_queues(), _gemini_pick(), narrator_share(), pool(), results() (+24 more)

### Community 12 - "Detection Engine v5"
Cohesion: 0.07
Nodes (28): WahyEngineV5, WV5_ADHKAR_CUES, wv5_cueQuranBlocks(), WV5_DEFAULTS, wv5_dropOneLetter(), wv5_extractMatn(), wv5_intersects(), WV5_LETTER_NAMES (+20 more)

### Community 13 - "Model Edits & Corpus Sources"
Cohesion: 0.09
Nodes (22): _book_for(), _clean(), convert_open_hadith_zip(), CorpusSourceManager, _hadith_items(), _get(), _norm(), _relocate() (+14 more)

### Community 14 - "Teacher Model Clients"
Cohesion: 0.09
Nodes (14): key(), ask(), normalize(), Teacher, GeminiTeacher, JevTeacher, LayaLocal, OpenRouterChatTeacher (+6 more)

### Community 15 - "Label Reconciliation & Review"
Cohesion: 0.08
Nodes (23): human_key(), human_labels(), save_human(), audit_results(), audit_sample(), audit_widget(), save(), show() (+15 more)

### Community 16 - "Teacher Eval & Run Comparison"
Cohesion: 0.09
Nodes (24): convert_single_record_to_laya_format(), convert_verification_records_to_laya_jsonl(), main(), sanitize_probabilities(), answer(), answered(), load(), save() (+16 more)

### Community 17 - "Quotation Matcher JS"
Cohesion: 0.10
Nodes (31): checkWarshUsulMatch(), CITATION_AND_ISNAD_WORDS, CONTINUATION_MARKER_NORMS, EXEGETICAL_MARKERS, expandHonorificLigatures(), HADITH_CITATION_CUES, HONORIFIC_LIGATURES, isCitationOrIsnadWord() (+23 more)

### Community 18 - "Laya v1 Dataset Builder"
Cohesion: 0.09
Nodes (23): assign_splits(), auc(), build(), build_rows(), counts(), downsample_false(), _h(), lecture_info() (+15 more)

### Community 19 - "Laya Evaluation Metrics"
Cohesion: 0.10
Nodes (20): auc(), baseline_predictions(), boundary_metrics(), compare(), compare_boundary(), compare_slices(), decide(), ece() (+12 more)

### Community 20 - "Verification & Outline Repair"
Cohesion: 0.09
Nodes (11): compare_run_dirs(), build_mock_adapters_for_sample(), execute_master_matrix_protocol(), run_single_matrix_experiment(), AnomalyRecord, OutlineRepairReport, run_outline_repair_pass(), compute_percentiles() (+3 more)

### Community 21 - "Bin Baz Lesson Scraper"
Cohesion: 0.10
Nodes (19): Block, clean(), download_mp3(), fetch_html(), get_lesson(), iter_series_items(), Lesson, parse_lesson() (+11 more)

### Community 22 - "Engine Evaluation"
Cohesion: 0.14
Nodes (19): boundaries(), diff(), tally(), _inherited(), label_stores(), lessons(), load(), _load() (+11 more)

### Community 23 - "Media Download & Audio"
Cohesion: 0.12
Nodes (11): to_wav16k(), download_youtube_media(), FFmpegProcessingError, get_cached_youtube_media(), normalize_audio_streams(), probe_media_duration_seconds(), slice_audio_for_groq(), YtDlpDownloadError (+3 more)

### Community 24 - "Laya Data Design"
Cohesion: 0.09
Nodes (30): Blind labelling test instructions (30 findings), Boundary scheme (COMPLETE_SPAN / MISSING_START / MISSING_END / MISSING_BOTH), label.py next/answer/status tool, Verdict scheme (CORRECT / IN_HADITH / PARAPHRASE / FALSE / NOT_SURE), What data Laya needs, and why (data.md), WahyAiVerifier.buildCanonicalDecisionEnvelope, Envelope state fields (v1), export.py to_laya_row (+22 more)

### Community 25 - "Speech Segmentation"
Cohesion: 0.13
Nodes (18): find_punctuation_cut_points(), resolve_detection_boundaries(), segment_transcript(), inside_atomic(), n_words(), split_long(), SegmentationConfig, _word_spans() (+10 more)

### Community 26 - "Engine JS Test Harness"
Cohesion: 0.09
Nodes (22): buildWords(), crypto, ctx, DET_FIELDS, detect(), EXPECTED_CLASS, fileHashes, FILES (+14 more)

### Community 27 - "Transcribe UI Events"
Cohesion: 0.12
Nodes (21): Toast notification box, attachMediaUrlToPlayer(), attachTafrighModelSearch(), getQuoteTextMode(), handleBackendTranscribeRequest(), _lecturesWithRunsOpen, loadTafrighCatalog(), renderTafrighEstimate() (+13 more)

### Community 28 - "Ground Truth Alignment"
Cohesion: 0.11
Nodes (16): align(), _align_gap(), _anchors(), _digits(), locate_ayah(), parse_gt(), add_words(), surah_lookup() (+8 more)

### Community 29 - "Engine Python-Node Bridge"
Cohesion: 0.12
Nodes (8): EngineBridge, EngineBridgeError, _ctx(), build_ctx(), bridge(), test_fingerprint_is_stable(), test_loose_profile_is_really_loose(), Engine comparison scored against GT (precision, Quran recall)

### Community 30 - "Kaggle DDP Training"
Cohesion: 0.10
Nodes (14): balanced_accuracy(), is_incomplete_boundary(), is_true_noul(), item_kind(), main(), load(), val_metrics(), parse_args() (+6 more)

### Community 31 - "Laya v2 Dataset Builder"
Cohesion: 0.15
Nodes (15): build(), describe(), key_of(), labels_by_key(), make_row(), _noul(), position(), runs() (+7 more)

### Community 32 - "Tafrigh Run Save Endpoints"
Cohesion: 0.14
Nodes (14): api_laya_convert_dataset(), api_laya_load(), api_laya_predict(), api_openrouter_decisions(), api_tafrigh_compare(), api_tafrigh_control(), api_tafrigh_estimate(), api_tafrigh_models() (+6 more)

### Community 34 - "Training Store & Evaluation"
Cohesion: 0.11
Nodes (14): ClassMetrics, compute_prf1(), evaluate_run_against_gold(), EvaluationReport, compute_iaa(), GoldSegmentRecord, GoldSubsegment, inject_synthetic_valid_word_typos() (+6 more)

### Community 35 - "FastAPI Tafrigh Runs"
Cohesion: 0.09
Nodes (5): api_corpus_prepare(), no_cache_frontend_assets(), _start_corpus_prepare(), ModelAPIError, redact_secrets()

### Community 36 - "Lecture Cache Processing"
Cohesion: 0.15
Nodes (10): _file_sha(), _local_whisper(), transcribe(), JsonCache, add_engine(), load_lectures(), process_cached(), process_lesson() (+2 more)

### Community 37 - "AI Request Options UI"
Cohesion: 0.16
Nodes (24): AI request options modal (#modalAiRequestOptions), AI_PROVIDER_CARDS, aiDetCategory(), aiOptsCfg(), aiOptsSampleIdx(), aiOptsState, aiProviderHasKey(), aiVerdictBadge() (+16 more)

### Community 38 - "Internationalization (i18n)"
Cohesion: 0.18
Nodes (23): applyDirection(), blockedBy(), buildCountRules(), buildFragmentRe(), callTranslationModel(), deleteLanguagePack(), generateLanguagePack(), getPackSource() (+15 more)

### Community 39 - "Laya Datagen Labelling"
Cohesion: 0.17
Nodes (12): bucket(), default_scope(), tag_cases(), _boundary(), _coverage(), DocCtx, _evidence(), Label (+4 more)

### Community 40 - "Tafrigh Prep UI"
Cohesion: 0.13
Nodes (24): endTafrighRun(), openTafrighPrep(), refreshTafrighEstimate(), refreshTafrighPreview(), renderTafrighProgress(), renderTafrighSegList(), renderTafrighSourceInfo(), renderTafrighStats() (+16 more)

### Community 41 - "GT Parsing & Labelling"
Cohesion: 0.19
Nodes (14): Alignment, GTDoc, HadithRegion, _inline_hadith(), QuranSpan, ctx(), det(), test_boundary_missing_start_needs_asr_evidence() (+6 more)

### Community 42 - "Whisper Transcription Backends"
Cohesion: 0.14
Nodes (8): build_unified_word_schema(), CUDAOutOfMemoryError, get_specialized_whisper_pipeline(), GroqAPIError, LocalWhisperError, transcribe_with_groq_chunks(), transcribe_with_local_faster_whisper(), transcribe_with_specialized_whisper()

### Community 43 - "Kaggle Runs 1-2"
Cohesion: 0.16
Nodes (22): Class balance and prior correction (48.5 percent vs ~10 percent not-a-quote), laya_v1 dataset (soft_asis, soft_balanced, hard_asis, test, baselines, manifest), Temperature calibration fitted on val lectures, Fine-tuning Laya on Kaggle guide, Using the fine-tuned model in the app (laya.load, custom checkpoint), convaiinnovations/laya-multilingual (mmBERT-base), DDP training on 2xT4 (effective batch 64, fp16, checkpointing), RLCD loss (soft cross-entropy + GRPO-style proper-scoring reward) (+14 more)

### Community 44 - "Datagen Inventory"
Cohesion: 0.16
Nodes (10): answers(), by_reviewer(), collect(), _load(), splits(), summary(), usable(), load_inventory() (+2 more)

### Community 45 - "Gemini Adapter & Pipeline Tests"
Cohesion: 0.15
Nodes (12): pick_model(), TafrighModelError, make(), test_auto_model_resolves_before_first_call(), test_key_goes_in_header_never_in_url(), handler(), test_pick_model_prefers_flash_lite_and_skips_unsuitable(), test_pipeline_stops_with_clear_error_on_rejected_key() (+4 more)

### Community 46 - "OpenRouter & API Tests"
Cohesion: 0.15
Nodes (14): chat_reply(), make(), test_bare_gemini_name_gets_the_openrouter_prefix(), test_decision_trace_names_the_openrouter_model(), handler(), test_model_without_json_mode_is_asked_again_without_response_format(), handler(), test_reply_cut_short_is_retried_with_more_tokens() (+6 more)

### Community 47 - "Corpus Loader"
Cohesion: 0.21
Nodes (20): applyNormalizedCorpusToState(), clearAndRedownloadCorpus(), clearWahyCorpusDB(), DEFAULT_CORPUS_ENDPOINTS, DEFAULT_HADITH_DATA, downloadAllCorporaFromRemote(), fetchJsonSafely(), getCorpusEndpointsConfig() (+12 more)

### Community 48 - "Detection Engine v4"
Cohesion: 0.16
Nodes (6): cueQuranBlocks(), WahyEngine, WV4_ADHKAR_CUES, WV4_DEFAULTS, wv4_extractMatn(), WV4_TAKHRIJ_TAILS

### Community 49 - "App Workspaces UI"
Cohesion: 0.13
Nodes (21): Delete intent labels (FALSE_POSITIVE, BOUNDARY_RESELECT, TEST_SCRATCHPAD), Hadith corpus choice (Wahy default vs Open Hadith Data), Qira'at (ten recitations) selection, Quote categories: ayah, hadith, dhikr, Quote text mode: as spoken vs canonical orthography, Corpus reference linker modal (#corpusSearchModal), Deletion intent telemetry modal (#modalDeleteIntent), Engine sensitivity parameters (IDF, gaps, thresholds) (+13 more)

### Community 50 - "Kaggle Runs 5-6 & Passages"
Cohesion: 0.18
Nodes (20): Laya envelope v2 (run 3), neighbor_findings (nearest findings, no verdicts), Passages (consecutive verses merged into one row), Short verses inside a recitation rejected (Al-Waqia 89), Run 5 and zero-shot passages experiment report, Envelope v3 plan (v1 layout + boundary cues, no neighbor blobs, 2048), Run 5: fine-tuning on passages (degraded single quotes), Zero-shot soft_asis on combined passages (0/12 missed) (+12 more)

### Community 51 - "Kaggle Runs 3-4 & Envelope v2"
Cohesion: 0.16
Nodes (18): rule_predictions(), buildLayaV2Requests (single builder for app and data), Envelope v2 (passages, neighbours, yes/no boundary), Laya run history (runs 1-4), Run 3 results: passage fix works, verdict AUC worse, Run 4 plan (verdict-only vs boundary-only ablation), Counterfactual cut-off boundary rows, laya_v2 variants (base, passages, neighbours, both, both_synth) (+10 more)

### Community 52 - "Local Fine-tune Script"
Cohesion: 0.16
Nodes (5): LayaJsonlDataset, load_dataset(), main(), run_temperature_calibration(), train_head_only()

### Community 53 - "Verification UI Sections"
Cohesion: 0.15
Nodes (18): Gemini free-tier RPM pacer, OpenRouter JEV Decisions mode (typesafe/jev), Laya local fine-tuned classifier (laya-wahy-r6-v3_mixed, Envelope v3), Training task types (correctness, completeness, segmentation, classification, typo), AI request payload inspector modal (#aiPayloadModal), AI request telemetry and decision inspector table, AI quote verification quick bar, Google Gemini config card (+10 more)

### Community 54 - "Review Notes & Engine Fixes"
Cohesion: 0.17
Nodes (18): v5 fix: cues (stronger hadith/Quran cues, takhrij after), v5 fix: muq (spelled-out muqatta'at), v5 fix: ref (prefer adjacent ayah of neighbouring finding), Review notes (29 dictated notes), Note 3: ayah quoted inside a hadith, Note 9: consecutive ayat as one passage? and muqatta'at, Note 28: dhikr as post-detection check with editable list, Note 29: sheikh explaining with the text's own words is not a quote (+10 more)

### Community 55 - "Laya Row Export"
Cohesion: 0.22
Nodes (9): assign_splits(), export_dataset(), soft(), to_laya_row(), rec(), test_export_splits_by_doc_dedups_and_caps(), test_false_has_no_boundary_and_silent_is_dropped(), test_row_hides_engine_fields_and_uses_gold_probabilities() (+1 more)

### Community 56 - "Training Store & Exporters"
Cohesion: 0.16
Nodes (7): export_for_jev_or_laya(), export_for_llm_chat_jsonl(), anonymize_personal_details(), CanonicalTrainingRecord, TrainingStore, test_anonymize_personal_details(), test_canonical_training_store_and_exporters()

### Community 57 - "Tafrigh API Models Report"
Cohesion: 0.16
Nodes (15): Tafrigh with API models report, Tafrigh cost estimator (/api/tafrigh/estimate), Gemini batch verdict bug (first finding's verdict reused), Helper prompt regression (classifier prompt sent to helper), Live OpenRouter cost table (DeepSeek, JEV, Gemini), Instructions-before-finding prompt order for cache pricing, Tafrigh sentence mode (JEV/Laya only), Tafrigh window mode (default) (+7 more)

### Community 58 - "Transcribe API Endpoints"
Cohesion: 0.15
Nodes (10): api_corpus_upload(), _discard(), on_progress(), api_transcribe(), on_chunk_done(), on_segment(), work(), _make_download_hook() (+2 more)

### Community 59 - "Tafrigh Laya Export"
Cohesion: 0.23
Nodes (8): describe_option(), build_examples(), _choice_question(), label_source(), _model_answers(), _reconstructed_input(), save_run(), tag_label()

### Community 60 - "Future Work Ideas"
Cohesion: 0.22
Nodes (12): Note 11: Whisper hallucinated English in Arabic lesson, Note 21: most stage-3 missed GT is an ASR problem, Tahqeeq roadmap (future_work.md), Guarded auto-healing loop, Benchmark plan and evaluation metrics, Separate detection from canonical restoration, Final end-to-end validation, Evaluate Laya as multi-task reviewer (+4 more)

### Community 61 - "Caption Export (SRT/ASS)"
Cohesion: 0.24
Nodes (10): buildAyahGroupRefMap(), buildSmartCaptions(), exportCaptionsToASS(), exportCaptionsToSRT(), exportCaptionsToVTT(), formatAssTime(), formatSecondsToTimestamp(), getBracketsForCategory() (+2 more)

### Community 62 - "Saved Lectures Manager"
Cohesion: 0.32
Nodes (13): aiCheckBlocksSwitch(), applyRestoredSessionToUi(), deleteRunWithConfirm(), fmtSavedDate(), forgetOpenLectureRecord(), initSavedLecturesManager(), openLectureRun(), promptRenameLectureRun() (+5 more)

### Community 63 - "Datagen Plan & Label Tiers"
Cohesion: 0.20
Nodes (12): Labelling card (ASR span, Bin Baz written text, corpus text), Engine score/band hidden (engine_agnostic profile), Bin Baz written text used for testing only, Laya training-data generator execution plan, ASR to GT token alignment with doc gate, Bin Baz lessons as ground-truth source, Decisions D1-D7 (engine, engine_agnostic state, wrong ref FALSE, NOT_SURE human-only), Finding F1/F2: finetune_laya.py never trains; exporters write answers not gold (+4 more)

### Community 64 - "Benchmark Metrics"
Cohesion: 0.21
Nodes (7): confusion(), ece(), score(), Reconciliation GT + teacher + human (D6), Teachers (JEV, Gemini, OpenRouter chat, local Laya baseline), Teachers (JEV, Gemini, OpenRouter, base Laya) benchmarked on GT-strong labels, Stage 5: model check (JEV, Gemini, base Laya vs your labels)

### Community 66 - "Dataset Tokenising & Zip"
Cohesion: 0.18
Nodes (6): tokenizer(), token_lengths(), validate(), zip_dataset(), max_len 1024 truncation (keeps start, drops end), Part 6: token budget vs max_len 1024

### Community 68 - "Engine v5 Handoff Docs"
Cohesion: 0.21
Nodes (11): HANDOFF: Laya fine-tuning state 2026-10-27, Gotchas (harness engine build, finding keys, sleep kills CUDA), Handoff: engine v5 and loose profile, Measuring engine fixes (recall on 15 Bin Baz lessons, precision via labels), Docs index, Engine v5 report, engine_eval.py evaluation harness, test_engine_v5.py regression cases (+3 more)

### Community 69 - "Hadith Corpus Settings"
Cohesion: 0.38
Nodes (11): applySavedHadithCorpusChoice(), fetchHadithCorpusSources(), getSavedHadithCorpusChoice(), hadithCorpusSources, loadHadithCorpusData(), preparingCorpusJobs, renderHadithCorpusSettings(), selectHadithCorpus() (+3 more)

### Community 70 - "Read-only API Routes"
Cohesion: 0.18
Nodes (6): api_corpus_sources(), api_env_config(), api_laya_status(), api_tafrigh_list_runs(), get_backend_corpus_cache(), serve_index()

### Community 71 - "Label Card HTML"
Cohesion: 0.36
Nodes (8): audio_clip(), _chip_src(), esc(), mmss(), render_finding(), render_gt(), words_html(), flush()

### Community 72 - "Diagnostic Error Modal"
Cohesion: 0.36
Nodes (9): buildDiagnosticMarkdownReport(), copyDiagnosticReportForAI(), copyTextWithFallback(), ensureDiagnosticModalDOM(), fallbackCopyExec(), getActiveStateSnapshot(), logAction(), redactSecrets() (+1 more)

### Community 73 - "Backend Error Handling"
Cohesion: 0.22
Nodes (5): api_health(), classify_exception_type(), global_diagnostic_exception_handler(), check_ffmpeg_available(), get_vram_allocated_mb()

### Community 74 - "Colab Runner"
Cohesion: 0.24
Nodes (6): Notebook: wahy_colab_runner (Colab T4 runner), Step 1: GPU check, secrets, clone laya-experiments, install deps, Step 2: pre-load Abu-Dju Whisper + Laya on GPU (~4.3 GB of 15 GB VRAM), Step 3: launch FastAPI backend and expose it via Cloudflare Tunnel, Notebooks README, wahy_colab_runner.ipynb (Whisper + Laya on Colab)

### Community 75 - "Run 5-6 Results"
Cohesion: 0.29
Nodes (10): Base Laya zero-shot baseline (59.1 percent, 42.7 percent real rejected), Span-length shortcut baseline, Checker comparison on user's 198 cards, Run 6 variants v3_single and v3_mixed, Base Laya zero-shot evaluation (the 'before' line of run 1), Run 6 verdict report tables, Slices by context and span length, soft_asis (app) before line in run 6 (+2 more)

### Community 76 - "Loose Profile & Negatives"
Cohesion: 0.24
Nodes (9): Handoff: lecture batch 2 (download + transcribe), Groq free-tier ASR limits and resumable caching, notebooks/data/laya_lectures.ipynb, Batch 2 selection: 12 sheikhs, 38 videos + Bin Baz lessons, v5 loose profile (WV5_PROFILES.loose), Note 1: matn-only hadith findings need sanad sometimes, Note 23: findings that are only sanad/narrator names are key negatives, Build better non-quotation (hard negative) examples (+1 more)

### Community 77 - "Engine v5 Fix Notes"
Cohesion: 0.27
Nodes (10): WahyEngineV5 (js/engine_v5.js), v5 fix: free (honorifics and asides skipped for free), v5 fix: merge (long quote as one finding), v5 fix: multi (multi-home phrases kept with ambiguous reference), v5 fix: qul (قال as verse-initial قل), v5 fix: seed2 (bigram credits both words), v5 fix: short (complete 1-2 word ayah without cue), Note 14: parenthetical phrases (honorifics) must not affect a finding (+2 more)

### Community 78 - "ASR Spelling Variants"
Cohesion: 0.27
Nodes (10): v5 fix: chain (near-miss consecutive ayat support each other), v5 fix: fused (two ASR words join to a rare corpus word), v5 fix: variants (ASR spelling near-matches), Note 4: long-vowel letters dropped (اتق/اتقي), Note 6: ASR word endings (ة/ه, ا/ى, tanwin, pronoun suffixes), Note 13: first letters (ال and و ف ب ك ل prefixes) dropped/added/swapped, Note 20: neighbour probe chain failure (الانفطار:10-11), Note 16: short quote through very noisy ASR (النحل:74) (+2 more)

### Community 79 - "Sonnet Labelling Eval"
Cohesion: 0.36
Nodes (5): main(), pool_and_bundles(), report(), run(), your_labels()

### Community 80 - "Run Result Comparison"
Cohesion: 0.31
Nodes (9): eval_laya.per_verse scoring, eval_laya.py evaluation script, Notebook: laya_v2_compare (read Kaggle run 3/4 results locally), Section 5: cards whose answer changed (fixed / broken), Section 2: short-span / same-surah context slices, Load downloaded Kaggle results/ folder (status.json, per-model json, baselines), Section 4: per-epoch training curves from train logs, Section 1: verdict tables by label group (+1 more)

### Community 81 - "Progress Tracking"
Cohesion: 0.25
Nodes (5): api_transcribe_progress(), clear_control(), get_control(), get_progress(), set_control()

### Community 82 - "Reconcile Function & Tests"
Cohesion: 0.57
Nodes (6): reconcile(), rec(), t(), test_human_wins_and_asr_mismatch_dropped(), test_silent_needs_two_confident_agreeing_teachers_and_never_not_sure(), test_strong_gt_vs_confident_teacher_goes_to_review()

### Community 83 - "Project Overview & GPU Setup"
Cohesion: 0.25
Nodes (7): torch cu126 build for GTX 1050 (sm_61), GPU fix: torch cu126 in project .venv, README (Wahy Studio overview), FastAPI endpoint overview, Atomic SRT/VTT/ASS captions, Quote detection (Quran, hadith, adhkar corpus), Wahy Studio app

### Community 84 - "Run Comparison & Laya Converter"
Cohesion: 0.25
Nodes (3): generate_comparison_table(), generate_per_segment_disagreements(), load_run_data()

### Community 85 - "Index Page & Styling"
Cohesion: 0.29
Nodes (5): css/styles.css, index.html (Wahy Studio single-page shell), Input workspace (#section_input), Tailwind config mapping colours to CSS variables, Speech-to-text engine selector (Groq, Abu-Dju Whisper, local Whisper)

### Community 86 - "Envelope v2 Design"
Cohesion: 0.25
Nodes (8): Boundary head collapse (always COMPLETE_SPAN), prefix_words_heard / suffix_words_heard boundary evidence, Boundary as two yes/no questions (start_missing, end_missing), Run 2: learning curve + boundary oversampling, Laya checkers on the same test cards (2026-10-27), Boundary balanced accuracy comparison, Sonnet vs user agreement (95.4 percent verdict, 87-89 percent boundary), Section 3: boundary at 0.5 and tuned thresholds

### Community 87 - "Run 6 Comparison Chart"
Cohesion: 0.52
Nodes (7): Run 6 comparison chart (comparison_r6.png), before: soft_asis (app) baseline (AUC ~0.945, acc ~91.4%), Run 2 benchmark (AUC 0.945) reference line, v3_mixed model (AUC ~0.945, acc ~91%), v3_single model (AUC ~0.92, acc ~86.3%), Verdict Accuracy % bar chart (Cards: you), y 70-100, Verdict AUC bar chart (Cards: you), y 0.75-1.0

### Community 88 - "Datagen ASR"
Cohesion: 0.33
Nodes (3): api_laya_unload(), cleanup_cuda_vram(), unload_specialized_whisper()

### Community 89 - "Rule-based Boundary Baseline"
Cohesion: 0.40
Nodes (4): _norm_words(), rule_boundary(), _similar(), _aligned()

### Community 91 - "OpenRouter UI Controls"
Cohesion: 0.50
Nodes (3): initAiVerificationEventListeners(), selectOpenRouterProvider(), setOpenRouterModeUI()

## Knowledge Gaps
- **34 isolated node(s):** `Toast notification box`, `AI request payload inspector modal (#aiPayloadModal)`, `Tafrigh pre-run cost/time estimate panel`, `Saved Tafrigh runs bar`, `Delete intent labels (FALSE_POSITIVE, BOUNDARY_RESELECT, TEST_SCRATCHPAD)` (+29 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 671 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html (Wahy Studio single-page shell)` connect `Index Page & Styling` to `AI Verifier Frontend`, `Lecture State & Storage`, `AI Request Options UI`, `Hadith Corpus Settings`, `Internationalization (i18n)`, `Diagnostic Error Modal`, `Main UI Rendering`, `Transcript Editor & FN Studio`, `Detection Engine v5`, `Corpus Loader`, `Detection Engine v4`, `App Workspaces UI`, `Quotation Matcher JS`, `Verification UI Sections`, `Transcribe UI Events`, `Caption Export (SRT/ASS)`?**
  _High betweenness centrality (0.370) - this node is a cross-community bridge._
- **Are the 34 inferred relationships involving `TranscriptSegment` (e.g. with `api_tafrigh_review_action()` and `api_tafrigh_run()`) actually correct?**
  _`TranscriptSegment` has 34 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Toast notification box`, `AI request payload inspector modal (#aiPayloadModal)`, `Tafrigh pre-run cost/time estimate panel` to the rest of the system?**
  _34 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Cross-module Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.050837496326770495 - nodes in this community are weakly interconnected._
- **Why does `Notebook: Run 3 - envelope v2 ablation on laya_v2 (5 models, 2 epochs)` connect `Kaggle Runs 3-4 & Envelope v2` to `AI Verifier Frontend`, `Kaggle Runs 1-2`, `Kaggle Runs 5-6 & Passages`, `Laya Evaluation Metrics`, `Envelope v2 Design`, `Kaggle DDP Training`, `Laya v2 Dataset Builder`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `TafrighPipeline` (e.g. with `api_tafrigh_run()` and `BaseAdapter`) actually correct?**
  _`TafrighPipeline` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Should `Tafrigh Pipeline & Adapters` be split into smaller, more focused modules?**
  _Cohesion score 0.05895061728395062 - nodes in this community are weakly interconnected._