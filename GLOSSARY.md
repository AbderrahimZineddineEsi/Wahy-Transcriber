# Wahy Studio

Wahy Studio turns recorded Islamic lectures into timed transcripts, finds every Quran verse, hadith and dhikr the
speaker quotes, has models verify each one, and turns the corrections into training data for Laya, a small local model.

## Lectures and text

**Lecture**:
One recorded lesson being processed: its media, its transcript and everything found in it.
_Avoid_: session, video, file

**Lecture version**:
A saved snapshot of a lecture's findings and verdicts, kept so that two passes over the same lecture can be compared.
_Avoid_: run (reserved for Laya training)

**Transcript**:
The ordered, timed words of a lecture, produced by ASR or loaded from text or subtitles.
_Avoid_: text, captions

**Word**:
One transcript token with its start and end time.

**ASR** (automatic speech recognition):
Turning a lecture's audio into timed words. Four models do it: Groq's Whisper, local Whisper turbo, local Whisper
small, and the specialized Arabic Whisper. A failed model can fall back to the next one.
_Avoid_: STT, dictation

**Media**:
A lecture's video or audio file in `data/media/`, downloaded from a link, uploaded, or attached later. Downloads
are cached by link, so the same link is never fetched twice.
_Avoid_: asset, recording

**Caption**:
One timed block of transcript text in an exported subtitle file. A caption never splits a quote.
_Avoid_: subtitle, segment

## Quotes and detection

**Corpus**:
The reference texts that quotes are searched in: the Quran, the hadith collections, the adhkar list and custom quotes.
_Avoid_: database, dataset

**Reference**:
The place in the corpus a quote comes from, such as a surah and ayah or a hadith number.
_Avoid_: citation, source

**Quote**:
Words the speaker really recites from a reference. It is the truth that findings are measured against.

**Finding**:
A span of transcript words that the engine proposes as a quote of a reference. A finding can be wrong; a quote cannot.
_Avoid_: detection, match, hit

**Missed quote**:
A quote the engine produced no finding for, added by hand in the editor.
_Avoid_: FN, false negative (in the UI)

**Engine**:
The program that produces findings from a transcript. It has versions (v3, v4, v5) and sensitivity profiles.
_Avoid_: matcher, detector

**Matn**:
The text of a hadith itself, as opposed to its chain of narrators.

**Sanad**:
The chain of narrators in front of a hadith's matn.

**Takhrij**:
The speaker's statement of where a hadith is recorded, such as «رواه البخاري» or «متفق عليه».

**Dhikr** (plural **adhkar**):
A fixed formula of remembrance, such as «سبحان الله», kept in an editable list.

**Custom quote**:
A text the user adds to the corpus so the engine finds it like any other reference.

## Verification

**Verdict**:
The answer to "is this finding a real quote?": correct, false (ordinary speech) or not sure.
_Avoid_: decision, label (a label is a verdict kept as training truth)

**Boundary**:
Whether a finding's span matches the quote's extent: complete, missing start, missing end, extra start or extra end.
_Avoid_: truncation, cut

**Verifier**:
Any model that gives verdicts in the app: Gemini, JEV, an OpenRouter chat model or Laya.

**Verification pass**:
One batch of verdict requests from one verifier over some or all of a lecture's findings.
_Avoid_: run, batch run

## Laya

**Laya**:
The small local model fine-tuned to give a verdict and a boundary for each finding.

**Envelope**:
The structured input Laya reads for one finding or one passage. Envelopes have versions (v1, v2, v3), and each
checkpoint records the version it was trained on.
_Avoid_: payload, prompt, state

**Passage**:
Consecutive verses of one surah found close together (at most 2 words apart), sent to Laya as one envelope. A long
passage is cut into equal parts of at most 6 verses, never leaving one verse alone.
_Avoid_: group, block

**Neighbour**:
The nearest other finding before or after a finding, listed in its envelope without its verdict.

**Card**:
One finding shown for labelling with its context, together with the label given to it.
_Avoid_: item, sample

**Label**:
A verdict and boundary kept as training truth for a card, given by the user, by a teacher, or derived from a lesson's
written text.

**Gold label**:
A label given by the user, the most trusted kind.

**Teacher**:
A model that labels cards for training data, such as Sonnet or Gemini.

**Dataset**:
A versioned set of training rows built from labelled cards and split into train, validation and test (laya_v1, laya_v2).
_Avoid_: data, corpus

**Run**:
One fine-tuning experiment (run 1 to run 6): one or more variants trained and scored on the same test cards.
_Avoid_: experiment, job

**Variant**:
One model trained within a run, such as soft_asis or v3_mixed.

**Checkpoint**:
The saved weights of a variant together with the envelope version and questions it expects.
_Avoid_: model file

## Tafrigh

**Tafrigh**:
Turning a transcript into a structured written lesson (sentences, headings, matn and commentary) without changing what
was said.
_Avoid_: smart transcription, formatting

**Tafrigh run**:
One execution of Tafrigh over a lecture with fixed settings, saved so it can be compared with other Tafrigh runs.

**Outline**:
The heading structure that Tafrigh builds for a lesson.

## The app

**Job**:
One piece of long work the server does in the background (a transcription, a detection, a verification pass, a
Tafrigh run), with a status and progress the web app can follow, pause, resume or cancel. A job the server stopped
while it ran is **interrupted**.
_Avoid_: task, run

## Flagged ambiguities

- "Run" meant four things in the old code: a Laya training run, a Tafrigh run, a saved lecture snapshot (the
  IndexedDB `runs` store) and an AI verification batch. Bare **run** now means a Laya training run only; the others are
  **Tafrigh run**, **lecture version** and **verification pass**.
- The old code says "detection" for what this glossary calls a **finding**, and "label" for both model answers and
  training truth. A model's answer is a **verdict**; a **label** is training truth.
