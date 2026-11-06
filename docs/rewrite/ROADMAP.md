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

- [ ] **9. Screen design**: Opus 5.5, high.
  - Build mockups of the main screens as an artifact page the user can click through, in Arabic right-to-left and in
    light and dark, following the design wishes in `features.md`. Iterate until the user approves.
  - Then write the design tokens (colours, type, spacing) to `web/src/shell/tokens.css`. No other app code.
  - Done when: the user has approved the mockups and their words are recorded in `features.md` under Design wishes.
  - Feature check: none.
    Features: F-001, F-030, F-042, F-047, and the Design wishes.
  - Learn: design tokens; right-to-left layout.

- [ ] **10. Web shell**: Sonnet 5.5, high. ADR 0008.
  - Layout and navigation, the theme toggle, i18n by keys (Arabic default and right-to-left, English), and a settings
    screen (API keys saved on the server; health, GPU and key status). Add error toasts, the API client and types
    generated from OpenAPI, the TanStack Query setup, and a Playwright smoke test.
  - Done when: the type check, Vitest and the Playwright smoke test pass.
  - Feature check: the app opens; switching language and theme works; a saved key shows as set in the health status.
    Features: F-001, F-002, F-004 to F-006, F-008, F-010, F-124, F-128.
  - Learn: React components and hooks; how generated API types catch breaking changes.

- [ ] **11. Web: new lecture and saved lectures**: Sonnet 5.5, medium.
  - New lecture (paste, file, YouTube, upload, sample), the saved lectures list, transcription and detection progress.
  - Done when: Vitest and Playwright pass.
  - Feature check (**milestone A**): paste a YouTube link in the new app; the transcript and findings appear.
    Features: F-007, F-016 to F-020, F-023, F-024, F-026, F-027.
  - Learn: forms, server state, progress streams in React.

- [ ] **12. Lecture view**: Opus 5.5, high.
  - Transcript beside the video with word-by-word highlighting in sync, click a word to seek, findings highlighted
    with their reference, the verdict filter, and the live caption preview. It must stay smooth on a 2-hour lecture.
  - Done when: Vitest covers the word-sync logic (time to word) and Playwright covers click-to-seek.
  - Feature check (**milestone B**): open the sample lecture; the highlight follows the video; clicking a word
    mid-lecture jumps the video there.
    Features: F-028 to F-039, F-041, F-042.
  - Learn: refs and effects; rendering thousands of words without lag.

### Verification

- [ ] **13. AI provider layer**: Opus 5.5, high. ADRs 0004, 0006.
  - `core/ai/`: Gemini (free-tier pacer, `Retry-After`, batches of 5 to 10), OpenRouter JEV decisions, OpenRouter chat
    (model catalog with live prices, JSON mode), Groq (moved here from transcription), local Laya (through the GPU
    owner; the envelope version comes from the checkpoint), and a fake. Every call is saved as an AI request with its
    tokens, cost, latency and raw payload.
  - Done when: tests with recorded responses pass for each provider; live tests are marked and only run on request.
  - Feature check: one live call per provider, run only with the user's permission.
    Features: F-080 to F-083, F-094, F-097, F-098.
  - Learn: ports and adapters; rate limiting, retries and backoff.

- [ ] **14. Verification pass and telemetry (server)**: Opus 5.5, high.
  - Estimate (count, tokens, cost, time); a verification pass job with selected findings, scope, pause, resume and
    cancel; verdicts and boundaries saved; expanding a finding with a missing start or end; human override. Telemetry
    routes: the list of requests and one request's payload.
  - Done when: tests with the fake provider pass, and the Laya path sends the golden envelopes for golden findings.
  - Feature check (through the API): a Laya pass on the sample lecture saves verdicts.
    Features: F-065, F-084 to F-089, F-091 to F-093, F-095, F-096, N-020.
  - Learn: orchestrating a job.

- [ ] **15. Web: verification and telemetry**: Sonnet 5.5, high.
  - Verifier settings (provider, model, options), the estimate dialog where quotes can be unticked, progress with
    pause, verdict chips, the expand button, and the request log with its inspector.
  - Done when: Vitest and Playwright pass.
  - Feature check: verify the sample lecture with Laya in the new app; filtering out "ordinary speech" hides those
    findings in the transcript and the captions but keeps their words.
    Features: F-036, F-037, F-066, F-080 to F-091, F-095, F-096.
  - Learn: optimistic updates.

### Editing and export

- [ ] **16. Editing and export (server)**: Opus 5.5, high.
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
  - Learn: the command pattern for undo; LCS alignment.

- [ ] **17. Web: editor and export**: Opus 5.5, high.
  - The word board (add a missed quote with two clicks), the quote inspector, canonical word chips, the reference
    picker with corpus search, the full-text editor, the caption timing editor, undo, and the export dialog.
  - Done when: Vitest and Playwright pass.
  - Feature check: add a missed quote with two clicks; it shows in the transcript and the captions; undo removes it.
    Features: F-038, F-047 to F-071, N-007.
  - Learn: managing complex UI state.

### Tafrigh

- [ ] **18. Tafrigh (server)**: Sonnet 5.5, high.
  - Move `backend/tafrigh/` into `features/tafrigh/` mostly unchanged; its adapters use `core/ai`. It runs as a job
    (modes, typo strategy, the 20-sentence test slice, estimate, pause, stop). Review actions survive a restart.
    Tafrigh runs are saved in `data/tafrigh_runs/` and can be saved, cloned and compared, with outline, render and
    export.
  - Done when: the ported Tafrigh tests pass, including the restart test that fails today.
  - Feature check: run Tafrigh on the sample lecture's test slice, then compare two Tafrigh runs.
    Features: F-106 to F-123.
  - Learn: moving a well-tested package without breaking it.

- [ ] **19. Web: Tafrigh**: Sonnet 5.5, high.
  - Sentence preview, settings, a run with progress, pause and stop, the review queue, saved Tafrigh runs and the
    compare view, the outline view, export.
  - Done when: Vitest and Playwright pass.
  - Feature check: do a Tafrigh run from the new app and review one sentence.
    Features: F-106 to F-122.
  - Learn: long-running UIs.

### Training data and the research side

- [ ] **20. Training data**: Opus 5.5, high. ADRs 0003, 0005.
  - Gold labels from corrections and overrides, saved in the database. A Laya JSONL export that matches the golden
    export for the same records. An import for the legacy export in `data/legacy/`. The training data screen in the
    web app.
  - Done when: importing the legacy bank and exporting it again gives the old app's export.
  - Feature check: correct one verdict in the new app; it appears as a gold label in the export.
    Features: F-064, F-065, F-091, F-100, F-101, F-103, F-104, F-120, N-007.
  - Learn: data lineage (where a training row came from).

- [ ] **21. Corpora screens and status**: Sonnet 5.5, medium.
  - The adhkar editor, Quran and hadith browsing, custom quotes, corpus sources, engine version and profile settings,
    and Laya status (load, unload, envelope version, VRAM).
  - Done when: Vitest and Playwright pass.
  - Feature check: add a dhikr; the next detection finds it in the sample lecture.
    Features: F-011, F-014, F-015, F-046, F-072 to F-079, F-097, F-098.
  - Learn: CRUD screens done once and reused.

- [ ] **22. Datagen on the new core**: Opus 5.5, high. ADRs 0003, 0004.
  - Move `backend/laya_datagen/` to `server/laya/`, so teachers are `core/ai` providers and the engine is `core/engine`.
    Add CLI entry points, and port the tests.
  - The dataset builder stores final envelopes, and the Kaggle scripts and notebooks stop reshaping them. Use the skew
    report from phase 2: if the rows differ, this is a new dataset version, and the user decides when to retrain.
  - Done when: a rebuild of `laya_v2` gives identical hashes; the ported tests pass.
  - Feature check: label 5 cards with the fake teacher and one live teacher (with the user's permission).
    Features: F-131 to F-135, F-137.
  - Learn: keeping research code and product code on one path.

### Finish

- [ ] **23. Acceptance**: Opus 5.5, high.
  - Walk every kept `F-xxx` in `features.md` in the new app using its `check:` line, and tick it. Fix small gaps; list
    the big ones for the user with a proposed phase.
  - Done when: every kept feature is ticked, or listed with the user's agreement.
  - Feature check: all of `features.md`.
    Features: every F- and N- ID marked keep, merge or replaced, or marked to be in the rewrite.

- [ ] **24. Retire the old app**: Sonnet 5.5, medium. Only after the user says so.
  - Delete `backend/`, `js/`, `css/`, `index.html`, `run.bat`, and replace `run.sh` with the new launcher. Rewrite
    `README.md` with new screenshots. Move outdated docs to `docs/archive/`.
  - Done when: `scripts/test.sh` is green with only the new suites.
  - Feature check: fresh clone, run `./run.sh`, then the sample lecture end to end (transcribe, detect, verify, export).
    Features: F-127, F-130.

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
  (`EngineClient.use_hadiths`). Adhkar (18 built-in, seeded) and custom quotes are tables (migration `0003`) sent to the
  engine with each detect call. Built-in adhkar can no longer be edited or deleted (the adhkar switch turns them off).
  Detection does not start by itself after a paste or a transcription: the web app calls `POST /api/lectures/{id}/detect`
  (phase 11). Re-detecting saves the replaced findings as a lecture version.
