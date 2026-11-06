# Orchestrator reports

Every report the orchestrator session gives in chat is copied here, newest first, so nothing is lost by scrolling.
State for recovery (session IDs, what to do if a child died) is in `orchestrator-state.md`, not here.

<!-- NEW REPORTS GO BELOW THIS LINE -->

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
