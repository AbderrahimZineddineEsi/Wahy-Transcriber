# Laya training-data generator — execution plan

Status: planned 2026-10-22, not started. Executor: start at **Phase 0** and stop at each
**gate** to report numbers before continuing.

Goal: a notebook that turns **real lectures with real ASR** into Laya fine-tuning data for the
quote-verification task (`verdict` + `boundary_status`). You select the detection engine (v3 / v4 /
later v5) and the teacher model (JEV / Gemini / OpenRouter chat / none). Labels are anchored to
**ground truth (human transcripts, Bin Baz first)**, and sampling deliberately covers many case types.

---

## 0. Findings that shape the plan (verified in code / on the site)

| # | Finding | Consequence |
|---|---|---|
| F1 | `backend/finetune_laya.py` **never trains**. It freezes params, calls calibration and writes a JSON. `laya` 0.4.12 ships a real loop: `laya.train.finetune(data, model_dir, out, TrainConfig(...))` with `freeze_encoder`, soft-CE/RLCD, calibration and `dry_run`. | Fine-tuning script must be rewritten (follow-up task, Phase 7). |
| F2 | `laya.train` reads rows `{state, questions, gold: {qid: {probabilities}}}` or `{..., expected: {qid: label}}`. Every exporter in the repo (`laya_converter.py`, `ai-verifier.js`) writes **`answers`**. | Today's exported JSONL yields **0 training items**. The new exporter writes `gold`, and `laya.train.dry_run` is a mandatory gate. |
| F3 | Engines are browser JS. `jupyter-playground/v4-engine-diagnosis` is a Python *re-implementation* of v4, so it drifts as soon as you edit the engine. | Run the **real JS** in Node. **Spike passed:** `state.js + editor.js + engine.js + engine_v4.js + ai-verifier.js` load in a `vm` context with light shims. Index build is 6–8 s per engine, after which detection is fast. |
| F4 | v3 `detect()` calls `computeTokenIoU`, which is defined in **`editor.js`**. | Hidden cross-file dependency. The harness must load `editor.js`. |
| F5 | `rebuildMatcher()` passes UI slider params. Through them v4 gets `maxTGap=10`, `maxVGap=2`, not its own defaults of 12/3. If v4 fails to build it **silently falls back to v3**. | The harness calls the app's own `rebuildMatcher()` (defaults apply because `getElementById` returns null) and **asserts** the class (`WahyEngine` for v4). |
| F6 | Train/serve parity: Laya gets `WahyAiVerifier.buildCanonicalDecisionEnvelope(det, words, 25)` with the **base** questions. `providerSupportsPrompt("local_laya") === false`, so no presets are added. | Records are built by calling that exact JS function, never a Python copy. |
| F7 | `engine_score` and band thresholds are engine-specific (v3 verified ≈ 11; v4 Quran ver 26 / hadith 48). The default verification scope also uses `totalScore < 15`. | A model trained on v3 states misreads v4 scores. This is **Decision D2**. |
| F8 | Bin Baz `/audios/...` lesson pages have an **MP3** (`files.zadapps.info/...`) and a **verbatim** transcript (fillers like "يعني", "الشيخ:" labels, book text read aloud). Quran refs are inline `[النور:31]`, often **without** `﴿﴾`. Hadith quoted in commentary are **unmarked**. Fatwa pages checked so far are edited prose with **no audio**. | GT is **strong for Quran** and **partial for hadith/adhkar**, so labels need tiers (§3). Use the audio lesson series as the primary source. |
| F9 | The Firefox exporter is manual, skips `<audio>` (no MP3 URL) and outputs one page at a time. | A Python scraper is needed. Port the exporter's text rules (`normalizeRefs`, `wrapVerses`, stop prefixes). |
| F10 | `wahy_finder/archive/test_sets/fawzan_official_tafrigh.txt` has 331 words against 2,095 ASR words, so it is condensed. | Not every "official tafrigh" is alignable. Add a doc-level alignment gate. |
| F11 | Default verification scope = all HADITH + `CANDIDATE`/`AMBIGUOUS` + `score<15`. | Weight training data toward that scope and tag `in_default_scope`. |
| F12 | Laya serializes `state` as JSON and **truncates at `max_len`** (app uses 1024 / head 256). Long hadith `canonical_corpus_text` can push the boundary fields out. | Measure truncation with the real tokenizer and gate on it. Train with the same `max_len`/`head_max_len`. |
| F13 | The `.venv` (Python 3.14) has no `ipykernel`, `pandas`, `ipywidgets` or `bs4`. Node v24 and `laya`, `rapidfuzz`, `httpx`, `faster-whisper`, `groq` and `yt-dlp` are present. | Phase 0 installs the missing packages. |
| F14 | Hadith refs disagree across engines for the same text (the spike gave رياض الصالحين vs البخاري). | Match hadith to GT **by text**, not by ref. |

---

## 1. Architecture

```
 sources ──► ASR ──► engines(v3|v4|v5) ──► envelopes ──► GT align+label ──► case tags
 (Bin Baz,    (Groq /   (real JS in Node,     (buildCanonical-   (tiered labels,    (taxonomy)
  app export,  local     persistent proc)      DecisionEnvelope)  boundary)              │
  manual)      whisper)                                                                  ▼
   export ◄── reconcile(GT ⊕ teacher ⊕ human) ◄── teacher(s) ◄── quota sampler ◄── coverage
 (gold JSONL,   │                                (JEV|Gemini|       (which candidates
  splits,       └─► review queue (widget)          chat|none)         are worth labelling)
  manifest) ──► validate (tokens, dry_run, leakage) ──► benchmark (teachers, base Laya)
```

**Thin notebook, logic in a package.** The labeler and aligner decide whether the dataset is
correct, so they need unit tests. The notebook holds config, runs steps and shows inspection
widgets.

```
backend/laya_datagen/
  config.py            DatagenConfig dataclass (every knob, one place) + config hash
  cache.py             content-addressed JSON/blob cache (sha256 keys), atomic writes
  engines.py           registry: {"v3": {...}, "v4": {...}}; v5 = one new entry
  engine_bridge.py     persistent `node` subprocess, JSON-lines protocol
  js/harness.js        loads the app's real JS files, shims, commands (see §2)
  sources/binbaz.py    discover series → items, fetch (cached HTML), extract transcript + mp3 URL
  sources/app_export.py  ingest the app's Laya JSONL export (human overrides → human tier)
  sources/manual.py    (audio_path, gt_text) pairs, the Firefox exporter's JSON
  asr.py               wraps backend.media_processor + backend.transcriber, cached
  gt_parse.py          GT text → tokens + quote spans (Quran ref-anchored, «», matn blocks)
  align.py             ASR↔GT token alignment, projection, local quality
  label.py             verdict/boundary auto-labels + tiers (§3)
  cases.py             case tags (§4)
  sampler.py           quotas, caps, coverage matrix, gap report
  teachers/            base.py, jev.py, gemini.py, openrouter_chat.py, laya_local.py
  reconcile.py         GT ⊕ teacher ⊕ human → target distributions
  review.py            ipywidgets audit + review UI; human labels → labels/human.jsonl
  export.py            splits, dedup, caps → {train,val,test}.jsonl + manifest + dataset card
  validate.py          token lengths, laya dry_run, leakage, schema checks
notebooks/data/laya_data_generation.ipynb
backend/tests/laya_datagen/   test_gt_parse, test_align, test_label, test_export_schema,
                              test_engine_bridge (needs node; mark slow)
data/laya_datagen/            (gitignored) cache/{html,audio,asr,engine,teacher}, labels/, datasets/<ver>/
```

**Cache keys** (everything is resumable and idempotent):
- ASR: `sha256(audio) + asr_backend + model + prompt`. This is the expensive step, done once and engine-independent.
- Engine output: `sha256(transcript) + engine_fingerprint`. The fingerprint is the sha256 of every loaded JS file, the corpus, the adhkar list and the params. **Editing the engine invalidates automatically.**
- Teacher: `sha256(model + prompt_version + canonical JSON of state+questions)`. Unchanged envelopes cost nothing after an engine edit.
- Human labels: keyed **engine-independently** as `(doc_id, asr_word_start, asr_word_end, unit_id)`, so they survive v4→v5.

Because GT labels don't depend on the engine, changing v4 or adding v5 regenerates the whole
dataset for the new engine almost for free. Only new envelopes need teacher calls.

---

## 2. Engine bridge (real JS, parity first)

`js/harness.js`, one long-lived process:
1. A `vm` context with shims: `window=globalThis`, a `document` stub (`getElementById → null`),
   in-memory `localStorage` (seeded with the user's adhkar / outside-hadith JSON if provided),
   `indexedDB=undefined`, `performance.now`.
2. Load, in the app's order: `state.js, editor.js, engine.js, engine_v4.js[, engine_v5.js], ai-verifier.js`.
   Set `RAW_QURAN_DATA`/`RAW_HADITH_DATA` from `data/corpus.json` (or the configured hadith corpus).
3. Commands (JSON lines on stdin and stdout):
   - `fingerprint` → hashes of files, corpus and params.
   - `tokenize {text}` → the engine's own `tokenizeText` norms. Use this for **both** ASR and GT so normalization is identical.
   - `detect {engine, words}`: set `localStorage.wahyEngine`, call `rebuildMatcher()` (cached per engine) and **assert the class**. Set `currentState.words`, call `syncRawTextFromWords()`, then `detect` and `mapDetectionsToWordTimestamps`. Set `currentState.detections` and `activeMatcher`. For each det return `{det fields, envelope: buildCanonicalDecisionEnvelope(det, words, 25)}`, plus `unit` info (vocalized words, qSegments, candidate refs).
   - `formulas` → `QUARANTINED_FORMULAS`, `CITATION_AND_ISNAD_WORDS`, for the case tagger.
4. Python `EngineBridge` restarts the process on crash, applies timeouts and keeps one built
   matcher per engine name.

**Done when:** the smoke test returns identical detections to the app for one lecture. Paste
the same transcript in the browser and compare `(unitId, wordStartIdx, wordEndIdx, band)`. The
envelope JSON must be byte-identical to `WahyAiVerifier.buildRequestPreview` in the browser.

---

## 3. Ground truth, alignment and labels (the core; most tests go here)

### 3.1 GT parsing (`gt_parse.py`)
- Strip page chrome and keep speaker labels as structure: `الشيخ:` = sheikh, otherwise reader/book text, `س:`/`ج:` = Q&A. Remove footnote markers `[n]`, expand `ﷺ`-style ligatures.
- **Quran, ref-anchored (primary):** for each `[سورة: a]` or `[سورة: a-b]`, resolve the surah name to a number (with name variants) and look up those verses in the corpus. In the window before the ref, find the best local alignment of the verse tokens. Accept when coverage ≥ 0.6 or there are ≥ 3 consecutive matched words. Split multi-verse quotes into **per-ayah spans**. Record which corpus words of each ayah the speaker actually said, for boundary labels.
- **Quran in `﴿﴾`** without a ref: align against the corpus the same way.
- **Hadith:** (a) `«…»` spans; (b) text right before a takhrij tail (`رواه البخاري`, `متفق عليه`, …); (c) **matn blocks**, meaning reader/book-text regions that match a corpus hadith with ≥ 8 consecutive normalized tokens. Identity is by **text similarity**, never by ref (F14).
- Adhkar: no markers on Bin Baz, so treat as GT-silent.

### 3.2 ASR↔GT alignment (`align.py`)
- Tokens come from the bridge `tokenize`. Anchors are 3-grams unique in both sequences, chained with a longest increasing subsequence. Gaps between anchors get DP alignment with fuzzy token match (`rapidfuzz` normalized Levenshtein ≥ 0.75).
- Outputs: `asr→gt` map, per-token aligned flag, windowed quality (±15 tokens).
- **Doc gate:** ≥ 50 % of ASR tokens aligned **and** ≥ 50 % of GT tokens aligned, else reject the doc as a wrong pairing or condensed transcript. Restrict to the span between the first and last anchors when the transcript covers only part of the audio.
- Tests use synthetic noise generated from GT text: substitutions, merges/splits, deletions, insertions and Whisper repetition loops. Projection accuracy must be ≥ 98 % on clean anchors.

### 3.3 Verdict label tiers (`label.py`)
For each detection: local alignment quality `q` over `[start-10, end+10]`.

| Tier | Condition | Verdict | Trust |
|---|---|---|---|
| `unalignable` | `q < 0.6` | none | dropped (kept in audit table) |
| `pos_strong` | overlaps a GT quote span of the same type and **same identity** (Quran `s:a`; hadith text sim ≥ τ) | CORRECT | high |
| `wrong_id` | overlaps a GT Quran span with a **different** ref, and canonical texts differ on the matched words | FALSE (D3) | high |
| `mutashabih` | as above, but the texts are identical on the matched words | none | review |
| `asr_mismatch` | GT words at the projected span **don't** support the canonical text, though the ASR does (an ASR artifact made it look like a quote) | FALSE but **unlearnable from ASR alone** | excluded from training by default, kept for analysis |
| `neg_weak` | QURAN, region aligned, GT words support the span, **no** GT ref/quote within ±N tokens | FALSE | teacher must agree, else review |
| `silent` | HADITH/ADHKAR with no GT marker in an aligned region | none from GT | teacher consensus or review |

### 3.4 Boundary labels (only for CORRECT; D7)
From the GT per-ayah span: which unit words the speaker said, `u[a..b]`. From the detection:
`qSegments`, `u[qs..qe]`. `MISSING_START` if words in `u[a..qs)` exist and project into
`immediate_transcript_before`. `MISSING_END` mirrors this; `MISSING_BOTH` is both. Then apply the
same rules as `normalizeBoundaryVerdict`: no unmatched prefix means it can't be MISSING_START, and
likewise for the suffix. FALSE records get **no** boundary gold. Laya allows labelling a subset of
the questions.

### 3.5 Gate G1 (most important)
After 5 lectures, show a random audit sample of 100 auto-labels (stratified by tier) in the
review widget. The user marks errors. **Required:** `pos_strong` + `wrong_id` precision ≥ 97 %,
boundary precision ≥ 90 %. If it fails, fix the parser/aligner **before** scaling. Every later
number depends on this.

---

## 4. Case taxonomy and coverage-driven sampling

Auto-computed tags per candidate (`cases.py`):
`source` (QURAN/HADITH/ADHKAR) · `band` · `in_default_scope` · `has_cue` · `span_len`
bucket (1–3 / 4–7 / 8–15 / 16+) · `asr_noise` bucket (1 − sim(ASR span, canonical matched words)) ·
`formula_overlap` (QUARANTINED_FORMULAS) · `narrator_only` (isnad-word ratio) ·
`explain_repeat` (≤ 3 content words + قوله/أي/يعني nearby) · `ref_ambiguity` (# candidate refs) ·
`mutashabih` (matched words occur verbatim in ≥ 2 units) · `engine_disagreement` (v3 vs v4:
missing or different unit) · `interrupted` (segments > 1) · `qiraah≠hafs` · `embedded_quran` /
`also_adhkar` · `speaker_role` (reader vs sheikh) · `asr_loop` · `boundary_label` · `gt_tier` ·
`teacher_disagreement` · `teacher_low_conf`.

**Sampler** (`sampler.py`):
- Quota matrix over `verdict × source × primary case`, with targets set in config. It decides which candidates go to the teacher (saves cost) and which get exported.
- Caps: ≤ 3 per `unit_id` per lecture and ≤ 8 per `unit_id` overall. This keeps الفاتحة, آية الكرسي and similar from flooding. Reader-read long hadiths are capped at ≤ 15 % of CORRECT.
- Optional **near-threshold mining** (off by default): rerun engines with thresholds −20 % to surface hard negatives. Tag `mined=True`, cap at ≤ 15 % of FALSE, since production never shows these to Laya.
- **Gap report**: cells below target, mapped to the Bin Baz series most likely to fill them:
  تفسير ابن كثير → Quran-heavy · الوابل الصيب → adhkar/dua · بلوغ المرام / رياض الصالحين / صحيح البخاري →
  hadith + narrator names · كتاب التوحيد / الطحاوية → mixed Quran+hadith.

Optional, later: **counterfactual boundary augmentation** if MISSING_* stays under target. Trim a
`pos_strong`+`COMPLETE_SPAN` detection by k ∈ {1,2,3} words, recompute `qSegments` in the harness
and rebuild the envelope. The label is correct by construction. Implement only if the harness can
recompute `qSegments` exactly.

---

## 5. Teachers and reconciliation

`teachers/base.py`: `Teacher.predict(envelopes) → [{verdict_probs, boundary_probs, reason, raw, cost, latency}]`.
- `jev.py`: `POST openrouter.ai/api/alpha/decisions` with `{model, state, questions}` and the **base** canonical questions. Reuse the retry pattern of `tafrigh/adapters/jev_adapter.py`. Probabilities are calibrated.
- `gemini.py`: native API with the same `responseSchema` as `buildGeminiRequestBody`, a **fixed, versioned** system prompt and preset, batches of 5–10, pacer.
- `openrouter_chat.py`: generic chat with the JSON contract from `CHAT_OUTPUT_CONTRACT`.
- `laya_local.py`: zero-shot `convaiinnovations/laya-multilingual`, used as the **baseline only**, not as a teacher.
- A cost estimate plus an explicit confirm cell before any paid run. `max_budget_usd` is in config.

**Reconciliation (D6).** GT is the label. The teacher adds soft targets and covers GT-silent
cases. Disagreement is **signal, not trash**. If you drop disagreements you drop exactly the hard
cases Laya needs to learn, and keep only what the teacher already gets right.

| GT tier | Teacher | Outcome | Target |
|---|---|---|---|
| strong | agrees | accept | GT label, ε = 0.05 smoothing (optionally blended with JEV probs) |
| strong | disagrees | **review queue** (highest value) | human label; unreviewed → GT label ε = 0.10, flagged |
| `neg_weak` | agrees, conf ≥ τ | accept | FALSE, ε = 0.10 |
| `neg_weak` | disagrees | review | — |
| `silent` | ≥ 2 teachers agree, conf ≥ τ | accept, tier `teacher_consensus` | ε = 0.15 |
| `silent` | otherwise | review or drop | — |
| human | any | human wins | ε = 0.02, NOT_SURE allowed (D5) |

Laya has no per-sample weights, so trust is encoded as **target sharpness**.

**Teacher benchmark cell** (answers "which model?"): on a balanced GT-strong sample of about 300,
report per teacher and for base Laya: verdict accuracy, macro-F1, per-case accuracy, boundary
accuracy, ECE, $ cost and latency. The external human eval set (U4) covers the GT-silent cases.

---

## 6. Export, splits, validation

- **Record schema** (one JSONL line):
  `{id, state, questions, gold: {verdict: {probabilities}, boundary_status?: {probabilities}}, expected: {...}, meta: {doc_id, source, series, engine, engine_fingerprint, asr, gt_tier, label_source, teacher, cases[], in_default_scope, dataset_version}}`.
  `questions` = the base canonical questions exactly as the app sends them to Laya.
- **State profile** (D2): `app_current` (byte-identical to today's app) or `engine_agnostic`
  (drop `engine_score` and add `engine_version`). The latter needs the same change in `ai-verifier.js`.
- **Primary engine:** export envelopes from the engine you ship. Other engines contribute only
  candidates the primary missed, tagged `from_engine`. Dedup key `(doc_id, span, unit_id)`.
- **Splits by lecture, never by detection,** because neighbouring detections share context. Use
  train / val / test ≈ 80/10/10, plus an **unseen-series** test and the **external** set (U4).
  Laya takes its own calibration slice out of train.
- **Validation gates** (all must pass before writing `datasets/<ver>/`):
  1. Token lengths with the checkpoint tokenizer: ≤ 2 % of rows truncate before `immediate_transcript_after`.
  2. `laya.train.dry_run(train.jsonl, base, TrainConfig(max_len=1024, head_max_len=256))` with **0 skipped**.
  3. No `doc_id` appears in more than one split; `laya`'s eval-overlap check reports 0.
  4. Class balance is within the configured bands; at least 50 calibration items per question type.
- **Manifest + dataset card:** versions and hashes of everything, counts, coverage matrix, tier
  and label-source breakdown, audit precision from G1, and the base-Laya baseline on test.

Volume (re-estimate after G1, when the real yield per lesson is known):
- **M1:** ~1,500 train + 300 test (≈ 40–60 lessons). Enough for a frozen-encoder run on the GTX 1050 and the teacher benchmark.
- **M2:** 4,000–6,000 train (≈ 120–200 lessons, ~100–150 h audio). Full fine-tune on a Colab/Kaggle T4.
- Targets: CORRECT:FALSE ≈ 55:45 within scope; non-COMPLETE boundary ≥ 20 % of CORRECT; NOT_SURE from humans only.
- Cost: ASR at Groq `whisper-large-v3-turbo` rates is a few dollars for 150 h (check your free-tier limits). The GTX 1050 is too slow for bulk ASR. JEV at ~$0.042/1M tokens is pennies.

---

## 7. Notebook outline (`notebooks/data/laya_data_generation.ipynb`)

0. Purpose, how to run, what each gate means.
1. **Config:** engines, primary engine, hadith corpus, ASR backend, teachers, budgets, thresholds, quotas, seed, state profile.
2. Environment check: node, ffmpeg, keys, corpus hash, laya. Print the engine fingerprints.
3. Engine bridge smoke test (v3 and v4 on a sample sentence; class assertions).
4. Source discovery: Bin Baz series → items table; pick by series quotas. Plus app-export and manual sources.
5. Fetch + GT parse: per-doc stats (refs, Quran spans, hadith spans).
6. Audio + ASR (cached, resumable, progress).
7. Alignment: doc-gate table, coloured diff view for one doc.
8. Engines → candidates + envelopes (per engine) + v3/v4 diff table.
9. Auto-label + case tags: tier distribution.
10. **Audit widget (gate G1).**
11. Coverage matrix + sampler selection.
12. Teacher run (estimate → confirm → run).
13. **Teacher benchmark** (+ base Laya).
14. Reconcile → **review queue widget**.
15. Export: splits, dedup, caps → JSONL + manifest + card.
16. Validation gates.
17. Gap report → what to fetch next.

The review widget shows context with the span highlighted, the GT snippet, canonical text, the
teacher's reason, and buttons for verdict and boundary. Labels are appended to `labels/human.jsonl`.

---

## 8. Phases (each ends with something runnable)

| Phase | Deliverable | Done when |
|---|---|---|
| 0 Setup | install `ipykernel ipywidgets pandas beautifulsoup4 tqdm`; `.gitignore` `data/laya_datagen/`; package skeleton; config | kernel runs in VS Code |
| 1 Engine bridge | `harness.js`, `engine_bridge.py`, `engines.py`, tests | parity check in §2 passes for one lecture |
| 2 Sources + ASR | `sources/binbaz.py` (polite: ~1 req/2–3 s, cached HTML, robots.txt), `asr.py`, `sources/app_export.py` | 5 lessons downloaded + transcribed, cached |
| 3 GT + align + label | `gt_parse.py`, `align.py`, `label.py`, tests | **Gate G1** passes on 5 lessons |
| 4 Export MVP | `export.py`, `validate.py` (GT-only labels, no teacher) | dry_run 0 skipped; first dataset v0. **You can test engines from here.** |
| 5 Teachers | `teachers/*`, `reconcile.py`, benchmark cells, review widget | benchmark table for JEV + Gemini + base Laya |
| 6 Coverage | `cases.py`, `sampler.py`, gap report; scale to M1 | coverage matrix meets M1 targets |
| 7 Follow-up | rewrite `finetune_laya.py` on `laya.train.finetune` (`freeze_encoder=True` on the 1050, `max_len=1024`, `head_max_len=256`, `shuffle_options=("choice",)`, `eval_data=test`) | fine-tuned checkpoint beats the base-Laya baseline on test and the external set |

---

## 9. Decisions (recommended defaults in **bold**; the executor uses the defaults until told otherwise)

- **D1 Primary engine:** **generate with both and export the engine you'll ship**. Regenerate when v5 lands (cheap; §1).
- **D2 `engine_score` in Laya state:** **switch to `engine_agnostic`** (drop the score, add `engine_version`). This needs a 2-line change in `ai-verifier.js` so inference matches. Until decided, export `app_current`.
- **D3 Wrong reference:** **FALSE** when the span quotes a *different* verse/hadith text. **CORRECT** when it's the same text from a different hadith book.
- **D4 Explaining-repeat** (the sheikh repeats 1–2 words of a verse to explain it): **FALSE**, consistent with the app's `explainingRepeat` rule.
- **D5 NOT_SURE:** **only from human review.**
- **D6 Teacher role:** **GT is the label; the teacher adds soft targets and covers GT-silent cases; disagreements go to review.**
- **D7 Boundary gold:** **only on CORRECT records.**

## 10. Needed from the user

- **U1** Keys in the environment: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
- **U2** If you customized adhkar or the outside-hadith list in the app, export them from localStorage to JSON. Say which hadith corpus production uses (`corpus.json` or `hadith_open_hadith_data.json`).
- **U3** Gate G1: audit 100 auto-labels (~1 h).
- **U4** External eval set: 200–300 human-verified decisions from **your own target lectures** (not Bin Baz), made with the app's verify + override flow and exported from the Training tab. This is the only honest measure of real-world gain: Bin Baz is one speaker on old tapes.
- **U5** Pick the teacher(s) after the benchmark cell.
- **U6** Work through the review queue periodically (expect ~10–15 % of candidates).

## 11. Risks

GT noise (transcriber completions, missing refs) → tiers + G1 · speaker/era shift → second source + U4 ·
teacher selection bias → reconciliation table · engine-specific features → D2 · frequent-verse
flooding → caps · split leakage → lecture-level splits · max_len truncation → gate · scraping
fragility → cached HTML, polite rate · engines changing mid-project → fingerprints + engine-independent
labels · keep the dataset private (it contains site transcripts).
