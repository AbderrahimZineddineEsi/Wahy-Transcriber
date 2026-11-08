# Wahy Studio, explained

The whole rewrite in one document, written for you: a CS student whose focus is ML, with a Node/Express and NestJS
backend background and some Flutter. It is built from `LEARNING.md` (one section per phase, more detail and more
commands), the ADRs in `docs/adr/`, `ARCHITECTURE.md`, `GLOSSARY.md`, the roadmap and the friction map
(https://claude.ai/artifact/Wq1c5X9rZpYhkARjXMT5uv).

A second version of this text, made for NotebookLM (no tables or code blocks, every section stands alone, the Arabic
and Islamic words explained where they appear), is `docs/rewrite/EXPLAINED-notebooklm.md`.

Contents:

1. What the app does
2. Before: the old app and what hurt
3. After: the new shape
4. One lecture through the new system
5. The eight decisions (ADRs) in plain words
6. Each technology and what it does here
7. Laya in the final state
8. Running it: the launcher, the public corpus, Colab
9. The ideas worth keeping
10. What to learn next
11. How it was made
12. What is still open

---

## 1. What the app does

Wahy Studio (مكتشف الوحيين, "the finder of the two revelations": the Quran and the Sunnah) takes a recorded Islamic
lecture and:

1. **Transcribes** it into timed words (Groq's Whisper, local Whisper turbo or small, or a specialized Arabic Whisper).
2. **Detects** every Quran verse, hadith and dhikr the speaker quotes, by matching the words against a corpus of
   6,236 verses, about 40,000 hadiths and an editable adhkar list. Each proposed quote is a **finding**.
3. **Verifies** findings with a model (Gemini, JEV, an OpenRouter chat model, or **Laya**, your own fine-tuned
   local model): is this a real quote, and is its span complete?
4. Lets you **edit** everything (fix words, add a missed quote, move a quote's edges, delete with a reason), with undo.
5. **Exports** subtitles (SRT, VTT, ASS) where a quote is never split across two captions, plus Markdown, text, HTML
   and JSON.
6. Turns the transcript into a written lesson (**Tafrigh**, تفريغ: "writing out" a recorded lesson) with headings, the
   matn (the text being explained) and the commentary.
7. Keeps your corrections as **gold labels** and exports them as training rows for Laya.

The words used in this document are defined in `GLOSSARY.md`. The few you need now: a **finding** is what the engine
*proposes*; a **quote** is what the speaker *really* recited; a **verdict** is a model's answer about a finding; a
**label** is a verdict kept as training truth; an **envelope** is the structured input Laya reads for one finding.

## 2. Before: the old app and what hurt

The old app (deleted in phase 24, still in git at commit `b28eeda`) was about 35,000 lines:

- **A browser app doing the real work.** `index.html` (2,110 lines of static markup) loaded 16 plain scripts from
  `js/` with `<script>` tags: the three detection engines (`engine.js`, `engine_v4.js`, `engine_v5.js`), the editor,
  the renderer, the AI verifier, state, i18n. Tailwind came from its development CDN.
- **A FastAPI server on the side** (`backend/`): transcription, Tafrigh and the Laya data pipeline, with all 28
  routes in one 1,154-line `app.py`.

The friction review counted 20 problems. The ones that mattered most:

| Problem | What it cost |
|---|---|
| **The Laya input was built in six places, in two languages.** Three JS builders in `ai-verifier.js`, three Python ones, and the run-6 notebook reshaped it again with its own `to_v3_state`. | **Training/serving skew**: Laya was trained on one input shape and served another. Phase 2 measured it: 2,019 of 4,901 rows differed, and the question text differed on every row. |
| **The engine only existed as browser scripts.** To build datasets, Python started Node and ran the browser files inside a fake browser (fake `document`, fake `localStorage`), loading the UI's `editor.js` because the engine called a function defined there. | A UI change could break dataset building. The engine could not be tested on its own. |
| **AI providers were called from both sides.** The browser called Gemini and OpenRouter with keys in `localStorage`; the server called them again from 10 files, each with its own retries and cost counting. | A teacher you evaluated in the datagen was not the code the app ran. Keys lived in the browser. |
| **Data lived in five places, lectures only in the browser** (IndexedDB), Tafrigh runs and datasets in assorted folders. | Your corrections never reached the server or the datagen without a manual export. Clearing browser data lost work. |
| **One global object (`currentState`, 49 fields) edited from 10 files, about 690 references, and the screen redrawn by hand** (83 render calls in `events.js`, 71 `innerHTML` writes). | A wrong verdict on screen could come from any of 10 files; a forgotten refresh showed stale data. |
| **Two home-made job systems**, both in memory; verification ran inside the browser tab. | A restart lost every running job; closing the tab stopped a verification. |
| **Nobody owned the GPU.** Each module loaded its own model on the 3 GB GTX 1050; Laya unloaded Whisper through a callback it was handed. | Two jobs at once could run out of memory or silently fall back to the CPU, about 30 times slower. |
| **Translation keyed by the Arabic sentence itself** (1,486 entries, swapped into the page by a `MutationObserver`). | Fixing one Arabic word silently broke its English. |
| **No frontend tests at all**; the server's HTTP layer, transcription and GPU code had almost none. | Nothing would warn you during a rewrite. |

What already worked and was kept: Tafrigh's design (it never changes the spoken words, every edit passes validators),
the *idea* of one engine for the app and the data, envelope versions chosen by the checkpoint's own config, atomic
captions, word timings kept through edits, and the datagen's caching.

## 3. After: the new shape

The idea in one sentence: **the server does all the work and stores all the data; the web app only shows it and sends
your actions.**

```
 browser                       server (one process, port 8000)                      helper processes / files
┌──────────────┐  HTTP + SSE  ┌──────────────────────────────────────────────┐
│ web/ (React) │ ───────────► │ features/*  router → service                 │
│ shows, sends │ ◄─────────── │   lectures transcription detection verify    │
└──────────────┘              │   editing export tafrigh corpora training …  │
                              │ core/                                        │  JSON lines   ┌──────────────────┐
                              │   engine.py ───────────────────────────────────────────────► │ Node engine      │
                              │   ai/      (Gemini, OpenRouter, Groq, Laya)  │  over pipes   │ worker (engine/) │
                              │   gpu.py   (one model in VRAM at a time)     │               │ 90 MB corpus,    │
                              │   jobs.py  (threads, pause, resume, cancel)  │               │ loaded once      │
                              │   db.py    (SQLite + Alembic) ─────────────────► data/wahy.db └──────────────────┘
                              │ laya/      (research: datasets, teachers)    │   data/media, corpus.json,
                              └──────────────────────────────────────────────┘   tafrigh_runs/, laya_datagen/
```

Folders:

| Folder | What it is | Size (lines, no tests) |
|---|---|---|
| `server/wahy/core/` | the shared machinery: settings, database, jobs, GPU owner, engine client, AI layer, access guard | |
| `server/wahy/features/` | one folder per feature, each `router.py`, `service.py`, `schemas.py`, `models.py` | 24,300 with core and laya (Tafrigh alone was 5,700, copied) |
| `server/wahy/laya/` | the research side: datagen command line, teachers, dataset builders, Kaggle scripts | |
| `engine/src/` | TypeScript package: engines v3/v4/v5, envelope builders, captions, export, edits, search, the worker | 7,000 |
| `web/src/` | React app: `shell/` (layout, theme, i18n, settings, errors), `api/` (generated types), `features/` | 12,100 |
| tests | `server/tests` (8,700 lines), `engine/src/*.test.ts`, `web/src/**/*.test.tsx`, `web/e2e/` | |

The rules of the shape:

- **A feature only talks to `core/` and, in one direction, to other features' services.** For example `transcription`
  imports `lectures` (it needs to save words), never the reverse. That is why a YouTube link starts at
  `POST /api/transcriptions/youtube` and not at `/api/lectures`.
- **A router translates HTTP and nothing else**; the rules live in the service, which is plain Python a test can call.
- **Every core module is deep**: a small interface over a hard problem.

| Module | What callers do | What it hides |
|---|---|---|
| `core/engine.py` | `engine.detect(words, {"engine": "v5"})` | the Node process: start, crash, timeout, restart with another hadith file, one request at a time |
| `core/ai/` | `ai.verify("gemini", items, call=...)` → one `Answer` per item | keys, free-tier pacing, retries, cost, the request log |
| `core/gpu.py` | `with gpu.use("laya") as model:` | waiting your turn, unloading the other model, freeing VRAM |
| `core/jobs.py` | `runner.submit("transcribe", params)`, `ctx.progress(...)`, `ctx.check()` | threads, pause/resume/cancel, saved status, restart recovery |
| `core/db.py` | `with db.session() as s: s.add(Lecture(...))` | SQLite pragmas (foreign keys on, WAL), migrations at start-up |

## 4. One lecture through the new system

1. You paste a YouTube link. The web app sends `POST /api/transcriptions/youtube {url}`.
2. The transcription service has the lectures service save an empty lecture, and submits a **transcribe job**. The
   answer comes back at once with a job id; the web app opens the job's progress stream
   (`GET /api/jobs/<id>/events`, server-sent events).
3. The job downloads the media (yt-dlp, cached by a hash of the link), extracts 16 kHz mono audio (ffmpeg), asks the GPU
   owner for Whisper (or calls Groq), and saves the timed words. If a model fails, the next one in the fallback chain
   runs, and the result says which model really ran and why.
4. The web app sees the job finish and starts a **detect job**. It sends the words to the Node engine worker and saves
   the findings. The lecture screen shows the transcript beside the video, the spoken word lit as the video plays.
5. You start a **verification pass** with Laya. The job asks the checkpoint which envelope it was trained on (its config
   says `wahy_envelope: 3`), asks the engine for exactly those envelopes, and the GPU owner swaps Whisper out and Laya in.
   Each verdict is saved; each request is logged with its tokens, cost and latency.
6. You correct a verdict in the editor. That is saved as a **gold label**, and as one row in the lecture's **edit
   log**, so it can be undone, also after a reload.
7. The training export reads the labels and writes Laya rows with the same envelopes. The datagen reads the same
   database, so your corrections reach the dataset without a manual export.

## 5. The eight decisions (ADRs) in plain words

An **ADR** (architecture decision record) is a short file saying what was decided, why, and what else was considered.
It exists so that a later reader (you, or an AI session) does not undo a decision without knowing its reason. A
changed decision gets a new ADR that supersedes the old one; none was needed during this rewrite.

**ADR 0001: rewrite beside the old app, one tested phase per session.** The new code was built in new folders next to
the old app, which kept running until acceptance passed (phase 23) and was deleted only then (phase 24). Before any code
moved, the old app's outputs were saved as **golden files**, and the new code had to reproduce them byte for byte.
*Why:* Laya's results depend on findings and envelopes staying identical, and a rewrite you cannot compare with the old
app loses features silently. *Rejected:* changing the old code in place (every intermediate state designed twice), or one
big-bang session (impossible to verify, nothing to learn from).

**ADR 0002: the engine stays TypeScript, run on the server in a Node worker.** About 4,200 lines of tuned matching
logic were moved, not ported. The server starts one long-lived Node process and talks to it with one JSON message per
line. The browser never loads the 90 MB corpus. *Why:* porting tuned heuristics to Python is long and risky with only
golden tests to prove parity, and keeping one language means the app and the dataset builder run literally the same
functions. *Rejected:* a Python port; keeping the engine in the browser.

**ADR 0003: one envelope builder; datasets store the final envelopes.** Only `engine/` builds envelopes (one function
per version). The dataset stores each row's envelope as it will be read, and training and evaluation code read it as
is, never reshaping it. *Why:* the six builders in two languages are what caused the run-6 skew. *Consequence:* changing
an envelope means a new version, a rebuilt dataset and a new checkpoint; old checkpoints keep working because each one
records the version it expects. This is the decision that matters most for your ML work.

**ADR 0004: all model calls go through one server-side provider layer.** Gemini, OpenRouter (JEV and chat models),
Groq and local Laya are all called from `core/ai/`, which owns the keys, pacing, retries, cost and the request log. App
verification, Tafrigh and the datagen's teachers all use it. The browser holds no keys. *Why:* the old code called
Gemini from 4 files and OpenRouter from 8, so an evaluated teacher was not the code the app ran.

**ADR 0005: SQLite for app data; media, corpus and datasets stay files.** One file, `data/wahy.db`, through SQLAlchemy
with Alembic migrations. *Why:* one user on one machine needs no database server, while IndexedDB hid your corrections
from the server and the datagen. Datasets stay files because Kaggle reads files.

**ADR 0006: one GPU owner, one model in VRAM at a time.** A single owner decides which model (Whisper, the specialized
Whisper or Laya) is on the 3 GB card. Jobs ask and wait; it unloads whatever else is there first. *Why:* the old modules
each loaded their own models, which could run out of memory or fall back to the CPU, about 30 times slower.

**ADR 0007: one job runner for all long work, with job state in SQLite.** Transcription, detection, verification and
Tafrigh are jobs with saved progress, pause, resume and cancel, and one progress stream. After a restart unfinished jobs
show as *interrupted* and can be resumed where the work allows. *Why:* the old two in-memory systems forgot everything
on restart. *Rejected:* Celery or RQ with Redis, built for many machines and users; here they would only add a second
service to run.

**ADR 0008: a React + TypeScript web app, typed from the server's API, translated by keys.** Vite, Tailwind, feature
folders, TanStack Query for server data, types generated from the server's OpenAPI schema (a server change that breaks
the web app fails the type check), and text looked up by keys (`t("nav.settings")`), Arabic first and right to left,
plus English. *Why:* the global object, the hand refreshes and the Arabic-keyed translations. *Rejected:* plain
TypeScript with no framework (less to learn, but the refresh problem returns in an interactive editor and player).

## 6. Each technology and what it does here

### Server (Python)

| Technology | What it does here | You know it as |
|---|---|---|
| **Python 3.12 + uv** | `uv sync` creates `server/.venv` from `pyproject.toml` and pins versions in `uv.lock`; `uv run pytest` runs inside it. Optional extras: `local-asr` (faster-whisper and NVIDIA libraries), `laya` (torch for CUDA 12.6, laya), `research` (pandas, notebooks). | `npm` + `package-lock.json` |
| **FastAPI** | The web framework: routes, request validation, dependency injection (`Depends`), and an OpenAPI schema generated from the code (open `/docs`). Also serves the built web app from the same port. | NestJS / Express |
| **Pydantic** | The request and response classes (`schemas.py`): validation and the OpenAPI types. | DTOs with class-validator |
| **SQLAlchemy** | The ORM: a table is a class (`Lecture(title=...)`), sessions, transactions. | TypeORM / Prisma |
| **Alembic** | Migrations, written with `alembic revision --autogenerate` and applied at start-up. A test fails if a model changes without a migration. | TypeORM migrations |
| **SQLite (WAL mode)** | The database file. Foreign keys are switched on (SQLite has them off by default); WAL lets the web app read while a job writes. | |
| **threads + asyncio** | FastAPI serves requests on one asyncio loop; each long job gets its own thread so it does not freeze requests. Updates cross over with `loop.call_soon_threadsafe`. Pause is a `threading.Condition`. | Node's event loop + worker threads |
| **Server-sent events (SSE)** | A response that stays open and sends `event: job` blocks; the browser's `EventSource` reads them. One way only, which is all a progress bar needs. | |
| **httpx** | HTTP client for every provider; tests replace the network with `httpx.MockTransport`. | axios + nock |
| **yt-dlp, ffmpeg** | Downloading from YouTube (a library, in-process, with a progress hook) and extracting audio (a child process that is killed when you cancel). | |
| **faster-whisper, torch, laya** | Local speech recognition and the local Laya model, on the GPU through the GPU owner. torch comes from PyTorch's CUDA 12.6 index because the CUDA 13 builds have no kernels for the GTX 1050. | |
| **pytest, ruff** | Tests (about 520) and the linter. | Jest, ESLint |

### Engine (TypeScript, run by Node)

| Technology | What it does here |
|---|---|
| **TypeScript with loose types** | Only the public interface is typed (`Word`, `Finding`, `DetectOptions`); the 4,000 lines of moved JS are imported as they are (`allowJs`, no `checkJs`). Typing them would have meant touching every line. |
| **Node 22.18+ type stripping** | Node runs `.ts` files directly by removing the types, so the worker needs no build step and no `node_modules`. This is why `run.sh` checks the Node version. |
| **ES modules** | Every file says what it imports. The old scripts shared one global scope and depended on load order. |
| **JSON Lines over stdin/stdout** | The worker protocol: one JSON message per line, `{"id": 7, "cmd": "detect", ...}` in, `{"id": 7, "ok": true, "result": ...}` out; logs go to stderr so they never look like answers. |
| **Vitest** | The engine's tests, including the golden ones (268). |

### Web (React)

| Technology | What it does here | Flutter / NestJS equivalent |
|---|---|---|
| **React** | Components are functions of their data; hooks (`useState`, `useReducer`, `useRef`, `useEffect`) give them state and side effects. | widgets, `setState`, a `Bloc` |
| **Vite** | Dev server with instant reload and a proxy to the API (one origin, no CORS); `vite build` makes the static files the server serves. | `flutter run` / `flutter build web` |
| **Tailwind v4 + design tokens** | Utility classes (`p-4 text-quran`); the colours, fonts and spacing are named tokens in `web/src/shell/tokens.css`, switched for dark mode by one attribute. | `ThemeData` |
| **TanStack Query** | Server data: fetched, cached under a key, shared, refetched; `invalidateQueries` after a write; optimistic updates. | `FutureProvider` with caching, `ref.invalidate` |
| **openapi-typescript + openapi-fetch** | `npm run api:generate` turns the server's schema into `schema.d.ts`; every call is type-checked. | a generated API client |
| **i18n by keys** | `ar.ts` and `en.ts` with the same keys and `{slots}`; a test checks both files match. | `intl` ARB files |
| **Vitest + Testing Library, Playwright** | Unit tests of logic and screens against a fake server; Playwright drives a real browser against the real server (40 tests). | `flutter_test`, `integration_test` |

### AI providers

| Provider | Used for |
|---|---|
| **Groq** (`whisper-large-v3-turbo`) | Cloud speech recognition, cheap and fast; long audio is cut into 45-minute chunks. |
| **Gemini** (`gemini-3.5-flash-lite` and others) | Batched verification (5 to 10 findings per request) on the free tier, Tafrigh, a datagen teacher. |
| **OpenRouter: JEV** (`typesafe/jev-1.14`) | Calibrated probabilities for CORRECT / FALSE / NOT_SURE. |
| **OpenRouter: chat models** | Any of 500+ models with live prices (DeepSeek, Qwen, ...). |
| **Laya** (local) | Your fine-tuned verifier, offline, about 1.2 GB of VRAM, under a second per decision on the GTX 1050. |
| **fake** | A verifier for tests, so no test spends money. |

### Outside the code

| Tool | Role |
|---|---|
| **GitHub release asset** | The 90 MB corpus (`corpus-v1`), public, downloaded by `run.sh` and checked against its sha256. |
| **Google Colab + Drive + Cloudflare tunnel** | Running the whole app on a free T4 GPU (section 8). |
| **Kaggle** (2× T4) | Fine-tuning Laya from the dataset files (section 7). |
| **Hugging Face Hub** | Where the Laya checkpoints live (private repos under `ZenoAbderrahim/`). |

## 7. Laya in the final state

This is the part most connected to your studies, so here it is on its own.

- **The task.** For each finding, Laya answers a classification question (CORRECT / FALSE / NOT_SURE: is this a real
  quote or the speaker's own words?) and, in some versions, a boundary question (is the start or the end cut off?).
- **The served checkpoint** is `laya-wahy-r6-v3_mixed` (run 6, variant `v3_mixed`, envelope 3, verdict only). On your
  labelled cards in passage mode it scored 90.3 % accuracy and AUC 0.967. Its boundary comes from a **word-overlap
  rule** (did the speaker say a corpus word right before or after the span?), because in runs 1 and 2 the boundary head
  collapsed to "always complete" and the rule beat every model.
- **Envelope 3** groups consecutive verses of one surah (at most 2 words apart, cut into parts of at most 6 verses)
  into one **passage**, and lists the nearest **neighbour** findings without their verdicts. A passage gets one answer;
  "start cut off" can only be true of its first verse and "end cut off" of its last, so the answer is split into two
  yes/no probabilities and each verse gets its share.
- **Serving reads the checkpoint's own config.** `rl_agent_config.json` says `wahy_envelope: 3`, `passages: true`,
  questions `["verdict"]`. The server builds exactly that, with the same engine function that built the training rows.
  A v1 checkpoint gets v1 envelopes (the old app sent v3 to every checkpoint).
- **Skew, measured and removed.** Phase 2 found the run-6 rows differ from what the app sends: every question text, and
  2,019 hadith and dhikr states (`"quran_neighboring_context": null` in training, the key absent in the app). To a
  person those are "the same"; to a language model `{"a": 1, "q": null}` and `{"a": 1}` are different token sequences.
  The run-6 model is still the one served, so that skew is still there today, and it is known and measured.
- **The new dataset, `laya_v3`** (phase 22), stores every row as the engine's own envelope 3, with the same labels,
  split and gold as `laya_v2`, and `notebooks/kaggle/laya_v3_kaggle.ipynb` reads the rows as they are. It has not been
  trained on: you decided on 2026-11-07 to keep serving r6 `v3_mixed` ("we're not retraining laya anytime soon"). A
  model trained on `laya_v3` would be the first with no skew at all.
- **Where training rows come from now:** your corrections in the app (gold labels with how they were given: a verdict,
  approve all, delete as ordinary speech, a missed quote), the verifiers' newest verdicts (non-gold), Tafrigh sentences,
  and the old app's export. Each row knows its origin (**data lineage**), and importing the same row twice replaces it
  (an **idempotent** import).
- **The research side** is `python -m wahy.laya` (build, compare hashes, label cards with a teacher, the run-6 skew
  report, validate, zip). Teachers are thin adapters over `core/ai`, so a teacher evaluation now describes the code the
  app runs, and their answers are cached under a key that includes the prompt version.

## 8. Running it: the launcher, the public corpus, Colab

**On your laptop.** `./run.sh` is the promise "fresh clone, one command, working app". It checks node (22.18+), npm, uv
and ffmpeg, installs the Node packages only when the lock file changed, builds the web app only when its sources are
newer than `web/dist`, runs `uv sync`, downloads the corpus the first time, and serves everything on
http://127.0.0.1:8000. Every step is safe to repeat, so the second start takes seconds. `scripts/dev.sh` is the
development mode (server on 8120, web on 5173 with hot reload).

**The public corpus.** The corpus (Quran and hadith, 90,256,830 bytes) used to be only in the private Wahy-Finder
repo, so a fresh clone needed your GitHub login. Since task 24b it is a public release asset of this repo, `corpus-v1`.
`scripts/fetch_corpus.sh` downloads it to `data/corpus.json.part`, checks the sha256 (`ffe22b80...b69f67`) and only
then renames it; a cut-off or wrong file is thrown away. The old `gh` and `GITHUB_TOKEN` routes to the private repo are
kept as fallbacks. The Wahy-Finder repo itself stays private and untouched.

**On Colab** (task 24b, F-130). `notebooks/colab/wahy_colab_runner.ipynb`, generated by `scripts/make_colab_notebook.py`
and opened from the README's badge, runs the whole app on a free T4 in three cells and one *Run all*:

1. options, clone, Google Drive, secrets (`HF_TOKEN` for the private Laya checkpoint; the provider keys are optional);
2. install everything in parallel (Python packages, Node and the web build, the corpus, the models); the built web app
   is cached on Drive under a key made from git's hashes of `web/` and `engine/`, so later sessions skip npm;
3. start the app with the same `./run.sh`, load Laya on the GPU, open a Cloudflare tunnel, print a private link.

Three design points worth understanding:

- **Drive is a backup, not the data folder.** Drive in Colab is a network file system, and SQLite needs real file locks
  and its write-ahead log, which Drive does not give reliably. So the app runs on the VM's disk and a background thread
  copies `data/` and the keys file to *My Drive/Wahy-Studio* every minute: the database through SQLite's backup API (a
  consistent snapshot while the app writes), other files only when their size or time changed, and never deleting on
  Drive. With Drive off, a backup zip without keys is refreshed every 2 minutes.
- **A token guards the public link.** The tunnel address is open to the internet, so `WAHY_ACCESS_TOKEN`
  (`core/access.py`, an ASGI middleware that sees every request first) requires a random token. The link carries
  `?token=...`; the guard swaps it for an `HttpOnly` cookie and redirects, so the token leaves the address bar; scripts
  send an `X-Wahy-Token` header. The comparison is constant-time (`hmac.compare_digest`), and the notebook hides the token
  in the server's logs.
- **One start-up path.** Colab runs `./run.sh` instead of its own start-up code, so the laptop and Colab cannot drift
  apart. Doing this found a real bug: the old notebook installed Node 20, which cannot run the TypeScript worker.

What is verified: the guard, Drive sync and restore with a live database, the backup zip, path safety, the build cache,
the corpus download (a real 90 MB download matched in 7 s). What is not: a real Colab session (the T4, `cloudflared`, the
Drive pop-up). F-130 stays unticked until you run it once (the checklist is in section 12).

## 9. The ideas worth keeping

These came up again and again; each has a small example from this code.

- **Golden (characterization) tests.** Record what the old code *does*, right or wrong, and require the new code to
  produce the same bytes. Example: engine v5 labels a Fatiha phrase as `يونس: 10`; the golden file keeps the mistake,
  because fixing the engine is a separate decision, never hidden inside a refactor. The generator must be deterministic:
  pinning `Math.random` to a constant made three ids equal and lost two of six export rows, so it became a seeded sequence.
- **Expected differences are written down, never regenerated.** When you chose brackets for verses inside hadiths, one
  golden finding changed. Instead of regenerating the golden files, `engine/src/golden-differences.ts` lists the change by
  hand, and the test applies exactly that to the old file before comparing.
- **Tests with teeth (mutation checks).** Break the code on purpose and see whether a test fails. Moving
  `candidateThreshold` from 6.8 to 30 failed at once; moving `minIslandIdf` from 3.8 to 3.7 failed nothing, which told
  us the golden inputs have no quote near that cut-off.
- **Training/serving skew.** The model must see the same input in training and in use. The fix was structural (one
  builder, datasets store final envelopes), not "be careful".
- **Deep modules.** `detect()` is one function with six options over 4,100 lines and a matcher cache. Callers learn
  little and get a lot.
- **Ports and adapters.** The verification pass knows one shape, `verify(items) -> [Answer]`; Gemini, JEV, OpenRouter,
  Laya and a fake stand behind it. Swapping verifiers is a string; tests plug in the fake.
- **Fakes outside, real inside.** Tests use real ffmpeg, real SQLite and the real GPU owner with fake models, fake Groq
  servers and a fake downloader. One real end-to-end test (golden lectures through the HTTP API, a job thread and the
  Node worker) proves the pieces fit.
- **Cooperative cancellation.** Python cannot stop a thread from outside, so a job calls `ctx.check()` between steps,
  where it sleeps (paused) or raises `JobCancelled`. A careless `except Exception` would turn "user pressed cancel" into
  "Groq failed, try the next model", so the fallback chain lets it through.
- **Checkpoints and resume.** A verification pass saves `{"chunks": 3}` after each request; after a restart it skips the
  chunks already done, so no finding is asked about twice.
- **Retries with backoff, and knowing what not to retry.** A 429 waits as long as the server asks (`Retry-After`); a 401
  is fatal, because waiting cannot fix a wrong key.
- **The command pattern for undo.** Each edit is a row with only what it replaced; undo writes `before` back, newest
  first. A deleted finding is only marked deleted, so undo restores it with its verdicts and label.
- **LCS alignment.** When you fix the text, the longest common subsequence of old and new words says which words stayed
  and keep their times; the changed words share the time of the words they replaced. Same idea as `diff` and edit distance.
- **Server state vs screen state.** Findings live on the server (TanStack Query); which words are selected lives in the
  browser (`useReducer`). An edit changes the server and the screen follows; nothing patches the screen by hand.
- **Derived state, not copied state.** The studio computes the chosen reference from the suggestions and what you
  picked, instead of copying it into state, which is the classic source of stale screens.
- **Performance by not doing work.** A binary search finds the spoken word among 20,000 in about 15 steps; the player
  time lives outside React; paragraphs off screen are skipped (`content-visibility: auto`). A late click went from 1 s to
  22 ms.
- **Evidence, not opinion.** Each ticked feature names a test or a measured result anyone can rerun.

## 10. What to learn next

Ordered by how much they help your ML focus, then the backend and the app.

| Topic | Why, in this project | Where to start | Mapping |
|---|---|---|---|
| **Evaluation design** | Laya's numbers depend on which cards, which labeller and which input mode (run 6's first eval never scored passage rows). | `server/wahy/laya/kaggle/eval_laya.py`, `docs/reports/laya-eval-report.md`; read about balanced accuracy, AUC, calibration. | — |
| **Calibration** | JEV's and Laya's `confidence` is not the chosen verdict's probability; temperature scaling sits in the Kaggle scripts. | Guo et al., "On Calibration of Modern Neural Networks"; reliability diagrams on your test cards. | — |
| **Data versioning and lineage** | `laya_v1`, `v2`, `v3`, cache keys with fingerprints, idempotent imports. | DVC or Hugging Face Datasets versions; compare with `laya_v3.py`. | NestJS: migrations for data |
| **A training run on `laya_v3`** | The first model with zero skew; when you want it, it is the natural next experiment. | `notebooks/kaggle/laya_v3_kaggle.ipynb`. | — |
| **Python typing and async** | The server uses type hints, `Annotated`, `Depends`, threads and asyncio side by side. | FastAPI's "Concurrency and async/await" page; mypy or pyright on `core/`. | NestJS providers and DI ↔ `Depends`; Express middleware ↔ ASGI middleware |
| **SQL and SQLite** | Joins power the request log ("this request judged these findings"); WAL, foreign keys, migrations. | `sqlite3 data/wahy.db .schema`; SQLAlchemy 2.0 tutorial. | TypeORM entities ↔ `models.py`; Prisma migrate ↔ Alembic |
| **React state, deeper** | Reducers, effects, refs, `useSyncExternalStore`, memo. | react.dev "Managing State" and "Escape Hatches"; then `web/src/features/editing/board.ts`. | Flutter: `setState` ↔ `useState`, `Bloc` ↔ reducer, `ValueNotifier` ↔ the clock store, `key` ↔ React `key` |
| **TanStack Query** | Caching, invalidation, optimistic updates. | Its "Important Defaults" and "Optimistic Updates" guides; `web/src/features/verification/api.ts`. | Riverpod `FutureProvider` + `ref.invalidate` |
| **Testing pyramids and Playwright** | Unit, screen, end-to-end, golden, live tests, and when each pays. | `web/e2e/acceptance.spec.ts`; Playwright's "Best practices". | Flutter: unit / widget / `integration_test` |
| **Process communication** | The engine worker: pipes, JSON lines, timeouts, restarts. | `server/wahy/core/engine.py` and `engine/src/worker.ts`. | NestJS microservices with a transport |
| **Security basics** | Path traversal checks, keys that never come back, the access token, constant-time comparison. | OWASP Top 10; `core/access.py`, `test_web_mount.py`. | NestJS guards ↔ the middleware |

## 11. How it was made

**The plan.** On 2026-11-03 a read-only review produced the friction map and eight ADRs. You agreed to a full rewrite
on a new branch, `factory-reset`, as a learning opportunity ("im a cs student so make this a learning opportunity"). The
roadmap (`ROADMAP.md`) split it into 25 phases, each with its model and effort, the ADRs to read, a **Done when** test and
a **Feature check** naming the `F-xxx` features it must deliver.

| # | Phase | Model, effort |
|---|---|---|
| 1 | Feature inventory (137 features, 20 proposed) | Opus 5.5, high |
| 2 | Golden files and the skew measurement | Opus 5.5, high |
| 3 | Repository skeleton | Sonnet 5.5, medium |
| 4 | Engine package | Opus 5.5, high |
| 5 | Envelope builders and the engine worker | Opus 5.5, high |
| 6 | Server core | Opus 5.5, high |
| 7 | Lectures and transcription | Sonnet 5.5, high |
| 8 | Corpora and detection | Sonnet 5.5, high |
| 9 | Screen design (mockups, tokens) | Opus 5.5, high |
| 10 | Web shell | Sonnet 5.5, high |
| 11 | Web: new lecture and saved lectures | Sonnet 5.5, medium |
| 12 | Lecture view | Opus 5.5, high |
| 13 | AI provider layer | Opus 5.5, high |
| 14 | Verification pass and telemetry (server) | Opus 5.5, high |
| 15 | Web: verification and telemetry | Sonnet 5.5, high |
| 16 | Editing and export (server) | Opus 5.5, high |
| 17 | Web: editor and export | Opus 5.5, high |
| 18 | Tafrigh (server) | Sonnet 5.5, high |
| 19 | Web: Tafrigh | Sonnet 5.5, high |
| 20 | Training data | Opus 5.5, high |
| 21 | Corpora screens and status | Sonnet 5.5, medium |
| 22 | Datagen on the new core | Opus 5.5, high |
| 23 | Acceptance | Opus 5.5, high |
| 24 | Retire the old app (after your go-ahead) | Sonnet 5.5, medium |
| 24b | Colab runner and public corpus (extra task) | Sonnet 5.5, high |
| 25 | This document | Opus 5.5, high |

Work ran from 2026-11-03 to 2026-11-08. Two corrections ran as their own small tasks: adhkar became editable rows
(8b, your reversal of a phase-8 choice) and verses inside hadiths got their own brackets (16b, your choice).

**How a session worked.** Every phase was one fresh session started with the same prompt:

> Recommended: \<model\>, \<effort\> — if you're not on it, ask me first. Read docs/rewrite/ROADMAP.md and do the next
> unticked phase.

The session checked out the branch and pulled, read the roadmap, the glossary, the architecture and the phase's ADRs,
did only that phase, ran its Done-when tests and Feature check, appended a section to `LEARNING.md`, ticked the phase,
and committed `rewrite phase N: <title>` and pushed. It never changed a phase or the scope on its own: if it needed a
decision it stopped with `QUESTION:` and the options, and your answer went under **Changes** in the roadmap with your
own words. Work that needed your eyes (the mockups, a Colab session) was committed as a draft first.

**The orchestrator.** From phase 8 an orchestrator session (Sonnet 5.5, medium) ran the phases for you: it launched
one headless child per phase (`claude -p --name refactoring-step-N --model ... --effort ...`), kept its state in
`docs/rewrite/orchestrator-state.md` so a dead session could be resumed, mirrored every report into
`docs/rewrite/orchestrator-reports.md`, and resumed a child with `--resume` when it ended with a QUESTION. Your standing
instruction: "keep going step by step until you finish", stopping only for a QUESTION, a failed gate or phase 24. While
you were away, a decider session (Opus 5.5, high) answered children's questions, but never deletions, secrets, real
spending or phase 24.

**How it was tested.**

- **Before code moved:** 234 golden files from the old app, run in Node with a fake browser (phase 2).
- **While it moved:** each phase's own tests at each module's interface, golden tests through every layer (findings,
  envelopes, captions, exports, the Laya JSONL), mutation checks, and live feature checks with real models where it
  mattered: a 16-minute Mohammed Meziane khutba transcribed with Groq and local Whisper, Laya on the GTX 1050, Gemini on
  the free tier. Paid calls cost a few cents in total and were made only with your permission.
- **At the end:** phase 23 walked every feature's `check:` line in the new app (23 Playwright acceptance tests plus a live
  walk); 135 of 137 features are now ticked.
- **Today** (`scripts/test.sh`, 2026-11-08, phase 25): all green. Server 517 passed (6 live tests skipped) and ruff clean; engine 268 tests and the type check; web 149 unit tests, type check, lint, and 40 Playwright tests.

**Commands to look at it yourself.**

```bash
git log --oneline --grep "rewrite phase"            # the phases, one commit each
scripts/test.sh                                      # every suite
./run.sh                                             # the app on http://127.0.0.1:8000 (then /docs for the API)
grep -n "^- \*\*2026" docs/rewrite/ROADMAP.md        # every decision you made, with your words
```

## 12. What is still open

- **F-130, the Colab runner**, waits for one real session. Your checklist: open the badge and pick a T4 GPU; *Run all*
  and approve Drive; give `HF_TOKEN` and check "Laya: loaded ... cuda"; open the link and remove `?token=...` (it still
  works), then open the plain tunnel address in a private window (it should say an access link is needed); transcribe a
  short file with the specialized Whisper and verify with local Laya; after about a minute,
  `My Drive/Wahy-Studio/data/wahy.db` exists; stop, *Run all* again, and the lecture is still there and the start is
  faster; optionally, with Drive off, `/content/wahy-backup.zip` appears.
- **F-134, Kaggle training**, is not ticked by your choice: no retraining for now; `laya_v3` waits as the base for the
  next run.
- **Agreed gaps, not built:** adhkar detection on engines v4 and v5 (only v3 detects adhkar; N-001 plans dhikr as a check
  after detection), custom corpus URLs (replaced by uploading a source), a second engine picker in the lecture toolbar,
  making a saved lecture version current again, a direct jump from "Verify this quote" to its request-log entry.
- **Open points recorded for you:** a user boundary `EXTRA_START` / `EXTRA_END` is written to the Laya row as it is,
  though the v1 boundary question offers only four choices; `training_store.py` and `exporters.py` in
  `features/tafrigh/` are superseded by the labels table and could be deleted (your call); comments in `engine/src/` still
  name `backend/laya_datagen` (editing an engine file changes the engine fingerprint and so every datagen cache key).
- **One doc slip found while writing this:** the README's quick start says "Node 20+", but `run.sh` needs Node 22.18+
  (the TypeScript worker). Not changed here (outside this phase).
