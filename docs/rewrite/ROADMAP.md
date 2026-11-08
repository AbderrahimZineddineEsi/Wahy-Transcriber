# Rewrite roadmap

The single source of truth for the rewrite (replaces the 2026-11-03 morning version). It holds every phase's
instructions. There are no handoff files: `docs/plans/rewrite-feature-inventory-handoff.md` is superseded by phase 1
and must not be followed.

Read with it: `GLOSSARY.md` (the words), `docs/rewrite/ARCHITECTURE.md` (the target shape), `docs/adr/` (the
decisions and why). The problems being fixed are in the friction map: https://claude.ai/artifact/Wq1c5X9rZpYhkARjXMT5uv

## How a session works

1. The user starts it with:
   `Recommended: <model>, <effort> — if you're not on it, ask me first. Read docs/rewrite/ROADMAP.md and do the next unticked phase.`
2. If the session runs on another model, or its effort isn't confirmed, it asks the user before reading anything else.
   Never suggest Fable 5.1 (not on the user's plan).
3. Check out branch `factory-reset` and pull. Read this file, `GLOSSARY.md`, `ARCHITECTURE.md` and the ADRs the phase
   names. Do **only** the first unticked phase.
4. Test as you go. A phase is done only when its **Done when** tests pass and its **Feature check** was run and passed.
   Report failures as they are, with the output.
5. Append a section to `docs/rewrite/LEARNING.md` for the user (a CS student whose focus is ML; backend background in
   Node/Express and NestJS, some Flutter): what was built, each new concept explained plainly with a small example
   from this code, how it was tested, and two or three commands to try. Keep it short. This is a learning log for the
   user, not instructions for the next session.
6. Tick the phase, show the user a short summary, then commit as `rewrite phase N: <title>` and push without asking
   (retry the push with a timeout if GitHub drops the connection). At the start of a session, if the previous phase's
   work is still uncommitted, commit and push it the same way before doing anything else.
7. End by giving the user the exact start prompt for the next phase, with its model and effort.

**Rules.**
- A session never changes another phase, the order or the scope on its own. If a phase is too big for one session or
  needs a change, the session stops, asks the user, and records the answer under **Changes**. The one exception:
  phase 1 fills in the `F-xxx` IDs on every phase's Feature check line.
- Until phase 24, the old app (`backend/`, `js/`, `css/`, `index.html`, `run.sh`) must keep working. It is only edited
  where a phase says so.
- A decision that changes an ADR gets a new ADR that supersedes the old one. New domain words go in `GLOSSARY.md`.
- Golden files (phase 2) are never regenerated to make a test pass. If a golden test fails, the new code is wrong
  unless the user agrees otherwise, and that agreement is recorded under **Changes**.

## Phases

### Ground work

- [x] **1. Feature inventory**: Opus 5.5, high.
  Write `docs/rewrite/features.md`, the exhaustive checklist used as the final acceptance test.
  - Sources, each fully covered: every entry in `js/i18n-en.js`, every `id` in `index.html`, every handler in `js/*.js`,
    every setting and store in `js/state.js`, every route in `backend/app.py`, every CLI entry point in `backend/**`,
    `scripts/` and `notebooks/`, plus the wishes in `README.md`, `future_work.md`, `docs/review-notes.md` and
    `docs/plans/`. Measure coverage with a script in the scratchpad and report the counts (assigned, generic,
    unassigned = 0). Engine internals are not features; list only what the user can see or set.
  - Format per feature: `- [ ] **F-001 Title.** One sentence.` then `where:` (file:line), `suggest:` (keep / merge /
    remove / replaced, with a reason), `check:` (one concrete action and the expected result), `user:` (the user's
    mark). IDs are stable and never renumbered.
  - Walk the user through it one area at a time, in plain text, and record their marks exactly as they said them. Say
    in one line whether you agree with each choice that differs from your suggestion, and why.
  - Also record: **design wishes** (they like the transcript beside the video with word-by-word sync; the old look
    need not survive), proposed **new features** with size S/M/L and the user's mark, and which engine versions,
    envelope versions and old Laya paths (`finetune_laya.py`, `laya_dataset.py`) are kept.
  - Finally, fill in the `F-xxx` IDs on each later phase's Feature check line below.
  - Done when: counts reported with 0 unassigned, every feature has a user mark, IDs filled in below.
  - Feature check: none (read-only on code).
  - Learn: why a rewrite starts with acceptance criteria.

- [x] **2. Golden files and a safety export**: Opus 5.5, high. ADRs 0001, 0003, 0005.
  Freeze what the old app produces, so the new code can be proven identical.
  - Choose fixed inputs: the sample lecture and 3 lectures from `data/laya_datagen/lectures/` (one short, one with a
    long Quran passage, one with many hadiths). Copy their words into `engine/golden/inputs/`.
  - With the old code running in Node (reuse `backend/laya_datagen/js/harness.js`; load `js/caption-builder.js` the
    same way), record: findings for every engine choice (`v3`, `v4`, `v5`, `v5:loose`); envelopes v1, v2 (every option
    set that a kept checkpoint uses) and v3; SRT, VTT and ASS captions; the formatted text export; the Laya JSONL
    export for a fixed set of verification records. Write them to `engine/golden/expected/` with a generator script
    in `engine/golden/make_golden.mjs` whose header says how to run it.
  - Measure the training/serving skew: for every row of `laya_v2`, compare the run-6 notebook's `to_v3_state` output
    with `buildLayaEnvelopeV3`. Report how many rows differ and how, in plain words, in `LEARNING.md`.
  - Ask the user to export the old app's training bank and saved lectures from the browser (the existing export
    buttons) into `data/legacy/`. Wait until they confirm.
  - Done when: the generator reruns and produces identical files twice; the skew is reported; the legacy export exists.
  - Feature check: the old app still runs with `./run.sh` and the sample lecture shows the same findings as before.
    Features: F-024, F-043, F-069, F-070, F-101, F-127.
  - Learn: golden (characterization) tests; training/serving skew, measured on your own data.

- [x] **3. Repository skeleton**: Sonnet 5.5, medium. ADRs 0001, 0005, 0008.
  - Create `server/` (uv, Python 3.12, FastAPI app with `/api/health`, pytest, ruff), `engine/` (TypeScript, Vitest),
    `web/` (Vite + React + TypeScript + Tailwind, Vitest, ESLint), and root npm workspaces for `engine` and `web`.
  - Add `scripts/test.sh`, which runs the old backend tests, the new server tests, engine tests and web tests, and
    `scripts/dev.sh`, which starts the new server and web app together. `run.sh` stays the old app's launcher.
  - Move experiment output out of git: `runs/` and `backend/runs/` go to `data/tafrigh_runs/` (untracked with
    `git rm --cached`; nothing is deleted from disk), and `data/` is git-ignored except what is already tracked on
    purpose (check with the user before untracking anything else).
  - Done when: `scripts/test.sh` is green (except the one known failing old test,
    `test_review_endpoint_survives_a_server_reload`), and `scripts/dev.sh` shows a blank web page that reads
    `/api/health`.
  - Feature check: the old app still runs with `./run.sh`; a saved Tafrigh run is still listed.
    Features: F-121, F-127, F-128.
  - Learn: monorepos, uv vs pip, what Vite does, npm workspaces.

### Engine and Laya inputs

- [x] **4. Engine package**: Opus 5.5, high. ADR 0002.
  - Move `js/engine.js`, `js/engine_v4.js`, `js/engine_v5.js` and the helpers they need (such as `computeTokenIoU` from
    `editor.js` and the Arabic normalisers in `state.js`) into `engine/src/` as ES modules. Keep the logic as close to
    verbatim as possible: loose types first, no behaviour changes. There must be no DOM, no `localStorage` and no
    globals; the engine version and profile are arguments.
  - One entry point: `detect(words, { engine, profile, qiraat, adhkar, customQuotes })` returning findings.
  - Don't edit the old `js/` files: the old app keeps its own copy until phase 24.
  - Done when: golden findings are identical for every engine choice and every input.
  - Feature check: the old app is untouched and still detects as before.
    Features: F-011, F-012, F-043.
  - Learn: ES modules vs browser globals; deep modules (a small interface over a lot of logic).

- [x] **5. Envelope builders and the engine worker**: Opus 5.5, high. ADRs 0002, 0003.
  - Move the envelope builders v1, v2 and v3 (with passages, neighbours and `boundaryByRule`) into `engine/src/`, with
    one entry point: `envelopes(findings, words, version, options)`.
  - Add `search(text)` for corpus search, and a worker entry (`engine/src/worker.ts`): one JSON request per line on
    stdin, one JSON response per line on stdout, with the corpus loaded once.
  - Switch `backend/laya_datagen/engine_bridge.py` to the new worker (this edits old code, on purpose), so the datagen
    already uses the new package.
  - Done when: golden envelopes are identical; `backend/tests/laya_datagen/` is green; rebuilding `laya_v2` gives files
    identical to today's (compare hashes).
  - Feature check: the old app is untouched; the datagen builds the same dataset.
    Features: F-092, F-093, F-131, F-132.
  - Learn: talking between processes; why one envelope builder matters for Laya.

### Server

- [x] **6. Server core**: Opus 5.5, high. ADRs 0005, 0006, 0007.
  - `core/settings.py`, `core/db.py` with the first Alembic migration (lectures, lecture versions, words, findings,
    verdicts, labels, jobs, AI requests, settings), and `core/jobs.py`: submit, progress, pause, resume, cancel,
    status saved in SQLite, interrupted after a restart, and one progress stream per job (server-sent events).
  - `core/gpu.py`: models ask and wait, and only one is resident at a time. `core/engine.py`: starts the worker,
    restarts it if it crashes, one request at a time.
  - Done when: tests at each module's interface pass, using a fake model for the GPU owner and the real engine worker
    with a small sample corpus.
  - Feature check: nothing visible yet; the old app still runs.
    Features: groundwork for F-010, F-023, F-088, F-098.
  - Learn: ORM and migrations, threads vs asyncio, locks, server-sent events.

- [x] **7. Lectures and transcription**: Sonnet 5.5, high.
  - `features/lectures`: create, list, open, delete, save a lecture version, serve media. Inputs: pasted text,
    `.txt/.srt/.vtt`, a YouTube link (yt-dlp), an uploaded file (ffmpeg), and the sample lecture. The media cache goes
    in `data/media/`.
  - `features/transcription`: Groq, faster-whisper (small, large-v3-turbo) and the specialized Whisper, all through
    the GPU owner, running as a job. Pass faster-whisper a decoded float32 array, not a file path: its path decoding
    calls `av.open(metadata_errors=...)`, which PyAV 19 removed (fixed in the old app on 2026-11-06, commit 6b3d363).
    API keys come from the gitignored `.env`.
  - Done when: parser tests use fixture files; transcription tests use a fake ASR; one live test is marked and only
    runs on request.
  - Feature check (through the API): an `.srt` file becomes a lecture with timed words; a YouTube link shows progress
    and ends with timed words.
    Features: F-016 to F-028, N-009.
  - Learn: FastAPI routers, services and `Depends`; running ffmpeg and yt-dlp from Python.

- [x] **8. Corpora and detection**: Sonnet 5.5, high.
  - `features/corpora`: corpus sources (download, prepare, upload, cache), the adhkar list and custom quotes, stored in
    the database.
  - `features/detection`: a detect job through the engine worker, with the engine version, profile and Qira'at, plus a
    corpus search route.
  - Done when: detection through the API on each golden input equals the golden findings.
  - Feature check: the sample lecture gives the same findings as the old app.
    Features: F-011, F-012, F-043 to F-046, F-061 (corpus search), F-075, F-077 to F-079.
  - Learn: integration tests that cross a process boundary.

### First screens

- [x] **9. Screen design**: Opus 5.5, high.
  - Build mockups of the main screens as an artifact page the user can click through, in Arabic right-to-left and in
    light and dark, following the design wishes in `features.md`. Iterate until the user approves.
  - Then write the design tokens (colours, type, spacing) to `web/src/shell/tokens.css`. No other app code.
  - Done when: the user has approved the mockups and their words are recorded in `features.md` under Design wishes.
  - Feature check: none.
    Features: F-001, F-030, F-042, F-047, and the Design wishes.
  - Learn: design tokens; right-to-left layout.

- [x] **10. Web shell**: Sonnet 5.5, high. ADR 0008.
  - Layout and navigation, the theme toggle, i18n by keys (Arabic default and right-to-left, English), and a settings
    screen (API keys saved on the server; health, GPU and key status). Add error toasts, the API client and types
    generated from OpenAPI, the TanStack Query setup, and a Playwright smoke test.
  - Done when: the type check, Vitest and the Playwright smoke test pass.
  - Feature check: the app opens; switching language and theme works; a saved key shows as set in the health status.
    Features: F-001, F-002, F-004 to F-006, F-008, F-010, F-124, F-128.
  - Learn: React components and hooks; how generated API types catch breaking changes.

- [x] **11. Web: new lecture and saved lectures**: Sonnet 5.5, medium.
  - New lecture (paste, file, YouTube, upload, sample), the saved lectures list, transcription and detection progress.
  - Done when: Vitest and Playwright pass.
  - Feature check (**milestone A**): paste a YouTube link in the new app; the transcript and findings appear.
    Features: F-007, F-016 to F-020, F-023, F-024, F-026, F-027.
  - Learn: forms, server state, progress streams in React.

- [x] **12. Lecture view**: Opus 5.5, high.
  - Transcript beside the video with word-by-word highlighting in sync, click a word to seek, findings highlighted
    with their reference, the verdict filter, and the live caption preview. It must stay smooth on a 2-hour lecture.
  - Done when: Vitest covers the word-sync logic (time to word) and Playwright covers click-to-seek.
  - Feature check (**milestone B**): open the sample lecture; the highlight follows the video; clicking a word
    mid-lecture jumps the video there.
    Features: F-028 to F-039, F-041, F-042.
  - Learn: refs and effects; rendering thousands of words without lag.

### Verification

- [x] **13. AI provider layer**: Opus 5.5, high. ADRs 0004, 0006.
  - `core/ai/`: Gemini (free-tier pacer, `Retry-After`, batches of 5 to 10), OpenRouter JEV decisions, OpenRouter chat
    (model catalog with live prices, JSON mode), Groq (moved here from transcription), local Laya (through the GPU
    owner; the envelope version comes from the checkpoint), and a fake. Every call is saved as an AI request with its
    tokens, cost, latency and raw payload.
  - Done when: tests with recorded responses pass for each provider; live tests are marked and only run on request.
  - Feature check: one live call per provider, run only with the user's permission.
    Features: F-080 to F-083, F-094, F-097, F-098.
  - Feature check result (2026-11-06, with the user's permission; one tiny request each, all passed): Gemini
    `gemini-3.5-flash-lite` CORRECT 0.99, 852 + 119 tokens, $0 (free tier), 3.7 s; JEV `typesafe/jev-1.14-20261014`
    CORRECT 0.80, 413 + 43 tokens, $0.000017, 0.9 s; OpenRouter `deepseek/deepseek-chat` CORRECT 0.95, 924 + 104
    tokens, $0.00039, 5.4 s (catalog search for "deepseek" also live); Groq 2 s of tone transcribed (billed as 10 s,
    about $0.0001); Laya `laya-wahy-r6-v3_mixed` on CUDA, envelope 3, golden sample finding CORRECT 0.51, 4.5 s.
  - Learn: ports and adapters; rate limiting, retries and backoff.

- [x] **14. Verification pass and telemetry (server)**: Opus 5.5, high.
  - Estimate (count, tokens, cost, time); a verification pass job with selected findings, scope, pause, resume and
    cancel; verdicts and boundaries saved; expanding a finding with a missing start or end; human override. Telemetry
    routes: the list of requests and one request's payload.
  - Done when: tests with the fake provider pass, and the Laya path sends the golden envelopes for golden findings.
  - Feature check (through the API): a Laya pass on the sample lecture saves verdicts.
    Features: F-065, F-084 to F-089, F-091 to F-093, F-095, F-096, N-020.
  - Learn: orchestrating a job.

- [x] **15. Web: verification and telemetry**: Sonnet 5.5, high.
  - Verifier settings (provider, model, options), the estimate dialog where quotes can be unticked, progress with
    pause, verdict chips, the expand button, and the request log with its inspector.
  - Done when: Vitest and Playwright pass.
  - Feature check: verify the sample lecture with Laya in the new app; filtering out "ordinary speech" hides those
    findings in the transcript and the captions but keeps their words.
    Features: F-036, F-037, F-066, F-080 to F-091, F-095, F-096.
  - Feature check result (2026-11-06): `e2e/live-laya.spec.ts` verified the sample lecture with Laya
    `laya-wahy-r6-v3_mixed` on the GTX 1050 (27 s): every ticked quote got a verdict, the log showed the Laya requests with
    the v3 envelope, and hiding "ordinary speech" hid the false finding (Muslim 2149) and kept all its words.
  - Notes: the estimate is a panel beside the list (as in the approved mockup), not a dialog. A row in a running pass
    shows "Queued", not "checking": the server does not say which finding is in flight. The quote card got the user's
    verdict buttons and "Complete the quote"; the transcript got the ✂ marks (`MISSING_BOTH` is now a boundary the
    view knows). Laya's load/unload buttons (F-097, F-098) belong to the later phase that lists them.
  - Learn: optimistic updates.

### Editing and export

- [x] **16. Editing and export (server)**: Opus 5.5, high.
  - Edits, each one an operation in a per-lecture log so undo works: add a missed quote (a word range plus a
    reference), swap in canonical words, choose a candidate reference, edit the full text while keeping word timings,
    edit caption timing.
  - Export: SRT, VTT and ASS captions that never split a quote, and the formatted text with bracket and reference
    styles.
  - Commentary gaps (new, not in the old app): when a finding has `commentaryGaps`, the speaker's words between its
    `segments` go outside the quote, for Quran, Hadith and Adhkar alike: `«part one» [commentary] «part two» [ref]`.
    A Quran verse embedded in a hadith (`embeddedQuran`) still goes in its own `﴿…﴾` inside the segment it is in.
    Add a setting to turn this off (the old code had an unused `showSharhBrackets` flag). The old app put the commentary
    inside the brackets, so findings with gaps are the one expected difference from the golden exports. The web
    transcript view (phases 12 and 17) shows the same split.
  - Done when: golden captions and text exports are identical, apart from the commentary-gap split above, which has
    its own test (Hadith with a gap, Hadith with a gap and an embedded verse, Quran with a gap); a test proves word
    timings survive a text edit.
  - Feature check: export the sample lecture's captions; they match the old app's.
    Features: F-003, F-053, F-056, F-058 to F-064, F-067 to F-071.
  - Feature check result (2026-11-06): a running server on a scratch data folder, the sample lecture detected with
    v5, then `GET /api/lectures/{id}/export/{srt,vtt,ass,md,txt}`: all five byte-identical to the old app's files
    (`make_golden.mjs --check` confirmed the old app still writes them). Adding a missed quote showed it in the SRT and
    undo removed it.
  - Notes: see the 2026-11-06 phase 16 entry under **Changes**.
  - Learn: the command pattern for undo; LCS alignment.

- [x] **17. Web: editor and export**: Opus 5.5, high.
  - The word board (add a missed quote with two clicks), the quote inspector, canonical word chips, the reference
    picker with corpus search, the full-text editor, the caption timing editor, undo, and the export dialog.
  - Done when: Vitest and Playwright pass.
  - Feature check: add a missed quote with two clicks; it shows in the transcript and the captions; undo removes it.
    Features: F-038, F-047 to F-071, N-007.
  - Feature check result (2026-11-06): `e2e/editor.spec.ts` on the real server and engine with the sample lecture: two
    clicks on three plain words, inserted as an outside quote; the server had the new finding and a quote caption, the
    view's transcript showed the quote and the caption over the video showed it; the header's undo ("تراجع: إضافة
    اقتباس فائت") removed it from both. The export tab's SRT download was byte-identical to the server's file, and « »
    verse brackets reached the transcript after a reload. `scripts/test.sh` all green.
  - Notes: see the 2026-11-06 phase 17 entry under **Changes**.
  - Learn: managing complex UI state.

### Tafrigh

- [x] **18. Tafrigh (server)**: Sonnet 5.5, high.
  - Move `backend/tafrigh/` into `features/tafrigh/` mostly unchanged; its adapters use `core/ai`. It runs as a job
    (modes, typo strategy, the 20-sentence test slice, estimate, pause, stop). Review actions survive a restart.
    Tafrigh runs are saved in `data/tafrigh_runs/` and can be saved, cloned and compared, with outline, render and
    export.
  - Done when: the ported Tafrigh tests pass, including the restart test that fails today.
  - Feature check: run Tafrigh on the sample lecture's test slice, then compare two Tafrigh runs.
    Features: F-106 to F-123.
  - Feature check result (2026-11-07): live on the sample lecture (12 sentences, so the 20-sentence slice covers it),
    `gemini-3.5-flash-lite` on Google's free tier ($0): a windowed run (window 10, 2 requests) and a per-sentence run
    (12 requests), both saved in `data/tafrigh_runs/`; compare listed the 2 sentences the runs label differently.
    Offline tests: 89 Tafrigh tests, including the restart test; `scripts/test.sh` green.
  - Notes: see the 2026-11-07 phase 18 entry under **Changes**.
  - Learn: moving a well-tested package without breaking it.

- [x] **19. Web: Tafrigh**: Sonnet 5.5, high.
  - Sentence preview, settings, a run with progress, pause and stop, the review queue, saved Tafrigh runs and the
    compare view, the outline view, export.
  - Done when: Vitest and Playwright pass.
  - Feature check: do a Tafrigh run from the new app and review one sentence.
    Features: F-106 to F-122.
  - Feature check result (2026-11-07): live, from the new app, on the sample lecture: Tafrigh tab → Gemini route
    "directly through Google" (OpenRouter's key is expired) → "first 10" → Start; `gemini-3.5-flash-lite` on the free
    tier ($0), 10 sentences in 1 windowed request (3.6 s), saved in `data/tafrigh_runs/`; one sentence opened and
    confirmed, and the server's run says `reviewed: 1` (`web/e2e/live-tafrigh.spec.ts`, `WAHY_E2E_LIVE=1`).
  - Notes: see the 2026-11-07 phase 19 entry under **Changes**.
  - Learn: long-running UIs.

### Training data and the research side

- [x] **20. Training data**: Opus 5.5, high. ADRs 0003, 0005.
  - Gold labels from corrections and overrides, saved in the database. A Laya JSONL export that matches the golden
    export for the same records. An import for the legacy export in `data/legacy/`. The training data screen in the
    web app.
  - Done when: importing the legacy bank and exporting it again gives the old app's export.
  - Feature check: correct one verdict in the new app; it appears as a gold label in the export.
    Features: F-064, F-065, F-091, F-100, F-101, F-103, F-104, F-120, N-007.
  - Done-when result (2026-11-07): `data/legacy/` is empty (2026-11-03 entry below), so the old bank's export is the
    golden `laya_export.jsonl` (the old app's Laya JSONL export, its only export of the bank): imported through the API
    and exported again, byte-identical; counters as the old app's (6 rows: 3 correct, 2 false, 1 not sure; 3 gold, 3 AI).
    With the same records made in the new app (sample, v5, full corpus) the export equals the golden file except the
    ids, which the old app made at random (`test_training_golden.py`).
  - Feature check result (2026-11-07, offline, `e2e/training.spec.ts`): the sample lecture with the fake verifier's
    verdicts; in the lecture view الأحزاب: 70 set to "ordinary speech"; the training screen showed one gold row
    ("Ordinary speech (gold)", "You (verdict)", the verifier had said "Correct"); the gold-only export held that row as
    human-verified `FALSE`. Also checked in the real app: the golden bank imported from a file exports as the same
    bytes; 5 reviewed Tafrigh sentences saved for Laya show as 5 segmentation rows.
  - Notes: see the 2026-11-07 phase 20 entry under **Changes**.
  - Learn: data lineage (where a training row came from).

- [x] **21. Corpora screens and status**: Sonnet 5.5, medium.
  - The adhkar editor, Quran and hadith browsing, custom quotes, corpus sources, engine version and profile settings,
    and Laya status (load, unload, envelope version, VRAM).
  - Done when: Vitest and Playwright pass.
  - Feature check: add a dhikr; the next detection finds it in the sample lecture.
    Features: F-011, F-014, F-015, F-046, F-072 to F-079, F-097, F-098.
  - Done-when result (2026-11-07): web Vitest 147 pass (21 files), Playwright 17 pass, server 410 pass,
    engine 268 pass.
  - Feature check result (2026-11-07, offline, `e2e/corpora.spec.ts`): on engine v3 the sample lecture has one dhikr
    (the closing «لا إله إلا الله»); adding «نحمده ونستعينه ونستغفره» in the corpora screen made the next detection return
    two, the new one at words 3 to 5; the "Detect adhkar" switch off left none. Engine v4 and v5 find no adhkar at all
    (the golden files pin that), so the check runs on v3 and the screen says so.
  - Notes: new engine command `browse` (read-only paging of the Quran and hadith, no matcher); new server routes
    `GET /api/corpora/browse`, `POST /api/corpora/adhkar/import`, `POST /api/corpora/adhkar/reset`; a dhikr must have two
    words (F-073). Laya load/unload (F-097, F-098) are in Settings, on the existing routes. F-011's display-toolbar copy
    of the engine choice belongs to the lecture view and is not added here (settings has it). F-015's upload is the
    sources tab's per-source upload; no custom corpus URLs (the server owns the sources).
  - Learn: CRUD screens done once and reused.

- [x] **22. Datagen on the new core**: Opus 5.5, high. ADRs 0003, 0004.
  - Move `backend/laya_datagen/` to `server/laya/`, so teachers are `core/ai` providers and the engine is `core/engine`.
    Add CLI entry points, and port the tests.
  - The dataset builder stores final envelopes, and the Kaggle scripts and notebooks stop reshaping them. Use the skew
    report from phase 2: if the rows differ, this is a new dataset version, and the user decides when to retrain.
  - Done when: a rebuild of `laya_v2` gives identical hashes; the ported tests pass.
  - Feature check: label 5 cards with the fake teacher and one live teacher (with the user's permission).
    Features: F-131 to F-135, F-137.
  - Done-when result (2026-11-07): `laya_v2` rebuilt by the moved code equals a rebuild by the old code made the same
    day, 27 of 27 files byte-identical (manifest apart from its date). Against the folder stored on 2026-10-27, 11 files
    differ, the same for the old code: the 16 passages regrouped by commit `4147cb7` (and the synth rows and verse flags
    that follow from them), and the stored `v1_passages`, whose instructions lack their backticked field names (that
    file was not written by this code). `server/tests/laya/`: 74 pass (62 ported, 12 new).
  - Feature check result (2026-11-07): 5 cards of `laya_v3/v3_mixed/test.jsonl` (your labels, seed 22) labelled with
    `python -m wahy.laya label`: the fake teacher (5/5 agree with your label, $0), then Gemini `gemini-3.5-flash-lite` on
    the free tier (one request, 2.8 s, $0, 5/5 agree); both saved in the app's request log as purpose "teacher".
  - Notes: see the 2026-11-07 phase 22 entry under **Changes**.
  - Learn: keeping research code and product code on one path.

### Finish

- [x] **23. Acceptance**: Opus 5.5, high.
  - Walk every kept `F-xxx` in `features.md` in the new app using its `check:` line, and tick it. Fix small gaps; list
    the big ones for the user with a proposed phase.
  - Done when: every kept feature is ticked, or listed with the user's agreement.
  - Feature check: all of `features.md`.
    Features: every F- and N- ID marked keep, merge or replaced, or marked to be in the rewrite.
  - Done-when result (2026-11-07): 134 of 137 features and N-007, N-009, N-020 ticked, each with an `accepted` line in
    `features.md` (new `web/e2e/acceptance.spec.ts`, 23 tests, plus a live walk on this machine's GPU with no paid
    call). Listed with the user's agreement, not ticked: F-127 and F-130 (phase 24's work; F-130's check also needs a
    Colab session) and F-134 (no retraining: the app keeps r6 `v3_mixed`). `scripts/test.sh` all green.
  - Notes: see the 2026-11-07 phase 23 entry under **Changes**.

- [x] **24. Retire the old app**: Sonnet 5.5, medium. Only after the user says so.
  - Delete `backend/`, `js/`, `css/`, `index.html`, `run.bat`, and replace `run.sh` with the new launcher. Rewrite
    `README.md` with new screenshots. Move outdated docs to `docs/archive/`.
  - Done when: `scripts/test.sh` is green with only the new suites.
  - Feature check: fresh clone, run `./run.sh`, then the sample lecture end to end (transcribe, detect, verify, export).
    Features: F-127, F-130.
  - Done-when result (2026-11-08): old app deleted; `scripts/test.sh` has only the new suites (server pytest and ruff
    green, engine 133+ tests and typecheck green, web unit tests, typecheck, lint and 40 Playwright tests green; one
    Playwright run timed out a 90 s detection while the machine was loaded and passed on its own).
  - Feature check result: F-127 ticked (fresh clone, `./run.sh`, upload transcribed, sample lecture detected, verified
    with the fake verifier and exported). F-130 not ticked: the Colab notebook is rebuilt, but its check needs a Colab
    GPU session.
  - Notes: see the 2026-11-08 phase 24 entry under **Changes**.

- [ ] **25. Explanation document**: Opus 5.5, high.
  - Write `docs/rewrite/EXPLAINED.md` for the user, built from `LEARNING.md`: the architecture before and after, every
    ADR in plain words, each technology and what it does, things to learn next (mapped to NestJS and Flutter where it
    helps), and a short "how it was made" section (phases, tests, prompts).

## Changes

Each entry: date, what changed, the user's words.

- **2026-11-03**: This roadmap replaces the morning version. Earlier decisions were treated as input, not as fixed:
  the architecture was re-derived from a friction review and recorded as ADRs 0001-0008.
  User: "i still agree on the big rewrite, but no testing along the way is only about me not claude, ofc claude will
  be testing along the way, and also claude would plan different sessions and work part by part naturally" and "this
  also helps me track the progress and learn along the way, im a cs student so make this a learning opportunity".
- **2026-11-03**: All work happens on branch `factory-reset`, created from `main` after PR #2 merged
  `laya-experiments`. User: "create a branch that we'll work on from now on and name it something like factory-reset".
- **2026-11-03**: The exhaustive feature checklist is phase 1. User: "yes do it".
- **2026-11-03**: Phase 1's walkthrough was shortened: areas A and B were walked one at a time, then every feature
  and proposed new feature was marked as suggested. User: "look, i'll just agree with all every time, and i'll change
  later if i needed to".
- **2026-11-03**: Phase 2's safety export is dropped: the old app holds no saved lectures or training bank, so
  `data/legacy/` stays empty, and phase 20's legacy import has nothing to import. Real test lectures come from a
  Jumuah khutba by sheikh Mohammed Meziane. User: "i don't have any so just move on, if you ever needed one for tesing
  just go fetch some jumuaa lecture by sheikh mohammed meziane".
- **2026-11-04**: Phase 3 copied the Tafrigh runs to `data/tafrigh_runs/` and untracked `runs/` and `backend/runs/`
  (originals stay on disk, because the old app reads them). The new dev server uses port 8120 (8100 is taken here).
- **2026-11-06**: Before a demo, the old app on `main` got a fix: local faster-whisper crashed on PyAV 19, and
  `run.sh` now loads `.env` (Groq key). Cherry-picked here; phase 7 notes the PyAV pitfall. User: "push the change,
  then go to the refactoring branch and make that change too if it was needed there".
- **2026-11-06**: Sessions now commit and push without asking: the previous phase's leftovers at the start, the new
  phase at the end. User: "before you start push with the commit step 6 done (something like that) and when you finish
  push with step 7 done (or whatever you made done) and make this remembered for future sessions".
- **2026-11-06**: Phase 7 (done): a YouTube link or an upload starts at `POST /api/transcriptions/youtube|upload`, not
  at `/api/lectures`, so `lectures` never imports `transcription`. The fallback chain is simpler than the old one: any
  failure moves to the next model (the old code fell back from local turbo only on out-of-memory). The Groq SDK is
  dropped (plain HTTP with retries), `numpy` is a core dependency, and `faster-whisper` plus the NVIDIA cuBLAS and cuDNN
  wheels are the optional `local-asr` extra (`uv sync --extra local-asr`). The specialized Whisper was not run live
  (no torch in `server/`). Test files may have long lines (ruff E501 off for `tests/*`).
- **2026-11-06**: Phase 8 (done): hadith sources keep the old app's files in `data/corpora/` (prepared file
  `hadith_<source>.json`, cached zip in `downloads/`); choosing a source restarts the engine worker with `--hadiths`
  (`EngineClient.use_hadiths`). Adhkar and custom quotes are tables (migration `0003`) sent to the
  engine with each detect call. Adhkar are NOT built-in (corrected 2026-11-06, user decision): the 18 are only the
  initial rows, seeded once (remembered by the settings key `corpora.adhkar_seeded`), and the user can edit or delete
  ANY row; an edited or deleted row is never restored at start-up, and deleting all of them does not bring them back.
  The global adhkar switch stays.
  Detection does not start by itself after a paste or a transcription: the web app calls `POST /api/lectures/{id}/detect`
  (phase 11). Re-detecting saves the replaced findings as a lecture version.
- **2026-11-06**: Phase 9 (done): the mockups in `docs/rewrite/mockups/screens.html` (published at
  https://claude.ai/artifact/QLhgNejsyQDbFexdv8nujm) are approved as is, and the tokens are in `web/src/shell/tokens.css`.
  The draft was committed before approval because a headless session cannot wait for an answer. User: "it's good go on".
- **2026-11-06**: Phase 10 (done): the settings screen needed two small server routes that no earlier phase had, so
  they were added inside phase 10: `GET /api/health` now lists keys, GPU, engine, corpus and running jobs (F-128), and
  `PUT /api/settings/keys/{provider}` saves a key to `.env` (F-010). The web app's types come from
  `web/src/api/openapi.json` (`npm run api:generate`), and `scripts/test.sh` now also runs the Playwright smoke test.
  The rail has no "open lecture" place and no count badges yet: they arrive with the screens that own them (phases
  11 and 12 onward).
- **2026-11-06**: Phase 12 (done): the caption builder moved into `engine/src/captions.ts` (golden SRT identical), so
  the web preview and phase 16's export share it; the web app imports it as `@wahy/engine/captions`. Two small server
  additions the view needed: each finding carries its newest verdict (`GET .../findings`), and
  `PATCH /api/lectures/{id}/words/{idx}` corrects one word in place (F-041; phase 16 moves it into the edit log so it
  can be undone). "Standard script" (F-038) is a view setting for now; phase 16 decides how it reaches the exports.
  Versions: a saved version opens read only; switching back to it as the current findings is not built. The other
  lecture tabs (edit, verify, Tafrigh, export) are placeholders until their phases. The 2-hour check is
  `WAHY_E2E_PERF=1 npx playwright test e2e/perf-long-lecture.spec.ts`, not part of `scripts/test.sh`.
- **2026-11-06**: Phase 13 (done; the live Feature check ran on the user's go-ahead: "go do whatever you want, and
  then launch the next phases as usual"): `core/ai/` is built. Groq's
  HTTP call moved from `features/transcription/backends.py` to `core/ai/groq.py` (the transcription backend keeps the
  audio chunking). Every attempt is logged, failed ones (429s, dropped connections) included. JEV uses `JEV_API_KEY`
  if set, else the OpenRouter key. The old app's boundary clean-up (`normalizeBoundaryVerdict`) runs in `core/ai` for
  every provider. Prompt presets and rules (F-086) are left to phase 14: `core/ai` takes a system prompt, temperature
  and "thinking off" as options. The recorded-response fixtures (`server/tests/fixtures/ai/`) are written in each
  provider's documented reply shape (no real replies were saved before). The live run's real replies are added
  as `real_*.json` beside them, with their own replay tests; they did not replace the hand-written ones, because the
  tests assert the hand-written cases (a 2-item batch, a boundary answer, fenced JSON) and 8 failed with the swap. Small additions the features needed: `GET /api/settings/ai/openrouter/models`,
  `GET /api/settings/ai/gemini/models`, `GET /api/settings/laya`, `POST /api/settings/laya/load|unload`. New optional
  extra `laya` (laya, torch 2.14.1+cu126 from PyTorch's CUDA 12.6 index, huggingface-hub); to fit it with
  `local-asr`, that extra's cuBLAS pin went from `>=12.9.3.13` to `>=12.6` (faster-whisper checked on CUDA after the
  change). The server venv now has both extras: `uv sync --extra local-asr --extra laya`.
- **2026-11-06**: Phase 14 (done): `features/verification` and `features/telemetry` are built. Choices made inside the
  phase: a Laya checkpoint reads the envelope version its config names, so a v1 checkpoint now gets v1 envelopes (the
  old app sent v3 to v1 checkpoints, against ADR 0003). Verdicts save the boundary as `COMPLETE | MISSING_START |
  MISSING_END | MISSING_BOTH | EXTRA_*` (a model's `COMPLETE_SPAN` is saved as `COMPLETE`, which the web view already
  reads; `MISSING_BOTH` is new to it, phase 15). Migration `0004` adds `verdicts.confidence` and `verdicts.details`
  (probabilities, boundary source, passage, merge suggestion) and `ai_requests.finding_ids`, so the request log can
  name the findings of a failed request too. "Expand" (the old editor's auto-heal) moved into the engine as
  `engine/src/expand.ts` (worker command `expand`). It now says when no word matched instead of marking the boundary
  complete anyway, and it saves a `human` verdict with a complete boundary; undoing it belongs to phase 16's edit log.
  The user's verdict and "approve all" save gold labels (`labels`, source `user`, one per finding, updated in place),
  whose card holds the finding and its v1 envelope for phase 20's export. A pass does not save a lecture version:
  every pass adds verdict rows, and the newest one is shown. One pass at a time per lecture (409). F-085's "one
  request with all questions" is how every request already works: verdict, boundary and merge go in one request.
- **2026-11-06**: Phase 16 (done). Choices made inside the phase:
  - The export formats and the old editor's finding edits moved into the engine package (`engine/src/export.ts`,
    `engine/src/edit.ts`; worker commands `export`, `captions`, `edit`; `units` also returns a hadith's whole text), so
    the server and the web app (phase 17, `@wahy/engine/export`) write the same files.
  - Undo only, newest first (no redo). Every edit is a row in `edit_ops` holding only what it replaced; a deleted
    finding is marked `deleted` (migration `0005`), so undo brings it back with its verdicts and label. A new detection
    starts the log and the caption edits again.
  - `PATCH /api/lectures/{id}/words/{idx}` moved into `features/editing` (same path and answer) and is logged; one fixed
    word keeps the findings and does not re-scan. Rewriting words or saving the full text re-scans the edited span
    (3 words around it) and adds new findings there, as the old editor did; a quote that only partly overlapped a span
    whose word count changed is removed, a quote around the edit is kept and moved. Expand (phase 14) also moved into
    `features/editing` (same route), so it can be undone.
  - Caption edits (split, merge, new times) are stored per lecture, anchored on words, and applied after the captions
    are built; only speech captions can be split or merged (quotes are locked units, 409).
  - The export style (`GET/PATCH /api/export/style`) keeps the old preference names. As in the old app (and the golden
    alt-style files), the exports always write references: the "show source" switches are saved for the screen only.
    "Standard script" (F-038) reaches the exports as `?script=standard`; the verdict and kind filters as `?show=` and
    `?kind=`. The HTML export is built from the captions, not the page; print / PDF stays in the web app (phase 17).
  - Commentary gaps: the split applies to findings that have gaps. A hadith with a verse inside it but no gap is
    written as the old app wrote it (the roadmap allows only the gap split to differ from the golden files); the
    engines set `embeddedQuran` only on one-part findings, so the verse's own brackets show after a "commentary" merge.
    Open point for the user: bracket such verses in gapless hadiths too? (Answered: yes, see the next-but-one entry.)
  - An outside-corpus quote is not added to the adhkar or custom-quote lists here (the old "save as dhikr" belongs to
    the adhkar editor).
- **2026-11-06**: Phase 17 (done). Choices made inside the phase:
  - Small server additions the screens needed: `GET /api/corpus/suggest` (the old studio's ranking of the closest
    references, `updateFnStudioSuggestions`, moved into `engine/src/search.ts` as `suggest`, worker command `suggest`),
    `GET /api/corpus/units` (a reference's words, a hadith's whole text with its matn bounds), `GET
    /api/lectures/{id}/edits/captions` (the caption edits, so the view's caption preview applies them too), the
    `flag_reference` finding edit (N-007, kept on the finding as `referenceWrong` for phase 20's gold labels), and
    `confidence` and `details` on each finding's newest verdict (the inspector's confidence and merge suggestion).
  - The export "dialog" is the lecture's export tab, as in the approved mockup. Downloads come from the server's export
    routes; print / PDF opens the HTML export and the browser's print dialog.
  - The view tab now draws the saved brackets, the commentary-gap split (phase 16) and the screen-only "show source"
    switches, honours a finding's own "source text" switch, and builds its captions with the caption edits
    (`@wahy/engine/export` `lectureCaptions`). The dhikr brackets in the view changed from « » to the style's 〖 〗.
  - The word board shows the spoken words (it is for picking words); standard script (F-038) applies in the view, the
    caption timing table and the exports. "Save as a dhikr" from a selection also marks those words with it (as the old
    app did); from an existing quote it only adds it to the adhkar list.
  - "Verify this quote" (F-066) opens the verify tab with that finding picked; a direct jump to its request-log entry
    is not built (the log filters by lecture, pass, provider and status, not by finding). Open point for the user.
  - `web/tsconfig.json` allows `.ts` import paths (the engine's `export.ts` imports `./captions.ts`).
- **2026-11-06**: Correction to phase 16 (phase 16 stays ticked): a hadith with a Quran verse inside it
  (`embeddedQuran`) and no commentary gap now also writes the verse in its own `﴿…﴾` inside the hadith's brackets,
  as the gap case already did, with the commentary split on or off. One switch reverts it:
  `BRACKET_EMBEDDED_QURAN` in `engine/src/captions.ts` (the rule `bracketsEmbeddedVerses` is used by the captions, the
  text exports and the web transcript). Not in standard script or a snapped finding (the source text has no verse
  marks). The golden files are not regenerated: with the split off, exports equal the old app's files except the one
  golden finding with an embedded verse (Muslim 6889, `yt_iG2F8nymm1A` v3, in its SRT, VTT, ASS, Markdown and text
  files), listed by hand in `engine/src/golden-differences.ts` and asserted. The web transcript did not draw embedded
  verses at all before (not even in the gap case); it now does, through the same rule. User: "i think i want them
  bracketed, if i didn't like it i'll change it back".
- **2026-11-07**: Phase 18 (done): `backend/tafrigh/` was *copied* to `server/wahy/features/tafrigh/` (the old app keeps
  using the original until phase 24). Adapters call `core/ai`; a run is a job (`kind: tafrigh`, not resumable) and a
  folder in `data/tafrigh_runs/<run_id>/` that review actions rewrite, so they survive a restart. Left out on purpose:
  `master_verification.py` (F-123: the matrix script goes; "no run changes the original words" is now a test). Carried
  across with their tests for phase 20 to decide: `training_store.py`, `exporters.py`, `pilot_tools.py`. Saving
  sentences as Laya training examples (F-120) is phase 20: `laya_export.py` is ported but has no endpoint yet.
  Re-detecting with a chosen engine before a run (F-109) is the existing detection job, started by the web app
  (phase 19). The default processing mode is `windowed` (size 15), as the previous Tafrigh cost measurements
  recommended. The OpenRouter key in `.env` is expired.
- **2026-11-07**: Phase 19 (done): the lecture's Tafrigh tab (`web/src/features/tafrigh/`). Choices made inside the
  phase: (1) **F-120** (save a run for Laya) has no screen here: it needs the training tables and the endpoint of phase
  20, which already lists F-120; nothing is dropped, it moves with its server half. (2) F-109's "re-detect with a chosen
  engine" is a button that starts the existing detection job (`POST /api/lectures/{id}/detect {engine}`) after a second
  click, because it replaces the lecture's current quotes. (3) For JEV and Laya the Gemini model and route fields are
  shown as the *helper model* (splits and typo fixes). (4) The run settings are remembered in this browser
  (`wahy.tafrigh.settings`), like the old app; the runs and every review action are on the server. (5) The offline
  Playwright test gets its saved run from `scripts/seed_tafrigh_run.py`, which runs the real Tafrigh service on a
  throw-away app with the server tests' fake model; no server code was added for it. (6) *Max words* never cuts a
  verse (the segmenter protects atomic Quran ranges): with the quotes as found a long verse stays one sentence, and the
  preview counts it as "over the limit". Typo strategy offers the three choices of F-112 (when suspicious, always,
  never); the server's fourth value (`asr_confidence_gated`) has no button.
- **2026-11-07**: Phase 20 (done). Choices made inside the phase:
  - The legacy import reads what the old app exported: its Laya JSONL file (the bank had no other export), as a file
    upload or every `.jsonl` / `.json` in `data/legacy/`; it also reads a Tafrigh "save run" file. A row already
    imported (same id) is replaced. Nothing was imported from `data/` (no legacy files exist), and the old Tafrigh
    decision log `data/training_store/canonical_decisions.jsonl` (39 records, another schema) is left as it is.
  - The old app's row converter moved into the engine (`engine/src/training.ts`, worker command `laya_jsonl`), so
    numbers are written by `JSON.stringify` as before (Python writes `5e-05` where JavaScript writes `0.00005`).
  - Migration `0006`: labels get `task` (verification, tafrigh_structure, tafrigh_split) and a unique `key`
    (`legacy:<row id>`, `tafrigh:<run>:<task>:<sentence>`); `verdict` may be empty (a Tafrigh example). Tafrigh
    examples (F-120) are label rows, no longer files in `data/training_store/tafrigh_runs/`; "Export Tafrigh examples"
    writes the old "save run" lines.
  - A missed quote added by hand saves a gold label (correct, complete; as in the approved mockup's "missed quote"
    counter); undo removes it with the quote. Every user label records how it was given (`SET`, `VALIDATE_ALL`,
    `ORDINARY_SPEECH`, `MISSED_QUOTE`).
  - As in the old bank, a verifier's newest verdict on a live finding is a (non-gold) training row until the user
    labels that finding; then the user's row replaces it and keeps the verifier's verdict as "model said". Row ids are
    `wahy_dec_<time>_<label id>` and `wahy_verdict_<verdict id>` (the old ids were random, or a request id shared by a
    whole batch, so rows overwrote each other). An approve-all row carries the old `human_gold_resolution` key.
  - N-007: the "reference wrong" flag is read from the finding when the row is written, so undoing the flag changes
    the row; it is written as `meta.ref_issue: true` only when set (so other rows stay byte-equal to the old app's).
    A flag on a finding without a label makes no row.
  - Clear (F-103) deletes every label and hides the verifiers' verdicts given before it (settings key
    `training.cleared_at`); the verdicts, including the user's own, stay on their lectures.
  - Open point for the user: a user boundary `EXTRA_START` / `EXTRA_END` is written to the Laya row as it is, though
    the v1 boundary question only offers the four `COMPLETE_SPAN` / `MISSING_*` choices.
  - Phase 18 left `training_store.py`, `exporters.py` and `pilot_tools.py` in `features/tafrigh/` for this phase to
    decide: kept as they are, not wired to any route. The training rows now live in the labels table, so the first two
    are superseded (deleting them is the user's call); `pilot_tools.py` is research tooling for phase 22.
  - No rail count badge for the training screen yet (F-001's badges are not in this phase's feature list).
- **2026-11-07**: Phase 21 done as written. Two facts for the user: only engine v3 detects adhkar (v4/v5, the default,
  find none), so the adhkar tab says which engine finds them and the Feature check runs on v3; and the engine choice
  in the lecture toolbar (second copy of F-011) was left to the lecture view. No change of scope.
- **2026-11-07**: Phase 22 (done). Choices made inside the phase:
  - The research side is `server/wahy/laya/` (package `wahy.laya`), not `server/laya/`: a top-level package named `laya`
    would hide the installed `laya` library that local Laya imports. ARCHITECTURE.md says so. `backend/laya_datagen/`
    and its tests were removed (moved); the old app never used them.
  - Teachers are adapters over `core/ai` (fake, gemini, jev, openrouter, laya) and keep their answer cache. The request
    differs a little from the old datagen's (the app's batch instruction, reply schema and boundary clean-up), so new
    answers are cached as prompt version `v2`; the 1,335 old `v1` answers stay readable and are never mixed with them.
    The guided labelling (agent_eval) and `teacher_eval` JEV and chat calls also go through core/ai; `core/ai`'s chat
    options gained `top_logprobs` for `teacher_eval chat`. `teacher_eval laya` still scores a checkpoint with the laya
    package in batches, as `kaggle/eval_laya.py` does: that is scoring a checkpoint, not asking a teacher. The datagen's
    ASR uses `features/transcription` (Groq through core/ai, local Whisper through the GPU owner); every lecture so far is
    in the ASR cache, so nothing was re-transcribed.
  - Teacher requests go to the app's request log (`data/wahy.db`, purpose "teacher").
  - Dataset builders (laya_v1, laya_v2, laya_v3) refuse to write over an existing folder unless asked (`--force`);
    `laya_dataset.ipynb` now writes `laya_v1_rebuild` unless `REBUILD_IN_PLACE = True`.
  - New dataset version **`laya_v3`** (`data/laya_datagen/datasets/laya_v3/`): run 6's two variants, `v3_single` and
    `v3_mixed`, with every row the engine's own envelope 3 (the app's builder), the same labels, split and gold as
    laya_v2, and the three envelope questions kept (verdict-only training picks the verdict items). `skew-run6` against
    the rows run 6 trained on: the verdict question differs on all rows, the state on 2,019 (hadith and adhkar:
    `quran_neighboring_context` null in run 6, absent in the app), and 16 passages are grouped differently. Not zipped
    nor uploaded; no training was started: when to retrain is the user's decision (QUESTION in the phase 22 report).
  - `notebooks/kaggle/laya_v3_kaggle.ipynb` is run 6's recipe reading `laya_v3` as it is (no `to_v3_state`); the run-6
    notebooks are left as the record of run 6. The Kaggle scripts (`train_ddp.py`, `eval_laya.py`) did not reshape
    rows (they only choose questions, as the app does) and are unchanged, so laya_v2's copies stay identical.
  - The datagen notebooks import `wahy.laya` and run in a new kernel "Wahy server (server/.venv)" (`wahy-server`);
    the server has a new extra `research` (beautifulsoup4, pandas, tqdm, ipykernel, ipywidgets, matplotlib), and the
    dev group gained beautifulsoup4, pandas and tqdm for the tests. The moved code keeps its old style (per-folder ruff
    ignores, as Tafrigh in phase 18).
  - Two lint errors left by phase 21 (`features/corpora/schemas.py` UP037, `features/corpora/router.py` E501) were fixed
    so `scripts/test.sh` passes ruff.
  - Comments in `engine/src/` still name `backend/laya_datagen`: editing an engine file changes the engine fingerprint
    and so every datagen cache key (a full re-detection), so they were left for a phase that changes the engine anyway.
- **2026-11-07**: Phase 23 (draft). Small gaps fixed inside the phase (no scope change):
  - F-001: the rail's count badges (open lecture: its quotes; sources: the adhkar; training: the rows; request log: the
    requests), as in the approved mockup, read from the screens' own query keys (`web/src/shell/badges.ts`).
  - F-044 (and F-028's "re-run with v4"): "Detect the quotes again (engine)" in the lecture header, with the engine
    chosen in Settings (user-agreed: no second engine picker in the lecture toolbar) and a second click to confirm;
    the server keeps the replaced quotes as a lecture version, as before.
  - F-012: the Qira'ah setting is the old app's four choices (automatic, Hafs, Warsh, Qalun), not a free-text field.
  - N-009: the finished transcription card lists the server's transcript-quality warnings.
  - F-112: a server test that "typos off" applies no fix. `web/e2e/live-youtube.spec.ts` pointed at a test id that no
    longer exists (`findings`); it now checks the transcript's reference tags.
  - Gaps the user already agreed to, not built: adhkar detection on engines v4/v5 (only v3 detects adhkar), custom
    corpus URLs (F-015; the per-source upload replaces them), the second engine choice in the lecture toolbar (F-011).
    Already recorded as not built: making a saved lecture version current again (F-028), a direct jump from "Verify
    this quote" to its request-log entry (F-066).
  - No big gap was found. The phase was committed as a draft (`f4a9836`) with a QUESTION about three items, then
    ticked after the answer (option a):
    - F-134 (Kaggle training) is listed as not ticked with the user's agreement. User: "we're not retraining laya
      anytime soon just keep using the version i used last". The check that could be made without training (the
      `laya_v3` notebook reads the rows as they are) stays recorded.
    - F-127 (one-command launch) and F-130 (Colab runner) are listed as not ticked, handled by phase 24 (F-130 also
      needs a Colab GPU session only the user can run). Decided on the user's behalf by the orchestrator while they
      are away; the user can overrule it when back.
- **2026-11-08**: Task 24b, "Colab runner" (extra task after phase 24, not phase 25). The corpus is now a **public**
  release asset of this repo (`corpus-v1`, sha256 `ffe22b80...b69f67`, 90,256,830 bytes); the Wahy-Finder repo stays
  private and untouched. `run.sh` downloads it through `scripts/fetch_corpus.sh`: the release URL first, then the old
  `gh` and `GITHUB_TOKEN` fallbacks for the private repo, and every download is checked against the sha256 before it is
  kept. `run.sh` also needs node 22.18+ (the engine worker is TypeScript that node runs directly; the old notebook
  installed Node 20, which cannot run it) and skips `npm ci` when `web/dist` is up to date. F-130: the notebook is
  rebuilt as one Run-all flow (options + Google Drive, parallel install, run), data kept on the user's Drive by
  default, a backup zip when Drive is off, and an access token (`WAHY_ACCESS_TOKEN`, `core/access.py`) on the public
  link. See `docs/rewrite/LEARNING.md` and `features.md` F-130 for what is verified and what needs a Colab session.
- **2026-11-08**: Phase 24 (done, F-130 open): the old app (`backend/`, `js/`, `css/`, `index.html`, `run.bat`,
  `pytest.ini`) is deleted, as the user approved ("go for phase 24, it should be safe since i pushed everything to
  github already"). `server/wahy/main.py` now serves `web/dist`, so `./run.sh` is one process on port 8000.
  The corpus (`data/corpus.json`, 90 MB) was then only in the private Wahy-Finder repo, so `run.sh` fell back to
  `gh api` or `GITHUB_TOKEN`; since task 24b it is a public release asset of this repo (see the 24b entry above), so a
  plain download works on a fresh clone. `docs/HANDOFF.md` and `docs/plans/` moved to
  `docs/archive/`; the README has new screenshots (`web/scripts/screenshots.mjs`). F-130 (Colab) is left for the user.
