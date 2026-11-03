# Handoff — engine v5 (better matching) + a "loose" profile to mine negatives for Laya

Written 2026-10-24 at the end of a long session, so a fresh session can do this without its history.

> **Status (2026-10-24, later):** deliverable 1 done — `js/engine_v5.js`, results and the per-fix table in
> `docs/reports/engine-v5-report.md`, re-run with `notebooks/data/laya_engine_v5.ipynb`. Deliverable 2: the loose profile exists
> (`v5:loose`) and is measured; labelling its findings on the lecture batches is the open step (see the report).
Read this file, then `docs/review-notes.md` (the user's notes from reviewing ~1,100 cards: the engine problems with real
examples and label keys).

## Why

Laya (the local quote verifier) needs training rows with real **negatives** (engine findings that are not quotes). The
current engine (v4) is precise (~92 %), so negatives are rare: about 10–15 % of findings. Two deliverables, in order:

1. **Engine v5**: fix the problems the user found while reviewing, judged on its own (recall and precision vs v4).
2. **A "loose" profile** on top of v5 (lower thresholds) to produce many more borderline findings on new lectures;
   Sonnet labels them (the pipeline already exists) → many negatives. Its precision also tells the user how loose the
   app can run with Laya as the safety net.

## Rules

- **New file `js/engine_v5.js`**, a copy of `js/engine_v4.js` evolved. Do not change v4's behaviour (the app uses it, and
  every comparison is against it). Shared helpers in `js/engine.js` (v3) may only be changed if v3/v4 results are
  unchanged.
- A fix stays only if it **doesn't cost more precision than it gains in recall** (measure each one; the user's words:
  "fix every problem … if it doesn't cause more harm than good").
- Wire v5 so the app can choose it: `rebuildMatcher()` in `js/state.js` (~line 705, reads `localStorage.wahyEngine`), the
  two engine dropdowns and the Tafrigh re-run in `js/events.js` (~lines 1373 and 1633: today they only know "v3"/"v4"),
  and a `<script>` tag after `engine_v4.js` in `index.html` (~line 2045).
- Harness: `backend/laya_datagen/js/harness.js` loads extra engine files (`extra_engine_files`, already supported by
  `EngineBridge(hadith_path, extra_engine_files=["js/engine_v5.js"])`) and asserts the built class per engine name
  (`EXPECTED_CLASS` — add `v5`).
- The user works in notebooks open in VS Code: **before editing a notebook, ask them to save it**, then edit cell by cell
  (NotebookEdit); they reopen without saving. Never rewrite a whole notebook they have open.
- Never call paid models by accident: notebooks have `RUN_MODELS = False` switches; keep that pattern.

## What to fix (from docs/review-notes.md — note numbers)

Matching (ASR spelling variants — the biggest family):
- **4, 6** word endings / حروف العلة: ة/ه, final ا/ى/ي (root cause found: `js/engine.js` ~line 174 maps ى→ي so «غزى»≠«غزا»),
  tanwin, pronoun suffixes (ـه/ـها/ـهم/ـكم…), dropped long vowels (اتق↔اتقي, يدعو↔يدو).
- **13** first letters: «ال» dropped/added (both directions), prefix و/ف/ب/ك/ل dropped/added/swapped, «ال»↔«لل», hamzat
  al-wasl (عبدوا↔اعبدوا), one-letter prefix swaps (نحافظين↔لحافظين), and a quote starting mid-hadith without «و» («من» vs «ومن»).
- **18** one word split in two / two merged («لب المرصاد»↔«لبالمرصاد»): v3's `isFusedTwoToOneMatch` exists but only runs when
  extending an island; use it when seeding/scoring.
- **8** «قال» for a verse-initial «قل» (only when the verse starts with قل; «قال» is also the commonest cue).

Rules / thresholds:
- **17** too-short rules: v4 `_passesGuards` accepts a ≤2-word ayah only with a cue, whatever its rarity (طه:41
  «واصطنعتك لنفسي» missed); cue doesn't lower the threshold for fragments (آل عمران:19); add «قوله» / «في قوله» as cues;
  multi-home phrases (الرعد:16 / الزمر:62) → accept and mark the reference ambiguous instead of rejecting.
- **14** parenthetical phrases (honorifics «رضي الله عنه», «صلى الله عليه وسلم», «عز وجل», asides «يعني»): free to skip, never
  split/end a finding inside one.
- **25, 27** cue strength: a takhrij right *after* the text («متفق عليه», «رواه البخاري/مسلم…») is a strong hadith cue
  (today cues are only searched in the 8 words before); «وفي رواية»/«وفي لفظ» should weigh more than a generic «قال».
- **12** identical endings: prefer the reference that is the same as / adjacent to (same surah ±1 ayah) a neighbouring
  finding (الأحزاب:35 vs الفتح:29 case).
- **20** neighbour probe could start from a near-miss candidate, not only an accepted ayah.
- **9** spelled-out muqatta'at («ألف لام ميم» → الم).
- **19** regressions where v3 catches what v4 misses: البقرة:21, فاطر:6 — keep v4's gains, add v3's tolerance.
- **15, 24** (optional, check the harm) `maxVGap` is 2 in the app: ASR deletions inside a quote and abridged hadiths split
  or lose the tail.

Not engine work (leave): 1 (sanad policy), 2 (new boundary labels), 11 (ASR hallucinations), 21 (most misses are ASR),
26/29 (by-meaning / explanation — Laya's job), 28 (dhikr as a post-detection check — a separate design task; do it only
if the user asks).

## How to measure

Everything is in `backend/laya_datagen/` and cached (ASR is never redone; editing an engine file changes the engine
fingerprint, so only detection reruns).

- **Recall**: the 15 hand-reviewed Bin Baz lessons (`notebooks/data/laya_review.ipynb`, cells "Setup" + "Load lessons"; add
  `"v5"` to `ENGINES`). `stages.recall_table(bundles, ["v3","v4","v5"])` → recall vs 583 ground-truth quotes (499
  alignable). Today: v4 Quran 69 % / hadith 99 %, v3 58 % / 97 %. Stage 3 labels (`labels/stage3_missed.json`) say why each
  v4 miss happened (65 ASR-garbled, 49 engine's fault, 8 too short, 7 unsure, 2 bad GT): the 49 are the target.
- **Precision**: label keys are engine-independent (`doc|wordStart-wordEnd|unitId`), so any v5 finding with the same span
  reuses the user's labels in `labels/findings.json` (329) and `labels/sprint.json` (111). New spans: label them with
  Sonnet (`backend/laya_datagen/autolabel.py` — add a `store` parameter so this evaluation doesn't mix with
  `labels/sonnet.json`). `stages.engine_report(...)` gives the v4 baseline numbers.
- **Regression set** (exact cases from the notes, label keys included there): البقرة:21 (`binbaz_audio_182|Q|2:21|304`),
  فاطر:6 (`binbaz_audio_820|Q|35:6|4064`), النجم:23, الفجر:14 «لب المرصاد», طه:41, آل عمران:19, الزمر:62, الانفطار:10–11,
  النحل:74, يوسف:108 (قال/قل), غزا/غزى, Muslim 2699 «من سلك» (`binbaz_audio_561|2705-2715|…`), الأحزاب:35 vs الفتح:29
  (`binbaz_audio_567|4027-4029|48:29`). `EngineBridge.detect(engine, words)` runs any snippet, so each fix gets a test in
  `backend/tests/laya_datagen/` (see `test_engine_bridge.py`).
- Report per fix: recall gained, findings added, precision of the added findings; and a final v3 / v4 / v5 table.

## Deliverable 2 — loose profile + negatives

- Expose v5's thresholds as a profile (e.g. constructor param or `localStorage.wahyEngineProfile = "loose"`), harness
  passes it; the app default stays the normal profile.
- New lectures: `backend/laya_datagen/lectures.py` (YouTube ids per sheikh + Bin Baz URLs; the user wants many short videos
  from famous sheikhs, list in that file). Downloads `sources/youtube.py`, transcription Groq (free key in `.env`; if it
  fails ask the user for a new one), processing `pipeline.process_no_gt` (YouTube) / `pipeline.process_cached` (Bin Baz).
- Labelling: `notebooks/data/laya_autolabel.ipynb` + `autolabel.py` — Sonnet through `claude -p` (headless Claude Code on the
  user's subscription), 10 cards per call, guide = `agent_eval_files/instructions.md`. Currently effort `high`. 717 cards
  labelled so far (72 negatives). Pool for the loose run = loose findings not already labelled.

## State of the labels (2026-10-24)

- Hand labels: `labels/findings.json` (stages 2+4, 329), `labels/sprint.json` (111), `labels/stage1_gt_check.json`,
  `labels/stage3_missed.json`. ~55 hand negatives.
- Sonnet: `labels/sonnet.json` (717, with reasons), usage per call `labels/sonnet_runs.jsonl`. Blind tests: Sonnet matched
  the user on 58/60 cards (`data/laya_datagen/agent_eval/report_r1.md`, `report_r2.md`).
- Laya training export (stage 6/8 data generation) is not built yet; `finetune_laya.py` doesn't train (separate task).
