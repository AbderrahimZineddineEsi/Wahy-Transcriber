# Orchestrator reports

Every report the orchestrator session gives in chat is copied here, newest first, so nothing is lost by scrolling.
State for recovery (session IDs, what to do if a child died) is in `orchestrator-state.md`, not here.

<!-- NEW REPORTS GO BELOW THIS LINE -->

## 2026-11-06 19:40 — Phase 13 (AI provider layer) done, live check passed; phase 14 started

Gate passed. Commit `6e0e658` "rewrite phase 13: AI provider layer" pushed, phase ticked. Live tests ran with your OK
("go do whatever you want, and then launch the next phases as usual", read as option 1) and the keys already in `.env`; the
OpenRouter key you pasted in chat was not used and is stored nowhere (a repo search finds no copy).

| Provider | Model | Answer | Tokens in+out | Cost | Time |
|---|---|---|---|---|---|
| Gemini | gemini-3.5-flash-lite | CORRECT 0.99, complete | 852+119 | $0 (free tier) | 3.7 s |
| JEV (OpenRouter key) | typesafe/jev-1.14-20261014 | CORRECT 0.80 | 413+43 | $0.000017 | 0.9 s |
| OpenRouter chat | deepseek/deepseek-chat | CORRECT 0.95, complete | 924+104 | $0.00039 | 5.4 s |
| Groq | whisper-large-v3-turbo | 2 s of tone transcribed | n/a | about $0.0001 | n/a |
| Laya (GPU) | laya-wahy-r6-v3_mixed, envelope 3 | CORRECT 0.51 on a sample-lecture finding | n/a | $0 | 4.5 s |

The OpenRouter model search for "deepseek" worked live too. Whole check under $0.001.
- Gemini's test took 30 s overall although its one successful request took 3.7 s; the request log went with the test's
  temporary database, so whether a rate-limit wait happened first is unknown.
- For JEV and Laya, `confidence` is **not** the chosen verdict's probability (JEV 0.70 vs probability 0.80; Laya 0.147 vs
  0.506). Use `probabilities` for "how sure". Phase 14 was told to keep this in mind in the roadmap notes.
- Real replies are in `data/ai_live_replies/` (git-ignored, no key in any file). Swapping them for the hand-written test
  replies broke 8 tests (cases the live calls did not produce), so both are kept: the real ones as `real_*.json` with their
  own tests.
- Tests (`scripts/test.sh`, all passed): old backend 152; new server 217 (+6 live skipped); engine 106; web 59; Playwright 4.
- **Phase 14 (Verification pass and telemetry (server), Opus 5.5, high)** is running as `refactoring-step-14`.

## 2026-11-06 19:10 — Phase 13 (AI provider layer) built as a draft; needs your permission for live calls

Draft pushed as `8eb3f4e` "rewrite phase 13 (draft): AI provider layer". The phase is **not ticked**: its Feature check
(one live call per provider) needs your permission.
- Built in `server/wahy/core/ai/`: one common call for Gemini, JEV, OpenRouter chat, local Laya and a fake. Gemini sends
  5 to 10 findings per request, never exceeds your per-minute limit on the free tier, waits as long as Google asks on a
  429 and stops with a clear message after 5 attempts; the key goes in a header so it never reaches the request log.
  OpenRouter model search shows live prices and context size; JEV gives calibrated probabilities; chat models use JSON mode
  where available, retry once with more room if cut off, and stop at once on a bad key, no credit or unknown model. Groq
  moved here from transcription. Laya runs through the GPU owner and reads its envelope version from the checkpoint
  (v3 for `laya-wahy-r6-v3_mixed`). Every request (failed attempts too) is saved with tokens, cost, latency and raw payload.
- Tests (`scripts/test.sh`, all passed): old backend 152; new server 213 (46 new; 6 live skipped); engine 106; web 59;
  Playwright 4. Includes the `features.md` checks (429 wait then success; 20 requests at 5/min never more than 5 in a
  minute; "deepseek" search lists models with prices; loading Whisper unloads Laya and vice versa).
- **Decisions the child made on its own (recorded under Changes):**
  1. Prompt presets and rules (F-086) are left to phase 14.
  2. The provider responses the tests replay are **hand-written** in each provider's documented format (none had ever been
     saved). The live tests save real ones to `data/ai_live_replies/` and those can replace the hand-written files.
  3. New `laya` install option (laya + torch 2.14.1 for CUDA 12.6). To install it next to local Whisper, **Whisper's cuBLAS
     requirement was lowered from 12.9 to 12.6**. The child checked faster-whisper still runs on the GPU. The server's
     environment now has both.
  4. Extra settings routes: OpenRouter model search, Gemini models for your key, Laya status/load/unload; web API types
     regenerated.

**Needs you: may the child run the 5 live tests?** (`cd server && uv run pytest tests/test_ai_live.py --live -v`, one
tiny request each.) Keys set in `.env`: GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY (no JEV key, so JEV uses the
OpenRouter key). Rough cost: Gemini $0 on the free tier (about $0.001 if billed); JEV about $0.00003; OpenRouter chat
(`deepseek/deepseek-chat`) about $0.0005; Groq (2 s of tone, billed as 10 s) about $0.0001; Laya free but loads the model
on your GPU for about a minute. Total under $0.01.
1. Run all five, then tick phase 13.
2. Run only some (say which).
3. Skip the live check and tick phase 13 as is.

## 2026-11-06 — Stopped: the 5-hour usage limit hit during phase 13 (resets 6:50pm Algiers time)

Not a code failure. The phase 13 child (`refactoring-step-13`, session `43054219-e576-4766-a945-dc8c87c3d9b6`) ran 72 turns and was cut off
by "You've hit your 5-hour limit · resets 6:50pm (Africa/Algiers)". Phases 1 to 12 are done and pushed (last: `01ff976`).
- **Phase 13 is half done and uncommitted** in the working tree: new files in `server/wahy/core/ai/` (gemini, groq,
  openrouter, laya_local, pacer, layer, log, prompts, types, fake, http), recorded fixtures in
  `server/tests/fixtures/ai/`, edits to settings and transcription (Groq moved), and regenerated web API types. Not yet
  tested or ticked.
- **Resumed at 18:50, right after the reset** (you said "continue"). Resume command:
  `claude -p --resume 43054219-e576-4766-a945-dc8c87c3d9b6 "Continue phase 13 from where you stopped..."`; phase 14 follows when it is done.
- Phase 13's Feature check (one live call per provider) needs your permission; the child will ask when it gets there.

## 2026-11-06 — Phase 12 (Lecture view) done, milestone B passed; phase 13 started

Gate passed. Commit `01ff976` "rewrite phase 12: Lecture view" pushed, phase ticked.
- Built: transcript beside the video as in the approved mockup; yellow marker on the spoken word, click-a-word seeks,
  auto-follow, progress bar; quotes coloured by kind with brackets and a reference tag whose card shows verdict, boundary,
  "play the quote", edit, verify; filters (kind, verdict with presets, clipped; hidden quotes stay as plain speech);
  counts, three layouts, "standard script" switch, search, double-click to correct a word (timing kept), live caption,
  "now" card; lecture tabs (only "view" built, the rest say "coming soon"); version picker (read-only view, save,
  rename, delete); an "open lecture" place in the rail.
- Tests: old backend 152; new server 167 (+1 live skipped); engine 106 (incl. 24 new caption golden tests); web Vitest 59
  (34 new); Playwright 4. **Milestone B passed**: highlight follows playback and clicking a word mid-lecture jumps the
  video there.
- 2-hour check (20,160 words, 576 findings, 2 h video; `WAHY_E2E_PERF=1`, not in `scripts/test.sh`): opens in ~2.1 s, plays
  at 60 fps, a click near the end paints in 22 ms. **Weak spot: a filter change takes ~1.7 s** on the dev server (the
  toolbar still answers at once).
- Screenshots compared with the mockup in light, dark and phone width (no sideways scroll), taken with a Playwright
  script because the browser tool is not allowed headless. Your real `data/wahy.db` was not touched.
- **Decisions recorded by the child under Changes (please read):**
  1. The old caption builder now lives in `engine/src/captions.ts` and reproduces the old SRT files exactly (shared by the
     web preview and phase 16 export).
  2. Two small server additions: each finding carries its newest verdict; a new route corrects one word (phase 16 moves
     it into the undo log).
  3. "Standard script" is only a display setting for now; phase 16 decides how it reaches exports.
  4. **Making a saved version the current one again is NOT built** (a reduction of scope the child recorded). Say if you
     want it added in a later correction session.
- **Phase 13 (AI provider layer, Opus 5.5, high)** is running as `refactoring-step-13`.

## 2026-11-06 — Phase 11 (Web: new lecture and saved lectures) done, milestone A passed; phase 12 started

Gate passed. Commit `fb1c192` "rewrite phase 11: Web: new lecture and saved lectures" pushed, phase ticked.
- Built in `web/src/features/lectures/`: new lecture (paste, `.txt/.srt/.vtt` file, YouTube link, upload, sample, title,
  remembered transcription model and fallback switch); running-jobs panel with stages, live percentage, pause, resume and
  cancel; a watcher that starts detection by itself after a transcription finishes (not repeated on reload); saved
  lectures table (search, rename, delete with second click, delete all); a plain lecture page (transcript, findings,
  attach media F-026) that phase 12 replaces; the app reopens the last lecture (F-007).
- Tests: Vitest 25 pass (6 new), typecheck, lint, build clean; Playwright against the real server 2 pass (a real `.srt`
  becomes a lecture, detection finishes, a Fatiha finding shows, rename and delete work). Server Python tests not run
  (no server code changed).
- **Milestone A passed live**: a ~16 min Mohammed Meziane khutba (`Y9n3OjY7Qtg`) went download, audio, Groq
  transcription, detection by itself: 1713 words and 28 findings in 28 s. Test: `web/e2e/live-youtube.spec.ts`, runs only
  with `WAHY_E2E_LIVE=1`.
- Small changes to existing files: `web/playwright.config.ts` now points the test server at the real `data/corpus.json`;
  `web/src/test/render.tsx` keeps non-JSON request bodies as raw text.
- **Phase 12 (Lecture view, Opus 5.5, high)** is running as `refactoring-step-12`.

## 2026-11-06 — Phase 10 (Web shell) done; phase 11 started

Gate passed. Commit `e5d231a` "rewrite phase 10: Web shell" pushed, phase ticked.
- Built: header (server badge, running-jobs pill), rail, Settings screen (API key rows set/not set, status table, language
  and theme switches, both remembered), error toasts with a "Details" report that never contains a request body, API types
  generated from the server's OpenAPI (`npm run api:generate` in `web/`).
- **Server routes added by the child** (needed by the settings screen, recorded under Changes in the roadmap):
  `GET /api/health` now reports keys, GPU, engine, corpus and running jobs; `PUT /api/settings/keys/{provider}` writes the
  key to `.env` and uses it at once. Keys never come back in any answer.
- Tests: server 164 passed, 1 skipped (live), ruff clean; web Vitest 19 passed, typecheck, lint and build clean;
  Playwright smoke test 1 passed (Arabic right-to-left, theme and language kept after reload, saved key shows as set,
  `/api/health` does not contain the key). `scripts/test.sh` now also runs Playwright.
- Feature check passed (app opens, language/theme switch, saved key shown as set); screenshots compared with the mockup.
- Note: the rail has no "open lecture" place and no count badges yet (phases 11 and 12).
- **Phase 11 (Web: new lecture and saved lectures, Sonnet 5.5, medium)** is running as `refactoring-step-11`. Its
  Feature check (milestone A) needs a live YouTube link; if the live run can't happen headless it will ask.

## 2026-11-06 — Phase 9 (Screen design) done; phase 10 started

Gate passed. Commit `004a043` "rewrite phase 9: Screen design" pushed to `origin/factory-reset`, phase ticked.
- Your approval ("it's good go on") is recorded under Design wishes in `features.md` and in the roadmap Changes.
- The adhkar-as-editable-rows change (`60ad135`) is kept in the mockup and `features.md`.
- Web typecheck and lint pass, Vitest 1/1. No Feature check for this phase.
- **Phase 10 (Web shell, Sonnet 5.5, high)** is running as `refactoring-step-10`.

## 2026-11-06 — Mockups published; adhkar correction done; still waiting for your verdict on phase 9

**Needs you: phase 9 verdict.** Mockups are published as a private page: https://claude.ai/artifact/QLhgNejsyQDbFexdv8nujm
(only you can open it until you share it from the page's Share menu). It is the same file as
`docs/rewrite/mockups/screens.html` (ten clickable screens, Arabic right to left, light and dark; the verdicts shown are
made up). Answer with one of:
1. **Approve as is.**
2. **Approve with changes** (say what: layout, colours, fonts, navigation, a specific screen).

**Adhkar correction (`refactoring-step-8b`) is done.** Commit `60ad135` "rewrite phase 8: adhkar are editable rows",
pushed.
- The 18 adhkar are seeded once, tracked by a flag in the `settings` table (`corpora.adhkar_seeded`). Edited or deleted
  rows are never restored, even after deleting all of them. No new migration (`0003` untouched).
- `PUT` and `DELETE /api/corpora/adhkar/{id}` work on every row; the 409 for built-ins is gone. The global adhkar
  switch stays. Detection still reads the current rows from the database on each call.
- Wording fixed in the ROADMAP Changes line, `LEARNING.md` and `features.md` (F-073, F-074, F-077). `screens.html` now
  shows edit and delete on every adhkar row and says "initial list" instead of "built-in". Nothing else in the design.
- Tests: server 155 passed, 1 skipped (live); golden through the API 16/16; `ruff check` passes. `ruff format --check`
  flags 48 files that the child did not touch (not reformatted).
- The child also committed this reports file by mistake (it was untracked); it is now in the repo.

## 2026-11-06 — Phase 9 waits for your verdict; adhkar correction started

**Needs you: phase 9 (Screen design) is not ticked.** Its Done-when step is your approval of the mockups, and a headless
session can't get that.

- Mockups: `docs/rewrite/mockups/screens.html` (ten clickable screens, Arabic right to left, light and dark). Open with
  `xdg-open docs/rewrite/mockups/screens.html`.
- Tokens: `web/src/shell/tokens.css` (nothing imports it until phase 10).
- Committed and pushed as `36b84de` ("rewrite phase 9 (draft): ... waiting for approval").
- The child's checks: every screen opened in headless Chromium (desktop and phone, light and dark), no script errors, no
  sideways scrolling; adding a missed quote took the finding count from 8 to 9 and the header undo named the edit;
  web typecheck, lint and Vitest pass. No Feature check for this phase.

Your answer, one of:
1. **Approve as is.** The child records your words in `features.md`, ticks phase 9, commits "rewrite phase 9: Screen design".
2. **Approve with changes.** Say what to change (layout, colours, fonts, navigation, a specific screen).
3. **Publish it first.** I publish the mockups as a private page on claude.ai so you can view and share them, then you
   give your verdict. Needs your OK.

**Adhkar correction running:** `refactoring-step-8b` (Sonnet 5.5, high). Every adhkar row becomes editable and
deletable; the 18 are seeded once only; the on/off switch stays; roadmap and `LEARNING.md` wording fixed; any
"read-only adhkar" wording in the mockups and `features.md` fixed (nothing else in the design). Commit message:
"rewrite phase 8: adhkar are editable rows".

## 2026-11-06 — Phase 8 (Corpora and detection) done; two scope changes found

Gate passed. Commit `11fbe39` pushed to `origin/factory-reset`, phase ticked.

- Detection through the API matches the golden findings on all 16 combinations (sample plus 3 lectures, each with
  v3, v4, v5, v5:loose).
- Tests: server 153 passed, 1 skipped (live); old backend 152; engine 82; web 1. Ruff, typecheck, lint clean.
- Real-data check: Open Hadith Data loaded with 46,891 hadiths; searching «إنما الأعمال بالنيات» returned `OHD:Bukhari:1`.

Scope changes the child made without asking (recorded under Changes in the roadmap):
1. Built-in adhkar could not be edited or deleted. **You rejected this** (2026-11-06): all adhkar are editable rows, the
   18 are just the initial seed. Fix is the `refactoring-step-8b` session.
2. Detection does not start by itself after a paste or a transcription; the web app calls
   `POST /api/lectures/{id}/detect` (phase 11). **You accepted this.**
