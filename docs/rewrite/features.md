# Feature checklist

The acceptance test for the rewrite (roadmap phase 1, used in phase 23). Every feature of the old app that the user can
see or set is listed once, with an ID that never changes and is never reused.

- **Format.** `- [ ] **F-001 Title.** One sentence.` then `where:` (old code, file:line), `suggest:` (keep / merge /
  remove / replaced, with a reason), `check:` (one action in the new app and the expected result), `user:` (the user's
  mark, in their words). The box is ticked in phase 23, when the `check:` passes in the new app.
- **Marks.** `user: keep` means it must exist after the rewrite. A feature marked remove is still listed, so nobody adds
  it back by accident.
- **Coverage.** `docs/rewrite/features-map.tsv` says which old code lines each ID claims (`G-` IDs are claimed lines that
  are not features). A coverage script lists every UI string, HTML id, event handler, setting and store, route, CLI entry
  point and wish heading, and checks that each falls in some claimed range. Counts are under **Coverage** at the end.
- **Walkthrough (2026-11-03).** Areas A and B were walked one at a time; then the user said: "look, i'll just agree
  with all every time, and i'll change later if i needed to". So every mark is "agree with all" (as suggested), and a
  mark can be changed later by the user.
- **Words** follow `GLOSSARY.md`: a *finding* is what the engine proposes, a *verdict* is a model's answer, a *label* is
  training truth, a *lecture version* is what the old code calls a "run" of a lecture.

## A. App shell

- [ ] **F-001 Workspace navigation.** Six workspaces (input, display, editor, corpora, AI and logs, training data), each
  with a live count badge (findings, adhkar, AI-checked findings, training records).
  - where: `index.html:72-96`, `js/render.js:7` (`switchMainSection`), `js/events.js:623`
  - suggest: merge — keep the badges, but the screens follow the phase 9 design, not the six old tabs.
  - check: open each screen from the navigation; the badges show the same counts as the screens.
  - user: "agree with all" (as suggested)
- [ ] **F-002 Light and dark theme.** A toggle in the header, remembered between visits.
  - where: `index.html:105`, `js/events.js:562` (`applyThemeMode`), `js/events.js:600-610`
  - suggest: keep.
  - check: switch to light, reload; the app opens in light.
  - user: "agree with all" (as suggested)
- [ ] **F-003 Undo.** Every edit pushes a snapshot with a label; the header button undoes the last one and names it.
  - where: `js/state.js:484-524` (`pushUndoSnapshot`, `popUndoSnapshot`), `js/events.js:882`
  - suggest: replaced — by the per-lecture operation log of phase 16, so undo survives a reload.
  - check: add a missed quote, press undo; the quote is gone and a toast names the undone edit.
  - user: "agree with all" (as suggested)
- [ ] **F-004 Server status badge.** The header shows whether the server is connected (with GPU and key status) or the
  app runs in browser-only mode.
  - where: `index.html:66-70`, `js/events.js:512` (`checkBackendHealthStatus`)
  - suggest: merge — into the health status of the settings screen (phase 10); there is no browser-only mode any more.
  - check: stop the server; the web app shows that it cannot reach it.
  - user: "agree with all" (as suggested)
- [ ] **F-005 Toasts.** Short messages after each action, success or error.
  - where: `js/state.js:466` (`showToast`), `index.html:2080-2083`
  - suggest: keep.
  - check: save a setting; a toast confirms it.
  - user: "agree with all" (as suggested)
- [ ] **F-006 Corpus loading strip.** A progress bar under the header while the corpora load at startup.
  - where: `index.html:114-126`, `js/corpus-loader.js:110` (`updateCorpusProgressUI`)
  - suggest: replaced — the server loads the corpus once; the web app shows a status only when it is not ready.
  - check: start the server with no prepared corpus; the app says so and links to the corpus sources.
  - user: "agree with all" (as suggested)
- [ ] **F-007 Resume the last session.** On startup the app reopens the last lecture (text, edits, media) instead of the
  sample, and autosaves while you work.
  - where: `js/state.js:1405-1455` (`scheduleSessionAutosave`, `restoreLatestLectureSession`), `js/events.js:2848-2879`
  - suggest: keep — with data on the server this becomes "open the last lecture".
  - check: edit a lecture, reload the page; the same lecture opens with the edit.
  - user: "agree with all" (as suggested)

## B. Settings and language

- [ ] **F-008 Arabic and English interface.** The UI is Arabic (right to left) or English (left to right); lecture and
  corpus text are never translated.
  - where: `js/i18n.js:1-300`, `js/i18n-en.js`, `index.html:1787-1796`
  - suggest: keep — by keys (ADR 0008), not by translating rendered Arabic text.
  - check: switch to English; menus are English, left to right, the transcript stays Arabic.
  - user: "agree with all" (as suggested)
- [ ] **F-009 AI-generated language packs.** Type a language name; Gemini or OpenRouter translates the English pack;
  packs can be regenerated or deleted.
  - where: `js/i18n.js:302-510`, `index.html:1797-1803`
  - suggest: remove — generated packs drift from the keys and cost a model call; two languages are enough.
  - check: none if removed; otherwise generate French and see French menus.
  - user: "agree with all" (as suggested)
- [ ] **F-010 API keys.** Groq, Gemini and OpenRouter keys are typed in three different screens and kept in the
  browser; on Colab the server pre-fills them from the environment.
  - where: `index.html:231`, `index.html:1232`, `index.html:1285`, `js/events.js:611-622`, `backend/app.py:207` (`/api/env-config`)
  - suggest: merge — one settings screen, keys saved on the server (`.env`), shown only as "set / not set".
  - check: save a Gemini key in settings; the health status shows it as set and the browser never receives it.
  - user: "agree with all" (as suggested)
- [ ] **F-011 Engine choice.** v5 (default), v5:loose, v4 or v3, in settings and in the display toolbar, kept in sync and
  remembered; switching applies to the next detection.
  - where: `index.html:315-322`, `index.html:1839-1844`, `js/events.js:2078-2101`, `js/state.js:713-762`, `js/engine_v5.js:275`
  - suggest: keep — engine and profile become arguments (ADR 0002); which versions stay is decided under **Versions kept**.
  - check: choose v5:loose, re-run detection on the sample lecture; the findings equal the golden v5:loose findings.
  - user: "agree with all" (as suggested)
- [ ] **F-012 Default Qira'ah.** Automatic (Hafs plus the ten Qira'at), Hafs, Warsh or Qalun for detection.
  - where: `index.html:1830-1836`, `js/state.js:698-708`
  - suggest: keep.
  - check: choose Warsh and detect a Warsh reading; it is found.
  - user: "agree with all" (as suggested)
  - note (phase 4): in the old code this setting is read only by engine v3, and there it only relabels a Hafs
    finding's reading (even on a dhikr). v4 and v5 ignore it: they match the Qira'at variants word by word anyway.
    Kept as it is; the check above passes on v5 because of the variants, not because of the setting.
- [ ] **F-013 Engine sensitivity sliders.** Eight raw engine thresholds (island IDF, transcript and verse gaps, verified,
  candidate, uncued hadith, minimum hadith words, uncued Quran coverage); a change re-checks the lecture.
  - where: `index.html:1846-1880`, `js/events.js:805-817`, `js/state.js:698-708` (`rebuildMatcher`), `index.html:1821-1828`
  - suggest: remove — they change findings silently, break the golden tests' meaning and shift what Laya sees; the
    profiles (normal / loose) cover the real need.
  - check: none if removed; the engine settings show the version and the profile only.
  - user: "agree with all" (as suggested)
- [ ] **F-014 Corpus status and reload.** Settings show the indexed counts (Quran, hadith, adhkar) and a button to clear
  the cache and download the corpora again.
  - where: `index.html:1805-1820`, `js/events.js:818-822`, `js/corpus-loader.js:555` (`clearAndRedownloadCorpus`)
  - suggest: replaced — by the corpus sources screen (phase 21).
  - check: the corpus screen shows the counts and can re-prepare a source.
  - user: "agree with all" (as suggested)
- [ ] **F-015 Custom corpus links and local corpus file.** Custom hadith, Uthmani Quran and cloud adhkar URLs, and an
  upload of a local corpus JSON.
  - where: `index.html:1881-1924`, `js/events.js:823-861`, `js/corpus-loader.js:1-110`, `js/corpus-loader.js:330-555`
  - suggest: merge — the URLs go (the server owns the sources); the upload stays as a corpus source upload (F-079).
  - check: upload a corpus file in the corpus screen; detection uses it.
  - user: "agree with all" (as suggested)

## C. New lecture

- [ ] **F-016 Lecture title.** A title field, used in the saved lectures list and in exports.
  - where: `index.html:150-154`, `js/events.js:346`
  - suggest: keep.
  - check: type a title, open the saved lectures; the lecture shows that title.
  - user: "agree with all" (as suggested)
- [ ] **F-017 Paste text or subtitles.** Paste plain text or SRT / VTT content and analyse it.
  - where: `index.html:157-185`, `js/events.js:11` (`switchInputSourceTab`), `js/events.js:471` (`handleTextFastPathExecution`), `js/events.js:725-731`, `js/events.js:927`
  - suggest: keep.
  - check: paste an SRT; the lecture opens with timed words and findings.
  - user: "agree with all" (as suggested)
- [ ] **F-018 Import a text or subtitle file.** Load `.txt`, `.srt` or `.vtt` from disk.
  - where: `index.html:177-180`, `js/events.js:918`
  - suggest: keep.
  - check: import a `.vtt`; the words carry its timings.
  - user: "agree with all" (as suggested)
- [ ] **F-019 YouTube link.** The server downloads the video, extracts the audio and transcribes it with word timings.
  - where: `index.html:187-200`, `js/events.js:401` (`handleBackendTranscribeRequest`), `js/events.js:889`, `backend/app.py:225-382`, `backend/media_processor.py`
  - suggest: keep.
  - check: paste a YouTube link; progress shows and the transcript ends with timed words.
  - user: "agree with all" (as suggested)
- [ ] **F-020 Upload audio or video.** Upload `.mp4`, `.mp3` or `.wav` and transcribe it.
  - where: `index.html:202-211`, `js/events.js:898`
  - suggest: keep.
  - check: upload a short `.mp3`; it is transcribed and plays in the player.
  - user: "agree with all" (as suggested)
- [ ] **F-021 Transcription model.** Groq (whisper-large-v3-turbo), the specialized Arabic Whisper
  (`Abu-Dju/whisper-large-v3-ar`), local Whisper turbo int8 or local Whisper small int8; remembered.
  - where: `index.html:213-238`, `backend/transcriber.py`, `backend/app.py:290-340`
  - suggest: keep.
  - check: pick local small and transcribe; the result says which model was used.
  - user: "agree with all" (as suggested)
- [ ] **F-022 Automatic fallback.** When Groq fails, transcription falls back to local Whisper.
  - where: `index.html:233-236`, `backend/app.py:326-340`
  - suggest: keep.
  - check: use a wrong Groq key with fallback on; the job finishes with local Whisper and says so.
  - user: "agree with all" (as suggested)
- [ ] **F-023 Transcription progress.** Stages (download, extract audio, transcribe, detect) with a percentage.
  - where: `index.html:240-256`, `js/events.js:31-93`, `backend/app.py:218` (`/api/transcribe/progress`), `backend/progress.py`
  - suggest: keep — as a job progress stream (ADR 0007).
  - check: start a YouTube job; each stage lights up in order and reaches 100 %.
  - user: "agree with all" (as suggested)
- [ ] **F-024 Sample lecture.** One click builds a sample lecture from the corpus (verses, hadith, adhkar) and opens it.
  - where: `index.html:143-148`, `js/events.js:932`, `js/state.js:887` (`buildDynamicSampleLectureFromCorpus`)
  - suggest: keep — but a fixed sample (the golden input), so it is the same every time.
  - check: open the sample; it shows the same findings as the golden file.
  - user: "agree with all" (as suggested)
- [ ] **F-025 Media cache.** Downloaded media is cached, so the same link is not downloaded twice.
  - where: `backend/media_processor.py`, `backend/app.py:240-290`
  - suggest: keep — in `data/media/`.
  - check: transcribe the same link twice; the second time skips the download.
  - user: "agree with all" (as suggested)
- [ ] **F-026 Attach local media.** Attach a local video or audio file to the player for a lecture made from text.
  - where: `index.html:735-742`, `js/events.js:910`, `js/events.js:378` (`attachMediaUrlToPlayer`)
  - suggest: keep.
  - check: open a pasted-text lecture, attach its audio; clicking a word seeks the audio.
  - user: "agree with all" (as suggested)

## D. Saved lectures and lecture versions

- [ ] **F-027 Saved lectures.** Every lecture is saved automatically; the list shows date, words and versions, and can
  open, rename, delete, or delete all.
  - where: `index.html:258-266`, `js/events.js:94-180`, `js/events.js:288-345`, `js/state.js:923-1145`, `js/state.js:1253-1290`
  - suggest: keep.
  - check: create two lectures, rename one, delete the other; the list shows exactly the renamed one.
  - user: "agree with all" (as suggested)
- [ ] **F-028 Lecture versions.** Each engine re-run, bulk AI check or manual copy is a version of the lecture: a picker
  opens another version, versions can be renamed, saved as a new version, or deleted (not the last one); a running AI
  check blocks switching.
  - where: `index.html:285-292`, `js/events.js:181-299`, `js/events.js:352-377`, `js/state.js:1290-1404`
  - suggest: keep.
  - check: re-run detection with v4; a new version appears, and opening the old one shows its old findings.
  - user: "agree with all" (as suggested)

## E. Lecture view

- [ ] **F-029 Summary counts.** Words, verses, hadith, adhkar and captions of the open lecture.
  - where: `index.html:274-284`, `js/render.js:89` (`renderKpiSummaryBar`)
  - suggest: keep.
  - check: open the sample; the counts equal the golden findings.
  - user: "agree with all" (as suggested)
- [ ] **F-030 Layout.** Lecture beside the video, lecture only, or video only.
  - where: `index.html:296-303`, `js/events.js:732-738`, `js/render.js:1376` (`setWorkspaceLayoutMode`)
  - suggest: keep — beside the video is the default (design wish).
  - check: switch to lecture only; the player hides and the text takes the width.
  - user: "agree with all" (as suggested)
- [ ] **F-031 Annotated transcript.** The lecture text with each finding highlighted by kind (verse, hadith, dhikr), its
  brackets and its reference.
  - where: `index.html:401-499`, `js/render.js:121-387` (`buildLectureHtmlContent`, `renderFormattedLectureView`), `js/render.js:1677` (`renderAllViews`)
  - suggest: keep.
  - check: open the sample; each finding is highlighted with its reference.
  - user: "agree with all" (as suggested)
- [ ] **F-032 Word sync and click to seek.** The spoken word is highlighted as the media plays; clicking a word jumps
  there; an auto-follow toggle scrolls with it; a reading progress bar.
  - where: `index.html:480-495`, `js/events.js:739-748`, `js/render.js:1312` (`seekToMediaTimestamp`), `js/events.js:2322-2359`
  - suggest: keep — milestone B.
  - check: play the sample; the highlight follows; click a word mid-lecture and the video jumps there.
  - user: "agree with all" (as suggested)
- [ ] **F-033 Finding popover.** Clicking a finding on the display opens a small card: verdict, reference, play the
  quote, edit it.
  - where: `js/render.js:388-491` (`showDisplayFindingPopover`, `openFindingInDisplay`, `openFindingInEditor`)
  - suggest: keep.
  - check: click a hadith; the card shows its reference and "play" plays exactly its words.
  - user: "agree with all" (as suggested)
- [ ] **F-034 Search in the lecture.** A search box highlights matching words.
  - where: `index.html:433-438`, `js/events.js:984`
  - suggest: keep.
  - check: search a word; its occurrences are highlighted.
  - user: "agree with all" (as suggested)
- [ ] **F-035 Kind filter.** Show all findings, verses only, hadith only or adhkar only.
  - where: `index.html:470-479`, `js/events.js:979`
  - suggest: keep.
  - check: choose hadith only; verses are shown as plain text.
  - user: "agree with all" (as suggested)
- [ ] **F-036 Verdict filter.** Show or hide correct, not sure, false and unverified findings, with presets (all,
  correct only, false only); hidden findings keep their words in the transcript and the captions.
  - where: `index.html:440-465`, `js/events.js:2496-2560`, `js/state.js:219-225`
  - suggest: keep — phase 15 checks it.
  - check: hide "false"; those findings become plain words in the transcript and the captions.
  - user: "agree with all" (as suggested)
- [ ] **F-037 Clipped filter.** Show only findings whose verdict says the start or end is missing, with their count.
  - where: `index.html:466-468`, `js/events.js:2561-2571`
  - suggest: keep.
  - check: after a verification pass, turn it on; only findings with a missing start or end remain.
  - user: "agree with all" (as suggested)
- [ ] **F-038 As spoken or standard script.** One switch shows each quote as spoken or as the source text, in the
  display, the editor, the captions and the exports.
  - where: `index.html:296-299`, `js/events.js:2005-2024`, `js/events.js:181-197`, `js/state.js:592-697`
  - suggest: keep.
  - check: switch to standard script; a misheard verse shows the Uthmani text in the transcript and the SRT.
  - user: "agree with all" (as suggested)
- [ ] **F-039 Player with caption overlay.** Video or audio player with the live caption over it, play / pause, back
  and forward 5 seconds, a timeline slider.
  - where: `index.html:732-781`, `js/render.js:1200-1342` (`updateVideoCaptionOverlay`, `syncPlayPauseButtonsUI`), `js/events.js:2322-2359`
  - suggest: keep.
  - check: play the sample; the caption over the video changes with the words and never splits a quote.
  - user: "agree with all" (as suggested)
- [ ] **F-040 Simulated playback.** Without media, "play" advances a fake clock so the highlight still moves.
  - where: `js/render.js:1343` (`toggleSimulatedPlayback`), `js/state.js:84`
  - suggest: remove — without media there is nothing to follow; it confuses the timing.
  - check: none if removed; a text-only lecture shows no play button.
  - user: "agree with all" (as suggested)
- [ ] **F-041 Edit a word in place.** Double-click a word in the display to correct it; its timing is kept.
  - where: `js/render.js:523` (`startInlineWordEdit`), `js/editor.js:1777` (`updateSingleWordInLecture`)
  - suggest: keep.
  - check: double-click a word, fix it, Enter; the word changes and its time is the same.
  - user: "agree with all" (as suggested)
- [ ] **F-042 Quick jumps.** Buttons to go from the display to the editor (at the open quote), back to the input, and
  back to the display.
  - where: `index.html:336-343`, `index.html:772-776`, `index.html:829-833`, `js/events.js:630-643`
  - suggest: merge — into the new navigation (phase 9 design).
  - check: from a finding's card, "edit" opens the editor on that finding.
  - user: "agree with all" (as suggested)

## F. Detection

- [ ] **F-043 Detect after input.** After any input the engine runs, findings are mapped to word times, and captions
  are built.
  - where: `js/state.js:763-886` (`runDetectionAndBuildCaptions`, `recalculateCaptionsFromCurrentFindings`)
  - suggest: keep — as a detect job on the server (phase 8).
  - check: paste the sample text; findings appear without pressing anything else.
  - user: "agree with all" (as suggested)
- [ ] **F-044 Re-run the engine.** Re-detect on the current text without entering it again; the result is a new
  lecture version.
  - where: `index.html:305-333`, `js/events.js:2095-2101`
  - suggest: keep.
  - check: edit a word inside a verse, re-run; the finding updates and the old version is kept.
  - user: "agree with all" (as suggested)
- [ ] **F-045 Hadith corpus choice.** Choose which hadith corpus the engine searches (the Wahy corpus or Open Hadith
  Data with chains of narration); a corpus not prepared yet is refused with a hint.
  - where: `index.html:323-327`, `js/hadith-corpus.js:1-120`, `js/hadith-corpus.js:236-242`
  - suggest: keep.
  - check: choose Open Hadith Data on a prepared server; detection reports hadith from it.
  - user: "agree with all" (as suggested)
- [ ] **F-046 Adhkar detection on or off.** A switch that adds or removes the adhkar list from detection.
  - where: `index.html:1080-1084`, `js/events.js:2102-2108`
  - suggest: keep — but see N-001 (dhikr as a check after detection).
  - check: turn it off and re-run; no dhikr findings remain.
  - user: "agree with all" (as suggested)

## G. Editor

- [ ] **F-047 Editor modes.** Three modes: findings (word board with the FN Studio and the inspector), full text, and
  caption timing.
  - where: `index.html:787-836`, `js/render.js:51` (`switchEditorSubMode`), `js/events.js:644-658`, `js/editor.js:56` (`switchEditorDockTab`)
  - suggest: merge — the modes stay as views of the editor; the layout follows phase 9.
  - check: switch between the three modes; each shows its tool and keeps the same lecture.
  - user: "agree with all" (as suggested)
- [ ] **F-048 Editor mini player.** Play / pause, back and forward 2 seconds and the time, without scrolling.
  - where: `index.html:803-812`, `js/events.js:714-724`
  - suggest: keep.
  - check: in the editor, press back 2 s; the media rewinds 2 seconds.
  - user: "agree with all" (as suggested)
- [ ] **F-049 Video follows selection.** A toggle: selecting a word in the editor moves the video there, or not.
  - where: `index.html:819-824`, `js/events.js:2884-2899`
  - suggest: keep.
  - check: turn it off, click a word; the video does not move.
  - user: "agree with all" (as suggested)
- [ ] **F-050 Full matn view.** Show a quote's full source text (with the chain of narration) instead of only the
  spoken part.
  - where: `index.html:825-828`, `js/events.js:2900-2910`
  - suggest: keep.
  - check: turn it on, open a hadith; its sanad shows dimmed before the matn.
  - user: "agree with all" (as suggested)
- [ ] **F-051 Add a missed quote with two clicks.** Click the first word and the last word (or drag) on the word board,
  with a hover preview, a reset, and editable start and end indices.
  - where: `index.html:840-900`, `js/editor.js:313-428` (`handleFnWordClick`, `handleFnWordHover`, `openFnStudioWithWordRange`), `js/events.js:659-699`, `js/render.js:492` (`renderEditorLectureStage`)
  - suggest: keep.
  - check: click two words of a missed verse; the range is highlighted and the studio proposes the verse.
  - user: "agree with all" (as suggested)
- [ ] **F-052 Find the reference of a missed quote.** Choose the kind (verse, hadith, dhikr), search the corpus, choose a
  Qira'ah, pick from the closest matches, and see the full matn with the matched words highlighted.
  - where: `index.html:901-949`, `js/editor.js:89-312` (`renderFnSelectedUnitPreview`, `updateFnStudioSuggestions`)
  - suggest: keep.
  - check: select a verse's words; the right surah and ayah is first in the list.
  - user: "agree with all" (as suggested)
- [ ] **F-053 Insert the missed quote.** Insert it with the chosen reference, or as an outside-corpus quote with a
  typed source; captions are rebuilt.
  - where: `index.html:950-966`, `js/editor.js:429` (`commitFnQuoteHelper`)
  - suggest: keep.
  - check: insert a missed verse; it shows in the transcript and the captions; undo removes it (phase 17).
  - user: "agree with all" (as suggested)
- [ ] **F-054 Save as a dhikr.** Save the selected words, or an existing finding, as a dhikr in the adhkar list.
  - where: `index.html:960-962`, `js/editor.js:583` (`commitFnDhikrToAdhkarDatabase`), `js/editor.js:862` (`convertFindingToSavedDhikr`)
  - suggest: keep.
  - check: save a phrase as a dhikr; it appears in the adhkar list and is found by the next detection.
  - user: "agree with all" (as suggested)
- [ ] **F-055 Selection toolbar.** Selecting text shows a toolbar: edit the text, open in the FN Studio, mark as verse,
  hadith or dhikr.
  - where: `index.html:1615-1635`, `js/events.js:2025-2052`, `js/editor.js:1126-1203`
  - suggest: keep.
  - check: select three words, press "+ hadith"; the hadith search opens with them.
  - user: "agree with all" (as suggested)
- [ ] **F-056 Edit selected words.** A dialog to rewrite or delete the selected words, keeping the timing of the rest,
  with "listen to this segment".
  - where: `index.html:1637-1659`, `js/events.js:940-961`, `js/editor.js:1806-1856`, `js/editor.js:1719` (`replaceWordRange`)
  - suggest: keep.
  - check: rewrite two words as three; the rest of the lecture keeps its word times.
  - user: "agree with all" (as suggested)
- [ ] **F-057 Quote inspector.** For the selected finding: previous / next, spoken text, approved reference, show in the
  display, play the quote.
  - where: `index.html:972-985`, `js/render.js:581-1048` (`renderFindingInspector`), `js/events.js:700-713`, `js/editor.js:661-696`
  - suggest: keep.
  - check: press next three times; the inspector walks the findings in order and "play" plays each one.
  - user: "agree with all" (as suggested)
- [ ] **F-058 Change a finding's kind.** Turn a finding into a verse, a hadith or a dhikr.
  - where: `js/editor.js:697` (`changeFindingCategory`)
  - suggest: keep.
  - check: change a dhikr finding to hadith; its colour and brackets change.
  - user: "agree with all" (as suggested)
- [ ] **F-059 Move a finding's edges.** Extend or shrink the start and the end by one word.
  - where: `js/editor.js:713` (`adjustFindingWordBoundary`)
  - suggest: keep.
  - check: press "−1 word" on the start; the finding starts one word earlier and the captions follow.
  - user: "agree with all" (as suggested)
- [ ] **F-060 Expand a clipped finding.** When a verdict says the start or end is missing, one click extends the
  finding over the missing source words that were spoken.
  - where: `js/editor.js:742` (`autoHealClippedBoundary`)
  - suggest: keep — see N-013 for the guarded loop.
  - check: on a finding with "missing end", press expand; it ends on the verse's last spoken word.
  - user: "agree with all" (as suggested)
- [ ] **F-061 Matching references.** The finding's candidate references: approve another one, add or remove one, add a
  manual reference, or search the corpus and link (search dialog by kind).
  - where: `js/editor.js:880-964` (`getFindingCandidates`, `addReferenceToFinding`, `linkFindingToCorpusUnit`), `js/editor.js:1204-1393`, `index.html:1925-1963`, `js/events.js:2053-2066`
  - suggest: keep.
  - check: link a finding to another ayah via the search; its reference label changes everywhere.
  - user: "agree with all" (as suggested)
- [ ] **F-062 Canonical word chips.** Pick words from the reference's full text and apply them to the transcript; edits
  are remembered per reference.
  - where: `js/editor.js:1905-1983` (`applyReferenceWordsToTranscript`), `js/editor.js:840` (`toggleSnapFindingToCanonical`)
  - suggest: keep.
  - check: pick the verse's words for a misheard verse; the transcript shows them with the old timings.
  - user: "agree with all" (as suggested)
- [ ] **F-063 Merge with a neighbour.** Suggests merging a finding with the next or previous one when together they fit
  one reference better; the suggestion can be dismissed.
  - where: `js/editor.js:986-1125` (`getFindingMergeOptions`, `mergeFindingWithNeighbor`)
  - suggest: keep.
  - check: two findings of one verse split by a misheard word; merge gives one finding with the verse.
  - user: "agree with all" (as suggested)
- [ ] **F-064 Delete with intent.** Deleting a finding asks why: ordinary speech (saved as a gold negative label), a
  highlighting mistake (not saved), or just testing (not saved).
  - where: `index.html:2004-2038`, `js/editor.js:965` (`deleteFinding`), `js/editor.js:1984-2033`, `js/events.js:2911-2952`
  - suggest: keep.
  - check: delete a finding as "ordinary speech"; a gold label "false" appears in the training data.
  - user: "agree with all" (as suggested)
  - note (phase 2): broken in the old app. `editor.js:2018` calls `WahyAiVerifier.convertRecordToLayaTrainingEnvelope`,
    which `ai-verifier.js` never exports; the error is caught, so no gold label was ever saved.
- [ ] **F-065 Human verdict.** In the inspector, set a finding's verdict to correct, false or not sure; it is saved as a
  gold label and shown as "(gold)".
  - where: `js/ai-verifier.js:2106` (`setHumanOverrideVerdict`), `js/render.js:1031-1045`
  - suggest: keep.
  - check: set a finding to false; the chip shows false (gold) and the export has the label.
  - user: "agree with all" (as suggested)
- [ ] **F-066 Verify one finding.** Run a verification on the selected finding, see its verdict, model and confidence,
  open its request options, or jump to its log entry.
  - where: `js/render.js:1013-1030`
  - suggest: keep.
  - check: verify one finding with the fake provider; its chip updates and the log has one request.
  - user: "agree with all" (as suggested)
- [ ] **F-067 Full text editor.** Edit the whole lecture text; saving re-aligns the words (LCS) so unchanged words keep
  their times, then re-checks findings and captions.
  - where: `index.html:987-1013`, `js/events.js:962-977`, `js/editor.js:1588-1805` (`alignAndRetimeWords`, `applyLectureTextEdits`), `js/editor.js:1857` (`toggleLectureEditMode`)
  - suggest: keep.
  - check: fix three words in the full text; the other words keep their times (phase 16 test).
  - user: "agree with all" (as suggested)
- [ ] **F-068 Caption timing editor.** Each caption with its text and times: edit the text, nudge a time, set a time
  to the playhead, merge with the next, split at the cursor, play from it; quotes are locked units.
  - where: `index.html:1015-1030`, `js/render.js:1049` (`renderCaptionTimeline`), `js/editor.js:1394-1587`
  - suggest: keep.
  - check: split a caption at a word; two captions, the second starting at that word's time.
  - user: "agree with all" (as suggested)

## H. Export

- [ ] **F-069 Export the lecture text.** As an HTML page, print / PDF, Markdown, plain text, or JSON (lecture data,
  findings and captions).
  - where: `index.html:1661-1699`, `js/render.js:1697-1806`, `js/events.js:2360-2371`, `js/events.js:749-772`
  - suggest: keep.
  - check: export Markdown; it matches the golden text export.
  - user: "agree with all" (as suggested)
- [ ] **F-070 Export captions.** SRT, VTT (with colours) and ASS (with fonts and colours); a quote is never split across
  captions.
  - where: `index.html:1701-1718`, `js/caption-builder.js`, `js/events.js:2372-2389`
  - suggest: keep.
  - check: export SRT for the sample; it equals the golden SRT.
  - user: "agree with all" (as suggested)
- [ ] **F-071 Bracket and reference style.** Bracket pairs for verses, hadith and adhkar; show surah and ayah, hadith
  source, dhikr tag; merge consecutive verses under one reference; saved.
  - where: `index.html:1720-1774`, `js/events.js:773-789`, `js/state.js:452-465`, `js/state.js:164-175`
  - suggest: keep.
  - check: change the verse brackets to « »; the transcript and the export use them after a reload.
  - user: "agree with all" (as suggested)

## I. Corpora and adhkar

- [ ] **F-072 Corpora screen.** Tabs for adhkar, outside-corpus quotes, the Quran and the hadith books, each with its
  total.
  - where: `index.html:1032-1070`, `js/events.js:2067-2077`, `js/render.js:1413-1676` (`renderDatasetsSection`)
  - suggest: keep (phase 21).
  - check: open the corpora screen; the four totals match the corpus.
  - user: "agree with all" (as suggested)
- [ ] **F-073 Adhkar list.** Add (at least two words), edit in the table, delete, copy; filter built-in or your own;
  counts of each.
  - where: `index.html:1071-1115`, `js/events.js:2109-2125`, `js/events.js:2243-2321`, `js/state.js:525-562`
  - suggest: keep.
  - check: add a dhikr; the next detection finds it in a lecture that says it.
  - user: "agree with all" (as suggested)
- [ ] **F-074 Adhkar import, export and reset.** Export the list as JSON, import a JSON list, or restore the built-in
  list (removes your additions after a confirm).
  - where: `index.html:1085-1095`, `js/events.js:2181-2242`
  - suggest: keep.
  - check: export, reset, import the export; the list is back as before.
  - user: "agree with all" (as suggested)
- [ ] **F-075 Outside-corpus quotes.** Add, edit and delete hadith or sayings that are not in the corpus, so the engine
  finds them like any other reference (custom quotes).
  - where: `index.html:1116-1131`, `js/events.js:2126-2144`, `js/state.js:563-591`
  - suggest: keep.
  - check: add a saying; the next detection finds it.
  - user: "agree with all" (as suggested)
- [ ] **F-076 Browse the Quran and hadith.** Read-only browsing with search, surah or book filter and pages.
  - where: `index.html:1133-1188`, `js/events.js:2145-2180`
  - suggest: keep.
  - check: filter surah 18, page 2; ayat 26 to 50 of al-Kahf show.
  - user: "agree with all" (as suggested)
- [ ] **F-077 Built-in adhkar.** A seed list of the best-known short adhkar; your additions are kept across updates.
  - where: `js/state.js:39-62`, `js/state.js:256-306`
  - suggest: keep — as seed rows of the adhkar table.
  - check: a new database has the built-in adhkar; adding one and upgrading keeps it.
  - user: "agree with all" (as suggested)
- [ ] **F-078 Corpus cache.** The prepared corpus is cached (browser IndexedDB and a server cache file) so the next
  start is instant.
  - where: `js/corpus-loader.js:43-109`, `js/corpus-loader.js:507-554`, `backend/app.py:422-445`, `js/state.js:73-82`
  - suggest: replaced — the server keeps the corpus in its database and loads it once (ADR 0005).
  - check: restart the server; detection is ready without a download.
  - user: "agree with all" (as suggested)
- [ ] **F-079 Corpus sources.** A list of hadith corpus sources with status (ready, preparing, not downloaded), download
  and prepare, re-prepare, use this one, and a manual upload when the download fails.
  - where: `js/hadith-corpus.js:119-235`, `index.html:1885-1897`, `backend/app.py:383-421`, `backend/corpus_sources.py`
  - suggest: keep (phase 8 and 21).
  - check: prepare Open Hadith Data; its status goes from preparing to ready.
  - user: "agree with all" (as suggested)

## J. Verification

- [ ] **F-080 Verifier choice.** Gemini, OpenRouter JEV, an OpenRouter chat model or local Laya, picked in the
  verification bar or in a provider card (description, price tags).
  - where: `index.html:345-372`, `js/events.js:2393-2403`, `js/ai-verifier.js:686-904`
  - suggest: keep (ADR 0004).
  - check: switch to JEV; the next verification pass uses JEV.
  - user: "agree with all" (as suggested)
- [ ] **F-081 Gemini settings.** Key, model (or a typed one), free-tier pacer with requests per minute, batch size,
  "fetch models available to my key", save.
  - where: `index.html:1219-1270`, `js/events.js:2572-2582`, `js/events.js:2929-2952`, `js/ai-verifier.js:905-1113`, `backend/app.py:576-594` (`/api/tafrigh/models`)
  - suggest: keep.
  - check: set 5 requests per minute; a pass with 20 findings never sends more than 5 a minute.
  - user: "agree with all" (as suggested)
- [ ] **F-082 JEV settings.** OpenRouter key, mode switch (JEV or chat), JEV model; the server proxies the decisions API.
  - where: `index.html:1272-1308`, `js/events.js:2583-2632`, `js/ai-verifier.js:1114-1221`, `backend/app.py:527-557`
  - suggest: keep.
  - check: verify one finding with JEV; it gets calibrated probabilities.
  - user: "agree with all" (as suggested)
- [ ] **F-083 Chat model search.** Search OpenRouter's whole catalog with live prices and context size, category chips
  (all, JEV, Gemini, Chinese, free); the model is checked to exist and to support JSON.
  - where: `index.html:1309-1337`, `js/events.js:2633-2732`, `js/ai-verifier.js:1222-1531`
  - suggest: keep.
  - check: type "deepseek"; the list shows DeepSeek models with prices, and one can be picked.
  - user: "agree with all" (as suggested)
- [ ] **F-084 Choose the findings.** By scope (hadith and suspects, hadith only, all) or by hand with search, kind and
  verdict buttons, select none and invert.
  - where: `index.html:2040-2061`, `js/ai-request-options.js:1-372`, `js/ai-verifier.js:1757-1782`, `js/ai-verifier.js:2284-2298`
  - suggest: keep.
  - check: pick three findings by hand; the pass sends exactly those three.
  - user: "agree with all" (as suggested)
- [ ] **F-085 Model options per pass.** Provider, model, batch size, free-tier mode, temperature, thinking off, group
  consecutive verses into one passage, one request with all questions; Laya checkpoint info.
  - where: `js/ai-request-options.js:373-568`
  - suggest: keep.
  - check: turn on passage grouping; three consecutive verses go out in one request.
  - user: "agree with all" (as suggested)
- [ ] **F-086 Prompt tuning.** Verdict style (balanced, strict, lenient, boundary focus), extra rules, context window,
  reason language and detail, custom instructions with ready-made snippets, the system prompt (load default, reset), a
  preview of what the model will read, copy the full request.
  - where: `js/ai-request-options.js:569-845`, `js/ai-verifier.js:818-904`
  - suggest: keep.
  - check: pick "strict" and open the preview; the system prompt shows the strict rule.
  - user: "agree with all" (as suggested)
- [ ] **F-087 Estimate before a pass.** Findings, tokens, cost and time, updated as options change.
  - where: `index.html:2062-2078`, `js/ai-verifier.js:2299-2411`, `js/ai-request-options.js:120-153`
  - suggest: keep.
  - check: untick half the findings; the estimate halves.
  - user: "agree with all" (as suggested)
- [ ] **F-088 Run a pass.** Start, pause, resume and cancel a verification pass, with progress (findings and requests,
  each with its own total).
  - where: `index.html:373-386`, `js/events.js:2404-2495`, `js/ai-verifier.js:1783-2105`, `index.html:1195-1214`
  - suggest: keep — as a job (phase 14).
  - check: pause half-way, resume; every finding gets exactly one verdict.
  - user: "agree with all" (as suggested)
- [ ] **F-089 Pass metrics.** Engine time, requests, total and average time, tokens, average context, verdict counts and
  cost of the pass.
  - where: `index.html:388-399`, `js/render.js:1811` (`updateAiMetricsUI`), `js/ai-verifier.js:1680-1756`, `js/state.js:228-245`
  - suggest: keep.
  - check: after a pass, the cost equals the sum of the logged requests' costs.
  - user: "agree with all" (as suggested)
- [ ] **F-090 Verdict chips.** Each finding shows its verdict (correct, not sure, false, unverified, checking, error) and
  a boundary notice (missing start, end or both), with a tooltip.
  - where: `js/render.js:121-340`
  - suggest: keep.
  - check: a finding judged "missing start" shows a ✂ badge on its start.
  - user: "agree with all" (as suggested)
- [ ] **F-091 Approve all.** Accept every AI verdict of the lecture at once as gold labels.
  - where: `index.html:360-362`, `js/events.js:2953-2986`
  - suggest: keep — with a confirm, since it writes many gold labels at once.
  - check: approve all after a pass; the training data gains one gold label per verdict.
  - user: "agree with all" (as suggested)
  - note (phase 2): broken in the old app, same missing export as F-064 (`events.js:2968`); the click handler throws
    after marking the first finding, and no gold label is saved.
- [ ] **F-092 Neighbour context for prompted verifiers.** Gemini, JEV and chat models also get the findings around the
  one being judged and can suggest a merge.
  - where: `js/ai-verifier.js:34-276`, `js/ai-verifier.js:631-685`
  - suggest: keep — through the one envelope builder (ADR 0003).
  - check: the request preview of a verse between two verses lists both neighbours.
  - user: "agree with all" (as suggested)
- [ ] **F-093 Laya inputs by checkpoint.** Laya gets envelope v1, v2 or v3 depending on what its checkpoint was trained
  on: passages of consecutive verses, neighbours, and the boundary from the word-overlap rule for verdict-only models.
  - where: `js/ai-verifier.js:277-630`, `js/ai-verifier.js:1532-1679`
  - suggest: keep — byte-identical to the golden envelopes (phases 5 and 14).
  - check: verify the sample with the run-6 checkpoint; the envelopes sent equal the golden v3 envelopes.
  - user: "agree with all" (as suggested)
- [ ] **F-094 Rate limits and retries.** Gemini waits on 429 and `Retry-After`, retries on connection errors, and stops
  with a clear message after too many attempts.
  - where: `js/ai-verifier.js:905-1113`
  - suggest: keep — in `core/ai`.
  - check: with a recorded 429 response, the pass waits and then succeeds.
  - user: "agree with all" (as suggested)

## K. Telemetry

- [ ] **F-095 Request log.** Every AI request: time and provider, the finding, verdict with probabilities and a manual
  correction, context size, latency, cost and details; can be cleared.
  - where: `index.html:1401-1442`, `js/render.js:1922-2052` (`renderAiRequestLogsTable`), `js/events.js:2824-2830`
  - suggest: keep (phase 14 and 15).
  - check: after a pass, the log has one row per request with its cost.
  - user: "agree with all" (as suggested)
- [ ] **F-096 Request inspector.** Open one request's input and output JSON, readable or raw, and copy either.
  - where: `index.html:1965-2002`, `js/render.js:2006` (`openAiPayloadModal`), `js/events.js:2831-2847`
  - suggest: keep.
  - check: open a request; the input is the exact JSON that was sent.
  - user: "agree with all" (as suggested)

## L. Local Laya

- [ ] **F-097 Laya status.** Loaded or not, device, free VRAM, active checkpoint and its envelope version.
  - where: `index.html:1339-1360`, `js/render.js:1876` (`checkAndUpdateLayaBackendStatus`), `backend/app.py:446-454`, `backend/laya_engine.py`
  - suggest: keep (phase 21).
  - check: load Laya; the status shows the device, the VRAM used and envelope 3.
  - user: "agree with all" (as suggested)
- [ ] **F-098 Load and unload Laya.** Choose a checkpoint (or a local folder) and a device (auto, CUDA, CPU), load it,
  unload it to free the GPU.
  - where: `index.html:1361-1395`, `js/events.js:2733-2770`, `backend/app.py:455-479`
  - suggest: keep — through the GPU owner (ADR 0006).
  - check: load Laya, then transcribe with local Whisper; Laya is unloaded first and reloads when needed.
  - user: "agree with all" (as suggested)
- [ ] **F-099 Laya test run.** One button runs a fixed test finding through Laya and shows the verdict and time.
  - where: `index.html:1387-1390`, `js/events.js:2771-2804`, `backend/app.py:480-513` (`/api/laya/predict`)
  - suggest: remove the button — the status (F-097) is enough; the predict route stays for verification.
  - check: none if removed.
  - user: "agree with all" (as suggested)

## M. Training data

- [ ] **F-100 Training bank.** Every verdict and correction is saved in the browser as a training record, with counters
  (total, correct, false, not sure, human, AI).
  - where: `index.html:1444-1500`, `js/state.js:337-430`, `js/render.js:1845` (`renderLayaDatasetBankStats`)
  - suggest: replaced — by gold labels in the database (phase 20); the old bank is imported from `data/legacy/`.
  - check: import the legacy export; the counters equal the old app's.
  - user: "agree with all" (as suggested)
- [ ] **F-101 Export Laya JSONL.** Export the training records as Laya JSONL rows.
  - where: `index.html:1458`, `index.html:1522`, `js/ai-verifier.js:2154-2283`, `js/events.js:2805-2809`, `js/events.js:2998-3003`
  - suggest: keep — equal to the golden export for the same records (phase 20).
  - check: export after importing the legacy bank; the file equals the old app's export.
  - user: "agree with all" (as suggested)
- [ ] **F-102 Training script download.** A button downloads the command line for `finetune_laya.py`.
  - where: `index.html:1462`, `js/events.js:2810-2815`
  - suggest: remove — training happens on Kaggle with `train_ddp.py`.
  - check: none if removed.
  - user: "agree with all" (as suggested)
- [ ] **F-103 Clear training data.** Delete every training record after a confirm.
  - where: `index.html:1466`, `index.html:1526`, `js/events.js:2816-2823`, `js/events.js:3004-3013`
  - suggest: keep — with a confirm; maybe export first.
  - check: clear; the training screen shows zero records.
  - user: "agree with all" (as suggested)
- [ ] **F-104 Training data screen.** Counters (total, correct, false, clipped, segmentation, typo), filters by task and
  label, search, and a table (task, reference, spoken text, AI verdict, gold verdict, date).
  - where: `index.html:1503-1613`, `js/render.js:2806-2925` (`renderTrainingDataHub`), `js/events.js:2987-2997`
  - suggest: keep (phase 20).
  - check: filter "false"; only false labels are listed.
  - user: "agree with all" (as suggested)
- [ ] **F-105 Server-side dataset conversion.** `POST /api/laya/convert-dataset` turns records into JSONL on the server;
  nothing in the UI calls it.
  - where: `backend/app.py:514-526`, `backend/laya_converter.py`
  - suggest: remove — the training export (F-101) covers it.
  - check: none if removed.
  - user: "agree with all" (as suggested)

## N. Tafrigh

- [ ] **F-106 Tafrigh preview.** Before a run: the sentences the transcript splits into, with statistics (count, words,
  shortest, longest, mean and median, duration, why sentences end) and the sentence list.
  - where: `index.html:500-649`, `js/events.js:992-1008`, `js/events.js:1300-1381`, `js/events.js:1483-1503`, `backend/app.py:595-649` (`/api/tafrigh/segment`)
  - suggest: keep.
  - check: open Tafrigh on the sample; the sentence count and statistics show before any model call.
  - user: "agree with all" (as suggested)
- [ ] **F-107 Sentence splitting settings.** Pause that ends a sentence, minimum and maximum words, split at
  punctuation.
  - where: `index.html:618-629`, `js/events.js:1151-1159`, `js/events.js:1771-1774`, `backend/tafrigh/segmenter.py`
  - suggest: keep.
  - check: set max words to 10; no previewed sentence is longer than 10 words.
  - user: "agree with all" (as suggested)
- [ ] **F-108 Matn text.** Paste the matn being explained, so Tafrigh separates matn from commentary.
  - where: `index.html:630-633`, `backend/tafrigh/matn_aligner.py`
  - suggest: keep.
  - check: paste the matn; sentences that read it are tagged matn.
  - user: "agree with all" (as suggested)
- [ ] **F-109 Text source.** Send the quotes as found (each its own sentence), with their source text, or the raw text;
  optionally re-detect with a chosen engine first.
  - where: `index.html:579-602`, `js/events.js:1009-1150`, `js/events.js:1737-1750`
  - suggest: keep.
  - check: choose "source text"; a misheard verse appears with its Uthmani text in the result.
  - user: "agree with all" (as suggested)
- [ ] **F-110 Tafrigh model.** Gemini (automatic or a fetched model), any OpenRouter model (JEV through its decisions
  API), or Laya; thinking off; a helper model for splits and typo fixes when the classifier cannot do them.
  - where: `index.html:509-535`, `index.html:603-617`, `js/events.js:1160-1299`, `js/events.js:1703-1736`, `backend/tafrigh/adapters/`
  - suggest: keep — adapters use `core/ai` (phase 18).
  - check: run with JEV; split points come from the helper model, and the details say so.
  - user: "agree with all" (as suggested)
- [ ] **F-111 Tafrigh mode.** Sentence by sentence, or a window of several sentences per request (window size); for JEV,
  three parallel requests or one request with all questions.
  - where: `index.html:536-552`, `js/events.js:1776-1789`, `backend/tafrigh/unit_of_work.py`
  - suggest: keep.
  - check: run windowed with size 8 on 16 sentences; the log has 2 classification requests.
  - user: "agree with all" (as suggested)
- [ ] **F-112 Typo strategy.** Fix ASR typos only when suspicious (gated), always, or never.
  - where: `index.html:553-562`, `backend/tafrigh/edit_resolver.py`, `backend/tafrigh/validators.py`
  - suggest: keep.
  - check: run with typos off; no sentence has a correction.
  - user: "agree with all" (as suggested)
- [ ] **F-113 Sentence range.** Run only sentences from–to, with quick buttons (first 10, 25, 50) as a cheap test slice.
  - where: `index.html:563-578`, `js/events.js:1775`, `js/events.js:1790-1796`
  - suggest: keep.
  - check: choose first 10; the run processes exactly 10 sentences.
  - user: "agree with all" (as suggested)
- [ ] **F-114 Tafrigh estimate.** Requests, tokens, cost and time for each mode, from the real prompts.
  - where: `index.html:637-639`, `js/events.js:1382-1482`, `backend/app.py:650-662`, `backend/tafrigh/estimate.py`
  - suggest: keep.
  - check: switch from sentence to window mode; the estimate shows fewer requests.
  - user: "agree with all" (as suggested)
- [ ] **F-115 Tafrigh run and progress.** A run with a live bar (finished sentences and the sentences waited on),
  requests, tags, current sentence and purpose; pause and resume, stop and show what is done, cancel.
  - where: `index.html:650-679`, `js/events.js:1504-1696`, `js/events.js:1751-1770`, `backend/app.py:692-988`
  - suggest: keep — as a job.
  - check: stop half-way; the result shows only the finished sentences.
  - user: "agree with all" (as suggested)
- [ ] **F-116 Tafrigh error and retry.** A failed run shows the error and a retry button.
  - where: `index.html:680-692`
  - suggest: keep.
  - check: run with a wrong key; the error shows and retry reopens the preview.
  - user: "agree with all" (as suggested)
- [ ] **F-117 Tafrigh result.** The structured lesson (headings, matn, commentary), its outline as a bar of headings,
  warnings, a run summary with a cost breakdown; copy as Markdown, export as HTML.
  - where: `index.html:694-731`, `js/render.js:2053-2214`, `js/render.js:2419-2491`, `js/events.js:1867-2003`, `backend/tafrigh/renderer.py`, `backend/tafrigh/outline_repair.py`, `backend/tafrigh/exporters.py`
  - suggest: keep.
  - check: after a run, click a heading in the outline; the text scrolls to it.
  - user: "agree with all" (as suggested)
- [ ] **F-118 Decision details.** Per sentence: label, model confidence, who labelled it, split requests and their
  outcome, corrections accepted, rejected or not applied, with reasons.
  - where: `js/render.js:2215-2305`, `js/render.js:2492-2572`
  - suggest: keep.
  - check: open the details of a split sentence; it says who asked for the split and where it cut.
  - user: "agree with all" (as suggested)
- [ ] **F-119 Tafrigh review queue.** Sentences that need review (low confidence, rejected corrections) are listed;
  review one by one: confirm, relabel, undo a correction, next; the action is saved on the server.
  - where: `js/render.js:2306-2418`, `js/render.js:2734-2805`, `backend/app.py:989-1056`, `backend/tafrigh/review_queue.py`
  - suggest: keep — review actions must survive a restart (phase 18).
  - check: relabel one sentence, restart the server; the relabel is still there.
  - user: "agree with all" (as suggested)
- [ ] **F-120 Save a Tafrigh run for Laya.** Choose sentences (quick picks: reviewed by you, corrected, confidence ≥ 85 %,
  exclude those needing review) and a note, and save them as training examples.
  - where: `js/render.js:2573-2733`, `backend/app.py:1057-1092`, `backend/tafrigh/training_store.py`, `backend/tafrigh/laya_export.py`
  - suggest: keep — they become training rows in the database (phase 20).
  - check: save 5 reviewed sentences; the training screen shows 5 segmentation rows.
  - user: "agree with all" (as suggested)
- [ ] **F-121 Saved Tafrigh runs.** Every Tafrigh run of a lecture is kept: picker, rename, save as new (review goes on
  in a copy), delete; review edits autosave.
  - where: `index.html:696-702`, `js/events.js:198-242`, `js/events.js:1797-1866`, `js/state.js:1154-1252`, `backend/app.py:663-691` (`/api/tafrigh/clone-run`)
  - suggest: keep.
  - check: save a run as new, relabel in the copy; the first run is unchanged.
  - user: "agree with all" (as suggested)
- [ ] **F-122 Compare Tafrigh runs.** Compare saved runs side by side (labels, cost, changes); today only through
  `POST /api/tafrigh/compare`, `GET /api/tafrigh/runs` and `compare_runs.py`, not in the UI.
  - where: `backend/app.py:1093-1145`, `backend/tafrigh/compare_runs.py`, `backend/tafrigh/run_logger.py`
  - suggest: keep — and give it a screen (phase 19).
  - check: compare two runs of the sample; the view lists the sentences whose label differs.
  - user: "agree with all" (as suggested)
- [ ] **F-123 Tafrigh experiment matrix.** `master_verification.py` runs a 6-run dry-run matrix, compares them and
  audits that no run changed the original words.
  - where: `backend/tafrigh/master_verification.py`, `backend/tafrigh/evaluation.py`, `backend/tafrigh/pilot_tools.py`
  - suggest: merge — the faithfulness audit becomes a test; the matrix script goes.
  - check: the Tafrigh tests include "no run changes the original words" and pass.
  - user: "agree with all" (as suggested)

## O. Errors and diagnostics

- [ ] **F-124 Error report.** Any uncaught error or failed request opens a report: summary, endpoint, model, VRAM, input
  source, stack trace, recent actions, as Markdown to copy, with keys removed.
  - where: `js/error-handler.js:1-340`, `js/error-handler.js:355-454`, `index.html:1815`, `js/events.js:862-881`, `index.html:2103-2107`
  - suggest: merge — error toasts with a "details" view; the server logs the stack trace.
  - check: make a request fail; a toast offers details with the endpoint and the error.
  - user: "agree with all" (as suggested)
- [ ] **F-125 Explain the error with AI.** Sends the report to Gemini and shows a diagnosis and a suggested fix.
  - where: `js/error-handler.js:142-209`
  - suggest: remove — it sends app state to a model and is rarely right without the code.
  - check: none if removed.
  - user: "agree with all" (as suggested)
- [ ] **F-126 Test error route.** `POST /api/diagnostic-test-error` raises an error on purpose.
  - where: `backend/app.py:558-575`
  - suggest: remove — a test can raise its own error.
  - check: none if removed.
  - user: "agree with all" (as suggested)

## P. Running the app

- [ ] **F-127 One-command launch.** `run.sh` / `run.bat` create the venv, install, download the corpus the first time
  and serve the app at port 8000; the server also serves the page.
  - where: `run.sh`, `run.bat`, `backend/app.py:1146-1154`
  - suggest: replaced — `scripts/dev.sh` now, the new `run.sh` in phase 24.
  - check: fresh clone, `./run.sh`; the app opens and the sample lecture works.
  - user: "agree with all" (as suggested)
- [ ] **F-128 Health route.** Server, GPU, keys and Colab status.
  - where: `backend/app.py:180-206`
  - suggest: keep.
  - check: `GET /api/health` lists GPU and which keys are set.
  - user: "agree with all" (as suggested)
- [ ] **F-129 Browser-only mode.** Open `index.html` without a server: paste text, detect in the browser, verify with
  your own keys, export.
  - where: `README.md:63-73`, `js/events.js:512-561`
  - suggest: remove — the server does all the work after the rewrite (see ARCHITECTURE.md).
  - check: none if removed.
  - user: "agree with all" (as suggested)
- [ ] **F-130 Colab runner.** A notebook runs the whole app on a Colab GPU with the specialized Whisper and Laya behind a
  Cloudflare tunnel; a script generates it.
  - where: `notebooks/colab/wahy_colab_runner.ipynb`, `notebooks/wahy_colab_runner.ipynb`, `scripts/make_colab_notebook.py`
  - suggest: keep — updated for the new server in phase 24.
  - check: run the notebook on Colab; the tunnel URL opens the app and transcribes with the specialized Whisper.
  - user: "agree with all" (as suggested)

## Q. Research side (Laya)

- [ ] **F-131 Datagen notebooks.** Build and label the Laya data: Bin Baz lessons with ASR and written text, the review
  stages with cards, Sonnet auto-labelling, lecture batch 2, engine v5 against v3 and v4, the `laya_v1` dataset.
  - where: `notebooks/data/*.ipynb`, `backend/laya_datagen/`
  - suggest: keep — moved to `server/laya/` in phase 22.
  - check: run `laya_review.ipynb` "Setup" and "Load lessons"; the recall table prints.
  - user: "agree with all" (as suggested)
- [ ] **F-132 Build `laya_v2`.** Build, validate and zip the current dataset.
  - where: `backend/laya_datagen/laya_v2.py`, `docs/HANDOFF.md`
  - suggest: keep — identical hashes after phases 5 and 22.
  - check: rebuild `laya_v2`; the file hashes equal today's.
  - user: "agree with all" (as suggested)
- [ ] **F-133 Teacher and labeller evaluations.** `teacher_eval` (JEV, base Laya, chat models, report), `sonnet_eval`
  (run, report), and the blind test with its `label.py` command line.
  - where: `backend/laya_datagen/teacher_eval.py`, `backend/laya_datagen/sonnet_eval.py`, `backend/laya_datagen/agent_eval_files/label.py`, `backend/laya_datagen/agent_eval.py`
  - suggest: keep.
  - check: `teacher_eval report` prints the table from the saved results.
  - user: "agree with all" (as suggested)
- [ ] **F-134 Kaggle training.** `train_ddp.py` and the run notebooks 1 to 6 with their finished copies.
  - where: `backend/laya_datagen/kaggle/train_ddp.py`, `notebooks/kaggle/`, `notebooks/wahy-laya-finetuning-run6.ipynb`
  - suggest: keep — notebooks read finished datasets and never rebuild envelopes (ADR 0003).
  - check: the run-6 notebook trains one variant on the new dataset without reshaping rows.
  - user: "agree with all" (as suggested)
- [ ] **F-135 Scoring a checkpoint.** `eval_laya.py predict` and `compare`, and the results notebook.
  - where: `backend/laya_datagen/kaggle/eval_laya.py`, `notebooks/results/laya_v2_compare.ipynb`
  - suggest: keep.
  - check: `eval_laya.py compare` on run 6's results prints the same table as before.
  - user: "agree with all" (as suggested)
- [ ] **F-136 Old Laya training path.** `finetune_laya.py` (head-only or full fine-tune of the app export) and
  `laya_converter.py` (records to JSONL).
  - where: `backend/finetune_laya.py`, `backend/laya_converter.py`, `README.md:119-135`
  - suggest: remove — replaced by the datagen and Kaggle path; decided under **Versions kept**.
  - check: none if removed.
  - user: "agree with all" (as suggested)
- [ ] **F-137 Notebooks as Markdown.** `notebooks_to_md.py` writes each notebook as Markdown for the knowledge graph.
  - where: `scripts/notebooks_to_md.py`
  - suggest: keep.
  - check: run it; `notebooks/md/` is regenerated without errors.
  - user: "agree with all" (as suggested)

## Generic (not features)

Claimed code that is not a feature of its own, so the coverage counts it as generic.

- **G-001 Shared UI plumbing.** Modal open and close, toolbar menus, HTML escaping, the page head and script tags,
  workspace containers, tab and dock styling.
- **G-002 Engine internals.** Matching code and its helpers (engines v3, v4, v5, the IoU helper `evaluatePipeline`);
  the user sees their output through F-011 and F-043.
- **G-003 Internal state.** Runtime fields of `currentState` (selection, playback time, flags) and settings with no
  reader left (`verificationConfig`, `tafrighConfig`, `displayFormatting`, `autoVerifyAfterEngine`,
  `outsideCorpusEnabled`, `autoScrollCaptions`, `tafrigh.matnMode`).
- **G-004 Unused UI strings.** Keys of `js/i18n-en.js` whose Arabic text no longer appears anywhere in the code (left
  from older screens).
- **G-005 Historical plans.** Headings of finished handoffs and plans in `docs/plans/` and the README's reference
  sections (contents, screenshots, structure, credits).

## Design wishes

- The transcript sits beside the video with word-by-word sync (F-032); this is the main screen.
- The old look need not survive: the new screens follow the phase 9 mockups.
- (More from the user during the walkthrough and phase 9.)

## New features (proposed)

Ideas from `future_work.md`, `docs/review-notes.md`, `docs/plans/` and the HANDOFF, plus a few of mine. Size: S (part of
a session), M (about one session), L (several sessions). They are not part of the rewrite unless the user marks them.

- [ ] **N-001 Dhikr as a check after detection.** Adhkar stop being a search target; after detection a finding whose
  core is a listed formula becomes a dhikr, unless it is part of a longer quote (review note 28). Size M.
  - suggest: later — after the rewrite; it changes findings, so it needs new golden files and Laya data.
  - user: "agree with all" (as suggested)
- [ ] **N-002 Extra start and extra end.** New boundary answers for a finding that reaches past the quote, possibly as
  two questions (start: ok / missing / extra; end: same) (note 2). Size M, needs a new dataset and run.
  - suggest: later — needs a new envelope version, dataset and training run.
  - user: "agree with all" (as suggested)
- [ ] **N-003 Sanad policy.** Decide when the chain of narration belongs to a hadith finding, and let the engine extend
  to it (notes 1 and 23). Size M.
  - suggest: later — a policy decision first, then engine work after the rewrite.
  - user: "agree with all" (as suggested)
- [ ] **N-004 Verse inside a hadith.** One hadith finding that keeps the verse inside it as a nested reference
  (note 3; the datagen already has the "ayah inside a hadith" verdict). Size S.
  - suggest: later — after the rewrite, with N-001 and N-003 (all three are finding policies).
  - user: "agree with all" (as suggested)
- [ ] **N-005 Quoted by meaning.** A fourth verdict for a hadith told in the speaker's words, showing the original next
  to it (notes 26 and 29). Size M, needs Laya retraining.
  - suggest: later — needs a fourth verdict in Laya's questions and a new run.
  - user: "agree with all" (as suggested)
- [ ] **N-006 Ambiguous reference.** When a phrase exists in several verses, keep the finding and list every home
  instead of guessing one; prefer the home next to a neighbouring finding (notes 12 and 17). Size M.
  - suggest: later — engine work after the rewrite.
  - user: "agree with all" (as suggested)
- [ ] **N-007 "Reference wrong" flag in the app.** The datagen's "reference wrong / incomplete" toggle, in the editor
  (note 22). Size S.
  - suggest: in the rewrite — a small flag in the editor (phase 17) and the gold labels (phase 20).
  - user: "agree with all" (as suggested)
- [ ] **N-008 Engine v6 from the review notes.** Word endings, first letters, split and joined words, «قال»/«قل»,
  spelled-out letters, short-quote rules, parenthetical phrases, cue strength, takhrij after the text, abridged hadith
  (notes 4-9, 12-20, 24, 25, 27; `docs/plans/engine-v5-handoff.md`). Size L.
  - suggest: later — engine work only after the engine package and golden tests exist (phases 2 and 4).
  - user: "agree with all" (as suggested)
- [ ] **N-009 ASR quality warning.** Flag runs of Latin script and repetition loops in an Arabic transcript (note 11).
  Size S.
  - suggest: in the rewrite — a small check after transcription (phase 7).
  - user: "agree with all" (as suggested)
- [ ] **N-010 Engine benchmark against QDetect.** Quran detection head to head on the same held-out set
  (future work 1). Size M.
  - suggest: later — research, after the rewrite.
  - user: "agree with all" (as suggested)
- [ ] **N-011 ASR benchmark.** Groq, Whisper large-v3 and the specialized Whisper on real lectures, WER overall and
  inside quotes (future work 2). Size M.
  - suggest: later — research, after the rewrite.
  - user: "agree with all" (as suggested)
- [ ] **N-012 Hard negatives.** Mine near-matches and recurring false findings for "not a quote" training rows
  (future work 3). Size M.
  - suggest: later — research, after the rewrite.
  - user: "agree with all" (as suggested)
- [ ] **N-013 Guarded auto-heal loop.** Propose the smallest source-backed completion of a clipped quote, re-check it,
  stop after a few tries, and leave the rest to the user (future work 5; HANDOFF "later ideas"). Size L.
  - suggest: later — builds on F-060 once verdicts and boundaries live on the server.
  - user: "agree with all" (as suggested)
- [ ] **N-014 Restoration with an audit trail.** Show the spoken words beside the restored source text, highlight what
  changed, accept or reject each change, keep who and what decided (future work 6 and 9). Size M.
  - suggest: later — after the editor (phase 17).
  - user: "agree with all" (as suggested)
- [ ] **N-015 End-to-end checks.** After corrections, check that every restored quote points to a source and no words
  outside quotes changed (future work 7). Size S.
  - suggest: later — after N-014.
  - user: "agree with all" (as suggested)
- [ ] **N-016 Laya as a multi-task reviewer.** Evaluate verdict, boundary, completion and source match separately
  (future work 4). Size M (research).
  - suggest: later — research, after the rewrite.
  - user: "agree with all" (as suggested)
- [ ] **N-017 Several fatwas in one video.** Split a short video into its questions only when it has several
  (future work 8). Size L.
  - suggest: later — product work after the rewrite.
  - user: "agree with all" (as suggested)
- [ ] **N-018 Short fatwa videos ("Tahqeeq").** Make short fatwa videos a first-class input, as `future_work.md`
  describes (project scope). Size M; a product decision more than code.
  - suggest: later — a product decision; nothing in the rewrite blocks it.
  - user: "agree with all" (as suggested)
- [ ] **N-019 Compare lecture versions.** Show what changed between two versions of a lecture (findings added, removed,
  verdicts changed), which the glossary already promises. Size M.
  - suggest: later — lecture versions are stored on the server in phase 6, so this becomes easy afterwards.
  - user: "agree with all" (as suggested)
- [ ] **N-020 Prompt rules from the review notes.** Cue followed by garbled words means the quote started earlier;
  explaining with the text's own words is not a quote (notes 5 and 29). Size S.
  - suggest: in the rewrite — two optional prompt rules in the verification layer (phase 14).
  - user: "agree with all" (as suggested)

## Versions kept


- **Engine versions:** v3, v4, v5, v5:loose — suggestion: keep all four in the engine package (golden findings exist
  for each and the datagen compares them); the UI offers v5 and v5:loose only. User: "agree with all".
- **Envelope versions:** v1, v2, v3 — suggestion: keep all three, since checkpoints trained on each exist.
  User: "agree with all".
- **Old Laya paths:** `finetune_laya.py` and `laya_converter.py` — suggestion: remove (F-136). `laya_dataset.py`
  (builds `laya_v1`, the dataset of runs 1 and 2) — suggestion: keep, moved to `server/laya/` in phase 22, so the old
  runs stay reproducible. User: "agree with all".

## Coverage

Measured on 2026-11-03 at the end of phase 1, with a script (session scratchpad, not kept) that reads the sources and
`features-map.tsv`. A UI string is located where its Arabic text occurs (whitespace collapsed) in `index.html`, `js/` or
`backend/`; each other item has one file:line.

| Source | Items | Assigned | Generic | Unassigned |
|---|---|---|---|---|
| UI strings (`js/i18n-en.js`) | 1477 | 1356 | 121 | 0 |
| HTML ids (`index.html`) | 434 | 434 | 0 | 0 |
| Event handlers (`js/*.js`) | 305 | 302 | 3 | 0 |
| Settings and stores (`currentState`, storage keys) | 190 | 171 | 19 | 0 |
| Routes (`backend/app.py`) | 28 | 28 | 0 | 0 |
| CLI entry points, launchers, scripts, notebooks | 36 | 36 | 0 | 0 |
| Wish headings (README, future work, review notes, plans) | 114 | 96 | 18 | 0 |
| **Total** | **2584** | **2423** | **161** | **0** |

Found while measuring:
- 120 UI strings no longer appear in the code (G-004).
- 7 settings are never read (G-003).
- Nothing in the UI calls `/api/laya/convert-dataset`, `/api/tafrigh/compare` or `/api/tafrigh/runs`.
- `index.html` uses the id `btnExportLayaJsonl` twice (lines 1458 and 1522).
