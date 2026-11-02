# Graph Report - Wahy-Transcriber  (2026-11-03)

## Corpus Check
- 146 files · ~277,850 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 21 file(s) not represented in the graph (top: .ipynb 16, (none) 2, .css 1)

## Summary
- 2329 nodes · 5890 edges · 106 communities (92 shown, 14 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 584 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Tafrigh Core Models
- AI Verifier Frontend
- Lecture State & Storage
- Main UI Rendering
- Transcript Editor & FN Studio
- FastAPI Tafrigh Runs
- Unit of Work & Adapters Base
- Detection Engine v5
- Model Edits & Corpus Sources
- Gemini Adapter & Pipeline Tests
- Tafrigh Pipeline Core
- Master Verification Schemas
- Quotation Matcher JS
- Training Store & Evaluation
- Teacher Model Clients
- Laya Datagen Labelling
- Laya Evaluation Metrics
- Laya v2 Dataset Builder
- Transcript Renderers
- Tafrigh Run Save Endpoints
- Ground Truth Alignment
- Laya v1 Dataset Builder
- Label Reconciliation & Review
- Whisper Transcription Backends
- Speech Segmentation
- Engine Evaluation
- Engine JS Test Harness
- Transcribe UI Events
- Agent Eval Runner
- Labelling Sprint & Cache
- Run Comparison & Laya Converter
- Engine Python-Node Bridge
- Media Download & Audio
- AI Request Options UI
- Internationalization (i18n)
- Kaggle DDP Training
- Tafrigh Prep UI
- Engine v5 Tests
- Bin Baz Lesson Scraper
- Pipeline Stage Reports
- Matn Alignment
- OpenRouter & API Tests
- Corpus Loader
- Detection Engine v4
- Datagen Inventory
- Teacher Eval Runs
- Verification UI Sections
- JEV Adapter
- App Workspaces UI
- Review Notes & Engine Fixes
- Lecture Cache Processing
- Laya v2 Tests
- Local Fine-tune Script
- Auto-labelling
- Datagen Plan & Label Tiers
- Engine v5 Handoff Docs
- Laya Row Export
- JEV Live Contract Tests
- Tafrigh API Models Report
- Label Reviewer CLI
- Tafrigh Laya Export
- Engine v5 Fix Notes
- Datagen ASR
- Laya Fine-tuning Guides
- Future Work Ideas
- Caption Export (SRT/ASS)
- Saved Lectures Manager
- Label Card HTML
- Local Laya Verifier
- Laya Adapter
- Hadith Corpus Settings
- Read-only API Routes
- Project Overview & GPU Setup
- Laya Dataset Tests
- Labels & Checker Comparison
- Envelope v2 Design
- Diagnostic Error Modal
- Label Schemes & Splits
- Benchmark Metrics
- Sonnet Labelling Eval
- YouTube Download
- Backend Error Handling
- Run Cost Estimate
- Pilot Set Tooling
- Passages & Verse Notes
- Calibration & Eval Notes
- Run 5-6 Results
- Blind Label CLI
- Rule-based Boundary Baseline
- Index Page & Styling
- Laya Envelope Fields
- Run 6 Comparison Chart
- Logistic Regression Baseline
- Dataset Validation Gate
- Pydantic Validators
- OpenRouter UI Controls
- JEV Confidence Test
- JEV Unsure Test
- Test API-key Guard
- Run Script

## God Nodes (most connected - your core abstractions)
1. `TranscriptSegment` - 111 edges
2. `TafrighPipeline` - 69 edges
3. `StructuralTag` - 58 edges
4. `GeminiAdapter` - 47 edges
5. `SourcePosition` - 40 edges
6. `OutlineState` - 40 edges
7. `StructuralDecision` - 39 edges
8. `JEVAdapter` - 38 edges
9. `api_tafrigh_run()` - 37 edges
10. `BaseModel` - 35 edges

## Surprising Connections (you probably didn't know these)
- `Verdict scheme (CORRECT / IN_HADITH / PARAPHRASE / FALSE / NOT_SURE)` --semantically_similar_to--> `Two questions per finding (verdict, boundary_status)`  [INFERRED] [semantically similar]
  backend/laya_datagen/agent_eval_files/instructions.md → docs/laya-finetune/data.md
- `Boundary scheme (COMPLETE_SPAN / MISSING_START / MISSING_END / MISSING_BOTH)` --semantically_similar_to--> `Two questions per finding (verdict, boundary_status)`  [INFERRED] [semantically similar]
  backend/laya_datagen/agent_eval_files/instructions.md → docs/laya-finetune/data.md
- `data/ notebooks (build and label Laya data)` --implements--> `Laya training-data generator execution plan`  [INFERRED]
  notebooks/README.md → docs/plans/laya-datagen-plan.md
- `v5 loose profile (WV5_PROFILES.loose)` --semantically_similar_to--> `Build better non-quotation (hard negative) examples`  [INFERRED] [semantically similar]
  docs/reports/engine-v5-report.md → future_work.md
- `Reconciliation GT + teacher + human (D6)` --semantically_similar_to--> `Soft labels / label smoothing per source (EPS_BY_SOURCE)`  [INFERRED] [semantically similar]
  docs/plans/laya-datagen-plan.md → docs/laya-finetune/data.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Six workspaces switched from the header navigation** — index_section_input, index_section_display, index_section_editor, index_section_datasets, index_section_ai_logs, index_section_training_data [EXTRACTED 1.00]
- **AI provider configuration cards (Gemini, OpenRouter, Laya)** — index_geminiconfigcard, index_openrouterconfigcard, index_layaconfigcard [EXTRACTED 1.00]
- **Quote detection, AI verification and training-data capture flow** — index_section_display, index_ai_verification_quickbar, index_ai_request_telemetry_table, index_laya_dataset_bank_panel, index_section_training_data [INFERRED 0.85]
- **Envelope v2 changes (passages, neighbours, yes/no boundary with evidence)** — docs_laya_finetune_envelope_v2_passages, docs_laya_finetune_envelope_v2_neighbor_findings, docs_laya_finetune_envelope_v2_yes_no_boundary, docs_laya_finetune_envelope_v2_boundary_evidence [EXTRACTED 1.00]
- **Laya v1 data design (soft labels, lecture split, hidden engine fields, label priority)** — docs_laya_finetune_data_soft_labels, docs_laya_finetune_data_lecture_level_split, docs_laya_finetune_data_engine_fields_hidden, docs_laya_finetune_data_label_priority, docs_laya_finetune_data_class_balance_prior [EXTRACTED 1.00]
- **Laya fine-tuning run sequence (runs 1, 2, 3, 5/6)** — docs_laya_finetune_kaggle_guide_run1, docs_laya_finetune_kaggle_guide_run2, docs_laya_finetune_kaggle_guide_run3, docs_reports_run5_and_passage_experiment_run5, docs_reports_run5_and_passage_experiment_run6_variants [INFERRED 0.85]
- **Engine v5 fix switches (each independently toggleable)** — docs_reports_engine_v5_report_fix_variants, docs_reports_engine_v5_report_fix_seed2, docs_reports_engine_v5_report_fix_cues, docs_reports_engine_v5_report_fix_short, docs_reports_engine_v5_report_fix_multi, docs_reports_engine_v5_report_fix_ref, docs_reports_engine_v5_report_fix_chain, docs_reports_engine_v5_report_fix_merge, docs_reports_engine_v5_report_fix_free, docs_reports_engine_v5_report_fix_fused, docs_reports_engine_v5_report_fix_qul, docs_reports_engine_v5_report_fix_muq [EXTRACTED 1.00]
- **ASR spelling-variant problems handled by one matcher** — docs_review_notes_asr_long_vowels, docs_review_notes_asr_word_endings, docs_review_notes_first_letters_prefixes, docs_review_notes_split_word_ayah, docs_review_notes_qul_qal [INFERRED 0.85]
- **Negatives sourcing flow for Laya (loose engine, new lectures, Sonnet labels)** — docs_plans_engine_v5_handoff_loose_profile_goal, docs_reports_engine_v5_report_loose_profile, docs_plans_lectures_batch2_handoff_sheikh_selection, future_work_hard_negatives [INFERRED 0.85]
- **Run 6 compared model variants** — notebooks_results_run6_comparison_r6_before_soft_asis_app, notebooks_results_run6_comparison_r6_v3_single, notebooks_results_run6_comparison_r6_v3_mixed [EXTRACTED 1.00]

## Communities (106 total, 14 thin omitted)

### Community 0 - "Tafrigh Core Models"
Cohesion: 0.07
Nodes (40): api_tafrigh_review_action(), _load_tafrigh_session(), _outline(), BaseModel, CommentKind, HeadingEntry, LabelProvenance, OutlineState (+32 more)

### Community 1 - "AI Verifier Frontend"
Cohesion: 0.08
Nodes (67): aiRunLabel(), assertOpenRouterChatModelExists(), boundaryByRule(), boundaryFromYesNo(), buildCanonicalDecisionEnvelope(), buildGeminiRequestBody(), buildGroupMergeContext(), buildJevPayload() (+59 more)

### Community 2 - "Lecture State & Storage"
Cohesion: 0.06
Nodes (61): activeEngineName(), alignTranscriptSegToUnit(), beginNewLectureRun(), BUILTIN_ADHKAR_DATA, clearVerificationRecordsDB(), currentLectureRunEntry(), currentRunContent(), currentState (+53 more)

### Community 3 - "Main UI Rendering"
Cohesion: 0.07
Nodes (59): buildFormattedPlainOrMarkdownLecture(), buildLectureHtmlContent(), checkAndUpdateLayaBackendStatus(), closeSaveTafrighRunModal(), decorateTafrighReviewInline(), executeTafrighReviewAction(), exportLectureAsJSON(), exportLectureAsMarkdown() (+51 more)

### Community 4 - "Transcript Editor & FN Studio"
Cohesion: 0.06
Nodes (36): addReferenceToFinding(), alignAndRetimeWords(), applyLectureTextEdits(), applySpanEditModal(), buildMatnDropdownSnippet(), closeSpanEditModal(), commitFnDhikrToAdhkarDatabase(), commitFnQuoteHelper() (+28 more)

### Community 5 - "FastAPI Tafrigh Runs"
Cohesion: 0.06
Nodes (18): api_corpus_prepare(), api_tafrigh_run(), _discard(), on_progress(), api_transcribe_progress(), no_cache_frontend_assets(), _start_corpus_prepare(), work() (+10 more)

### Community 6 - "Unit of Work & Adapters Base"
Cohesion: 0.06
Nodes (16): api_tafrigh_models(), annotate_segment_with_word_indices(), _clean_int(), GeminiAPIError, helper_field(), list_gemini_models(), normalize_openrouter_model(), normalize_split_points() (+8 more)

### Community 7 - "Detection Engine v5"
Cohesion: 0.07
Nodes (28): WahyEngineV5, WV5_ADHKAR_CUES, wv5_cueQuranBlocks(), WV5_DEFAULTS, wv5_dropOneLetter(), wv5_extractMatn(), wv5_intersects(), WV5_LETTER_NAMES (+20 more)

### Community 8 - "Model Edits & Corpus Sources"
Cohesion: 0.09
Nodes (22): _book_for(), _clean(), convert_open_hadith_zip(), CorpusSourceManager, _hadith_items(), _get(), _norm(), _relocate() (+14 more)

### Community 9 - "Gemini Adapter & Pipeline Tests"
Cohesion: 0.09
Nodes (25): GeminiAdapter, PipelineConfig, build_units_of_work(), make(), test_auto_model_resolves_before_first_call(), test_key_goes_in_header_never_in_url(), handler(), test_pipeline_stops_with_clear_error_on_rejected_key() (+17 more)

### Community 10 - "Tafrigh Pipeline Core"
Cohesion: 0.09
Nodes (3): LectureSpan, PipelineResult, TafrighPipeline

### Community 11 - "Master Verification Schemas"
Cohesion: 0.10
Nodes (9): BaseAdapter, ChoiceClassifierAdapter, ModelAPIError, redact_secrets(), GeminiSingleOutputSchema, GeminiWindowItemSchema, GeminiWindowOutputSchema, JEVRequestConfig (+1 more)

### Community 12 - "Quotation Matcher JS"
Cohesion: 0.10
Nodes (31): checkWarshUsulMatch(), CITATION_AND_ISNAD_WORDS, CONTINUATION_MARKER_NORMS, EXEGETICAL_MARKERS, expandHonorificLigatures(), HADITH_CITATION_CUES, HONORIFIC_LIGATURES, isCitationOrIsnadWord() (+23 more)

### Community 13 - "Training Store & Evaluation"
Cohesion: 0.08
Nodes (17): ClassMetrics, compute_prf1(), evaluate_run_against_gold(), EvaluationReport, export_for_jev_or_laya(), export_for_llm_chat_jsonl(), compute_iaa(), inject_synthetic_valid_word_typos() (+9 more)

### Community 14 - "Teacher Model Clients"
Cohesion: 0.10
Nodes (8): key(), ask(), normalize(), Teacher, GeminiTeacher, JevTeacher, LayaLocal, OpenRouterChatTeacher

### Community 15 - "Laya Datagen Labelling"
Cohesion: 0.13
Nodes (24): bucket(), default_scope(), tag_cases(), GTDoc, HadithRegion, _inline_hadith(), QuranSpan, _boundary() (+16 more)

### Community 16 - "Laya Evaluation Metrics"
Cohesion: 0.09
Nodes (20): auc(), baseline_predictions(), boundary_metrics(), compare(), compare_boundary(), compare_slices(), decide(), ece() (+12 more)

### Community 17 - "Laya v2 Dataset Builder"
Cohesion: 0.11
Nodes (19): tokenizer(), build(), describe(), key_of(), labels_by_key(), make_row(), _noul(), position() (+11 more)

### Community 18 - "Transcript Renderers"
Cohesion: 0.14
Nodes (17): TranscriptSegment, get_segment_render_text(), _public_trace(), _quote_brackets(), _quote_ops(), _ref_label(), render_to_html(), render_to_markdown() (+9 more)

### Community 19 - "Tafrigh Run Save Endpoints"
Cohesion: 0.10
Nodes (18): api_corpus_upload(), api_laya_convert_dataset(), api_laya_load(), api_laya_predict(), api_laya_unload(), api_openrouter_decisions(), api_tafrigh_clone_run(), api_tafrigh_compare() (+10 more)

### Community 20 - "Ground Truth Alignment"
Cohesion: 0.09
Nodes (17): align(), _align_gap(), Alignment, _anchors(), _digits(), locate_ayah(), parse_gt(), add_words() (+9 more)

### Community 21 - "Laya v1 Dataset Builder"
Cohesion: 0.12
Nodes (17): assign_splits(), build(), build_rows(), counts(), downsample_false(), _h(), lecture_info(), _meta() (+9 more)

### Community 22 - "Label Reconciliation & Review"
Cohesion: 0.13
Nodes (19): human_key(), human_labels(), reconcile(), save_human(), audit_results(), audit_sample(), audit_widget(), save() (+11 more)

### Community 23 - "Whisper Transcription Backends"
Cohesion: 0.11
Nodes (11): api_transcribe(), on_chunk_done(), on_segment(), build_unified_word_schema(), CUDAOutOfMemoryError, get_specialized_whisper_pipeline(), GroqAPIError, LocalWhisperError (+3 more)

### Community 24 - "Speech Segmentation"
Cohesion: 0.13
Nodes (17): find_punctuation_cut_points(), resolve_detection_boundaries(), segment_transcript(), inside_atomic(), n_words(), split_long(), SegmentationConfig, _word_spans() (+9 more)

### Community 25 - "Engine Evaluation"
Cohesion: 0.14
Nodes (14): boundaries(), _ctx(), diff(), tally(), _inherited(), label_stores(), _load(), precision() (+6 more)

### Community 26 - "Engine JS Test Harness"
Cohesion: 0.09
Nodes (22): buildWords(), crypto, ctx, DET_FIELDS, detect(), EXPECTED_CLASS, fileHashes, FILES (+14 more)

### Community 27 - "Transcribe UI Events"
Cohesion: 0.12
Nodes (21): Toast notification box, attachMediaUrlToPlayer(), attachTafrighModelSearch(), getQuoteTextMode(), handleBackendTranscribeRequest(), _lecturesWithRunsOpen, loadTafrighCatalog(), renderTafrighEstimate() (+13 more)

### Community 28 - "Agent Eval Runner"
Cohesion: 0.15
Nodes (14): load_dataset(), card_text(), _gemini_guided(), guide(), _jev_guided(), _key_map_path(), _kind(), _marked() (+6 more)

### Community 29 - "Labelling Sprint & Cache"
Cohesion: 0.13
Nodes (17): sha(), write_atomic(), save_store(), build_queues(), _gemini_pick(), narrator_share(), pool(), results() (+9 more)

### Community 30 - "Run Comparison & Laya Converter"
Cohesion: 0.13
Nodes (9): convert_single_record_to_laya_format(), convert_verification_records_to_laya_jsonl(), main(), sanitize_probabilities(), compare_run_dirs(), generate_comparison_table(), generate_per_segment_disagreements(), load_run_data() (+1 more)

### Community 31 - "Engine Python-Node Bridge"
Cohesion: 0.14
Nodes (7): EngineBridge, EngineBridgeError, build_ctx(), process_lesson(), bridge(), test_fingerprint_is_stable(), test_loose_profile_is_really_loose()

### Community 32 - "Media Download & Audio"
Cohesion: 0.14
Nodes (10): check_ffmpeg_available(), download_youtube_media(), FFmpegProcessingError, get_cached_youtube_media(), _make_download_hook(), hook(), normalize_audio_streams(), probe_media_duration_seconds() (+2 more)

### Community 33 - "AI Request Options UI"
Cohesion: 0.16
Nodes (24): AI request options modal (#modalAiRequestOptions), AI_PROVIDER_CARDS, aiDetCategory(), aiOptsCfg(), aiOptsSampleIdx(), aiOptsState, aiProviderHasKey(), aiVerdictBadge() (+16 more)

### Community 34 - "Internationalization (i18n)"
Cohesion: 0.18
Nodes (23): applyDirection(), blockedBy(), buildCountRules(), buildFragmentRe(), callTranslationModel(), deleteLanguagePack(), generateLanguagePack(), getPackSource() (+15 more)

### Community 35 - "Kaggle DDP Training"
Cohesion: 0.11
Nodes (10): balanced_accuracy(), is_incomplete_boundary(), is_true_noul(), item_kind(), main(), load(), val_metrics(), parse_args() (+2 more)

### Community 36 - "Tafrigh Prep UI"
Cohesion: 0.13
Nodes (24): endTafrighRun(), openTafrighPrep(), refreshTafrighEstimate(), refreshTafrighPreview(), renderTafrighProgress(), renderTafrighSegList(), renderTafrighSourceInfo(), renderTafrighStats() (+16 more)

### Community 37 - "Engine v5 Tests"
Cohesion: 0.23
Nodes (17): test_detects_verse_and_hadith_with_app_envelope(), find(), span(), test_consecutive_short_ayat(), test_endings_and_dropped_letters_full_ayah(), test_fragment_of_common_words(), test_hadith_word_endings(), test_identical_ending_takes_the_neighbouring_ayah() (+9 more)

### Community 38 - "Bin Baz Lesson Scraper"
Cohesion: 0.15
Nodes (12): lessons(), load(), Block, clean(), download_mp3(), fetch_html(), get_lesson(), iter_series_items() (+4 more)

### Community 39 - "Pipeline Stage Reports"
Cohesion: 0.20
Nodes (15): asr_tok_word(), auto_answer(), build(), engine_report(), gt_items(), hits(), human_records(), is_gt_finding() (+7 more)

### Community 40 - "Matn Alignment"
Cohesion: 0.17
Nodes (9): compute_fuzzy_similarity(), MatnConfig, normalize_arabic_for_alignment(), SequentialMatnAligner, MatnMatchEvidence, test_matn_variant_wording_detection(), test_segmentation_preserves_characters_and_atomic_quran_ayah(), test_sequential_matn_aligner_tracking() (+1 more)

### Community 41 - "OpenRouter & API Tests"
Cohesion: 0.15
Nodes (14): chat_reply(), make(), test_bare_gemini_name_gets_the_openrouter_prefix(), test_decision_trace_names_the_openrouter_model(), handler(), test_model_without_json_mode_is_asked_again_without_response_format(), handler(), test_reply_cut_short_is_retried_with_more_tokens() (+6 more)

### Community 42 - "Corpus Loader"
Cohesion: 0.21
Nodes (20): applyNormalizedCorpusToState(), clearAndRedownloadCorpus(), clearWahyCorpusDB(), DEFAULT_CORPUS_ENDPOINTS, DEFAULT_HADITH_DATA, downloadAllCorporaFromRemote(), fetchJsonSafely(), getCorpusEndpointsConfig() (+12 more)

### Community 43 - "Detection Engine v4"
Cohesion: 0.16
Nodes (6): cueQuranBlocks(), WahyEngine, WV4_ADHKAR_CUES, WV4_DEFAULTS, wv4_extractMatn(), WV4_TAKHRIJ_TAILS

### Community 44 - "Datagen Inventory"
Cohesion: 0.14
Nodes (8): answers(), by_reviewer(), _load(), splits(), summary(), usable(), load_inventory(), load_inputs()

### Community 45 - "Teacher Eval Runs"
Cohesion: 0.19
Nodes (13): read_jsonl(), _ask_chat(), _ask_jev(), _key(), main(), report(), _run_api(), run_chat() (+5 more)

### Community 46 - "Verification UI Sections"
Cohesion: 0.13
Nodes (20): Delete intent labels (FALSE_POSITIVE, BOUNDARY_RESELECT, TEST_SCRATCHPAD), Gemini free-tier RPM pacer, OpenRouter JEV Decisions mode (typesafe/jev), Laya local fine-tuned classifier (laya-wahy-r6-v3_mixed, Envelope v3), Training task types (correctness, completeness, segmentation, classification, typo), AI request payload inspector modal (#aiPayloadModal), AI request telemetry and decision inspector table, AI quote verification quick bar (+12 more)

### Community 47 - "JEV Adapter"
Cohesion: 0.17
Nodes (6): JEVAdapter, JEVAPIError, test_invalid_choice_from_api_is_rejected(), test_missing_key_is_a_clear_error_not_silent_garbage(), test_request_contract_matches_decisions_api(), test_laya_adapter_contract_matches_jev_adapter()

### Community 48 - "App Workspaces UI"
Cohesion: 0.15
Nodes (20): Detection engine versions (v3, v4, v5, v5:loose), Hadith corpus choice (Wahy default vs Open Hadith Data), Qira'at (ten recitations) selection, Quote categories: ayah, hadith, dhikr, Quote text mode: as spoken vs canonical orthography, Corpus reference linker modal (#corpusSearchModal), Engine sensitivity parameters (IDF, gaps, thresholds), Export and bracket formatting modal (#exportModal) (+12 more)

### Community 49 - "Review Notes & Engine Fixes"
Cohesion: 0.18
Nodes (20): v5 fix: cues (stronger hadith/Quran cues, takhrij after), v5 fix: variants (ASR spelling near-matches), Review notes (29 dictated notes), Note 24: abridged hadith with middle part skipped, Note 4: long-vowel letters dropped (اتق/اتقي), Note 6: ASR word endings (ة/ه, ا/ى, tanwin, pronoun suffixes), Note 28: dhikr as post-detection check with editable list, Note 29: sheikh explaining with the text's own words is not a quote (+12 more)

### Community 50 - "Lecture Cache Processing"
Cohesion: 0.20
Nodes (6): JsonCache, add_engine(), load_lectures(), collect(), process_cached(), process_no_gt()

### Community 51 - "Laya v2 Tests"
Cohesion: 0.20
Nodes (15): fake_run(), lab(), test_false_row_has_no_boundary_questions(), test_label_counts_only_in_its_own_engine_run(), test_long_run_is_split_into_equal_passages_not_6_plus_1(), test_mixed_passage_is_dropped_from_train_and_kept_in_test(), test_neighbours_list_the_findings_around_without_verdicts(), test_no_options_is_one_request_per_finding_without_neighbour_field() (+7 more)

### Community 52 - "Local Fine-tune Script"
Cohesion: 0.16
Nodes (4): LayaJsonlDataset, main(), run_temperature_calibration(), train_head_only()

### Community 53 - "Auto-labelling"
Cohesion: 0.21
Nodes (10): label_batch(), pool(), _prompt(), run(), spot_check(), extra(), summ(), Stop (+2 more)

### Community 54 - "Datagen Plan & Label Tiers"
Cohesion: 0.15
Nodes (18): Label source priority (user > written text > Sonnet high > Sonnet medium), Bin Baz written text used for testing only, Laya training-data generator execution plan, ASR to GT token alignment with doc gate, Case taxonomy and coverage-driven sampler, Finding F1/F2: finetune_laya.py never trains; exporters write answers not gold, Gate G1 (audit 100 auto-labels, precision >= 97 percent), GT parsing of Bin Baz transcripts (+10 more)

### Community 55 - "Engine v5 Handoff Docs"
Cohesion: 0.17
Nodes (15): Handoff: engine v5 and loose profile, Measuring engine fixes (recall on 15 Bin Baz lessons, precision via labels), Handoff: lecture batch 2 (download + transcribe), Groq free-tier ASR limits and resumable caching, notebooks/data/laya_lectures.ipynb, Batch 2 selection: 12 sheikhs, 38 videos + Bin Baz lessons, Docs index, Engine v5 report (+7 more)

### Community 56 - "Laya Row Export"
Cohesion: 0.24
Nodes (8): assign_splits(), export_dataset(), soft(), to_laya_row(), rec(), test_export_splits_by_doc_dedups_and_caps(), test_false_has_no_boundary_and_silent_is_dropped(), test_row_hides_engine_fields_and_uses_gold_probabilities()

### Community 57 - "JEV Live Contract Tests"
Cohesion: 0.26
Nodes (11): jev_transport(), make_pipeline(), quiet_jev(), test_a_model_that_always_says_split_cannot_loop_forever(), test_cancel_stops_between_sentences_and_returns_what_was_done(), test_matn_option_is_withheld_when_no_matn_is_configured(), test_missing_key_aborts_the_run_with_a_message(), test_pause_holds_the_run_until_resumed() (+3 more)

### Community 58 - "Tafrigh API Models Report"
Cohesion: 0.16
Nodes (15): Tafrigh with API models report, Tafrigh cost estimator (/api/tafrigh/estimate), Gemini batch verdict bug (first finding's verdict reused), Helper prompt regression (classifier prompt sent to helper), Live OpenRouter cost table (DeepSeek, JEV, Gemini), Instructions-before-finding prompt order for cache pricing, Tafrigh sentence mode (JEV/Laya only), Tafrigh window mode (default) (+7 more)

### Community 59 - "Label Reviewer CLI"
Cohesion: 0.30
Nodes (3): load_answers(), Reviewer, store()

### Community 60 - "Tafrigh Laya Export"
Cohesion: 0.23
Nodes (8): describe_option(), build_examples(), _choice_question(), label_source(), _model_answers(), _reconstructed_input(), save_run(), tag_label()

### Community 61 - "Engine v5 Fix Notes"
Cohesion: 0.16
Nodes (15): WahyEngineV5 (js/engine_v5.js), v5 fix: chain (near-miss consecutive ayat support each other), v5 fix: free (honorifics and asides skipped for free), v5 fix: fused (two ASR words join to a rare corpus word), v5 fix: merge (long quote as one finding), v5 fix: multi (multi-home phrases kept with ambiguous reference), v5 fix: qul (قال as verse-initial قل), v5 fix: ref (prefer adjacent ayah of neighbouring finding) (+7 more)

### Community 62 - "Datagen ASR"
Cohesion: 0.22
Nodes (6): _file_sha(), _local_whisper(), to_wav16k(), transcribe(), cleanup_cuda_vram(), unload_specialized_whisper()

### Community 63 - "Laya Fine-tuning Guides"
Cohesion: 0.21
Nodes (14): What data Laya needs, and why (data.md), laya_v1 dataset (soft_asis, soft_balanced, hard_asis, test, baselines, manifest), Fine-tuning Laya on Kaggle guide, Using the fine-tuned model in the app (laya.load, custom checkpoint), convaiinnovations/laya-multilingual (mmBERT-base), DDP training on 2xT4 (effective batch 64, fp16, checkpointing), RLCD loss (soft cross-entropy + GRPO-style proper-scoring reward), Run 1: soft_asis / soft_balanced / hard_asis (+6 more)

### Community 64 - "Future Work Ideas"
Cohesion: 0.22
Nodes (12): Note 11: Whisper hallucinated English in Arabic lesson, Note 21: most stage-3 missed GT is an ASR problem, Tahqeeq roadmap (future_work.md), Guarded auto-healing loop, Benchmark plan and evaluation metrics, Separate detection from canonical restoration, Final end-to-end validation, Evaluate Laya as multi-task reviewer (+4 more)

### Community 65 - "Caption Export (SRT/ASS)"
Cohesion: 0.24
Nodes (10): buildAyahGroupRefMap(), buildSmartCaptions(), exportCaptionsToASS(), exportCaptionsToSRT(), exportCaptionsToVTT(), formatAssTime(), formatSecondsToTimestamp(), getBracketsForCategory() (+2 more)

### Community 66 - "Saved Lectures Manager"
Cohesion: 0.32
Nodes (13): aiCheckBlocksSwitch(), applyRestoredSessionToUi(), deleteRunWithConfirm(), fmtSavedDate(), forgetOpenLectureRecord(), initSavedLecturesManager(), openLectureRun(), promptRenameLectureRun() (+5 more)

### Community 67 - "Label Card HTML"
Cohesion: 0.33
Nodes (8): audio_clip(), _chip_src(), esc(), mmss(), render_finding(), render_gt(), words_html(), flush()

### Community 70 - "Hadith Corpus Settings"
Cohesion: 0.38
Nodes (11): applySavedHadithCorpusChoice(), fetchHadithCorpusSources(), getSavedHadithCorpusChoice(), hadithCorpusSources, loadHadithCorpusData(), preparingCorpusJobs, renderHadithCorpusSettings(), selectHadithCorpus() (+3 more)

### Community 71 - "Read-only API Routes"
Cohesion: 0.18
Nodes (6): api_corpus_sources(), api_env_config(), api_laya_status(), api_tafrigh_list_runs(), get_backend_corpus_cache(), serve_index()

### Community 72 - "Project Overview & GPU Setup"
Cohesion: 0.18
Nodes (10): torch cu126 build for GTX 1050 (sm_61), HANDOFF: Laya fine-tuning state 2026-10-27, Gotchas (harness engine build, finding keys, sleep kills CUDA), GPU fix: torch cu126 in project .venv, Laya run history (runs 1-4), README (Wahy Studio overview), FastAPI endpoint overview, Atomic SRT/VTT/ASS captions (+2 more)

### Community 73 - "Laya Dataset Tests"
Cohesion: 0.25
Nodes (8): bridge(), fixture(), test_built_folder_has_no_leak(), test_rows_schema_sources_and_no_doc_in_two_splits(), test_soft_eps_per_source_and_hard_labels(), test_split_by_lecture_and_test_review_lessons(), test_variants_share_val(), run()

### Community 74 - "Labels & Checker Comparison"
Cohesion: 0.18
Nodes (11): Base Laya zero-shot baseline (59.1 percent, 42.7 percent real rejected), Engine score/band hidden (engine_agnostic profile), export.py to_laya_row, Soft labels / label smoothing per source (EPS_BY_SOURCE), Span-length shortcut baseline, Decisions D1-D7 (engine, engine_agnostic state, wrong ref FALSE, NOT_SURE human-only), Laya checkers on the same test cards (2026-10-27), Boundary balanced accuracy comparison (+3 more)

### Community 75 - "Envelope v2 Design"
Cohesion: 0.22
Nodes (11): Laya envelope v2 (run 3), Boundary head collapse (always COMPLETE_SPAN), prefix_words_heard / suffix_words_heard boundary evidence, Counterfactual cut-off boundary rows, neighbor_findings (nearest findings, no verdicts), Passages (consecutive verses merged into one row), Short verses inside a recitation rejected (Al-Waqia 89), laya_v2 variants (base, passages, neighbours, both, both_synth) (+3 more)

### Community 76 - "Diagnostic Error Modal"
Cohesion: 0.36
Nodes (9): buildDiagnosticMarkdownReport(), copyDiagnosticReportForAI(), copyTextWithFallback(), ensureDiagnosticModalDOM(), fallbackCopyExec(), getActiveStateSnapshot(), logAction(), redactSecrets() (+1 more)

### Community 77 - "Label Schemes & Splits"
Cohesion: 0.20
Nodes (10): Blind labelling test instructions (30 findings), Boundary scheme (COMPLETE_SPAN / MISSING_START / MISSING_END / MISSING_BOTH), Labelling card (ASR span, Bin Baz written text, corpus text), label.py next/answer/status tool, Verdict scheme (CORRECT / IN_HADITH / PARAPHRASE / FALSE / NOT_SURE), laya_dataset.py (assign_splits, build, shortcut_baselines), Lecture-level train/val/test split, Quoted-by-meaning cards excluded from v1 (243 cards) (+2 more)

### Community 78 - "Benchmark Metrics"
Cohesion: 0.29
Nodes (3): confusion(), ece(), score()

### Community 79 - "Sonnet Labelling Eval"
Cohesion: 0.31
Nodes (5): main(), pool_and_bundles(), report(), run(), your_labels()

### Community 80 - "YouTube Download"
Cohesion: 0.27
Nodes (3): download(), save_transcript(), Video

### Community 81 - "Backend Error Handling"
Cohesion: 0.25
Nodes (4): api_health(), classify_exception_type(), global_diagnostic_exception_handler(), get_vram_allocated_mb()

### Community 82 - "Run Cost Estimate"
Cohesion: 0.28
Nodes (3): estimate_run(), _tokens(), _uow()

### Community 83 - "Pilot Set Tooling"
Cohesion: 0.25
Nodes (4): GoldSegmentRecord, GoldSubsegment, prepare_annotation_batches(), select_stratified_pilot_passages()

### Community 84 - "Passages & Verse Notes"
Cohesion: 0.22
Nodes (8): buildLayaV2Requests (single builder for app and data), Envelope v2 (passages, neighbours, yes/no boundary), Run 3 results: passage fix works, verdict AUC worse, Run 4 plan (verdict-only vs boundary-only ablation), v5 fix: muq (spelled-out muqatta'at), Note 3: ayah quoted inside a hadith, Note 9: consecutive ayat as one passage? and muqatta'at, Note 2: Extra start / Extra end boundary label

### Community 85 - "Calibration & Eval Notes"
Cohesion: 0.22
Nodes (9): Class balance and prior correction (48.5 percent vs ~10 percent not-a-quote), Temperature calibration fitted on val lectures, eval_laya.per_verse scoring, eval_laya.py evaluation script, Calibration on val lectures instead of random train slice, Notebooks README, wahy_colab_runner.ipynb (Whisper + Laya on Colab), data/ notebooks (build and label Laya data) (+1 more)

### Community 86 - "Run 5-6 Results"
Cohesion: 0.36
Nodes (9): Run 5 and zero-shot passages experiment report, Envelope v3 plan (v1 layout + boundary cues, no neighbor blobs, 2048), Run 5: fine-tuning on passages (degraded single quotes), Run 6 variants v3_single and v3_mixed, Zero-shot soft_asis on combined passages (0/12 missed), Run 6 verdict report tables, soft_asis (app) before line in run 6, v3_mixed model (90.9 percent on user cards, 0/12 passage misses) (+1 more)

### Community 87 - "Blind Label CLI"
Cohesion: 0.54
Nodes (6): answer(), answered(), load(), save(), show_next(), status()

### Community 88 - "Rule-based Boundary Baseline"
Cohesion: 0.29
Nodes (5): _norm_words(), rule_boundary(), rule_predictions(), _similar(), _aligned()

### Community 89 - "Index Page & Styling"
Cohesion: 0.29
Nodes (5): css/styles.css, index.html (Wahy Studio single-page shell), Input workspace (#section_input), Tailwind config mapping colours to CSS variables, Speech-to-text engine selector (Groq, Abu-Dju Whisper, local Whisper)

### Community 90 - "Laya Envelope Fields"
Cohesion: 0.33
Nodes (7): WahyAiVerifier.buildCanonicalDecisionEnvelope, Envelope state fields (v1), max_len 1024 truncation (keeps start, drops end), Two questions per finding (verdict, boundary_status), buildLayaV2Requests (js/ai-verifier.js), laya_v2.py (build, validate, zip_dataset), Engine bridge (real JS in Node, harness.js)

### Community 91 - "Run 6 Comparison Chart"
Cohesion: 0.52
Nodes (7): Run 6 comparison chart (comparison_r6.png), before: soft_asis (app) baseline (AUC ~0.945, acc ~91.4%), Run 2 benchmark (AUC 0.945) reference line, v3_mixed model (AUC ~0.945, acc ~91%), v3_single model (AUC ~0.92, acc ~86.3%), Verdict Accuracy % bar chart (Cards: you), y 70-100, Verdict AUC bar chart (Cards: you), y 0.75-1.0

### Community 94 - "Pydantic Validators"
Cohesion: 0.40
Nodes (3): field_validator(), dec(), model_validator()

### Community 95 - "OpenRouter UI Controls"
Cohesion: 0.50
Nodes (3): initAiVerificationEventListeners(), selectOpenRouterProvider(), setOpenRouterModeUI()

## Knowledge Gaps
- **36 isolated node(s):** `Saved lecture runs bar`, `Tafrigh pre-run cost/time estimate panel`, `Saved Tafrigh runs bar`, `Sticky video player and caption overlay column`, `Finding inspector panel` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 675 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Docs index` connect `Engine v5 Handoff Docs` to `Project Overview & GPU Setup`, `Review Notes & Engine Fixes`, `Envelope v2 Design`, `Laya Fine-tuning Guides`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 34 inferred relationships involving `TranscriptSegment` (e.g. with `api_tafrigh_review_action()` and `api_tafrigh_run()`) actually correct?**
  _`TranscriptSegment` has 34 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Saved lecture runs bar`, `Tafrigh pre-run cost/time estimate panel`, `Saved Tafrigh runs bar` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Tafrigh Core Models` be split into smaller, more focused modules?**
  _Cohesion score 0.06511746680286006 - nodes in this community are weakly interconnected._
- **Why does `index.html (Wahy Studio single-page shell)` connect `Index Page & Styling` to `AI Request Options UI`, `Caption Export (SRT/ASS)`, `AI Verifier Frontend`, `Transcript Editor & FN Studio`, `Internationalization (i18n)`, `Hadith Corpus Settings`, `Detection Engine v5`, `Main UI Rendering`, `Lecture State & Storage`, `Corpus Loader`, `Detection Engine v4`, `Quotation Matcher JS`, `Diagnostic Error Modal`, `Verification UI Sections`, `App Workspaces UI`, `Transcribe UI Events`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `TafrighPipeline` (e.g. with `api_tafrigh_run()` and `BaseAdapter`) actually correct?**
  _`TafrighPipeline` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Should `AI Verifier Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.07887323943661972 - nodes in this community are weakly interconnected._