# Target architecture

What the rewrite builds. The reasons are in `docs/adr/`, the words in `GLOSSARY.md`, the problems it fixes in the
friction map (https://claude.ai/artifact/Wq1c5X9rZpYhkARjXMT5uv), and the order of work in `ROADMAP.md`.

## The idea in one paragraph

Today the browser does most of the work: it runs the engine, calls the AI providers, holds the keys and stores your
lectures, while the server does transcription and Tafrigh on the side. After the rewrite the **server does all the
work and stores all the data**, and the **web app only shows it and sends your actions**. The engine and the Laya
envelope builders become one TypeScript package that the server runs in a helper Node process, so the app and the
dataset builder use the same code.

## Folders

```
server/                Python 3.12, FastAPI, managed with uv
  wahy/
    main.py            builds the FastAPI app and mounts each feature's router
    core/              shared machinery, no feature logic
      settings.py      paths and API keys (.env), read once
      db.py            SQLite + SQLAlchemy; Alembic migrations in server/migrations/
      jobs.py          the job runner (ADR 0007)
      gpu.py           the GPU owner (ADR 0006)
      engine.py        client for the Node engine worker (ADR 0002)
      ai/              the provider layer (ADR 0004): gemini, openrouter, groq, laya_local, fake
    features/          one folder per feature: router.py, service.py, schemas.py, models.py
      lectures/  transcription/  detection/  verification/  editing/  export/
      tafrigh/   corpora/        telemetry/  training/
  laya/                the research side (was backend/laya_datagen): datagen CLI, teachers, dataset build, evals
  tests/
engine/                TypeScript: engines v3/v4/v5, envelope builders v1/v2/v3, worker entry, golden tests
web/                   React + TypeScript + Vite + Tailwind
  src/
    api/               client and types generated from the server's OpenAPI schema
    shell/             layout, navigation, theme, i18n (ar, en), settings, errors
    features/          same names as the server's features
notebooks/             research notebooks and Kaggle scripts (read datasets, never rebuild envelopes: ADR 0003)
data/                  git-ignored: wahy.db, media/, corpus.json, tafrigh_runs/, laya_datagen/, legacy/
```

Until the acceptance phase, the old app (`backend/`, `js/`, `css/`, `index.html`) stays where it is and keeps running
(ADR 0001).

## The modules, and what each one hides

A good module has a **small interface and a lot behind it**: callers learn little and get a lot. Each core module
below hides one hard problem.

| Module | What callers do | What it hides |
|---|---|---|
| `engine/` (via `core/engine.py`) | `detect(words, options)` → findings; `envelopes(findings, words, version)` → Laya inputs; `search(text)` → references | 4,200 lines of matching, the corpus loaded once, the Node process |
| `core/ai/` | ask a verifier or teacher about some items, get structured answers | keys, free-tier pacing, retries, cost, logging every request |
| `core/gpu.py` | "I need Laya" → wait → use it | which model is loaded, unloading, CPU fallback |
| `core/jobs.py` | submit work, report progress | threads, pause/resume/cancel, saving status, restart recovery |
| `features/*/service.py` | one call per user action (for example "run a verification pass") | the feature's own rules |
| `features/*/router.py` | HTTP | nothing; it only translates HTTP to a service call |

## One lecture through the new system (the example)

1. You paste a YouTube link. The web app sends `POST /api/lectures {url}`.
2. `lectures/service.py` saves a lecture row and submits a **transcribe** job. The answer comes back at once with a
   job id, and the web app shows the job's progress stream.
3. The job downloads the media (yt-dlp, ffmpeg), asks the GPU owner for Whisper, and saves the timed words.
4. A **detect** job sends the words to the engine worker and saves the findings. The lecture screen shows the
   transcript beside the video, with the findings highlighted.
5. You start a verification pass with Laya. The **verify** job asks the engine for **v3 envelopes**, built by the same
   function that built the training data. The GPU owner swaps Whisper out and Laya in. Each verdict is saved, and each
   request is logged with its tokens, cost and latency.
6. You correct one verdict in the editor. The correction is saved as a **gold label**.
7. The training export reads the gold labels and writes Laya rows with the same envelopes. The datagen sees the same
   database, so app corrections reach the dataset without a manual export.

## Ideas you already know from other stacks

| Here | NestJS | Flutter |
|---|---|---|
| `router.py` (FastAPI `APIRouter`) | controller | — |
| `service.py` | provider / service | repository or service class |
| Pydantic schema | DTO with class-validator | `fromJson` model class |
| `Depends(...)` | dependency injection | Provider / Riverpod |
| React component | — | widget |
| `useState` / `useReducer` | — | `setState` / a reducer |
| TanStack Query | — | `FutureProvider` with caching |

## Testing strategy

- **Golden tests** pin parity. The old app's outputs on fixed lectures are saved as files (findings per engine
  version, envelopes per version, captions, exports), and the new code must produce identical files.
- **Tests at each module's interface.** For example, a test runs a verification pass with the `fake` provider and
  checks the verdicts saved, never the private functions inside.
- **Fakes for the outside world.** A fake AI provider, a fake GPU owner and a small sample corpus keep the tests fast
  and offline. A few marked live tests hit real APIs and only run on request.
- **Web:** Vitest for logic (word sync, caption preview) and Playwright for one smoke test per screen.
