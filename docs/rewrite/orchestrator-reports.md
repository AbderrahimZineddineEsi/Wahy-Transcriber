# Orchestrator reports

Every report the orchestrator session gives in chat is copied here, newest first, so nothing is lost by scrolling.
State for recovery (session IDs, what to do if a child died) is in `orchestrator-state.md`, not here.

<!-- NEW REPORTS GO BELOW THIS LINE -->

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
