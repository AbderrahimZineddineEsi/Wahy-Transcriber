# Wahy Studio: the rewrite explained (NotebookLM edition)

## About this document

This document explains Wahy Studio, a software project, and the complete rewrite it went through between 3 and 8
November 2026. It is written for the project's author, a fifth-year computer science student specializing in machine
learning, with a backend background in Node.js, Express and NestJS and some Flutter. It is made to be loaded as a
source into NotebookLM, so it uses only plain paragraphs and lists: no tables, no code blocks, no diagrams. Every
section begins by saying what it is about, so it can be read on its own. Arabic and Islamic words are explained in the
first two sections and again, briefly, where they appear. A longer version with tables, diagrams and commands is the
file EXPLAINED.md in the same folder; the day-by-day learning log is LEARNING.md.

## Arabic and Islamic words used in this project

Wahy Studio works on recorded Islamic lectures, so its vocabulary includes many Arabic and Islamic terms. Here they are,
each with a plain explanation.

- Wahy (وحي) means revelation. The app's Arabic name, مكتشف الوحيين (Muktashif al-Wahyayn), means "the finder of the two
  revelations": the Quran and the Sunnah.
- The Quran is the holy book of Islam. It is divided into 114 chapters called surahs (singular surah, Arabic سورة),
  and each surah into verses called ayat (singular ayah, آية). The whole Quran has 6,236 verses. A verse is referred to by
  surah and number, for example "al-Baqarah 255" (the 255th verse of the second surah) or written in Arabic as
  "البقرة: 255".
- Some surahs and verses named in this document: al-Fatiha (the first surah, recited in every prayer), Yunus (surah 10),
  al-'Asr (surah 103, three verses), al-Ahzab (surah 33), and Ayat al-Kursi (the "Verse of the Throne", al-Baqarah 255).
- The Sunnah is the example of the Prophet Muhammad, known through hadiths.
- A hadith (حديث, plural ahadith) is a report of what the Prophet said or did. A hadith has two parts: the sanad
  (سند), the chain of narrators ("so-and-so told us that so-and-so said..."), and the matn (متن), the text of the report
  itself. The app mostly matches the matn, because speakers usually quote the matn.
- Hadith collections are books that gather hadiths with numbers. The two most famous are Sahih al-Bukhari and Sahih
  Muslim, named after their compilers. A hadith reference looks like "Bukhari 1" or "Muslim 2149".
- Takhrij (تخريج) is the speaker's statement of where a hadith is recorded, such as «رواه البخاري» (rawahu al-Bukhari,
  "Bukhari reported it") or «متفق عليه» (muttafaq 'alayh, "agreed upon", meaning both Bukhari and Muslim reported it).
- Dhikr (ذكر, plural adhkar, أذكار) means remembrance of God: short fixed formulas such as «سبحان الله» (subhan Allah,
  "glory be to God") or «لا إله إلا الله» (la ilaha illa Allah, "there is no god but God"). The app keeps an editable
  list of adhkar to detect.
- Tafrigh (تفريغ) literally means "emptying out"; for a recorded lesson it means writing it out as a structured text.
  In this app it is the feature that turns a transcript into a written lesson with sentences, headings, the matn being
  explained and the commentary on it.
- Sharh (شرح) means commentary or explanation, the speaker's own words explaining a text.
- A khutba (خطبة) is a sermon; the Friday sermon is the Jumu'ah (جمعة) khutba. A sheikh is a scholar or teacher. Test
  lectures in this project came from Friday sermons by sheikh Mohammed Meziane.
- Qira'ah (قراءة, plural qira'at) is a canonical way of reciting the Quran. Different qira'at differ slightly in some
  words. A riwayah (رواية, "transmission") is one transmitted form of a qira'ah. The most common is Hafs; Warsh and
  Qalun are common in North Africa. The app's Qira'ah setting has four choices: automatic, Hafs, Warsh, Qalun.
- Uthmani script is the traditional spelling used in printed Qurans; it differs from everyday Arabic spelling, and
  Arabic diacritics (small vowel marks, tashkeel) may or may not be written. The engine has to match spoken words to
  this script.
- Brackets: in exports, Quran verses are written inside ﴿ ﴾ (the ornate Quranic brackets), hadiths inside « », and
  adhkar inside 〖 〗.

## Project words used in this document

Wahy Studio has its own precise vocabulary, defined in the project's GLOSSARY.md file. These are the words that appear
throughout this document.

- A lecture is one recorded lesson being processed: its media (video or audio), its transcript and everything found in
  it.
- A transcript is the ordered list of timed words of a lecture. Each word has a start and an end time.
- ASR means automatic speech recognition: turning audio into timed words.
- The corpus is the set of reference texts that quotes are searched in: the Quran, the hadith collections, the adhkar
  list and custom quotes the user adds.
- A reference is the place in the corpus that a quote comes from, such as a surah and verse, or a hadith number.
- A finding is a span of transcript words that the detection engine proposes as a quote of a reference. A finding can
  be wrong.
- A quote is what the speaker really recited. Findings are measured against quotes.
- A missed quote is a real quote the engine produced no finding for, which the user adds by hand.
- The engine is the program that produces findings from a transcript. It has versions v3, v4 and v5; v5 is the default
  and has a "loose" profile that finds more but is less precise.
- A verdict is a model's answer to "is this finding a real quote?": correct, false (the speaker's ordinary speech), or
  not sure.
- The boundary is whether a finding's span matches the quote's real extent: complete, missing start, missing end, extra
  start or extra end.
- A verifier is any model that gives verdicts in the app: Gemini, JEV, an OpenRouter chat model, or Laya.
- A verification pass is one batch of verdict requests from one verifier over some or all of a lecture's findings.
- Laya is the small local language model the author fine-tuned to give a verdict and a boundary for each finding.
- An envelope is the structured input Laya reads for one finding or one passage. Envelopes have versions v1, v2 and
  v3, and each Laya checkpoint records which version it was trained on.
- A passage is a group of consecutive verses of one surah found close together, sent to Laya as one envelope.
- A neighbour is the nearest other finding before or after a finding, listed in its envelope without its verdict.
- A label is a verdict kept as training truth. A gold label is one given by the user, the most trusted kind.
- A card is one finding shown for labelling with its context and its label.
- A teacher is a model that labels cards for training data, such as Claude Sonnet or Gemini.
- A dataset is a versioned set of training rows split into train, validation and test (laya_v1, laya_v2, laya_v3).
- A run is one fine-tuning experiment (run 1 to run 6). A variant is one model trained within a run. A checkpoint is
  the saved weights of a variant together with the envelope version it expects.
- A job is one piece of long work the server does in the background (a transcription, a detection, a verification
  pass, a Tafrigh run), with a status and progress the user can follow, pause, resume or cancel.
- A lecture version is a saved snapshot of a lecture's findings, kept so two passes can be compared.
- The edit log is the ordered list of a lecture's edits, kept so the newest one can be undone, even after a reload.
- A commentary gap is the speaker's own words in the middle of a quote, between two of its parts. Exports write them
  outside the brackets.
- An embedded verse is a Quran verse quoted inside a hadith. Exports write it in its own Quranic brackets inside the
  hadith's brackets.

## What Wahy Studio does

Wahy Studio is a local web application that processes recorded Islamic lectures. Its pipeline has seven steps.

First, it transcribes a lecture into timed words, using one of four speech recognition models: Groq's cloud Whisper,
local Whisper turbo, local Whisper small, or a specialized Arabic Whisper model. Second, it detects every Quran verse,
hadith and dhikr the speaker quotes, by matching the words against a corpus of 6,236 verses, about 40,000 hadiths and
an editable adhkar list; each proposed quote is called a finding. Third, it verifies findings with a model: Google's
Gemini, a calibrated decision model called JEV, any chat model through OpenRouter, or Laya, the author's own
fine-tuned local model. The question is whether the finding is a real quote and whether its span is complete. Fourth,
the user can edit everything: fix words, add a missed quote, move a quote's edges, change its reference, delete it with
a reason, all with undo. Fifth, it exports subtitles in SRT, VTT and ASS formats, in which a quote is never split across
two captions, plus Markdown, plain text, HTML and JSON. Sixth, its Tafrigh feature turns the transcript into a written
lesson. Seventh, it keeps the user's corrections as gold labels and exports them as training rows for Laya, closing the
loop between using the app and improving the model.

## The old app and what was wrong with it

Before the rewrite, Wahy Studio was a browser application of about 35,000 lines with a Python server on the side. It
was deleted in the rewrite's phase 24 and survives in the git history. A read-only review on 3 November 2026, called the
friction map, counted 20 problems. The most important ones follow, each explained on its own.

The Laya input was built in six places in two languages. The structured text Laya reads for a finding, its envelope,
was assembled by three JavaScript functions in the browser, three Python functions on the server, and the training
notebook of run 6 reshaped it again with its own function. Nothing checked that they agreed. The result was
training/serving skew: the model was trained on one input shape and given another in use. Measured on the laya_v2
dataset, 2,019 of 4,901 single-finding rows differed, and the question text differed on every row.

The detection engine existed only as browser scripts. To build datasets, the Python side started Node.js and ran the
browser files inside a fake browser, with a fake document and fake local storage. It even had to load the user
interface's editor file, because the engine called a function defined there. A change to the interface could break
dataset building, and the engine could not be tested on its own.

AI providers were called from both sides. The browser called Gemini and OpenRouter directly, with API keys stored in
the browser's local storage. The server called the same providers again from about ten files, each with its own retry
and cost logic. A teacher model evaluated in the data pipeline was therefore not the same code the app used.

Data lived in five places, and lectures lived only in the browser's IndexedDB database. The server and the data
pipeline could not see the user's corrections without a manual export, and clearing the browser's data lost work.

The whole browser state was one global object with 49 fields, edited from ten files in about 690 places, and the
screen was redrawn by hand with 83 render calls and 71 raw HTML writes. A wrong verdict on screen could have been set by
any of ten files, and a forgotten redraw showed stale data.

Long work ran on two separate in-memory job systems that forgot everything when the server restarted, and verification
ran inside the browser tab, so closing the tab stopped it.

Nobody owned the GPU. The author's laptop has an NVIDIA GTX 1050 with 3 GB of video memory, enough for one model at a
time. Each module loaded its own model, and Laya freed memory by calling a Whisper unload function passed to it. Two
jobs at once could run out of memory or silently fall back to the CPU, about thirty times slower.

The English translation was keyed by the full Arabic sentence: 1,486 entries swapped into the page by a browser
observer. Fixing one Arabic word silently broke its English translation.

There were no frontend tests at all, and the server's HTTP layer, transcription and GPU code had almost none.

The review also listed what already worked and should be kept: Tafrigh's design, which never changes the spoken words
and checks every edit with validators; the idea of one engine shared by the app and the data pipeline; envelope versions
chosen by each checkpoint's own configuration; atomic captions; word timings preserved through edits; and the data
pipeline's caching.

## The new architecture

After the rewrite, Wahy Studio follows one principle: the server does all the work and stores all the data, and the web
app only shows the data and sends the user's actions.

The server is written in Python 3.12 with the FastAPI framework and runs as one process on port 8000. It has three
parts. The core holds the shared machinery: settings and API keys, the SQLite database, the job runner, the GPU owner,
the client for the engine process, the AI provider layer, and an access guard. The features part has one folder per
feature (lectures, transcription, corpora, detection, verification, editing, export, Tafrigh, training, telemetry, jobs,
settings), and each feature folder has the same four files: a router for HTTP, a service with the rules, schemas for the
request and response shapes, and models for the database tables. The research part, a package called wahy.laya, holds
the Laya data pipeline: dataset builders, teacher models, evaluation and the Kaggle training scripts.

The detection engine is a TypeScript package. The server starts it once as a long-running Node.js helper process that
loads the 90 MB corpus a single time and answers requests. The two processes talk through the helper's standard input
and output, one JSON message per line.

The web app is written in React with TypeScript. It is built into static files that the same server serves.

Data lives in one SQLite database file plus plain files: the media, the corpus, the Tafrigh runs and the Laya
datasets, all under a data folder that git ignores.

Three rules keep this shape clean. A feature talks only to the core and, in one direction only, to another feature's
service; for example the transcription feature uses the lectures feature to save words, never the reverse. A router only
translates HTTP into one service call; the rules live in the service, which is plain Python that a test can call
directly. And each core module is a deep module, meaning a small interface hiding a hard problem: the engine client
hides the helper process with its start-up, crashes, timeouts and restarts; the AI layer hides keys, rate limits,
retries, cost and logging; the GPU owner hides waiting, unloading and freeing memory; the job runner hides threads,
pause, resume, cancel and recovery after a restart.

In size, the new server is about 24,000 lines including the copied Tafrigh package and the research package, the engine
about 7,000 lines, the web app about 12,000 lines, and the server's tests alone about 8,700 lines.

## One lecture's journey through the new system

This section follows one lecture through the new Wahy Studio, from a YouTube link to a training row.

The user pastes a YouTube link in the web app. The app sends it to the server, which saves an empty lecture and starts
a transcription job, answering at once with the job's identifier. The web app follows the job through a progress stream,
a kind of HTTP response that stays open and sends updates (server-sent events).

The job downloads the video with the yt-dlp library, caching it under a hash of the link so the same link is never
downloaded twice. It extracts the audio with ffmpeg as 16 kHz mono, asks the GPU owner for a Whisper model or calls
Groq's cloud service, and saves the timed words. If a model fails, the next one in a fallback chain runs, and the result
records which model really ran and why the first one failed.

When the transcription job finishes, the web app starts a detection job. The server sends the words to the engine
helper process and saves the findings it returns. The lecture screen shows the transcript beside the video, with each
quote highlighted by kind and the spoken word lit as the video plays.

The user then starts a verification pass with Laya. The job reads the Laya checkpoint's configuration file, which says
it was trained on envelope version 3, asks the engine for exactly those envelopes, and asks the GPU owner for Laya, which
unloads Whisper first. Each verdict is saved, and each request is logged with its tokens, cost and duration.

The user corrects one verdict. The correction is saved as a gold label and as one entry in the lecture's edit log, so it
can be undone, even after a reload. Finally, the training export reads the labels and writes Laya training rows with
the same envelopes. Because the data pipeline reads the same database, the user's corrections reach the next dataset
without any manual export.

## The architecture decisions (ADRs)

An architecture decision record, or ADR, is a short document stating one decision, the reason for it and the
alternatives considered. Wahy Studio's rewrite rests on eight ADRs, written on 3 November 2026 from the friction review.
None had to be replaced during the rewrite. Each is explained below in plain words.

### ADR 0001: rewrite beside the old app, one tested phase per session

The first decision was how to rewrite Wahy Studio safely. The new code was built in new folders next to the old app,
which kept running until the acceptance phase passed and was deleted only after that. Before any code moved, the old
app's outputs (findings, envelopes, captions, exports) were saved as golden files, and the new code had to reproduce them
byte for byte. The reason: Laya's results depend on findings and envelopes staying identical, and a rewrite that cannot be
compared with the old app loses features without anyone noticing. Two alternatives were rejected: changing the old code
in place step by step, which would have required designing every intermediate state twice, and doing it all in one
session, which could not be verified and would teach nothing.

### ADR 0002: the engine stays TypeScript and runs on the server

The second decision concerns Wahy Studio's quote detection engine, about 4,200 lines of carefully tuned matching logic
written in JavaScript. It was moved into one TypeScript package and runs on the server in a long-lived Node.js process
that the Python server talks to with one JSON message per line. The browser never loads the 90 MB corpus. The reason:
porting tuned heuristics to Python is long and risky, with only golden tests to prove nothing changed, and keeping one
language means the app and the dataset builder run literally the same functions. The rejected alternatives were a Python
port, and keeping the engine in the browser, where every tab would load the corpus and the server could not reuse it.

### ADR 0003: one envelope builder, and datasets store the final envelopes

The third decision is the one that matters most for machine learning. In Wahy Studio, the envelope is the structured
input Laya reads. After the rewrite, envelopes are built only by the engine package, with one function per envelope
version. The dataset builder stores each training row's envelope in its final form, and the training and evaluation code
(Kaggle scripts and notebooks) read it as it is and never reshape it. The app builds envelopes with the same function at
verification time. The reason: in the old code six functions in two languages built envelopes, and run 6 found the
training notebook's version disagreeing with the app's, so the model was trained on one input shape and served another.
The consequence: changing an envelope now means adding a new version, rebuilding the dataset and training a new
checkpoint, while old checkpoints keep working because each one records the version it expects.

### ADR 0004: all model calls go through one server-side provider layer

The fourth decision is about calls to AI models in Wahy Studio. Every call to Gemini, OpenRouter (the JEV decision model
and chat models), Groq and local Laya goes through one provider layer in the server, which owns the API keys, the rate
limiting, the retries, the cost counting and a log of every request. The app's verification, Tafrigh and the data
pipeline's teachers all use it, and the browser holds no keys and calls no provider. The reason: the old code called
Gemini from four files and OpenRouter from eight, in the browser and on the server, each with its own logic, so an
evaluation of a teacher model did not necessarily describe the code the app ran.

### ADR 0005: SQLite for app data, files for media, corpus and datasets

The fifth decision is about storage in Wahy Studio. Lectures, transcripts, findings, verdicts, labels, jobs and the AI
request log live in one SQLite database file, accessed through the SQLAlchemy library, with Alembic migrations to evolve
its tables. Media, the corpus, Tafrigh runs and the Laya datasets stay plain files. The reason: the app has one user on
one machine, so a database server adds nothing, while the old browser storage hid the user's corrections from the server
and the data pipeline. Datasets stay files because Kaggle, where Laya is trained, reads files.

### ADR 0006: one GPU owner, one model in video memory at a time

The sixth decision is about the GPU in Wahy Studio, a GTX 1050 with only 3 GB of memory. A single GPU owner in the server
decides which model (Whisper, the specialized Arabic Whisper, or Laya) is loaded. Jobs ask it for a model and wait until
it is theirs; it unloads whatever else is loaded first. No other code loads models onto the GPU. The reason: in the old
code each module loaded its own model, so two jobs at once could run out of memory or silently fall back to the CPU,
about thirty times slower.

### ADR 0007: one job runner for all long work, with job state saved

The seventh decision is about long-running work in Wahy Studio. Transcription, detection, verification passes and
Tafrigh runs are all jobs in one runner inside the server process. It saves each job's progress and status in the
database, supports pause, resume and cancel, and offers one progress stream to the web app. After a server restart,
unfinished jobs show as interrupted and can be resumed where the work allows it. The reason: the old code had two
separate in-memory job systems that lost everything on restart, and verification ran in the browser tab. The rejected
alternative was a task queue such as Celery or RQ with Redis, which is built for many machines and many users and here
would only add a second service to run.

### ADR 0008: a React and TypeScript web app, typed from the server's API, translated by keys

The eighth decision is about Wahy Studio's user interface. It is a React and TypeScript app built with Vite and styled
with Tailwind, organised in feature folders. Server data is fetched and cached with the TanStack Query library. The app's
types are generated from the server's OpenAPI description, so a server change that breaks the web app fails the type
check before anything runs. Text is translated through keys (for example the key nav.settings), Arabic first and right to
left, plus English. The reason: the old interface kept everything in one global object, refreshed the screen by hand,
and keyed 1,486 translations by full Arabic sentences. The rejected alternative was plain TypeScript with no framework:
less to learn, but the screen-refresh problem would return in an interactive editor and video player.

## The server technologies

This section describes the technologies of Wahy Studio's Python server and what each does, compared with tools from the
Node.js world where that helps.

Python 3.12 is managed with uv, a fast package manager. The command "uv sync" creates the server's virtual environment
from its project file and pins exact versions in a lock file, like npm with its lock file. Optional extras add heavy
packages only when wanted: local-asr adds faster-whisper and the NVIDIA libraries, laya adds PyTorch and the laya model
library, research adds pandas and notebook tools.

FastAPI is the web framework, comparable to NestJS or Express. It defines the routes, validates requests, injects
dependencies, and generates an OpenAPI description of the whole API from the code, browsable at the /docs page. It also
serves the built web app from the same port. Pydantic classes define the request and response shapes, like NestJS DTOs
with class-validator.

SQLAlchemy is the object-relational mapper, like TypeORM or Prisma: a table is a class. Alembic writes and applies
migrations, the scripts that bring a database file from one table layout to the next; the server applies them at
start-up, and a test fails if someone changes a table class without adding a migration. SQLite runs with foreign keys
switched on (they are off by default, which once made cascading deletes silently do nothing) and in write-ahead-log mode,
so the web app can read while a job writes.

Concurrency mixes asyncio and threads. FastAPI serves requests on one asyncio event loop, like Node's event loop. A job
that runs Whisper for ten minutes would freeze that loop, so each job gets its own thread, and progress updates are
handed back to the loop safely. Pause and cancel are cooperative: Python cannot stop a thread from outside, so a job
checks between steps whether it should sleep or stop.

Server-sent events push job progress to the browser over one long HTTP response. They only go from server to browser,
which is all a progress bar needs, and they are simpler than WebSockets.

httpx is the HTTP client used for every AI provider; tests replace the network with a mock transport, a function that
answers requests. yt-dlp downloads from YouTube, and ffmpeg, a command-line program run as a child process, extracts the
audio; a cancelled job kills ffmpeg. faster-whisper runs Whisper locally; PyTorch comes from its CUDA 12.6 package index,
because newer builds no longer support the GTX 1050. pytest runs about 520 server tests, and ruff is the linter.

## The engine technologies

This section describes the technologies of Wahy Studio's detection engine, the TypeScript package that matches
transcripts against the Quran and hadith corpus.

The engine's 4,000 lines of tuned JavaScript were moved as they were and given a typed interface only: the word, the
finding and the options are typed, the logic behind them is not yet. Typing every line would have meant touching every
line, which is risky. The files became ES modules, which say what they import; the old scripts shared one global space
and depended on the order the page loaded them.

Node.js version 22.18 or later can run TypeScript files directly by stripping the types, so the engine needs no build
step. This is why the launcher checks the Node version: an older Node cannot start the engine.

The engine runs as a worker process speaking JSON Lines: each request is one JSON object on one line, carrying an
identifier and a command such as detect, envelopes, search or export, and each answer is one line with the same
identifier. Logs go to the error stream so they never look like answers. Loading the corpus and building a matcher takes
seconds and hundreds of megabytes, so the worker does it once and keeps it. Its tests run with Vitest.

## The web technologies

This section describes the technologies of Wahy Studio's web app and compares them with Flutter, which the author knows.

React components are functions that describe the screen for their current data, like Flutter widgets. Hooks give them
abilities: useState is like Flutter's setState, useReducer is like a Bloc that maps events to states, useRef holds a
value React does not watch, and useEffect runs code after the screen updates. Vite is the development server, with
instant reload and a proxy to the API, and the build tool that produces static files.

Tailwind version 4 styles the app with small utility classes. The colours, fonts and spacing are named design tokens in
one file, and dark mode switches them with one attribute on the page, like a Flutter ThemeData. The layout uses logical
properties, so the Arabic right-to-left interface and the English left-to-right one mirror each other for free.

TanStack Query manages data from the server: it fetches, caches under a key, shares one request between components,
refetches, and after a change invalidates the key so the data is read again. It is close to Riverpod's FutureProvider
with ref.invalidate. It also does optimistic updates: a button shows its result at once and rolls back if the server
refuses.

The API types are generated: a script asks the server for its OpenAPI description and turns it into TypeScript types, so
every call is checked by the compiler. Translations are two files, Arabic and English, with the same keys, and a test
checks that they match.

Tests use Vitest with Testing Library for logic and screens against a fake server, and Playwright, which drives a real
browser against the real server (40 end-to-end tests), comparable to Flutter's widget tests and integration tests.

## The AI providers

This section lists the AI services Wahy Studio uses, all called through the server's one provider layer.

Groq runs Whisper large v3 turbo in the cloud for cheap, fast speech recognition, with long audio cut into 45-minute
pieces. Google Gemini, mainly the flash-lite model on the free tier, verifies findings in batches of five to ten per
request and also serves Tafrigh and the data pipeline. JEV, a decision model reached through OpenRouter, returns
calibrated probabilities for correct, false and not sure. OpenRouter also offers more than 500 chat models with live
prices. Laya runs locally on the GPU, uses about 1.2 GB of video memory and answers in under a second per decision.
A fake verifier exists for tests, so no test spends money.

The provider layer adds the same machinery to all of them. A rate limiter with a sliding window keeps the free tier's
requests per minute. Busy answers (HTTP 429 and server errors) are retried, waiting as long as the provider asks, while a
wrong key (HTTP 401) is not retried, because waiting cannot fix it. Every attempt, failed ones included, is logged with
tokens, cost, latency and the exact payload without keys, and the app's request log screen shows them.

## Laya and the machine learning side

This section is about Laya, the fine-tuned model at the centre of Wahy Studio's machine learning work, and its state at
the end of the rewrite.

Laya's task is classification. For each finding it answers whether the finding is a real quote (correct), the speaker's
ordinary speech (false), or uncertain (not sure). Some versions also answer a boundary question: is the start or the end
of the quote cut off?

The model served by the app is called laya-wahy-r6-v3_mixed: run 6, variant v3_mixed, trained on envelope version 3,
answering the verdict only. On the author's own labelled cards, in passage mode, it reached 90.3 percent accuracy and an
area under the ROC curve of 0.967. Its boundary is not predicted by the model but by a word-overlap rule: did the
speaker say a corpus word right before or after the span? In runs 1 and 2 the boundary output collapsed to always
answering "complete", and the simple rule beat every model.

Envelope version 3 groups consecutive verses of one surah, found at most two words apart, into one passage, cut into
parts of at most six verses, and lists the nearest neighbouring findings without their verdicts. A passage gets one
answer. Because "start cut off" can only be true of the first verse and "end cut off" only of the last, the answer is
turned into two yes-or-no probabilities and each verse receives its share.

Serving reads the checkpoint's own configuration file, which states the envelope version, whether passages are used and
which questions the model learned. The server builds exactly that input with the same engine function that builds the
training rows. A version 1 checkpoint now receives version 1 envelopes; the old app sent version 3 to every checkpoint.

Training/serving skew was measured and its cause removed. The rewrite's phase 2 found that the rows run 6 trained on
differ from what the app sends: the question text on every row, and 2,019 hadith and dhikr rows where training wrote a
field as null and the app leaves it out. A person would call these the same; for a language model they are different
token sequences. Because the served model is still run 6's, that measured skew remains today, but it is known.

A new dataset version, laya_v3, built in phase 22, stores every row exactly as the engine's envelope 3, with the same
labels, split and gold labels as laya_v2, and a Kaggle notebook reads the rows as they are. It has not been trained on.
On 7 November 2026 the author decided to keep serving run 6's model for now, in their words: "we're not retraining laya
anytime soon just keep using the version i used last". A model trained on laya_v3 would be the first with no skew at
all.

Training rows now come from four sources, each recorded with its origin, which is called data lineage: the author's
corrections in the app (gold labels, each recording how it was given: a verdict, approve all, delete as ordinary speech,
or a missed quote added by hand), the verifiers' newest verdicts (not gold), Tafrigh sentences, and the old app's export.
Importing the same row twice replaces it instead of adding a duplicate, which makes the import idempotent.

The research side is a command-line tool in the server package (python -m wahy.laya) that builds datasets, compares
their hashes, labels cards with a teacher model, reports the run-6 skew, validates and zips. Teachers are thin adapters
over the same provider layer the app uses, so evaluating a teacher now evaluates the code the app runs, and teacher
answers are cached under a key that includes everything that changes the answer, including the prompt version.

## Running the app: the launcher and the public corpus

This section explains how Wahy Studio is started on a laptop after the rewrite, and how it gets its corpus.

One command, run.sh in the repository root, promises "fresh clone, one command, working app". It checks for Node.js
22.18 or later, npm, uv and ffmpeg; installs the Node packages only when their lock file changed; builds the web app
only when its sources are newer than the last build; installs the Python packages; downloads the corpus the first time;
and serves everything on port 8000 of the local machine. Every step is safe to repeat, so a second start takes seconds.
A separate development script runs the server and the web app with live reload.

The corpus, the Quran and hadith texts in one 90 MB JSON file, used to live only in a private repository called
Wahy-Finder, so a fresh clone needed the author's GitHub login. Since the extra task 24b, on 8 November 2026, it is a
public release asset of the Wahy-Transcriber repository, named corpus-v1. A download script fetches it to a temporary
file, checks its SHA-256 hash, and only then moves it into place, so a cut-off or wrong file is thrown away. The old
login-based routes to the private repository remain as fallbacks, and the private repository itself was not changed.

## Running the app on Google Colab

This section explains the Colab runner of Wahy Studio, built in task 24b, which runs the whole app on a free Google
Colab T4 GPU. It corresponds to feature F-130, which stays unticked until the author runs it once in a real Colab
session.

The notebook is generated by a Python script and opened from a badge in the README. It has three cells run with one
"Run all". The first sets the options, clones the repository, connects Google Drive and reads secrets: a Hugging Face
token, needed because Laya's checkpoint is private, and optional provider keys. The second installs everything in
parallel: the Python packages, Node.js and the web build, the corpus and the models. The built web app is cached on Drive
under a key made from git's hashes of the web and engine folders, so later sessions skip npm entirely. The third starts
the app with the same run.sh used on the laptop, loads Laya on the GPU, opens a Cloudflare tunnel and prints a private
link.

Google Drive is used as a backup, not as the app's data folder. Drive in Colab is a network file system, and SQLite needs
real file locks and its write-ahead log, which Drive does not provide reliably; a half-written database would be
corrupt. So the app runs on the Colab machine's own disk, and a background thread copies the data folder and the keys
file to a folder called Wahy-Studio in My Drive every minute. The database is copied with SQLite's backup function, which
makes a consistent snapshot even while the app writes; other files are copied only when their size or time changed; and
nothing on Drive is ever deleted. With Drive switched off, a backup zip without keys is refreshed every two minutes.

A token protects the public link, because a Cloudflare tunnel address is reachable by anyone on the internet. With the
access token setting on, every request needs a random token. The printed link carries it once; the server swaps it for a
browser cookie the page cannot read from scripts and redirects, so the token disappears from the address bar. Scripts can
send it in a header instead. The token is compared in constant time, so response timing cannot reveal it, and the
notebook hides it in the server's printed logs.

Colab starts the app with the same run.sh as the laptop, so the two cannot drift apart. Doing this found a real bug: the
previous notebook installed Node.js 20, which cannot run the TypeScript engine.

What is verified without Colab: the access guard, Drive sync and restore with a live database, the backup zip, path
safety, the build cache, and a real 90 MB corpus download that matched its hash in seven seconds. What still needs one
real session: the T4 GPU, the Cloudflare tunnel and the Drive permission pop-up.

## Key ideas from the rewrite: testing

This section collects the testing ideas that came up again and again in Wahy Studio's rewrite, each with an example.

Golden tests, also called characterization tests, record what the old code does, right or wrong, and require the new
code to produce the same bytes. For example, engine v5 labels a phrase from al-Fatiha as Yunus 10, a verse that ends
with the same words. The golden file keeps that mistake, because fixing the engine is a separate, deliberate decision
and must never hide inside a refactor. Golden files need a deterministic generator: when the random number function was
pinned to a constant, three record identifiers became equal and two of six export rows were lost, so it was replaced by
a seeded sequence that differs from call to call but is the same on every run.

Expected differences are written down, never regenerated. When the author chose to bracket Quran verses inside
hadiths, one golden finding changed. Regenerating the golden files would have made the test pass and prove nothing. Instead
a list of the expected changes is written by hand, and the test applies exactly those to the old file before comparing.

Tests need teeth. A mutation check breaks the code on purpose to see whether a test fails. Moving one engine threshold
from 6.8 to 30 failed at once; moving another from 3.8 to 3.7 failed nothing, which showed that the test inputs contain no
quote near that cut-off.

Fakes outside, real inside: tests use real ffmpeg, real SQLite and the real GPU owner, with fake models, fake provider
servers and a fake downloader. One real end-to-end test sends the golden lectures through the HTTP API, a job thread and
the Node engine process, and requires the old app's findings field for field.

Acceptance tests ask whether the user can do what was promised, in the real app with the real server, rather than
whether a function does what was meant. Each accepted feature names its evidence, a test or a measured result anyone can
rerun.

## Key ideas from the rewrite: design and backend

This section collects the design and backend ideas from Wahy Studio's rewrite, each with an example.

A deep module offers a small interface over a lot of logic. The engine's detect function has one call and six options
in front of 4,100 lines of matching and a cache of expensive matchers; callers learn little and get a lot.

Ports and adapters: the verification pass knows one shape, "verify these items and return one answer each". Gemini,
JEV, OpenRouter, Laya and a fake each adapt that shape to one company's API. Swapping verifiers is a configuration string,
and tests plug in the fake. In NestJS this is an interface token with several providers; in Flutter, an abstract
repository with a real and a mock implementation.

Cooperative cancellation: a job checks between steps whether it is paused or cancelled. A careless "catch every
exception" would turn "the user pressed cancel" into "Groq failed, try the next model", so the fallback chain lets the
cancellation through.

Checkpoints and resume: a verification pass saves how many request chunks it finished; after a restart it skips them,
so no finding is asked about twice.

Retries with backoff, and knowing what not to retry: a rate-limit answer waits as long as the provider asks; a wrong key
fails at once.

The command pattern for undo: each edit is saved with only what it replaced, and undo writes that back, newest first. A
deleted finding is only marked deleted, so undo restores it with its verdicts and label.

Longest common subsequence alignment keeps word times through a text edit: the words common to the old and new text keep
their own times, and changed words share the time of the words they replaced. It is the same idea as the diff tool and as
edit distance in natural language processing.

Idempotency and lineage: importing the same training file twice gives the same result as importing it once, because
every row has a key saying where it came from.

## Key ideas from the rewrite: the interface

This section collects the user-interface ideas from Wahy Studio's rewrite.

Server state and screen state are kept apart. Findings, words and the edit log live on the server and are cached by
TanStack Query; which words are selected lives only in the browser. An edit changes the server, and the screen follows by
reading again; nothing patches the screen by hand.

Derived state is computed, not copied. The editor computes the chosen reference from the suggestions and what the user
picked, instead of copying it into state, which is the classic source of screens showing stale data.

Performance comes from not doing work. Finding the spoken word among 20,000 takes about 15 steps with a binary search
over word start times. The video time, which changes 60 times a second, lives outside React so the transcript does not
re-render. Paragraphs off screen are skipped by the browser. A click near the end of a two-hour lecture went from about a
second to 22 milliseconds.

## What to learn next

This section suggests what the author could study next, based on what Wahy Studio's rewrite touched, ordered from the
machine learning side to the app side.

Evaluation design comes first, because Laya's numbers depend on which cards are used, who labelled them and which input
mode is scored; run 6's first evaluation never scored passage rows at all. Useful topics are balanced accuracy, the area
under the ROC curve, and the project's own evaluation script and report.

Calibration comes next, because the confidence that JEV and Laya report is not the probability of their chosen verdict.
The classic reading is Guo and colleagues, "On Calibration of Modern Neural Networks", and a good exercise is drawing a
reliability diagram on the author's own test cards.

Data versioning and lineage, with tools such as DVC or Hugging Face dataset versions, compared with how the project's
laya_v1, laya_v2 and laya_v3 datasets and fingerprinted caches work.

A training run on laya_v3, whenever the author wants one, would be the natural next experiment: the first model with no
training/serving skew.

On the backend side: Python type hints and FastAPI's dependency injection, which map directly to NestJS providers, and
FastAPI's guide on concurrency with async and await. SQL and SQLite: joins power the request log, and SQLAlchemy entities
and Alembic migrations map to TypeORM entities and Prisma migrations. Process communication: the engine client and worker
are a small example of a microservice with a message transport, without a network. Security basics: the OWASP Top Ten,
path traversal checks, keys that are never sent back, the access token and constant-time comparison; the access
middleware corresponds to a NestJS guard.

On the interface side: React state in depth (reducers, effects, refs, external stores, memoization), which maps to
Flutter's setState, Bloc and ValueNotifier; TanStack Query's guides on defaults and optimistic updates, which map to
Riverpod; and the testing pyramid with Playwright, which maps to Flutter's unit, widget and integration tests.

## How the rewrite was made

This section describes the process behind Wahy Studio's rewrite, which ran from 3 to 8 November 2026 on a git branch
called factory-reset.

It began with a read-only review that produced the friction map and the eight ADRs. The author agreed to a full rewrite
as a learning opportunity, saying "im a cs student so make this a learning opportunity". A roadmap split the work into 25
phases. Each phase named the Claude model and reasoning effort to use, the ADRs to read, a "Done when" test, and a
"Feature check" listing the numbered features (F-001 to F-137) it had to deliver.

The phases, in order, were: 1, a feature inventory of 137 features and 20 proposed new ones, each with a concrete check;
2, golden files from the old app and a measurement of the training/serving skew; 3, the repository skeleton; 4, the engine
package; 5, the envelope builders and the engine worker; 6, the server core (database, jobs, GPU owner, engine client); 7,
lectures and transcription; 8, corpora and detection; 9, screen design, clickable mockups that the author approved; 10,
the web shell; 11, the new-lecture and saved-lectures screens; 12, the lecture view with word-by-word sync; 13, the AI
provider layer; 14, the verification pass and telemetry on the server; 15, the verification and request-log screens;
16, editing and export on the server; 17, the editor and export screens; 18, Tafrigh on the server; 19, the Tafrigh
screen; 20, training data; 21, the corpora screens and status; 22, the data pipeline on the new core; 23, acceptance,
walking every feature's check in the new app; 24, retiring the old app, done only after the author said so; an extra
task 24b, the Colab runner and the public corpus; and 25, this explanation. Phases that needed the most judgement ran on
Claude Opus 5.5 at high effort; more mechanical ones on Claude Sonnet 5.5 at high or medium effort. Two small corrections
ran as their own tasks: adhkar became ordinary editable rows, reversing a phase-8 choice, and Quran verses inside hadiths
got their own brackets, the author's choice.

Every phase was one fresh Claude Code session started with the same short prompt: the recommended model and effort, an
instruction to ask first if the session was on another one, and "Read docs/rewrite/ROADMAP.md and do the next unticked
phase." The session pulled the branch, read the roadmap, the glossary, the architecture and its ADRs, did only that
phase, ran its tests and feature check, added a section to the learning log, ticked the phase, committed it as
"rewrite phase N" with the title, and pushed. A session never changed a phase or the scope on its own. When it needed a
decision it stopped with a question and options, and the author's answer was recorded in the roadmap's Changes section in
their own words. Work that needed the author's eyes, such as the mockups or a Colab session, was committed as a draft
first.

From phase 8 an orchestrator session ran the phases for the author. It launched one headless Claude session per phase
with the phase's model and effort, kept a state file so a dead session could be resumed, mirrored every report into a
reports file, and resumed a child session when it ended with a question. The author's standing instruction was to keep
going step by step until the end, stopping only for a question, a failed test gate, or phase 24. While the author was
away, a separate decider session on Opus answered children's questions, except about deletions, secrets, real spending
and phase 24.

Testing ran at every stage. Before code moved, 234 golden files recorded the old app's outputs. While it moved, each
phase tested its modules at their interfaces, ran golden tests through every layer, broke code on purpose to check the
tests, and ran live feature checks with real models where it mattered: a 16-minute Friday sermon by sheikh Mohammed
Meziane transcribed with Groq and local Whisper, Laya on the laptop's GPU, Gemini on the free tier. Paid calls cost a few
cents in total and were made only with the author's permission. At the end, phase 23 walked every feature's check in the
new app, and 135 of the 137 features are ticked. On 8 November 2026 the full test suite was green: 517 server tests (6 live tests skipped), 268 engine tests, 149 web unit tests and 40 Playwright end-to-end tests, with the linters and type checks clean.

## What is still open

This section lists what remains open in Wahy Studio at the end of the rewrite.

Feature F-130, the Colab runner, waits for one real Colab session by the author. The checklist: open the notebook from
the badge and choose a T4 GPU; run all and approve Google Drive; give the Hugging Face token and check that Laya reports
loaded on CUDA; open the printed link, remove the token from the address and see it still works, then open the plain
tunnel address in a private window and see that an access link is required; transcribe a short file with the
specialized Arabic Whisper and verify it with local Laya; after about a minute, check that the database file exists in
the Wahy-Studio folder on Drive; stop, run all again, and see the lecture is still there and the start is faster;
optionally, with Drive off, see that the backup zip appears.

Feature F-134, training Laya on Kaggle, is not ticked by the author's choice: no retraining for now, with laya_v3 kept as
the base for the next run.

Some gaps were agreed and not built: adhkar detection on engines v4 and v5 (only v3 detects adhkar, and a proposed
feature plans dhikr as a check after detection), custom corpus links (replaced by uploading a source), a second engine
picker in the lecture toolbar, making a saved lecture version current again, and a direct jump from "verify this quote"
to its request-log entry.

Some points are recorded for the author to decide: a user boundary of "extra start" or "extra end" is written to the
training row as it is, though the version-1 boundary question offers only four choices; two old Tafrigh files are
superseded by the labels table and could be deleted; and comments in the engine still name the old data pipeline
folder, left alone because editing an engine file changes the engine's fingerprint and so invalidates every data
pipeline cache.
