# Learning log

One section per rewrite phase: what was built, the new ideas in plain words with an example from this code, how it was
tested, and a few commands to try.

## Phase 1: Feature inventory (2026-11-03)

**What was built.** No code. `docs/rewrite/features.md` lists every feature of the old app (137 of them, F-001 to F-137),
20 proposed new features (N-001 to N-020), and which engine and envelope versions stay. `docs/rewrite/features-map.tsv`
says which lines of old code belong to each feature. Each later phase in the roadmap now names the features it must
deliver.

### Why a rewrite starts with acceptance criteria

An **acceptance criterion** is a check, written before the work, that says when the work is done. In a rewrite there
is a classic trap: the new app looks finished, but small features of the old one are gone, and nobody notices until
someone needs them. The old app has no list of its features. The list exists only in 25,000 lines of code.

So the first job is to write that list, with one concrete check per feature. Example, F-064:

```
- [ ] **F-064 Delete with intent.** Deleting a finding asks why: ordinary speech (saved as a gold negative label), ...
  - check: delete a finding as "ordinary speech"; a gold label "false" appears in the training data.
```

This feature is easy to lose. It is a small dialog, but it creates Laya's negative training examples. In phase 23 a
session walks every `check:` line in the new app. If one fails, the rewrite isn't done. The same idea appears in
NestJS as end-to-end tests written from user stories, and in ML as fixing the test set before you train anything.

### Coverage: how do you know the list is complete?

You can't prove completeness by reading. So instead of trusting the list, we measured it. A script enumerated
everything the old app exposes:

- 1,477 UI strings
- 434 HTML ids
- 305 event handlers
- 190 settings and stores
- 28 routes
- 36 entry points (CLIs, launchers, scripts and notebooks)
- 114 wish headings

It then checked that each item falls inside the line range of some feature in `features-map.tsv`. Items in a
"generic" range (modal plumbing, engine internals, dead strings) count separately. The rule is 0 unassigned.

Example of how a UI string gets assigned. The key `"حذف الكل"` ("Delete all") is found at `index.html:262`. Line 262 is inside
`F-027 index.html:258-267`, so it belongs to F-027 (Saved lectures).

This is the same idea as **test coverage**: you don't read the tests to see whether they cover the code; you run a
tool that marks every line. The measurement also found things nobody knew about:

- 120 UI strings that no code uses any more
- 7 settings that are saved but never read
- 3 routes the UI never calls
- one HTML id used twice

**How it was tested.** The coverage script was run until it reported 0 unassigned items. A second check compared the
IDs in `features.md` with those in the map, so no feature lacks code and no map line points to a missing feature.

**Try:**

```bash
# how many features, and how many are marked to be removed
grep -c '^- \[ \] \*\*F-' docs/rewrite/features.md
awk '/^- \[ \] \*\*F-/{id=substr($4,3)} /suggest: remove/{print id}' docs/rewrite/features.md
# which features phase 12 must deliver
grep -A12 '12. Lecture view' docs/rewrite/ROADMAP.md | grep Features
```

## Phase 2: Golden files and the skew measurement (2026-11-03)

**What was built.** `engine/golden/`: four fixed inputs (the sample lecture and three datagen lectures) in `inputs/`,
and 234 files in `expected/` recording what the old app makes from them. For each input and each engine (v3, v4,
v5, v5:loose) it records the findings, envelopes v1, v2 (four option sets) and v3 (two), SRT/VTT/ASS captions and
the Markdown and text exports, plus one Laya JSONL export. `make_golden.mjs` writes them, and `old_app.mjs` loads the
old browser files into Node to do it. `measure_skew.py` measures the training/serving skew. There was no legacy
export to make: the old app held no saved lectures or training data.

### Golden (characterization) tests

A normal test says what the code *should* do. A **characterization test** records what the code *does* today, right
or wrong, so you notice when that changes. Golden files are characterization tests stored as files: run the old code
once, save the output, and later require the new code to produce the same bytes.

Example from this phase. In the sample lecture the speaker quotes «الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ» from al-Fatiha,
but engine v5 labels it `يونس: 10`, a verse that ends with the same words. The golden file keeps `يونس: 10`. The
rewrite's job is to move the code without changing behaviour. Fixing the engine is a separate decision you make on
purpose, with a new golden version, so a fix never hides inside a refactor.

Golden files only help if the generator is **deterministic**: same input, same bytes. The old export builds record
ids from `Date.now()` and `Math.random()`, so the generator pins both. The first attempt pinned `Math.random` to a
constant, and the export lost two of its six rows: three records got the same id, and each overwrote the one before
it. The fix was a seeded sequence of numbers that is the same on every run but differs from call to call. A fake
must keep the properties the real code relies on (here, that ids are different).

### Running browser code in Node

The old engine is browser JavaScript: global variables, `document`, `localStorage`. Node's `vm` module runs code
inside a fresh global object you build yourself, so `old_app.mjs` gives it a fake `document` whose
`getElementById` returns `null` and a `localStorage` backed by a plain object. Then it calls the same functions the
buttons call. Example: the sample button runs `buildDynamicSampleLectureFromCorpus()` and then
`runDetectionAndBuildCaptions(...)`, and the generator calls exactly those two.

### Training/serving skew, measured on your data

**Skew** means the model sees one input shape in training and a different one when it is used. Laya reads
`json.dumps(state)` plus the question text as tokens. So a key that is `null` in one place and missing in the other,
or a changed sentence in the instructions, is a different input, even if a person would call it "the same".

The run-6 notebook builds its training rows with its own `to_v3_state`, while the app builds envelopes with
`buildLayaEnvelopeV3`. Measured over every `laya_v2` row the notebook reads:

- **State:** 2,882 of 4,901 single-finding rows are identical, and 2,019 differ. All 2,019 are hadith or adhkar
  findings: the notebook always writes `"quran_neighboring_context": null`, and the app leaves the key out. All 162
  multi-verse passages are identical.
- **Question:** different on every request. The app sends its v2 verdict instructions, which add two sentences (about
  `verses_in_passage` and `neighbor_findings`) that the notebook's rows don't have. The criteria are the same.
- **Grouping:** 405 single-verse training rows are verses that the app, with passages on, sends inside a passage,
  never alone. v3_mixed was trained on both shapes, so this is by design rather than a bug.
- **Code drift:** in passages only. Today's v2 builder rebuilds all 4,901 single-finding rows and 4,678 passage rows
  byte for byte. The other 16 passage rows (6 lectures, 6 of them in the v3_mixed passages) are grouped differently
  today. On 2026-10-28, one day after `laya_v2` was built, commit `4147cb7` let verses up to **4** words apart join a
  passage (it was 2). Example: 82:7 and 82:8 in `yt_pckn5mI4Q5g` are 4 words apart, so they were trained as two single
  verses, and the app now sends them as one passage.

So the run-6 model was evaluated on one input and is served another, on every hadith row and every question. ADR 0003
fixes this from phase 22: the dataset stores the final envelope, and nothing reshapes it afterwards.

### A bug the golden work found

"Delete as ordinary speech" (F-064) and "Approve all" (F-091) call `WahyAiVerifier.convertRecordToLayaTrainingEnvelope`,
which `ai-verifier.js` never exports. So neither has ever saved a gold label. The old app is left as it is; the note is
in `features.md` for phases 17 and 20.

**How it was tested.**
- The generator ran twice, and `--check` found all 234 files identical.
- A cross-check against the datagen's own harness (`backend/laya_datagen/js/harness.js`) gave the same findings, v1
  and v2 envelopes for 3 lectures × 4 engines.
- The old app, started with `./run.sh` and driven in a real browser, gave the same 8 sample findings, the same SRT
  and the same Markdown as the golden files.

**Try:**

```bash
node --max-old-space-size=4096 engine/golden/make_golden.mjs --check     # is the old app still the same?
jq '.[] | [.sourceType, .displayRef, .confidenceBand]' -c engine/golden/expected/sample/v5/findings.json
diff engine/golden/expected/sample/v5/wahy-captions.srt engine/golden/expected/sample/v5/alt-style/wahy-captions.srt | head
```

## Phase 3: Repository skeleton (2026-11-04)

**What was built.** Three empty-but-running homes for the new code, next to the old app:
- `server/`: Python 3.12 + FastAPI with one route, `/api/health`, one pytest test and ruff.
- `engine/`: a TypeScript package with Vitest and a type check (phase 4 fills it).
- `web/`: Vite + React + TypeScript + Tailwind, ESLint, Vitest; the page reads `/api/health` and shows `server: ok`.
- `scripts/test.sh` runs all four suites (old backend 150 passed, 1 known failure skipped; server 1; engine 1; web 1).
  `scripts/dev.sh` starts the server (port 8120) and the web app (port 5173).
- Tafrigh run folders were copied to `data/tafrigh_runs/` and untracked from git (files stay on disk, so the old app
  still lists them). `data/` is now git-ignored apart from `.gitkeep` and the four already-tracked media files.

**Concepts.**
- **Monorepo + npm workspaces:** one repo, several packages. The root `package.json` lists `"workspaces": ["engine",
  "web"]`, so one `npm install` installs both and `npm run test --workspace web` runs one of them. Like an Nx or
  NestJS monorepo.
- **uv vs pip:** `uv sync` reads `server/pyproject.toml`, makes `server/.venv` and pins versions in `uv.lock`;
  `uv run pytest` runs inside it. pip + `requirements.txt` does the same by hand, with no lockfile.
- **Vite:** the dev server for the web app. It serves your TypeScript modules unbundled with instant reload, and
  `vite build` bundles them for production. Here it also proxies `/api/...` to the server, so the browser sees one origin
  (no CORS setup).
- **Tailwind:** styling with small utility classes in the markup (`className="p-6 text-sm"`).

**How it was tested.** `scripts/test.sh` is green. `scripts/dev.sh` was started and `curl localhost:5173/api/health`
(through the Vite proxy) returned `{"status":"ok"}`. The old app started and `/api/tafrigh/runs` still listed saved runs.

**Try:**
```bash
scripts/test.sh
scripts/dev.sh            # then open http://localhost:5173
cd server && uv run pytest -q
```

Note: port 8100 was already used by something else on this machine, so the new server uses 8120.

## Phase 4: Engine package (2026-11-04)

**What was built.** The three detection engines now live in `engine/src/` as ES modules, with one typed entry point:

```ts
import { detect } from "./engine/src/index.ts";
const findings = detect(words, { corpus, engine: "v5", profile: "loose", qiraat: "AUTO", adhkar, customQuotes });
```

- `v3.js`, `v4.js`, `v5.js` are the old `js/engine*.js`, copied byte for byte by a script, then given a short list of
  named edits (each file's header lists them). The edits only remove globals. No matching logic changed.
- `shared.js` has what the engines read from `state.js` and `editor.js`: surah names, built-in adhkar, `computeTokenIoU`.
- `detect.ts` + `types.ts` are the only typed code: the interface is typed, the 4,000 lines behind it are not yet.
- Dropped as dead code: `formatAnnotatedTranscript` (nothing in the app calls it), the browser-console test
  `runNestedVerseTest`, and the `window.WahyEngineUtils` global.
- The old `js/` files are untouched. The old app keeps its own copy until phase 24.

### ES modules vs browser globals

In the old app, `index.html` loads `engine.js`, `engine_v4.js` and `engine_v5.js` with `<script>` tags. They all share
one global scope, so `engine_v5.js` can call `tokenizeText` because `engine.js` happened to load first. Nothing in the
file says where `tokenizeText` comes from, and the load order is a hidden dependency. An ES module says it outright:

```js
// engine/src/v5.js
import { tokenizeText, QuotationMatcherJS, /* … */ } from "./v3.js";
```

The globals were the hidden settings, too. Engine v3 read the default Qira'ah from a `<select>` on the page:

```js
const defQ = (typeof document !== "undefined" && document.getElementById("selDefaultQiraah")) ? … : "AUTO";  // old
const defQ = this.defaultQiraah;                                                                            // new
```

Now it is a constructor parameter, filled from `detect`'s `qiraat` option. In the same way, the v5 profile no longer
comes from `localStorage`, and the global `activeMatcher` became an argument. A neat trick found the leftovers:
type-checking the JS files with `checkJs` lists every name used but never defined ("Cannot find name"). It found 0.
In NestJS terms: a module that injects what it needs, instead of reaching into a global container.

### Deep modules: a small interface over a lot of logic

`detect()` has one function and six options. Behind it sit 4,100 lines of matching, the joining of words into one
text with character offsets, the mapping of findings back to word times, and a cache of built matchers. A matcher
takes seconds and hundreds of MB to build, so `detect` keeps up to 4 per corpus object (in a `WeakMap`, so the
cache goes away with the corpus). Callers don't know any of that exists. That is a **deep module**: a small interface
with a lot behind it. A **shallow** one would make every caller build matchers, join words and map offsets itself.

### "Loose types first"

Typing 4,000 lines of tuned JS would mean touching every line: risky, and the golden test would be the only safety
net. So `tsconfig.json` has `allowJs: true, checkJs: false`. TypeScript imports the JS as it is, and only the public
interface (`Word`, `Corpus`, `DetectOptions`, `Finding`) is typed. `Finding` keeps an index signature
(`[extra: string]: unknown`) because each engine adds its own fields (v4 and v5 add `evidence`, `candidateCount`).

The imports also say `.ts` (`from "./detect.ts"`), so Node 24 runs the package with **no build step**:
`node -e 'import("./engine/src/index.ts")'` works, because Node strips the types itself. Phase 5's worker can run
the same way.

### How it was tested

- **Golden test** (`engine/src/golden.test.ts`): 4 inputs × 4 engine choices, findings byte-identical to
  `engine/golden/expected/`. All 16 matched on the first run. Also: the longest lecture on a fresh matcher matches too,
  so the order lectures arrive in doesn't matter.
- **Does the test have teeth?** A golden test that can't fail proves nothing, so I broke the code on purpose. Moving
  `minIslandIdf` from 3.8 to 3.7, or `verifiedThreshold` from 11 to 7, changed **no** finding on these inputs: they
  have no quote near those cut-offs. Moving `candidateThreshold` from 6.8 to 30 failed at once (8 findings → 4). Lesson:
  a small mutation that survives tells you what your test data doesn't cover.
- **Coverage gap found and closed.** A probe showed that the code moved in from `state.js` (re-aligning a hadith
  finding that turns into the verse quoted inside it) runs on **none** of the 4 golden inputs. It does run on 18 of
  the 71 datagen lectures. So `engine/golden/make_nested_verse.mjs` cuts a short window from one of them and records
  the old app's findings for it, and the golden test checks that case too.
- **Differential checks** (one-off, old app in a vm vs the new package):
  - every option the golden files don't cover (Warsh, Qalun, adhkar off, an added dhikr, a custom quote) × 4 engines
    × 3 inputs: 60 of 60 identical;
  - all 71 datagen lectures × 4 engines: 284 of 284 identical (v5 alone: 1,811 findings; v5:loose: 3,564).
    Lesson learned the hard way: the first try held both apps and all 8 matchers in one 8 GB process and ran the
    laptop out of memory. One engine per process, with `--max-old-space-size=3500`, was enough.
- **Interface tests** (`engine/src/detect.test.ts`, under a second, on `src/fixtures/small-corpus.json`): the caller's
  words are not changed, bad options get a clear error, adhkar can be turned off, custom quotes are found, the
  Qira'ah relabels v3 only, and in a plain Node process the package adds **no globals** and never sees `window` or
  `document`.

**Something the move revealed.** The Qira'ah setting (F-012) only affects engine v3, and there it only renames a
Hafs finding's reading ("رواية ورش عن نافع"). It does that even on a dhikr finding. v4 and v5, the default, ignore it:
they already match the Qira'at variants word by word. Kept as it is (no behaviour changes in this phase); noted
under F-012 in `features.md`.

**Try:**

```bash
npm run test --workspace engine                         # 1 minute: golden + interface tests
diff js/engine_v5.js engine/src/v5.js                   # the whole move, line by line
node --input-type=module -e '
  const m = await import("./engine/src/index.ts");
  const fs = await import("node:fs");
  const corpus = JSON.parse(fs.readFileSync("engine/src/fixtures/small-corpus.json", "utf8"));
  const words = m.synthesizeWordsFromRawText("قال الله تعالى قل هو الله أحد الله الصمد");
  console.log(m.detect(words, { corpus, engine: "v3" }).map(f => [f.displayRef, f.matchedText]));'
```

## Phase 5: Envelope builders and the engine worker (2026-11-06)

**What was built.** The engine package now builds Laya's inputs too, and other languages can call it:

```ts
envelopes(findings, words, 3, { corpus, engine: "v5", passages: true })   // → [{members, state, questions, boundaryByRule}]
search("البقرة: 255", { corpus, engine: "v5", kind: "QURAN" })             // → [{unitId, sourceType, displayRef, fullText}]
```

- `engine/src/envelope-builders.js`: the old `js/ai-verifier.js` builders (v1, v1 with passages, v2, v3, the merge
  question, `boundaryByRule`), moved verbatim. The only edit: what they read from browser globals (`activeMatcher`,
  `RAW_QURAN_DATA`, `currentState`) is now an argument, `ctx = {units, ayat, detections}`.
- `envelopes.ts` and `search.ts`: the typed entry points. `members` are finding indices, not objects, so they survive JSON.
- `worker.ts`: a Node process that loads the corpus once and answers JSON lines (`detect`, `envelopes`, `search`,
  `units`, `tokenize`, `info`, …).
- `backend/laya_datagen/engine_bridge.py` now starts that worker instead of the old `js/harness.js` (deleted). Its
  Python interface did not change, so no datagen code changed. One research option is gone: loading a *copy* of an
  engine file (`"v5@tag"`); nothing used it.

### Talking between processes: JSON lines over pipes

The server is Python and the engine is JavaScript. They can't call each other's functions, so the server starts Node
as a **child process** and they talk through its stdin and stdout, the same pipes `cat file | grep x` uses:

```
python → worker (stdin):   {"id": 7, "cmd": "detect", "words": [...], "options": {"engine": "v5"}}
worker → python (stdout):  {"id": 7, "ok": true, "result": [...findings]}
```

Three rules make this safe:
- **One message per line.** JSON never contains a raw newline (it's escaped as `\n`), so "read one line" = "read one
  message". This is called *JSON Lines* or NDJSON.
- **stdout is only for answers.** A stray `console.log` would be read as an answer and break everything, so the worker
  redirects every other log to stderr. Errors become `{"ok": false, "error": ...}` and the worker keeps going.
- **One request at a time, and an `id` on each.** The Python side holds a lock while it writes and reads, and checks
  that the answer's `id` is its own.

Why a long-lived process instead of `node detect.js` per call: loading the 90 MB corpus and building a matcher takes
seconds and hundreds of MB. The worker pays that once. In NestJS terms it is like a microservice with a message
transport, minus the network.

### Why one envelope builder matters for Laya

Laya learns from rows whose `state` was built by some function. If the app later builds the `state` with a slightly
different function, the model sees inputs it was never trained on: **training/serving skew** (phase 2 measured it
between the notebook's `to_v3_state` and the app). Now the datagen and the app call the same `envelopes()`. The proof:
rebuilding `laya_v2` through the new worker gave **26 of 26 data files byte-identical** to a rebuild with the old harness.

### A cache keyed on a fingerprint

The datagen caches each lecture's findings under a key that includes the engine's **fingerprint**, a hash of every
engine file and the corpus. Edit one engine file and the hash changes, so the cache misses and everything is detected
again, and stale results are never reused. The new worker hashes `engine/src/*`, so its fingerprint is new and the first
rebuild re-detected every lecture with every engine (18 minutes instead of 2). That made the rebuild a full end-to-end
test, not only an envelope test.

### How it was tested

- **Golden** (`golden.test.ts`, about 75 s): every golden input × engine × envelope file (v1, the four v2 option sets,
  both v3 ones): 112 files identical. Plus 20 cases recorded from the old code by `engine/golden/make_envelope_extras.mjs`
  (v1 with passages, which Gemini, JEV and OpenRouter got by default, and envelopes for some findings only) and 72 corpus
  searches. Two of those old functions were private to their file, so the generator re-runs the file's own source with
  one extra export added; the function bodies run as they are.
- **Does it have teeth?** Changing the boundary evidence from 2 edge words to 3 failed 3 envelope tests on the sample
  alone.
- **Interface tests** (`envelopes.test.ts`, `worker.test.ts`, under a second, small corpus): passages, targets,
  neighbours, findings that went through JSON, clear errors; and a real worker process answering the same as the
  package in-process, surviving a bad line.
- **The datagen**: `backend/tests/laya_datagen` 62 of 62 on the new bridge; `laya_v2` rebuilt identically (above); the
  `laya_review.ipynb` "Load lessons" path prints its recall table (v4 recall 0.736 on 16 lessons).

**Something the rebuild revealed.** The `laya_v2` folder on disk (built 2026-10-27) can't be rebuilt even by the old
code: passage grouping and the `v1_passages` format changed after it was built. So "identical" here means identical to
what today's code builds, not identical to the folder on disk.

**Try:**

```bash
npx vitest run --root engine src/envelopes.test.ts src/worker.test.ts     # 1 second
printf '%s\n' '{"id":1,"cmd":"tokenize","text":"قالَ اللهُ تعالى"}' '{"id":2,"cmd":"search","text":"الصمد","options":{"engine":"v3"}}' \
  | node engine/src/worker.ts --corpus engine/src/fixtures/small-corpus.json
diff <(sed -n '34,148p' js/ai-verifier.js | sed 's/^  //') <(sed -n '19,133p' engine/src/envelope-builders.js)   # the move
```

## Phase 6: Server core (2026-11-06)

**What was built.** The machinery every later server feature stands on, in `server/wahy/core/`:

| Module | What a feature does with it | What it hides |
|---|---|---|
| `settings.py` | `settings.db_path`, `settings.key("gemini")` | `.env`, environment variables, keys as `SecretStr` |
| `db.py` + `migrations/` | `with db.session() as s: s.add(Lecture(...))` | SQLite pragmas, Alembic, one session per thread |
| `jobs.py` | `runner.submit("transcribe", params)`, `ctx.progress(...)`, `ctx.check()` | threads, pause/resume/cancel, saving, restarts |
| `gpu.py` | `with gpu.use("laya") as model:` | waiting your turn, unloading the other model, freeing VRAM |
| `engine.py` | `engine.detect(words, {"engine": "v5"})` | the Node worker: start, crash, timeout, one request at a time |

Plus `features/jobs/router.py` (list, read, pause, resume, cancel, and `GET /api/jobs/<id>/events`) and the nine
tables, each declared next to the feature that will own it (`features/lectures/models.py`, ...).

### ORM and migrations

An **ORM** maps a table to a class. You write `Lecture(title="درس", source_kind="youtube")` and SQLAlchemy writes
the `INSERT`. (In NestJS, TypeORM or Prisma do the same.) The class says what the table *should* look like. A
**migration** is the script that brings a real database file from one shape to the next: `0001_first_tables.py`
creates the nine tables, and a later one might add a column. Alembic records which migrations a file already has in
the `alembic_version` table. So `db.migrate()` at startup works the same on an empty file, on today's file, and on a
file from three versions ago.

The workflow: change a model, then run `uv run alembic revision --autogenerate -m "..."`. Alembic compares the models with
the database and writes the migration, which you read before committing. A test (`test_the_migrations_match_the_models`)
fails if someone changes a model and forgets the migration.

Two SQLite details hide in `db.py`. Foreign keys are **off** by default, so `ON DELETE CASCADE` silently did nothing
until we turned them on (the test proves deleting a lecture removes its words and findings but keeps its gold
labels). And **WAL mode** lets the web app read while a job writes.

### Threads vs asyncio, and locks

FastAPI serves requests with **asyncio**: one thread juggles many requests, switching at every `await`. That is good
for waiting on the network, but a job that runs Whisper for 10 minutes would freeze every request. So each job gets
its own **thread**. The two worlds meet in the progress stream: the job thread can't touch asyncio objects directly,
so it hands each update over with `loop.call_soon_threadsafe(queue.put_nowait, snapshot)`, which means "event loop,
please run this when you can".

**Pause** is built on a `threading.Condition`, a lock that a thread can sleep on:

```python
# inside the job, between steps            # the pause button (another thread)
with a.cond:                               with a.cond:
    while a.control == "pause":                a.control = "pause"
        a.cond.wait()   # sleeps, lets go   # ... later, resume:
                        # of the lock          a.control = "run"; a.cond.notify_all()   # wakes it
```

Nothing can stop a thread from outside in Python, so pause and cancel are **cooperative**: the job calls
`ctx.check()` between steps, and that is where it sleeps (paused) or raises `JobCancelled`. That's why there are
`pausing` and `cancelling` statuses: the button was pressed, but the job hasn't reached its next check yet.

The GPU owner uses the same idea, with one twist: while a job waits for the GPU it calls `ctx.check()` every quarter
second, so a job stuck waiting for Laya can still be cancelled.

### Server-sent events

SSE is the simplest way to push updates to a browser: a normal HTTP response that never ends quickly, made of
blocks like this:

```
event: job
data: {"id": "3f2a...", "status": "running", "progress": {"stage": "transcribe", "percent": 40.0}, ...}

```

In the browser, `new EventSource("/api/jobs/3f2a.../events")` calls you back for each block. It works one way only
(server → browser), which is all a progress bar needs; WebSockets would be two-way and more work. Each event is the
job's whole snapshot, not a diff, so a slow reader can safely skip to the newest one.

### Surviving a restart

Every status change is saved, so after a crash the database still says `running` for jobs no thread is running.
At startup `recover()` turns them into `interrupted`. A job kind registered as `resumable=True` saves its own
progress with `ctx.save_checkpoint({"next": 3})` and, when resumed, starts from `ctx.checkpoint`. The test stops a
server half-way through 5 items, starts a second "server" on the same database, resumes, and checks that items
0–1 ran before and 2–4 after: nothing twice, nothing skipped.

### How it was tested

- **46 server tests** at each module's interface: settings (4), database (8), jobs (15, including the progress stream
  over HTTP and the restart), GPU owner with fake models (9), engine client (10) with the **real worker** on the
  11-verse sample corpus, plus a small misbehaving stand-in worker (`tests/fixtures/misbehaving_worker.mjs`) that
  crashes or hangs on request.
- **Do they have teeth?** Breaking the code on purpose failed a test every time: foreign keys off, pause not waiting,
  `recover()` not marking jobs, a resumed job redoing work, the GPU loading without unloading, two GPU users at once,
  the engine not restarting. Without its timeout, the hang test hangs.
- **Real corpus**: `EngineClient` on `data/corpus.json` gives findings identical to the golden files for the sample
  lecture (v5 and v3). `scripts/test.sh` is all green (old backend 152, server 46, engine 82, web 1).
- A surprise along the way: v4 and v5 find nothing on the 11-verse test corpus (they need a full corpus's
  statistics), so the small-corpus tests use v3, as the engine's own worker test does.

**Try:**

```bash
cd server && uv run pytest -q tests/test_jobs.py -k "restart or stream"     # the restart and progress-stream tests
cd server && uv run alembic current && sqlite3 ../data/wahy.db .tables   # the migration level and the tables
scripts/dev.sh        # then open http://localhost:8120/docs: the jobs routes, with the stream described
```

## Phase 7: Lectures and transcription (2026-11-06)

**What was built.** Two server features, and the first routes a web app can really use:

| Route | What it does |
|---|---|
| `POST /api/lectures` | pasted text or the content of an `.srt` / `.vtt`: timed words, saved as a lecture |
| `POST /api/lectures/import`, `POST /api/lectures/sample` | an uploaded `.txt/.srt/.vtt` file; the fixed sample lecture |
| `GET/PATCH/DELETE /api/lectures/{id}`, `GET /api/lectures` | open (with its words), rename, delete, the saved list |
| `GET/PUT /api/lectures/{id}/media` | the player's video (with Range, so seeking works); attach a local file |
| `…/versions` | save, open, rename, delete a lecture version (never the last one) |
| `POST /api/transcriptions/youtube`, `…/upload` | make a lecture from a link or a file, and start the transcription **job** |
| `POST /api/lectures/{id}/transcribe` | transcribe again (a lecture with media) |
| `GET /api/transcription/models` | the four models, which ones work on this machine, the default |

A transcription is the job from phase 6: stages `download → audio → transcribe → save`, one progress stream, pause
and cancel (even while ffmpeg runs or while waiting for the GPU), and a result that says which model really ran.

### Router, service, model: who does what

Each feature is split the way a NestJS module is: `router.py` is the controller (it turns HTTP into one call and one
HTTP answer), `service.py` is the provider (the rules: "deleting a lecture also deletes its media unless another
lecture uses it"), `schemas.py` holds the DTOs (Pydantic classes, which FastAPI also turns into the OpenAPI schema the
web app's types will be generated from), `models.py` is the entity. The service is plain Python with no HTTP in it, so
a test can call it directly; the router test goes through the real app.

```python
# router.py: nothing but translation                    # service.py: the rules
@router.post("/{lecture_id}/versions", status_code=201)   def delete_version(self, lecture_id, version_id):
def save_version(lecture_id: int, body: CreateVersion,        ...
                 lectures: Lectures):                         if count <= 1:
    with lecture_errors():       # error → 404/409/422             raise LectureError("the last version ... stays")
        return lectures.save_version(lecture_id, body.name, body.snapshot)
```

`Lectures = Annotated[LectureService, Depends(get_lectures)]` is dependency injection: FastAPI calls `get_lectures`
for each request and passes the result in (in NestJS the container does this through the constructor). The service
lives in `app.state`, built once at startup, which is also where a test swaps in a fake.

One direction only: `transcription` imports `lectures` (it needs to save words and media), never the reverse. That
is why a YouTube link starts at `/api/transcriptions/youtube` and not at `/api/lectures`: the lectures feature must
not know that transcription exists.

### Running other programs: ffmpeg and yt-dlp

ffmpeg is a command-line program, so Python starts it as a **child process** (`subprocess.Popen`) and reads what it
says. The old code used `subprocess.run`, which waits until the child ends: cancelling a job during a 5-minute
extraction did nothing. Here `_run()` polls every quarter second, calls `ctx.check()`, and **kills the child** when
the job is cancelled (a test starts `sleep 30` and cancels it). yt-dlp is a Python library, so it runs in-process and
calls a *progress hook* we give it; the hook calls `ctx.check()` too.

### Why the Whisper input is an array, not a file

faster-whisper decodes a file path with PyAV and passes it an argument (`metadata_errors=`) that PyAV 19 removed, so
passing a path crashed every local transcription (the old app broke on 2026-11-06). ffmpeg already gives us a 16 kHz
mono WAV, so we read its samples with Python's `wave` module into a float32 **numpy array** and pass that. Decoding
by ourselves is also faster and is the one place that decides the format. A test checks the model really receives an
array.

### Fallback chain, and fakes

When a model fails and `auto_fallback` is on, the next one is tried: Groq → local turbo → local small (the specialized
model → Groq → local small). Every recogniser raises the same `AsrError`, so the chain is a loop over a list:

```python
for model_id in [model, *FALLBACKS[model]]:
    try:    raw = self.backends[model_id].transcribe(audio, ...)
    except AsrError as e:    first_error = first_error or e; continue
    return backend.label, raw, ({"reason": str(first_error)} if first_error else None)
```

One thing must **not** be caught: `JobCancelled`. It is an ordinary exception class, so a careless `except Exception`
would turn "the user pressed cancel" into "Groq failed, try the next model". `_translating()` lets it through.

This is the **ports and adapters** idea in its smallest form: the service knows one interface (`transcribe(audio) →
words`) and four adapters stand behind it. Tests use a `FakeAsr` with the same shape, a fake Groq server
(`httpx.MockTransport`: you write the function that answers requests), a fake YouTube downloader, and *real* ffmpeg on
sine-wave files, so the audio code is tested for real and everything slow or external is faked.

### Small things worth knowing

- **Cache by hash.** The media cache name is `yt_<first 16 hex chars of sha256(link)>.mp4`, plus a `.json` with the
  title; the `.json` is written last, so a half-finished download is never mistaken for a complete one.
- **Port the arithmetic, then prove it.** The text and subtitle parsers are ports of two JavaScript functions. JS
  `toFixed(2)` rounds halves up, Python's `round` rounds halves to even, so `round2()` uses `Decimal` with `ROUND_HALF_UP`.
  A script runs the *old* functions on 9 inputs (a whole lecture, SRT, VTT with hours, CRLF, tags...) and the Python
  output equals it, word for word.
- **Safe by default:** only `http(s)` links are accepted (yt-dlp would also read local paths), uploads get a fresh
  random name and only media suffixes, a media path can never leave `data/media/`, and the Groq key is never logged.
- **Alembic again:** a new column (`lectures.transcription_model`) is migration `0002`, written by `--autogenerate`.
- **`--extra local-asr`:** `faster-whisper` and the NVIDIA libraries it needs (cuBLAS, cuDNN, about 1 GB) are an
  optional install, so the server runs without them (Groq only). The old app got those libraries for free through
  torch; here `_preload_cuda_libraries()` loads them by hand. If CUDA still fails, `small` runs on the CPU and the
  bigger model fails over to `small`.
- **ASR warnings (N-009):** after a transcription, a run of 4+ Latin words ("Thank you for watching") or a word
  repeated 6+ times (a phrase 4+ times) is reported in the job result. Only flagged, never changed.

### How it was tested

- **111 server tests** pass (65 new: 12 parsing, 16 lectures, 37 transcription), 1 live test is skipped (`--live` runs it).
- **Parity with the old app:** `tests/fixtures/parsing_golden.json` is what the old JavaScript returns for 9 inputs.
- **Fakes where it is outside, real where it is ours:** real ffmpeg and real SQLite and the real GPU owner (with a fake
  Whisper model that raises `CUDA out of memory`); fake Groq, fake downloader, fake recogniser.
- **Do they have teeth?** Six deliberate bugs, each caught by a different test: a changed pause length, fallback
  ignoring `auto_fallback`, a cache that never hits, a file path instead of an array, deleting the last version,
  and a media path that could escape the folder. (A first attempt looked wrong: all six showed the *same*
  failure. Python had cached the first broken file's bytecode because the broken and the restored files had the
  same size and were written within a second. Lesson: clear `__pycache__` when you mutate files.)
- **Real run, through the API** (a 61-second khutba by sheikh Mohammed Meziane, `KZ_thZtA2kU`):
  an `.srt` became a lecture with timed words; the link went through all four stages and ended with 103 timed
  words with Groq; the same link again skipped the download and ran local small on the GTX 1050 (103 words);
  with a wrong Groq key the job fell back to local turbo (106 words, fits in 3 GB) and recorded the 401 as the reason;
  with fallback off it failed with that same message.
- **Not tested live:** the specialized Arabic Whisper (it needs torch and transformers; its code is exercised only
  through a fake model) and a lecture longer than Groq's 45-minute chunk (the splitting is tested with ffmpeg on
  4-second files with a lowered limit).

**Try:**

```bash
cd server && uv run pytest -q tests/test_transcription.py -k "fallback or cancel"      # the chain and cancelling
cd server && uv run --extra local-asr pytest -q --live -k live                          # the live YouTube + local small test
scripts/dev.sh      # http://localhost:8120/docs → POST /api/lectures/sample, then GET /api/lectures/1
```

### How it was made

1. Read the old `backend/transcriber.py`, `media_processor.py`, the transcribe route in `backend/app.py`, and the JS
   parsers; kept what worked, dropped the rest (two job systems, `temp_media`, the Groq SDK, global model caches).
2. Parsers first (smallest, provable): `make_parsing_golden.mjs` runs the old JS → `test_parsing.py`.
3. Lectures service + router + tests; then audio (ffmpeg), the four recognisers, the chain, the job; then the API tests.
4. Real feature check with a real khutba. It found the one thing the tests could not: `libcublas.so.12` was missing
   in the new environment (the old app got it from torch). Fixed with the NVIDIA wheels plus a CPU fallback for `small`,
   then rechecked on the GPU.
5. Mutation check (above), `scripts/test.sh`, this section.
Commands used: `uv add`, `uv run alembic revision --autogenerate`, `uv run pytest`, `uv run ruff check .`, `yt-dlp
--flat-playlist ytsearch…` (to find the khutba), `curl -N …/events` (the progress stream), `node
server/tests/fixtures/make_parsing_golden.mjs`.

## Phase 8: Corpora and detection (2026-11-06)

**What was built.** Two server features. `features/corpora` keeps the reference texts the engine searches: the hadith
*sources* (the built-in one, and Open Hadith Data: download, prepare, upload by hand, delete, choose), the **adhkar**
list and the **custom quotes** (both in SQLite, migration `0003`). `features/detection` turns a lecture's words into
**findings** with a job: `POST /api/lectures/{id}/detect` returns a job at once, the job calls the engine worker and
saves the findings; `GET /api/lectures/{id}/findings` reads them; `GET/PATCH /api/detection/settings` keeps the
engine choice (`v5`, `v5:loose`, `v4`, `v3`), the Qira'ah and the adhkar switch; `GET /api/corpus/search` is the
reference picker's search. The old app's rule "re-detect makes a new version" became: the findings being replaced are
first saved as a lecture version.

### New concepts

- **An integration test that crosses a process boundary.** A normal test calls a function. Here the thing under test
  is *four programs*: your test → FastAPI → a job thread → a Node process that has the 90 MB corpus loaded. The test
  `test_golden_findings_through_the_api` sends each golden lecture through `POST /detect`, waits for the job, reads
  `GET /findings` and requires the *old app's* findings, field for field. If any layer garbles a number, drops a
  field or reorders findings, it fails. Everything between the HTTP call and the old JavaScript is covered by one
  assertion. The price: it needs the full corpus and takes about a minute, so it skips itself when `data/corpus.json`
  is missing, and the fast tests use a **fake engine** (a class with the same methods that records what it was asked).
  Rule of thumb: fakes test *our* logic fast; one real end-to-end test proves the pieces really fit.
- **State that lives in a child process.** The engine worker reads the corpus *once, when it starts*. So "use another
  hadith source" cannot be a function call; it means restarting the worker with `--hadiths <file>`. `EngineClient.use_hadiths(path)`
  hides this: it returns `False` if nothing changed (no restart), `True` if it restarted. Adhkar and custom quotes need
  no restart because they travel with each `detect` call. Example in `service.py`: `engine_adhkar()` reads the table
  and the list is sent as `options["adhkar"]`. In NestJS terms: a provider that owns a long-lived resource and
  re-creates it when its config changes.
- **Same options for search and detection.** The worker keeps one *matcher* (hundreds of MB) per option set. If search
  used different options than detection, the first search after a detection would build a second matcher. Both call
  `engine_options()`, and a test asserts the options are equal.
- **Seeding a table.** `seed_adhkar()` runs at start-up but inserts the 18 initial adhkar only once: it
  checks the settings key `corpora.adhkar_seeded`, and when that is not set it seeds an empty table and sets the key
  (a table that already has rows only gets the key). After that the rows are the user's: any of them can be edited or
  deleted, an edited or deleted row is never restored, and deleting all of them does not bring them back. A test runs
  Node on `engine/src/shared.js` and checks that the seed file equals the engine's list, but only at the first seed;
  later the engine gets whatever rows are in the table.
- **Job vs. synchronous call.** Preparing a source (minutes) and detecting (seconds to minutes) are jobs; adding a dhikr
  is a plain request. If the user would want a progress bar or a cancel button, it is a job.

### Small things worth knowing

- Switching the hadith source is remembered in the `settings` table (`SettingsStore`, a 20-line class); if its prepared
  file is deleted, the server quietly uses the built-in hadiths again.
- The cached download stays in `data/corpora/downloads/`, so "prepare again" needs no network, and
  `{"redownload": true}` throws it away first. A zip that turns out to be broken is deleted, because a broken cache
  would fail forever.
- Adhkar are not built-in: the 18 are initial rows in the table, and the user can edit or delete any of them (there is
  no 409 for adhkar). The global adhkar switch turns the whole list off. (The first version of phase 8 made the 18
  read-only; the user reversed that the same day.) `is_custom` only records that the user added the row.
- Custom quotes are de-duplicated by letters only (marks and alef/yaa/taa-marbuta forms ignored), as before, with a
  small Python normaliser so adding a quote does not need the engine.

### How it was tested

- **155 server tests** pass (42 new: 19 corpora, 25 detection; the adhkar rules were corrected afterwards), engine 82, old backend 152, web 1; ruff clean.
- **Golden through the API: 16 of 16** (sample + 3 lectures × v3, v4, v5, v5:loose) are identical to the old app.
- Real-engine tests on the small corpus: a custom quote is found by the next detection and is gone after deleting it;
  turning adhkar off removes dhikr findings; the worker restarts on another hadith file and back.
- **Feature check with the real data** (cached Open Hadith Data zip): status `missing` → job → `ready`, 46,891 hadiths;
  after choosing it, a search for «إنما الأعمال بالنيات» returns `OHD:Bukhari:1`.
- Not done on purpose: no automatic detection after a transcription or a paste (the web app will call `detect`, phase 11).

**Try:**

```bash
cd server && uv run pytest -q tests/test_detection.py -k golden          # the old app's findings, through the API (~1 min)
cd server && uv run pytest -q tests/test_corpora.py                      # sources, adhkar, custom quotes
scripts/dev.sh     # http://localhost:8120/docs → POST /api/lectures/sample, then POST /api/lectures/1/detect, GET /api/lectures/1/findings
```

### How it was made

1. Read the old `backend/corpus_sources.py` and its routes, the JS adhkar/outside-hadith code, and the engine worker's
   commands; ported the source manager nearly verbatim (progress texts in English, cancel checks added).
2. Models + migration (`alembic --autogenerate`, on a scratch database), then sources, service, router; then detection.
3. Fast tests with a fake engine first, then real-worker tests on the small corpus, then the golden test last.
4. Full `scripts/test.sh`; one test (`test_db`'s table list) had to learn the two new tables.
Commands: `uv run alembic revision --autogenerate`, `uv run pytest`, `uv run ruff check .`, a throw-away script that
prepared the real Open Hadith Data through the API.

## Phase 9: Screen design (2026-11-06)

### What was built

- `docs/rewrite/mockups/screens.html`: a clickable mockup of ten screens (lectures, lecture view, editor, verify,
  Tafrigh, export, corpora, training data, request log, settings), in Arabic right to left, light and dark. It runs on
  real data: the golden sample's 280 words with their timings, the v5 findings and the SRT captions from phase 2. Only
  the verdicts are invented. A "Design notes" button (bottom left) explains each screen in English and lists its F-IDs.
- `web/src/shell/tokens.css`: the same colours, fonts, type sizes, spacing and radii as Tailwind tokens. Nothing
  imports it yet; phase 10 does.

### New concepts

- **Design tokens.** A token is a named design decision: `--wahy-quran: #2a4d9b` instead of writing that hex in
  forty places. Components use the name (`text-quran`), so changing the verse colour, or adding a dark theme, means
  editing one line per theme. It is the same idea as a constant in code, applied to design. In Tailwind v4 the
  `@theme` block turns tokens into utilities: `--color-quran` becomes `text-quran`, `bg-quran`, `border-quran`.
- **Runtime themes with `@theme inline`.** The raw values sit in CSS variables that change with `data-theme` on
  `<html>`; `@theme inline` makes the utility read the variable (`.bg-paper { background-color: var(--wahy-paper) }`),
  so switching to dark is one attribute change, with no rebuild. Three states: `data-theme="dark"`, `"light"`, or none
  (follow the system through `prefers-color-scheme`).
- **Right-to-left layout.** With `<html dir="rtl">` the browser lays rows out from the right. Write *logical*
  properties: `margin-inline-start` (Tailwind `ms-3`) means "on the side where the text starts", which is the right in
  Arabic and the left in English. Then the English interface mirrors itself for free. Two traps: numbers, times and
  code are left to right inside Arabic text (the mockup wraps them in `direction: ltr; unicode-bidi: isolate`), and
  icons that mean a direction (undo, previous/next) must be flipped in RTL, while icons that don't (play) must not.
- **Colour as meaning.** The mockup spends colour on three things only: the kind of a quote, its verdict and the
  spoken word. If everything is colourful, nothing stands out. A false finding is hatched rather than recoloured, so
  you can still see it is a hadith.
- **The word-sync logic, previewed.** The yellow marker is found by a binary search over word start times
  (`wordAt(t)` in the mockup's script): with 20,000 words in a 2-hour lecture that is about 15 comparisons per frame,
  not 20,000. Phase 12 turns this into a tested function.

### How it was checked

- Headless Chromium (the cached Playwright build) opened every screen at 1440 px and at phone width (400 px), in light
  and dark: no script errors, no sideways scrolling. The two-click "missed quote" flow was clicked through: the
  finding count went from 8 to 9 and the header said "تراجع: إضافة اقتباس فائت".
- The tokens were compiled with Tailwind's own compiler: `bg-paper`, `text-quran`, `font-read`, `text-read`,
  `rounded-m`, `p-4`, `w-player` and `shadow-pop` all come out as expected.
- Your approval: you looked at the published mockups and said "it's good go on", so they are the design phases 10 to
  21 build. (A separate session then made adhkar ordinary editable rows in the corpora mockup, as decided for phase 8.)

**Try:**

```bash
xdg-open docs/rewrite/mockups/screens.html     # click a word, press تشغيل, click a reference tag, open التحرير
grep -n "quran" web/src/shell/tokens.css       # one colour, three places: light, dark, and the Tailwind name
```

## Phase 10: Web shell (2026-11-06)

### What was built

- **The shell** (`web/src/shell/`): a header (brand, server badge, running-jobs pill, language and theme buttons), a
  rail with the app's places (lectures, sources, training data, request log, settings), and the page area. Every
  place except Settings is a "coming soon" panel until its phase. The mockup's look comes from `tokens.css`; the
  small shared pieces (`.panel`, `.btn`, `.vchip`, `.seg`) are written once in `index.css`.
- **i18n by keys** (`shell/i18n/`): `t("nav.settings")` looks the text up in `ar.ts` or `en.ts`. Arabic is the
  default; the choice sets `<html lang dir>` and is remembered in `localStorage`.
- **Theme** (`shell/theme.tsx`): light, dark, or follow the system, through `<html data-theme>` (the tokens do the
  rest). Remembered the same way.
- **Toasts and the error report** (`shell/toasts.tsx`, `ErrorReport.tsx`): success and error messages; an error toast
  has a "Details" button that opens a Markdown report (endpoint, status, what the server said, the last ten requests,
  the stack) to copy. It never contains a request body, so a key you were saving cannot end up in it.
- **The API client** (`web/src/api/`): `schema.d.ts` is generated from the server's OpenAPI file
  (`openapi.json`); `client.ts` wraps `openapi-fetch` so a 4xx/5xx or a dead server throws one kind of error.
- **Settings screen** (`features/settings/`): API keys (set / not set, save, remove), a status table (server, engine,
  corpus, GPU and loaded model) and the interface switches.
- **Server side** (needed for the settings screen): `GET /api/health` now reports keys, GPU, engine, corpus and
  running jobs; `PUT /api/settings/keys/{provider}` writes the key to `.env` (kept `0600`) and uses it at once.
  Keys go in and never come out: the answers only say "set" or "not set".

### New concepts

- **Components and hooks.** A React component is a function that returns what the screen should look like for
  its current data. A hook is a function starting with `use` that gives a component a capability. In `KeyRow`,
  `const [value, setValue] = useState("")` remembers what you typed; when `setValue` runs, React calls `KeyRow` again
  and the input shows the new value. It is the same idea as a Flutter `StatefulWidget`'s `setState`, but there is no
  class, and the state lives right next to the code that uses it.
- **Context.** `useI18n()` can be called from any component because `<I18nProvider>` at the top holds the language and
  hands it down, like `Provider` in Flutter. That is why the nesting order in `Providers.tsx` matters: toasts need the
  language, so they sit inside it.
- **Server state with TanStack Query.** `useHealth()` is `useQuery({ queryKey: ["health"], queryFn, refetchInterval })`.
  The library fetches, caches under that key, shares one request between every component that asks, refetches every
  10 s, and tells each component when the data changes. After saving a key, `queryClient.setQueryData(["health"], …)`
  updates the cache and every screen showing key status redraws; no manual refresh. Compare with the old app, where
  10 files edited one global object and called render by hand.
- **Generated API types.** `npm run api:generate` (in `web/`) asks the Python server for its OpenAPI schema, saves it
  as `openapi.json`, and `openapi-typescript` turns it into `schema.d.ts`. Then `api.PUT("/api/settings/keys/{provider}",
  { body: { value } })` is checked by TypeScript: a wrong path, a wrong field or a changed response is a compile error.
  If someone changes the server and forgets to regenerate, `server/tests/test_openapi.py` fails; if they regenerate and
  the web code no longer fits, `npm run typecheck` fails. Either way the break is found before anything runs.
- **Keys that never come back.** The browser sends a key once, the server stores it, and every later answer is a
  boolean. The check is a test: `test_a_saved_key_shows_as_set_and_is_never_returned` looks for the key text in the
  response, and the Playwright test looks for it in the page HTML.
- **A smoke test.** One Playwright test that opens the real app, against the real server (own temp database and
  `.env`), and walks the main path. It cannot find every bug, but it fails at once when the app does not start,
  the proxy is wrong, or a screen crashes.

### How it was checked

- Server: `server/tests/test_health.py` (health shape; a saved key is set, usable at once, survives a restart, is
  never returned; removing; unknown provider; a line break is refused; `.env` keeps other lines and mode 600) and
  `test_openapi.py`. 164 pass.
- Web (Vitest, 19 tests): language and theme switch and are remembered; an unreachable server shows in the header; a
  missing corpus shows the banner; a saved key flips to "set"; a failed save opens an error report that names the
  endpoint and does not hold the key; both language files have the same keys and `{slots}`.
- Playwright smoke: opens in Arabic right to left, switches the theme and language (kept after a reload), saves a
  Gemini key, sees it as set, and checks `/api/health` agrees and does not contain the key.
- A pitfall found on the way: my shell has a real `GEMINI_API_KEY`, and environment variables beat `.env`, so the
  first smoke run saw the key as already set. The test server now starts with all four keys set to empty.
- Screenshots of the Settings screen (Arabic light, English dark) were compared with the mockup by eye.

**Try:**

```bash
cd web && npm run api:generate          # regenerate the types after changing the server's routes
cd web && npm test && npm run e2e       # Vitest, then the Playwright smoke test (starts both servers itself)
scripts/dev.sh                          # server on 8120, web on 5173: open http://localhost:5173/settings
```

## Phase 11 — Web: new lecture and saved lectures

### What was built

The Lectures screen (`web/src/features/lectures/`): a **new lecture** panel with five ways in (pasted text or
subtitles, a `.txt/.srt/.vtt` file, a YouTube link, an uploaded audio/video file, the sample), a **running** panel
with each job's stages and a live percentage, and the **saved lectures** table (search, rename, delete, delete all).
Also a plain lecture page (`/lectures/:id`: transcript, the quotes found, attach media) that phase 12 will replace,
and "open the last lecture at startup" (F-007).

### Concepts

- **Forms with controlled inputs.** `const [url, setUrl] = useState("")` plus `value={url} onChange={…}` makes React
  the owner of the field, so the Start button can be `disabled={url.trim() === ""}`. Like a Flutter `TextEditingController`
  whose listener rebuilds the widget.
- **Mutations.** `useMutation` is the write side of TanStack Query: `create.mutate(input, { onSuccess })`. When it
  settles we call `invalidateQueries(["lectures"])`, which marks the cached list stale so the table refetches by itself.
  No manual refresh anywhere.
- **Progress streams (server-sent events).** `new EventSource("/api/jobs/<id>/events")` keeps one HTTP request open and
  the server writes `event: job` lines; each one becomes `setJob(snapshot)`. The `useJobStream` hook opens it in an
  effect and closes it in the effect's cleanup (or when the job ends), the React version of subscribing in `initState`
  and cancelling in `dispose`. The jobs list is also polled every 2 s while a job is unfinished, so a card still catches
  up if the stream drops.
- **Chaining two server jobs in the client.** The server runs transcription and detection as separate jobs. `JobWatcher`
  (mounted in the layout, so it works on every screen) watches the job list: a finished `transcribe` job whose lecture has
  no detect job and no findings starts one. The two guards make it safe to reload the page.
- **Multipart upload.** The generated types say a file is a `string`; the real body is a `FormData`. A tiny `multipart()`
  helper returns `{ body, bodySerializer: () => formData }`, so openapi-fetch sends the file and the types still check
  the rest.

### How it was tested

- Vitest (6 new tests, 25 in all) with a fake server and a fake `EventSource` that the test pushes snapshots into:
  paste → lecture + detection job with its three stages, moving to "detect" and then "7 quotes"; a YouTube link sends the
  chosen model, shows `Transcribe 62%`, and starting detection when transcription ends (with the fallback reason
  shown); a file import; the sample; search, rename, two-step delete and delete all; last lecture reopened, and a deleted
  one falling back to the list.
- Playwright against the real server: an `.srt` becomes a lecture, its detection job finishes, the transcript and a
  Fatiha finding show, then rename and delete.
- Milestone A, live (`e2e/live-youtube.spec.ts`, on request only): a real Mohammed Meziane khutba link (16 min) went
  download → audio → Groq transcription → detection by itself: 1713 words and 28 findings in 28 s.

**Try:**

```bash
cd web && npm test                                                    # Vitest
cd web && npm run e2e                                                 # Playwright (own server and temp data)
cd web && WAHY_E2E_LIVE=1 npx playwright test e2e/live-youtube.spec.ts   # the real YouTube run (uses .env keys)
```

## Phase 12 — Lecture view

### What was built

The main screen (`web/src/features/lectures/view/`): the transcript on the reading side and the video beside it,
the spoken word lit in yellow as the media plays, a click on any word seeking the video there, each quote highlighted by
kind with its brackets and a reference tag that opens the quote's card (verdict, boundary, play exactly the quote,
edit, verify). Around it: the counts, the three layouts, the kind and verdict filters with presets, the clipped filter,
"standard script", auto-follow, a reading progress bar, search, double-click to correct a word, the live caption over
the video, a "now" card, the lecture tabs (view, edit, verify, Tafrigh, export; only view is built), and the lecture
version picker (view a saved version read only, save, rename, delete).

Three things outside the web app were needed:
- `engine/src/captions.ts`: the old caption builder as a pure module. The web preview uses it now and the server's
  export will use it in phase 16, so both build the same captions. It reproduces the golden SRT files for all 4 inputs
  × 4 engines and the alternative style (24 tests).
- `GET /api/lectures/{id}/findings` now carries each finding's newest verdict (none yet; phase 14 writes them).
- `PATCH /api/lectures/{id}/words/{idx}` corrects one word and keeps its timing (F-041).

### Concepts

- **Refs and effects.** A ref (`useRef`) is a box React does not watch: changing it re-renders nothing. An effect
  runs after React has put the DOM on screen. Together they let code touch the DOM directly when React would be
  too slow. Here the player time changes 60 times a second, so it lives outside React state, in a tiny store
  (`clock.ts`). The transcript marker is moved by hand in an effect: `els[i].classList.add("now")`. It is like keeping
  a value in a Flutter `ValueNotifier` and rebuilding only one small `ValueListenableBuilder` instead of the page.
- **Subscribing to one value.** `useClock(clock, s => Math.floor(s.t))` uses React's `useSyncExternalStore`: the time
  label re-renders once a second, the caption overlay only when the caption changes, and the transcript never.
- **Time to word is a binary search.** `wordAt(starts, t)` finds the last word that has started in about 15 steps on
  20,000 words, instead of a scan. ASR sometimes gives a word a start a little earlier than the word before, so the
  start list is made non-decreasing first (`startTimes`), or the search could get lost. In a pause the last word stays lit.
- **Rendering thousands of words without lag.** (1) `memo`: the transcript re-renders only when its paragraphs change,
  not on every click. (2) `content-visibility: auto` on each paragraph: the browser skips drawing paragraphs off
  screen. (3) The "already spoken" colour is a class on whole paragraphs before the current one and per word only
  inside it, so a jump from the start to the end touches a few hundred elements, not 20,000 (this cut a late click
  from about 1 s to 22 ms). (4) `useDeferredValue`: after a filter change the toolbar answers at once and React
  renders the new transcript in the background.
- **requestAnimationFrame.** The video's own `timeupdate` event fires about 4 times a second, too slow for word by
  word. While playing, a `requestAnimationFrame` loop reads `video.currentTime` once per screen frame.

### How it was tested

- Vitest, 34 new tests (59 in the web app): `sync.test.ts` covers time to word before the first word, at a start, in
  a pause, after the end, with jittered starts, against a plain scan on 2,000 words, and the speed on 20,000 words.
  It also covers the caption on screen with its hold time. `model.test.ts` covers the filters, presets, clipped,
  paragraphs (never inside a quote), standard-script tokens, search, and the fact that a hidden finding's words stay in
  the captions. `LectureView.test.tsx` drives the screen against a fake server: the marker after a click, the card and
  its edit link, the filters, the script switch, search, correcting a word, versions, layout, paragraph marks and the rail.
- Playwright against the real server and a silent 140-second video made with ffmpeg, on the sample lecture (milestone B).
  Clicking the first word of آية الكرسي takes the video to 87.05 s and lights that word. Playing moves the marker on,
  and pausing leaves it on the word at the paused time. Back 5 s and an early word also seek. The quote card's "play"
  stops at the quote's last word.
- The 2-hour check (`e2e/perf-long-lecture.spec.ts`, on request) uses the sample text 72 times: 20,160 words, 576
  findings and a silent 2-hour video. It opens in about 2.1 s. Playback runs at 60 fps with no long tasks. A click near
  the end paints in 22 ms. A filter change takes about 1.7 s on the dev server (React in development mode; the toolbar
  stays responsive meanwhile).
- Screenshots in light, dark and phone width (no horizontal scroll) compared with the mockup by eye.

**Try:**

```bash
cd web && npx vitest run src/features/lectures/view                          # the word-sync and view tests
cd web && npx playwright test e2e/lecture-view.spec.ts                       # click-to-seek in a real browser
cd web && WAHY_E2E_PERF=1 npx playwright test e2e/perf-long-lecture.spec.ts  # the 2-hour measurement
```

## Phase 13 — AI provider layer

Every model call now goes through one folder, `server/wahy/core/ai/` (ADR 0004). Five verifiers answer the same call,
`ai.verify(name, items, call=..., options=...)` → one `Answer` per item: **gemini** (batches of 5 to 10, free-tier
pacer), **jev** (OpenRouter's Decisions API), **openrouter** (any chat model, JSON mode), **laya** (your local model,
through the GPU owner) and **fake** (for tests). Groq's Whisper moved here too. Each request is saved as an
`AiRequest` row with its tokens, cost, latency and raw payload, minus keys. Failed attempts are saved too, so a 429
shows in the telemetry.

Small routes for the settings screens: OpenRouter's catalog search with live prices, the Gemini models your key can
call, and Laya status, load and unload.

### Concepts

- **Ports and adapters.** The *port* is the shape every verifier promises: `verify(items, *, call, options) ->
  [Answer]`. Each provider file is an *adapter* that turns that promise into one company's HTTP API. The verification
  pass (phase 14) only knows the port, so swapping Gemini for Laya is a string. A test plugs in `FakeVerifier`. In
  NestJS terms it is an interface token with several providers behind it; in Flutter, an abstract repository with a
  real and a mock implementation.
- **One shape for all answers.** Gemini answers `{"verdict": "CORRECT", "confidence": 0.93}`, JEV and Laya answer
  `{"verdict": {"choice": "CORRECT", "probabilities": {...}}}`. `answer_from_json` and `answer_from_decisions` turn
  both into the same `Answer`, so "0.93 correct" means the same whoever said it.
- **Rate limiting with a sliding window** (`pacer.py`). The pacer keeps the start times of the last minute's requests.
  At 5 a minute, the 6th request waits until the oldest is 60 s old. One pacer serves the whole server, because the
  limit belongs to your key, not to one job.
- **Retries and backoff** (`http.py`). A busy answer (429, 5xx) or a dropped connection is tried again. The wait is
  what the server asks for (`Retry-After: 12`, or Gemini's `"retryDelay": "7s"` + 1.5 s), else a growing delay
  (Gemini: 5, 15, 35, 65 s). A wrong key (401) is *not* retried: waiting can't fix it, so it is marked `fatal`, and a
  pass stops instead of failing 300 findings one by one. Waits run in 1-second steps that call `call.check()`, so
  pausing or cancelling a job works even in the middle of a 60-second wait.
- **The checkpoint says which envelope it reads.** `rl_agent_config.json` of `laya-wahy-r6-v3_mixed` holds
  `"wahy_envelope": 3`. `ai.laya.envelope()` reads it from the Hugging Face cache without loading the model. Phase 14
  then builds v3 envelopes with the engine, and the serving input matches the training input (ADR 0003).
- **Dependency extras.** `uv sync --extra laya` adds laya and torch only where they are wanted. torch comes from
  PyTorch's CUDA 12.6 index, because PyPI's CUDA 13 builds no longer have kernels for your GTX 1050 (sm_61). That
  forced faster-whisper's cuBLAS pin down to 12.6, and Whisper was checked on CUDA afterwards.

### How it was tested

- 46 new tests, all offline: `test_ai_core.py` (13), `test_ai_gemini.py` (9), `test_ai_openrouter.py` (13),
  `test_ai_groq_laya.py` (11). The providers are replayed from response files in `server/tests/fixtures/ai/`
  through `httpx.MockTransport`. No real replies existed yet, so the files follow each provider's documented shape.
  Checks from `features.md`: a recorded 429 waits 8.5 s and then succeeds (F-094); 20 requests at 5 a minute never
  put more than 5 in any minute (F-081); "deepseek" lists DeepSeek models with prices (F-083); JEV returns calibrated
  probabilities (F-082); loading Whisper unloads Laya and Laya loads again when needed (F-098, with a fake Laya model
  and the real GPU owner); the status shows the device and envelope 3 (F-097, F-093).
- 5 live tests (`test_ai_live.py`, marked `live`), one tiny request per provider, run once with your permission. All
  passed:

  | Provider | Model | Answer | Tokens in + out | Cost | Time |
  |---|---|---|---|---|---|
  | Gemini | gemini-3.5-flash-lite | CORRECT 0.99, complete | 852 + 119 | $0 (free tier) | 3.7 s |
  | JEV | typesafe/jev-1.14-20261014 | CORRECT 0.80 | 413 + 43 | $0.000017 | 0.9 s |
  | OpenRouter chat | deepseek/deepseek-chat | CORRECT 0.95, complete | 924 + 104 | $0.00039 | 5.4 s |
  | Groq | whisper-large-v3-turbo | 2 s of tone transcribed | (audio) | ~$0.0001 (10 s billed) | — |
  | Laya (CUDA) | laya-wahy-r6-v3_mixed, envelope 3 | CORRECT 0.51 on a golden finding | — | $0 | 4.5 s |

  Two things the real replies taught: JEV's and Laya's `confidence` is not the chosen verdict's probability (JEV 0.70
  vs 0.80; Laya 0.147 vs 0.506), so read `probabilities` when you want "how sure". And Laya answered the v3 yes/no
  questions too (start cut off 0.74, end cut off 0.70). The real replies are kept as `real_*.json` fixtures with 4
  replay tests, beside the hand-written ones.
- `scripts/test.sh` all green: old backend 152, server 217 (+6 live skipped), engine 106, web 59, Playwright 4.

**Try:**

```bash
cd server && uv run pytest tests/test_ai_gemini.py -v              # the 429 / pacer / batch tests
cd server && uv run pytest tests/test_ai_live.py --live -v         # the real calls (costs < $0.01; ask first)
curl 'localhost:8120/api/settings/ai/openrouter/models?q=deepseek' # live prices, once ./scripts/dev.sh runs
```

## Phase 14 — Verification pass and telemetry (server)

The server can now run a **verification pass**: the job that asks a verifier about a lecture's findings and saves
its verdicts. It lives in `server/wahy/features/verification/`. A pass picks findings by scope (hadiths plus the
findings the engine itself doubts, hadiths only, or all) or by id. It asks the engine for envelopes, sends them
through `core/ai` (5 to 10 per Gemini request, 1 per request for the others), and saves one verdict per finding,
each linked to the AI request that produced it. A pass can be paused, resumed and cancelled, and it resumes after
a server restart. Before a pass you can ask for an **estimate** (findings, requests, tokens, cost, time) and a
**preview** (the exact body the model would get). Afterwards there are **metrics**.

Other routes: your own verdict on a finding (saved as a **gold label**), "approve all", and **expand**. Expand is the
old editor's auto-heal, moved into the engine as `engine/src/expand.ts`: a finding whose start or end is missing
grows over the words that match. The new `features/telemetry/` serves the request log and one request's payloads.
The two prompt rules from review notes 5 and 29 (N-020) are new optional rules, off by default.

### Concepts

- **Orchestrating a job.** `run_job` in `verification/service.py` is a loop over *chunks* (one chunk is one request).
  It does four things, in this order:
  1. Before each chunk, `ctx.check()` waits while the pass is paused and raises if it was cancelled.
  2. It calls the verifier.
  3. It saves that chunk's verdicts in one database transaction.
  4. It writes a checkpoint: `ctx.save_checkpoint({"chunks": 3, ...})`.

  After a restart the job runs again from the top, reads `ctx.checkpoint` and skips the chunks already done. That is
  why a resumed pass never asks twice about the same finding.

  One thing the test taught: the request that was *running* when the server stopped still finishes and is saved.
  The stop only takes effect at the next `check()`. So "resume" continues after it, not before it.

- **Choosing the targets before the job starts.** `start()` turns "the default scope" into a fixed list of finding
  ids and stores it in the job's params. A pass resumed tomorrow judges the same findings, even if you changed the
  scope setting meanwhile. Compare NestJS: you'd validate the DTO in the controller and hand the service plain ids.

- **The same envelope everywhere (ADR 0003, in practice).** The Laya path asks the checkpoint which envelope it was
  trained on (`rl_agent_config.json`: `wahy_envelope: 3`, `passages: true`, questions `["verdict"]`). It builds exactly
  that version with the engine and drops the questions the checkpoint never learned. A checkpoint that knows only
  the verdict gets its boundary from the **word-overlap rule**: did the speaker say a corpus word right before or
  after the span? The golden test proves it: on all 4 golden inputs, for v1, v2 (4 option sets) and v3 (2), what Laya
  read is byte for byte the old app's envelope. One deliberate difference from the old app: it sent v3 envelopes to v1
  checkpoints too, which is exactly the training/serving skew ADR 0003 forbids. Now a v1 checkpoint reads v1.

- **A passage's boundary is split.** Three verses judged as one passage get one answer. The rule is that "the start
  is cut off" can only be true of the *first* verse and "the end is cut off" only of the *last*. So the answer is
  turned into two yes/no probabilities, P(start) and P(end), and each verse gets its share:

  | Verse | P(start) | P(end) | Saved boundary |
  |---|---|---|---|
  | first | 0.8 | 0 | MISSING_START |
  | inner | 0 | 0 | COMPLETE |
  | last | 0 | 0.8 | MISSING_END |

  `boundary_from_yes_no` treats the two sides as independent, so it turns them into four classes:
  P(both) = 0.8 × 0.8, P(start only) = 0.8 × 0.2, and so on.

- **Telemetry by joining, not copying.** The request log row knows tokens, cost and payload. The verdict row knows
  which request made it (`ai_request_id`). The log screen joins the two to show "this request judged these findings,
  with these verdicts, and you later corrected this one". A failed request makes no verdict, so each request now
  also stores the ids of the findings it was about (`Call.finding_ids`, migration `0004`).

### How it was tested

- `tests/test_verification.py` has 23 tests at the API. Most use the fake verifier and a fake engine, whose envelopes
  come from each finding's own fields, so the tests check the pass's own rules. A few use the real worker on the
  small corpus. The `features.md` checks:
  - three findings picked by hand are exactly the three sent (F-084);
  - half the findings gives half the tokens and requests (F-087);
  - pause half-way, then resume: every finding gets exactly one verdict (F-088);
  - the pass's cost equals the sum of its logged requests' costs (F-089);
  - "strict" shows the strict rule in the preview (F-086);
  - a finding's neighbour goes out with it (F-092);
  - your verdict shows as `human` and becomes one gold label, updated in place the second time (F-065);
  - approve all gives one gold label per AI verdict, once (F-091);
  - one log row per request, and the inspector shows the exact payload (F-095, F-096).

  Also covered: cancel, a failed request vs a fatal one, a second pass on the same lecture (409), passage
  boundaries, the rule boundary, v1/v2/v3 checkpoints, expand with the real engine, and a pass interrupted by a
  real restart and then resumed.
- `tests/test_verification_golden.py` has 32 tests: the golden envelopes, as described above.
- `engine/src/expand.test.ts` has 5 tests: a hadith cut by 2 words at the start (or 3 at the end) grows back, and only
  on the side reported missing.
- Feature check, through the API with the real Laya on your GTX 1050: the sample lecture, engine v5, checkpoint
  `laya-wahy-r6-v3_mixed`. It made 8 findings in 6 requests (the three verses of al-'Asr went as one passage) and
  took 19.5 s. Laya saved 8 verdicts: 7 CORRECT, 1 FALSE (صحيح مسلم 2149), all boundaries complete (by the rule,
  since this checkpoint answers the verdict only). The metrics matched the 6 logged requests.
- `scripts/test.sh` all green:

  | Suite | Result |
  |---|---|
  | Old backend | 152 |
  | Server | 272, plus 6 live tests skipped |
  | Engine | 111 |
  | Web | 59 |
  | Playwright | 4 |

**Try:**

```bash
cd server && uv run pytest tests/test_verification.py -v -k "pause or passage"    # the job and the boundary split
curl -X POST localhost:8120/api/lectures/1/verification/estimate \
     -H 'content-type: application/json' -d '{"scope":"ALL","options":{"provider":"laya"}}'
curl 'localhost:8120/api/telemetry/requests?limit=5'                               # the request log
```

## Phase 15 — Web: verification and telemetry

The web app can now run a verification pass and show what it cost. Two places changed:

- **The lecture's "Verify" tab** (`web/src/features/verification/`). On the left, the quotes that will be sent, each
  with a tick box; you can choose by scope (hadith and suspects, hadith only, all) or by hand, with search, kind and
  verdict filters, "select shown", "none" and "invert". On the right, the verifier (Laya, Gemini, JEV or an OpenRouter
  chat model) with its options, the **estimate** (quotes, requests, tokens, cost, time), the **Start** button and
  the pass's **progress** with pause, resume and cancel. When the pass ends you see its numbers (requests, time, tokens,
  cost, verdict counts) and "Approve all", which asks twice before it saves gold labels.
- **The request log** (`/requests`, `web/src/features/telemetry/`). One row per AI request: time, provider, quote,
  verdict with its probability, your correction, size, tokens, cost, time taken. Click a row and the inspector shows the
  exact JSON sent and received, readable or raw, with a copy button for each.

Smaller pieces: the quote card now has your own verdict buttons and, for a quote whose start or end is missing, a
"Complete the quote" button (it calls the server's expand). The transcript draws a ✂ at the edge that is missing.
Unticking "Ordinary speech" in the lecture view still turns those quotes into plain words (phase 12 built it; phase 15
checks it against real verdicts).

### New ideas

**Optimistic updates.** Normally a button waits for the server and then shows the result: click, wait 300 ms, see the
change. An *optimistic update* shows the result first, and fixes it if the server says no. In
`api.ts`, `useSetVerdict` does it in four steps with TanStack Query:

```ts
onMutate:  save a copy of the cached findings, then change the one finding in the cache  // the chip changes now
onError:   put the saved copy back                                                        // the server refused
onSettled: ask the server for the real findings again                                     // whatever happened, end true
```

The same pattern saves the verifier settings (`useUpdateSettings`): the provider button turns on at once. The test
`a refused settings change puts the old verifier back` makes the server answer 422 and checks the old button is
pressed again. It is the same idea as setting state first in Flutter and rolling it back in a `catch`.

**State that comes from the server versus state that is only the screen's.** The settings and the findings live on the
server, so they are *queries* (cached, shared by every component). Which boxes are ticked is the screen's own state
(`useState`), and it is turned into the list of ids the estimate and the pass send. The estimate is a query whose key
contains those ids and the settings, so changing either asks again, after a 250 ms pause so that typing does not send
one request per key.

**Following a job.** A pass is a job that keeps running if you close the page. The tab looks for a running `verify` job
of this lecture in the jobs list and follows it with the same event stream the transcription card uses
(`useJobStream`). After each finished request it asks for the findings again, so the chips fill in while it runs.

**One rule written twice.** The tick boxes must match the server's idea of a scope, so `selection.ts` repeats the
server's `in_scope` rule. The pass then sends explicit ids, never the scope name, so the server rule cannot silently
disagree with what you saw ticked. A test pins the rule.

### How it was tested

- Vitest (80 tests; 21 new): `selection.test.ts` (scopes, filters, none, invert), `VerifyPage.test.tsx` (the default
  ticks; unticking changes the estimate, F-087; "three picked, three sent", F-084; progress, pause, numbers and the
  two-step approve, F-088/089/091; the optimistic verdict and settings, with the server refusing; the preview, F-086;
  the ✂ badge, F-090; complete the quote), `RequestsPage.test.tsx` (one row per request, F-095; readable and raw
  JSON with copy, F-096; clear asks first).
- Playwright (6 tests; 2 new in `e2e/verification.spec.ts`), with the server's fake verifier: a real pass over the sample
  lecture, then the log and the inspector; and hiding "ordinary speech" keeps every word.
- **Feature check, with the real Laya on your GTX 1050** (`e2e/live-laya.spec.ts`, 27 s): the sample lecture, checkpoint
  `laya-wahy-r6-v3_mixed`. The pass finished, every ticked quote got a verdict, the log showed the Laya requests and the
  inspector showed the v3 envelope (the passage العصر 1-3 as one request). Hiding "ordinary speech" hid Laya's false
  finding (Muslim 2149) in the transcript and kept all its words.
- `scripts/test.sh` all green:

  | Suite | Result |
  |---|---|
  | Old backend | 152 |
  | Server | 272, plus 6 live tests skipped |
  | Engine | 111 |
  | Web | 80 |
  | Playwright | 6 (plus 1 live Laya test on request) |

**Try:**

```bash
cd web && npx vitest run src/features/verification          # selection rules + the verify tab
cd web && npx playwright test e2e/verification.spec.ts       # a whole pass in the real app, fake verifier
cd web && WAHY_E2E_LIVE=1 npx playwright test e2e/live-laya.spec.ts   # the same with the real Laya (GPU)
```

## Phase 16 — Editing and export (server)

### What was built

- **Editing** (`server/wahy/features/editing/`): every change the editor can make, each one saved as an operation in
  the lecture's **edit log**, so undo works and survives a reload: fix one word, rewrite some words, save the full text,
  add a missed quote, move a quote's edge, change its kind, use the source text or picked reference words, link or add
  references, merge with a neighbour, delete "as ordinary speech" (a gold "false" label) or as a mistake, expand a
  clipped quote, and split, merge or re-time captions. `POST /api/lectures/{id}/edits/undo` undoes the newest one and
  names it.
- **Export** (`server/wahy/features/export/`): SRT, VTT, ASS, Markdown, plain text, HTML and JSON, with the saved
  bracket and reference style. An export shows what the screen shows: the verdict and kind filters, and "as spoken" or
  "standard script".
- **In the engine package**: `engine/src/export.ts` writes the files and `engine/src/edit.ts` holds the old editor's
  finding edits (they need the corpus). The web app will import the same `export.ts` for its preview (phase 17).
- **Commentary gaps** (new): when the speaker comments in the middle of a quote, the comment now goes outside the
  brackets: `«part one» [commentary] «part two» [ref]`. A setting (`splitCommentary`) turns it off.
- **Embedded verses** (changed after phase 17, the user's choice): a Quran verse inside a hadith gets its own `﴿…﴾`
  inside the hadith's brackets also when the hadith has no gap: `«ثم قرأ ﴿وما خلقت الجن والإنس إلا ليعبدون﴾» [ref]`.
  It lives in ONE place, so it is easy to undo: `engine/src/captions.ts`, the constant `BRACKET_EMBEDDED_QURAN` and
  the rule `bracketsEmbeddedVerses` under "verses inside a hadith". The captions, the text exports and the web
  transcript all ask that rule. To go back to the old app's output, set the constant to `false` and empty the list in
  `engine/src/golden-differences.ts`.

### New ideas

**The command pattern for undo.** An edit is an object that knows how to do itself and how to be undone. The old app
saved a full copy of everything before each edit (a snapshot) and kept the copies in browser memory, so a reload lost
them. Here every edit writes one row to `edit_ops` with only what it replaced:

```python
# delete a finding "as ordinary speech" saves:
undo = {"findings": [{"id": 42, "before": {..., "deleted": False}}],   # how the finding was
        "verdicts": [131], "labels": [{"id": 7, "before": None}]}      # what it created (None: remove on undo)
```

Undo reads the newest row that is not undone and writes `before` back. It only ever undoes the newest one, which is
what makes "write back what was there" always correct: nothing else changed those words or findings since. (A new
detection replaces all findings, so it starts the log again.) A deleted finding is only *marked* deleted, so undo
brings it back with its verdicts and label. In NestJS terms: each service method builds a `Change` (a small DTO) and
one private method, `_apply`, saves it and its undo in one database transaction.

**LCS alignment: keeping word times through a text edit.** ASR gives each word a start and an end. When you fix the
text, the unchanged words must keep their times. The *longest common subsequence* of the old and new word lists says
which words stayed:

```
old:  قال  الله  تعالي   قل   هو      (times 0.0, 0.5, 1.0, 1.5, 2.0)
new:  قال  الله  تعالى   قل   هو
LCS:  قال  الله          قل   هو      → those four keep their own times
gap:             تعالي → تعالى         → one word for one word: the new word takes 1.0
```

When the counts differ (two words become three), the new words share the time of the words they replaced. It is a
small dynamic-programming table, the same idea as `diff` and as edit distance in NLP. Only the changed middle of the
text is aligned (common words at both ends are stripped first), so an edit in a 2-hour lecture stays cheap.

**Positions move after an edit.** A finding says "words 16 to 23". Insert two words before it and it must say 18 to
25, and its engine positions too (`segments` count engine *tokens*, and a word can hold 0, 1 or more tokens: «،» has
none, «ابن-عمر» has two). `align.py` `Shift` moves word, token and character positions.

**Golden files decide, and a setting keeps them reachable.** Commentary gaps change the output, which would break the
golden test. So the new behaviour is a setting: with it off, every export of every golden input equals the old app's
file (100 engine tests); with it on, a test checks that the *only* captions that change are those of findings with gaps.

**Expected differences are written down, not regenerated.** When the user chose brackets for verses inside gapless
hadiths, one golden finding changed (Muslim 6889 in `yt_iG2F8nymm1A`, found by v3), with the split off too. The easy
wrong fix is to run the golden script again so the test passes, but then the test no longer proves anything about the
old app. Instead `golden-differences.ts` lists the change by hand: in these five files, this text becomes that text. The
test applies exactly those replacements to the old file, then compares byte for byte:

```ts
// old: «رب السماوات ورب الأرض رب العرش العظيم،»
// new: «﴿رب السماوات ورب الأرض رب﴾ العرش العظيم،»
expect(exportLecture({ format, words, findings, prefs: OLD }).content).toBe(expectedGolden(rel, read(rel)));
```

Each listed text must occur exactly once in its file, so a list that no longer fits fails loudly. A second test checks
that the list covers the only golden finding with an embedded verse, and that it only adds the two brackets.

### How it was tested

- Engine (Vitest, 248 tests; 137 new): every golden export (SRT, VTT, ASS, Markdown, text) of the 4 inputs × 4 engine
  choices, plus the alternative style, equal to the old app's files; the three commentary cases (a hadith with a gap; a
  hadith with a gap and a verse inside it; a verse with a gap, also in the source text); the caption editor; each
  finding edit on the tiny corpus. Added after phase 17: a verse inside a gapless hadith (split on and off, a long
  hadith cut into captions, the source text, the real Muslim 6889) and the expected-difference list; on the web side,
  `model.test.ts` (the verse's words are marked) and `Transcript.test.tsx` (the transcript shows the same `«…﴿…﴾»` as
  the text export).
- Server (pytest, 303 tests; 31 new): `test_editing.py` with the real engine worker: **word timings survive a text
  edit** (three words fixed, every other word keeps its exact start and end; two words inserted, the hadith after them
  moves from 16-23 to 18-25 with its tokens and characters); each edit is logged and undo restores words, findings and
  captions exactly; a gold "false" label appears and disappears with undo. `test_export.py`: the sample lecture and a
  lecture with gaps detected with the full corpus, exported through the API, equal to the old app's files.
- **Feature check**: a running server, the sample lecture detected with v5, its SRT, VTT, ASS, Markdown and text
  downloaded: all five byte-identical to the old app's. Adding a missed quote showed it in the SRT; undo removed it.

**Try:**

```bash
cd engine && npx vitest run src/export.test.ts            # golden exports + commentary gaps + embedded verses
cd server && uv run pytest tests/test_editing.py -q        # edits, undo, timings through a text edit
cd server && uv run pytest tests/test_export.py -q         # exports, filters, golden through the API
```

## Phase 17 — Web: editor and export

### What was built

The lecture's **edit** and **export** tabs (`web/src/features/editing/`, `web/src/features/export/`), over phase 16's
server routes:

- **Edit → quotes**: a word board (every word a chip, quotes in their colour). Click the first and the last word of a
  missed quote (or drag) and the inspector becomes the *studio*: the closest references, ranked by the engine, with the
  matched words lit in the source text; or "outside the sources" with a typed reference. Click a quote instead and the
  *inspector* shows it: previous / next, what was said, the source words as chips to pick from, the matching
  references (link another, add, remove, search the corpus), move an edge by one word, complete a clipped quote, merge
  with a close neighbour, your verdict (a gold label), "reference wrong" (N-007), change the kind, delete with a reason.
- **Edit → full text** (saved with LCS alignment, so word times survive) and **edit → caption timing** (re-word, split
  at a word, merge, nudge or type times, set to the playhead; quotes are locked).
- **Undo** in the header, naming the edit it would take back ("Undo: Add a missed quote"). The log is on the server, so
  it also works after a reload.
- **Export**: a preview of the real file beside its settings (SRT, VTT, ASS, HTML, Markdown, text, JSON; print / PDF;
  brackets; standard script; hide ordinary speech). The view tab now uses the same brackets, the commentary-gap split
  and the caption edits, so the screen and the files agree.
- Small server additions the screens needed: `GET /api/corpus/suggest` (the studio's ranking, moved from the old
  editor into `engine/src/search.ts`), `GET /api/corpus/units` (a reference's words, a hadith's chain too),
  `GET /api/lectures/{id}/edits/captions`, the `flag_reference` edit, and each verdict's `confidence` and `details`.

### New ideas

**Two kinds of state.** The editor holds two very different things. *Server state* (words, findings, the edit log,
captions) lives in TanStack Query: after any edit one function, `refreshLecture`, marks those queries stale and they
are read again. *UI state* (which words are selected, what the inspector shows) lives only in the browser, and is the
hard part. Keeping the two apart means an edit never has to patch the screen by hand: it changes the server, and the
screen follows.

**A reducer for the selection.** The board's clicks have rules (a click on a quote opens it, unless a first word is
already chosen; a third click starts again; a drag always makes a range). Instead of five `useState`s changed from five
handlers, one pure function takes the state and an action and returns the next state (`board.ts`):

```ts
boardReducer({ anchor: 7, range: null, ... }, { type: "click", i: 9, findingId: null })
// → { anchor: null, range: [7, 9], ... }
```

`useReducer(boardReducer, EMPTY)` runs it in React. Because it is a plain function, `board.test.ts` tests every rule
with no browser at all. It is the same idea as a Redux reducer, or a Flutter `Bloc` mapping events to states.

**Derived state instead of copied state.** The studio does not store "the chosen reference" when suggestions arrive;
it computes it: `chosen = picked ?? (best scores > 0 ? best : OUTSIDE)`. Only what the user did (`picked`) is state.
Copying derived values into state is the classic source of "the screen shows stale data" bugs.

**`key` resets a component.** The studio is rendered with `key={`${start}-${end}-${kind}`}`. When the selection changes,
React throws the old studio away and makes a fresh one, so its search box and choice start empty. No "reset" effect is
needed.

**Re-render only what changed.** A 2-hour lecture has about 20,000 words. Moving the pointer while choosing the last
word previews the range, which would re-render every chip. The board is cut into chunks (`boardChunks`, never inside a
quote) wrapped in `memo`, and each chunk gets only the part of the selection inside it, so a mouse move redraws one or
two chunks. CSS `content-visibility: auto` lets the browser skip drawing chunks that are off screen.

### How it was tested

- Engine (Vitest): `search.test.ts`, the studio's ranking on the tiny corpus (a verse heard as «العلمين» still ranks
  الفاتحة: 2 first, with its matched words).
- Server (pytest): suggestions, unit words (a hadith's chain and matn bounds), the "reference wrong" flag and its undo,
  the verdict's confidence and details, the caption edits list.
- Web (Vitest, 102 tests): `board.test.ts` (the selection rules, chunks, neighbours, candidates), commentary gaps in
  the transcript model, and `EditPage.test.tsx` against a fake server (insert a missed quote, undo it from the header,
  inspector edits, delete with a reason, split a caption, change the brackets).
- **Feature check** (Playwright, `e2e/editor.spec.ts`, real server and engine, the sample lecture): two clicks on three
  plain words, insert; the server has the new finding and a quote caption; the view's transcript shows the quote and
  the caption over the video shows it; the header's undo ("Undo: Add a missed quote") removes it from both. The export
  tab's download is byte-identical to the server's SRT, and « » verse brackets reach the transcript after a reload.

**Try:**

```bash
cd web && npx vitest run src/features/editing            # the selection reducer and the editor screens
cd web && npx playwright test e2e/editor.spec.ts          # the feature check in a real browser
scripts/dev.sh   # then open a lecture → Edit, click two words, insert, and press undo in the header
```

## Phase 18 — Tafrigh (server)

### What was built

Tafrigh turns a transcript into a written lesson: it cuts the text into sentences, asks a model to label each one
(paragraph, heading, list item, matn, comment...), fixes clear ASR typos, and renders Markdown / HTML. The code already
existed in `backend/tafrigh/` (5,700 lines, 2,000 lines of tests). This phase **moved it, it did not rewrite it**:

- `server/wahy/features/tafrigh/` holds the same segmenter, validators, outline repair, renderer and review queue.
  It is a *copy*: the old app must keep working until phase 24, so `backend/tafrigh/` stays.
- Three things are new. (1) The adapters no longer speak HTTP: they call `core/ai` (`ai.gemini.generate`,
  `ai.openrouter.complete_json`, `ai.jev.decide`, `ai.laya.predict`), so keys, retries, free-tier pacing, cost and the
  request log are in one place. (2) A run is a **job**. (3) A run is a **folder** in `data/tafrigh_runs/<run_id>/`.
- API: `POST /api/lectures/{id}/tafrigh/preview | estimate | runs`, `POST /api/tafrigh/jobs/{job}/stop`,
  `GET/PATCH/DELETE /api/tafrigh/runs/{id}`, `.../clone`, `.../review`, `.../export?format=md|html|json`,
  `POST /api/tafrigh/compare`.

### New ideas

**Moving code without breaking it.** The safest port keeps the tested logic byte-for-byte and changes only the seams:
imports, the error type, and how the model is called. Here that was four adapters and one pipeline file; the 70 tests
of the old package run unchanged against the new package (only imports and the HTTP-level tests changed). A style pass
(ruff) would have touched every line, so the ported folder has a per-file lint exemption in `pyproject.toml` for long
Arabic prompt lines, instead of a rewrite that could change behaviour.

**A seam is where you can substitute.** Adapters take `ai` (the `AiLayer`) in their constructor. A test passes an
`AiLayer` built over `httpx.MockTransport`, so the *real* adapter, the *real* AI layer and a *fake provider server*
run together, offline:

```python
ai = make_ai(httpx.MockTransport(handler))          # tests/tafrigh/helpers.py
GeminiAdapter(ai, route="openrouter", openrouter_model="gemini-3.1-flash-lite").classify_uow(uow)
```

**Two ways to end a job early.** *Cancel* (the job runner's) raises `JobCancelled` at the next `ctx.check()` and keeps
nothing. *Stop* is Tafrigh's: the service sets a `threading.Event`, and `Call.check` (which every wait in `core/ai`
calls) raises `TafrighStop`; the pipeline catches it and returns the sentences it has finished. One `check` function
does both, so a stop works even while a request is waiting out a 429. The old code needed a second thread and a lock
(`snapshot_result`) for this; they are gone.

**Persistence = write after every change, read lazily.** `RunStore` keeps a run in memory for speed but writes
`session.json` (atomically: write a `.tmp`, then `os.replace`) after the run and after every review action, and loads it
from disk when it is not in memory. That is the whole fix for "relabel, restart the server, the relabel is gone": the
old app only kept runs in a Python dict. The run id comes from the URL and becomes a folder name, so it is matched
against `^run_[0-9a-f]{12}$` first (otherwise `../../x` would be a path-traversal bug).

**Derived outline.** After a review turns a sentence into a heading, the outline state saved at the end of the run does
not know. `RunSummary`/`RunDetail.outline` is therefore *computed* from the sentences' current labels, not copied.

### How it was tested

- The ported tests: segmenter, matn alignment, validators, renderer, outline repair, pipeline modes (windowed and
  per-sentence), review queue, evaluation, run logger and comparison, JEV contract. Run unchanged except for imports.
- New: `test_tafrigh_service.py` (the API end to end on the sample lecture: preview with a 10-word cap, a run as a job,
  the request log attributed to the job, **the restart test** (run, relabel, start a *second app* on the same data
  folder, the relabel and the outline are there), clone independence, compare lists exactly the changed sentence,
  stop keeps the finished sentences, a window of 6 over 12 sentences is 2 requests, refusals, the offline fallback,
  "no run changes the original words"), `test_tafrigh_source.py` (the text builder), `test_tafrigh_adapters.py`.
- **Feature check (live, free tier, $0):** on the sample lecture (12 sentences, so the 20-sentence slice covers it) a
  windowed run (2 requests) and a per-sentence run (12 requests) on `gemini-3.5-flash-lite`; compare lists the 2
  sentences the two runs label differently (`seg_0004`, `seg_0011`: paragraph vs continuation).

### Things worth knowing

- `training_store.py`, `exporters.py` and `pilot_tools.py` came across with their tests, because the old tests cover
  them; they are research tooling and phase 20 (training data, F-120) decides what happens to them.
- The OpenRouter key in `.env` is expired (401); `gemini_route: "auto"` prefers OpenRouter when a key is set, so a run
  with the default route fails with a clear message. Use `gemini_route: "direct"` or replace the key.
- A Tafrigh job is **not resumable** after a restart (the classifier has no checkpoint); it shows as interrupted.

**Try:**

```bash
cd server && uv run pytest tests/tafrigh -q                      # 89 tests, offline
cd server && uv run pytest tests/tafrigh/test_tafrigh_service.py -k restart -v
scripts/dev.sh   # then: curl -XPOST localhost:8120/api/lectures/sample; curl -XPOST localhost:8120/api/lectures/1/tafrigh/runs -H 'content-type: application/json' -d '{"first_n":20,"gemini_route":"direct"}'
```

## Phase 19 — Web: Tafrigh

### What was built

The lecture's **Tafrigh tab** (`web/src/features/tafrigh/`), all of it a client of the phase-18 server:

- **Sentences** (F-106, F-107, F-109): the sentences a run would classify, with their statistics, before any model is
  called; the cutting settings, the text source and "re-run the engine first" (the ordinary detection job with a chosen
  engine) beside it.
- **Settings and estimate** (F-108, F-110 to F-114): the matn, the classifier, the Gemini model and route, window or
  sentence mode, typo strategy and the sentence range with the "first 10 / 25 / 50" test slices. The estimate is asked
  again after every change and shows each mode's requests and tokens.
- **A run with progress** (F-115, F-116): a bar with the finished sentences and the sentences waited on, requests, tags
  so far, pause, resume, **stop** (keep what is finished) and cancel; a failed run shows its error and *Retry*.
- **The lesson** (F-117, F-118): the outline as a bar of headings, warnings, the run summary with its cost breakdown,
  every sentence with its label; a sentence opens a card with who labelled it, the model's odds, what a split did,
  which fixes were applied or turned down and why.
- **Review** (F-119): the queue, one sentence at a time: confirm, relabel, undo a typo fix, next.
- **Saved runs and compare** (F-121, F-122): picker, rename, *Save as new*, delete; a comparison of two to six runs
  (settings, cost, tags, and the sentences labelled differently).
- Not here: **F-120** (save a run for Laya as training rows). It needs phase 20's training tables; phase 20 already
  lists it.

### New ideas, plainly

**A long-running UI is a job you *follow*, not a request you *wait for*.** Pressing *Start* does not wait for the run.
`POST …/tafrigh/runs` answers at once with a job (`202`), and `RunProgress` follows it over a server-sent-events
stream (`EventSource`), the same `useJobStream` hook the verification pass uses. Because the job lives on the server,
closing the tab changes nothing: the page asks `GET /api/jobs` on load, finds a running `tafrigh` job of this lecture
and follows it again.

```tsx
const going = jobs.data?.find((j) => j.kind === "tafrigh" && j.lecture_id === lecture.id && isUnfinished(j));
useEffect(() => { if (!watching && going) setWatching(going); }, [going, watching]);
```

**Server state and screen state are different things.** The run, its sentences and its review queue are *server
state*: TanStack Query fetches them and caches them under a key (`["tafrigh-run", runId]`). Which sentence is open and
which view is shown are *screen state*: plain `useState`. A review action (`POST …/review`) returns the whole run
drawn again, and `setQueryData` puts that straight into the cache, so the queue shrinks without a second request.

**A debounced query.** Typing "10" in *max words* must not send a request per key. The preview's `queryFn` first waits
300 ms and checks `signal.aborted`; when the key changes, TanStack Query aborts the old call, which therefore never
reaches the server. `placeholderData: keepPreviousData` keeps the old sentences on screen meanwhile, so the list does
not flash empty.

**A form field with a half-typed value.** `NumberBox` keeps what the user typed in its own `useState` and only
reports a number when the text is one (an empty box or `1.` is not). On blur it shows the saved value again. Without
this, clearing a box would snap back to the default at once and you could never type a new number.

**Pure logic gets pure tests.** `settings.ts` (range `1–10` → server `[0, 10)`), and `labels.ts` (who labelled a
sentence, what a split did, which sentence is "next to review") are plain functions, tested without a screen.

### Something the screen taught

*Max words* is a cap with one exception: **a verse is never cut**. The segmenter protects atomic Quran ranges, so with
the quotes as found, a 69-word verse stays one sentence even at "max 10". The preview now shows "n over the limit" so
this is visible, and the Playwright check proves the strict case on the raw text.

### How it was tested

- **Vitest** (`TafrighPage.test.tsx`, `settings.test.ts`, `labels.test.ts`): a fake server behind the real screens.
  The preview and its settings; the estimate following the mode; a run sending the exact request (first-10 slice,
  mode), the progress from a pushed job snapshot, *stop*, the saved run opening; a failed run and *Retry*; a refused
  start; the lesson (warning, cost breakdown, outline scroll); a split sentence's details; relabel and confirm sent to
  the server with the next sentence opening; *Save as new*; the comparison; re-detect asking twice.
- **Playwright** (`e2e/tafrigh.spec.ts`), real server and engine, offline: the preview and estimate; then a saved run
  made by `scripts/seed_tafrigh_run.py` (the server's test double as the model) is reviewed, cloned, relabelled in the
  copy (the first run is unchanged, checked on the server), compared and exported (the downloaded file equals the
  server's).
- **Feature check, live** (`e2e/live-tafrigh.spec.ts`, Gemini free tier, called directly, $0): from the new app, a
  run on the sample's test slice (10 sentences, 1 windowed request), then one sentence confirmed; the run on the server
  says `reviewed: 1`.

**Try:**

```bash
cd web && npx vitest run src/features/tafrigh                       # screens and logic, offline
cd web && npx playwright test e2e/tafrigh.spec.ts                    # real server, offline
cd web && WAHY_E2E_LIVE=1 npx playwright test e2e/live-tafrigh.spec.ts   # a real Gemini run (uses .env)
cd server && uv run python ../scripts/seed_tafrigh_run.py /tmp/x 1 8     # make a finished run without a model
```

## Phase 20 — Training data

### What was built

Where Laya's training rows come from, kept on the server, with a screen to look at them and the files Kaggle reads.

- **Gold labels from your corrections** (F-064, F-065, F-091, N-007). Phase 14 already saved a label when you pressed a
  verdict button or "approve all", and phase 16 when you deleted a quote "as ordinary speech". Now each label also
  says *how* it was given (`SET`, `VALIDATE_ALL`, `ORDINARY_SPEECH`), and **a missed quote you add by hand is a gold
  label too** (`MISSED_QUOTE`, correct and complete); undo removes it with the quote. The "reference wrong" flag on a
  quote (N-007) reaches its label's row as `meta.ref_issue`.
- **The Laya JSONL export** (F-101): `GET /api/training/export`. The rows are written by the old app's own converter,
  moved into the engine as `engine/src/training.ts` (worker command `laya_jsonl`), so the bytes are the old app's.
- **The legacy import** (F-100): `POST /api/training/import` (a file) and `/import/legacy` (every file in
  `data/legacy/`). The old app's only export of its bank was that same Laya JSONL file, so that is what is read.
  Importing the same row twice replaces it.
- **The training data screen** (F-104, F-103): counters, filters (gold, approval, models, old app, Tafrigh; task;
  label; search), a table that says where each row came from, the exact JSON line a row exports, import, export (all
  or gold only) and clear (two clicks).
- **Tafrigh sentences for Laya** (F-120): a "Save for Laya" button on the Tafrigh tab with the old quick picks
  (reviewed by you, corrected, confidence ≥ 85 %, leave out what needs review). The examples are rows in the database;
  saving the run again replaces them.

### New ideas, plainly

**Data lineage** means every training row can answer "where did you come from?". It matters because Laya can only be
as good as its labels: if a bad batch of rows shows up, you want to find its source and remove all of it. Here each
row has an *origin* (you, the old app, a Tafrigh run, a verifier) and, for your labels, the *action*:

```text
label:12   origin=user     action=ORDINARY_SPEECH   lecture="درس الجمعة"   ai_verdict=CORRECT
verdict:9  origin=ai       provider=laya-wahy-r6-v3_mixed
label:40   origin=legacy   key="legacy:wahy_dec_1793707200_0"
label:51   origin=tafrigh  key="tafrigh:run_ab12…:tafrigh_structure:seg_0004"
```

The `key` column is lineage you can act on: importing a file again, or saving a Tafrigh run again, finds the old rows
by their key and **replaces** them instead of adding duplicates (an *idempotent* import: doing it twice is the same as
doing it once).

**A card is a snapshot.** A label stores its finding and its v1 envelope as they were when you labelled them (the
`card` column). If the lecture is re-detected or deleted later, the label still exports the same row. One thing is
read *live* on purpose: the "reference wrong" flag, so undoing the flag also changes the row.

**Porting a function byte for byte.** The old converter used `Date.now()` and `Math.random()` for ids, and a global for
the lecture title. The port takes them as arguments, so the golden test can pass in the same seeded random sequence
`make_golden.mjs` used, and the output is the old file exactly:

```ts
const random = seeded();                       // make_golden.mjs's Math.random
const { jsonl } = layaJsonl(records, NOW, { lectureTitle: TITLE, random });
expect(jsonl).toBe(fs.readFileSync("engine/golden/expected/laya_export.jsonl", "utf8"));
```

**Why the JSON is written by Node, not Python.** `json.dumps(0.00005)` in Python gives `5e-05`; JavaScript's
`JSON.stringify` gives `0.00005`. A Kaggle script would read both as the same number, but a byte-for-byte test would
fail, and so would the hash of a dataset. Sending the rows through the engine worker means the server never formats a
number itself: the stored row goes in, the worker's `JSON.stringify` comes out, exactly as the old app wrote it.

**Model verdicts are rows until you decide.** As in the old bank, a verifier's newest verdict on a finding is a
(non-gold) row. When you give your own verdict on that finding, your gold label takes its place, and the model's
verdict is kept inside your row as `ai_verdict` (what the model said before you corrected it). *Clear* deletes the
labels and hides the verdicts given so far; the verdicts themselves stay on their lectures.

### How it was tested

- **Done when** (`server/tests/test_training.py`): the golden `laya_export.jsonl` (the old app's export of a bank with
  three user verdicts and three AI verdicts) is imported through the API and exported again: **identical bytes**, and
  the counters equal the old app's (6 rows: 3 correct, 2 false, 1 not sure; 3 gold, 3 AI). Importing it twice replaces
  the 6 rows instead of adding 6 more.
- **Same records, new app** (`server/tests/test_training_golden.py`, full corpus): the sample lecture detected with v5,
  your verdict on findings 0 to 2 and three verifier verdicts on findings 3 to 5, as `make_golden.mjs` did. The export
  equals the golden file byte for byte except the ids (the old ones were random).
- **Engine** (`engine/src/training.test.ts`): the port rebuilds the golden file from the golden envelopes; stored rows
  pass through unchanged; a worker test checks small numbers (`0.00005`, `1e-7`) survive the trip.
- **Server**: corrections become gold labels with their action; undoing a missed quote removes its label; the
  reference flag reaches the row; approve all replaces the model rows; clear empties the screen; Tafrigh saves replace
  each other and round-trip through the import.
- **Web**: Vitest for the screen (counters, lineage text, filters sent to the server, export links, clear asking twice)
  and for the Tafrigh quick picks; Playwright (`e2e/training.spec.ts`) on the real server.
- **Feature check** (Playwright, offline): the sample lecture gets the fake verifier's verdicts; in the lecture view
  the quote الأحزاب: 70 is set to "ordinary speech"; the training screen shows one gold row "Ordinary speech (gold)",
  "You (verdict)", the model had said "Correct"; the gold-only export holds that one row as human-verified `FALSE`.

**Try:**

```bash
cd engine && npx vitest run src/training.test.ts                    # the old converter, byte for byte
cd server && uv run pytest -q tests/test_training.py                 # import → export, corrections, Tafrigh
cd web && npx playwright test e2e/training.spec.ts                   # the feature check in the real app
curl -s localhost:8120/api/training | python3 -m json.tool | head -30 # the counters and rows (with scripts/dev.sh)
```

## Phase 21: Corpora screens and status

**Built.** The «المصادر / Sources» place (`/corpora`) is a real screen with five tabs: adhkar, custom quotes, Quran,
hadith, and hadith sources. Settings gained two panels: the detection engine (v5, v5:loose, v4, v3, the Qira'ah and the
adhkar switch) and Laya (loaded or not, device, GPU memory, checkpoint, envelope version, load and unload).

**New concepts.**
- **CRUD screen, written once.** Create/read/update/delete is the same four calls for adhkar and for custom quotes. Each
  tab has a `useXxx()` query hook (read) and a `useXxxActions()` hook (one mutation per verb) in `api.ts`; after every
  write the mutation *invalidates* the query key, so TanStack Query re-reads the list and the screen updates by itself.
  Compare Flutter: a repository that returns a `Future`, and a provider you `ref.invalidate(...)` after a write.
- **Rows are ordinary rows.** The 18 initial adhkar are only the first rows of the table: edit or delete any of them
  (`DELETE /api/corpora/adhkar/Adhkar:tahlil` works), and "restore the initial list" is an explicit button that asks
  twice (the first click turns it red, the second does it). Nothing is restored at start-up.
- **Paging on the server.** The Quran has 6,236 ayat and the hadith ~40,000; the browser must never receive them all.
  The web asks for `offset` and `limit`, the server asks the engine worker's new `browse` command, which counts the
  matches and returns one page. It reads the raw corpus arrays, so it needs no matcher (hundreds of MB, seconds to build).
- **Polling while something runs.** A hadith source being prepared is a job. `useSources` sets `refetchInterval` to 1.5 s
  only while some source says `preparing`, so the status chip moves on its own and the polling stops by itself.
- **Controlled switch.** The adhkar switch shows the *server's* value (`checked={settings.adhkar}`) and changes it with a
  PATCH; it flips when the answer arrives. A test must therefore click and then wait, not "uncheck" and expect it at once.

**A finding worth knowing.** Only engine **v3** detects adhkar; v4 and v5 (the default) find none, and the golden files pin
that. So the Feature check runs on v3, and the adhkar tab shows a note when another engine is chosen. (N-001 in
`features.md` plans "dhikr as a check after detection", which is where this goes.)

**Tested.**
- Engine: `browse.test.ts` (paging, the surah and book filters, diacritic-free search, unknown kind refused).
- Server: a dhikr needs two words; export → reset → import gives the list back and importing twice adds nothing;
  `/api/corpora/browse` with the fake engine and with the real worker on the small corpus.
- Web (Vitest, `CorporaPage.test.tsx`): add and delete a dhikr (an initial one too), the filter and the double-click
  reset, the adhkar switch, Quran surah 18 page 2, a source going from missing to preparing, the engine choice, and
  Laya loading and unloading with the device and memory shown.
- Feature check (Playwright, `e2e/corpora.spec.ts`, offline, real server and engine): on engine v3 the sample lecture has
  one dhikr (the closing «لا إله إلا الله»); adding «نحمده ونستعينه ونستغفره» in the screen makes the next detection
  return two, the new one at words 3 to 5; switching "Detect adhkar" off leaves none. Also: surah 18, page 2 shows ayat
  26 to 50; the sources tab shows the built-in source ready; the engine choice survives a reload.

**Try:**

```bash
cd engine && npx vitest run src/browse.test.ts                         # the new browse command
cd server && uv run pytest -q tests/test_corpora.py                    # adhkar import/reset, browse
cd web && npx playwright test e2e/corpora.spec.ts                      # the feature check in the real app
curl -s 'localhost:8120/api/corpora/browse?kind=QURAN&surah=18&offset=25&limit=3' | python3 -m json.tool
```

## Phase 22: Datagen on the new core

**Built.** The research side moved from `backend/laya_datagen/` to `server/wahy/laya/` and now runs on the server's own
machinery: the engine through `core/engine.py`, every teacher (Gemini, JEV, OpenRouter chat models, local Laya, and a
new fake one) through `core/ai`, speech recognition through `features/transcription`. It has a command line,
`python -m wahy.laya` (build, compare hashes, label cards with a teacher, the run-6 skew report, validate, zip). A new
dataset version, `laya_v3`, stores the **final** envelope-v3 rows, and a new Kaggle notebook
(`notebooks/kaggle/laya_v3_kaggle.ipynb`) reads them as they are. Nothing was trained.

Why `server/wahy/laya/` and not `server/laya/`: a top-level package called `laya` would hide the installed `laya`
library (the model code). `import laya` searches the folders on `sys.path` in order, and `server/` comes first, so
local Laya would have imported our folder instead of the library.

**New concepts.**
- **One path for research and product.** Before, the datagen had its own HTTP code for Gemini and JEV, with its own
  retries and no request log, so a teacher evaluation didn't necessarily describe what the app does. Now a teacher is a
  thin adapter: it builds `Item`s, calls `ai.verify("gemini", items, call=Call(purpose="teacher"))`, and adds a cache.
  Compare NestJS: two controllers (the app's verification and the datagen) injecting the same provider service.
- **A cache key holds everything that changes the answer.** A teacher's answers are cached under
  `sha(teacher, model, prompt_version, state, questions)`. Going through core/ai changes the request a little (the app's
  batch instruction and reply schema), so the prompt version went from `v1` to `v2`. The 1,335 old answers stay
  readable under `v1` and are never mixed with new ones.
- **"Identical hashes" needs two references.** The rebuild was compared with a rebuild by the *old* code today
  (27 of 27 files byte-identical: the move changed nothing), and separately with the dataset stored on 2026-10-27. That
  one differs in the passage files, and the old code gives the same differences: they come from earlier changes (the
  16 passages regrouped by commit `4147cb7`, and a stored `v1_passages` whose instructions lost their backticked field
  names). A rebuild never writes over a dataset now: `build()` refuses an existing folder unless told to.
- **Final rows, measured.** `skew-run6` rebuilds the rows run 6 trained on (with the notebook's own `to_v3_state`,
  read from its source) and compares them with `laya_v3`: the verdict question differs on every row, and 2,019 hadith
  and dhikr states differ (run 6 has `"quran_neighboring_context": null`, the app leaves the key out). Example:
  `json.dumps({"a": 1, "q": None})` and `json.dumps({"a": 1})` are different strings, so they are different tokens for
  Laya. Different rows means a new dataset version: you decide when to train on it.

**Tested.**
- `server/tests/laya/`: 74 tests (the 62 old datagen tests ported unchanged apart from their imports, plus 12 new):
  teachers through core/ai (fake verifier, recorded Gemini and JEV replies), saved in the request log as purpose
  "teacher" and cached; a failed card caches nothing; the CLI's hash comparison and labelling; `laya_v3` rows equal the
  engine's envelopes byte for byte; builds refuse to overwrite; the run-6 comparison.
- Rebuilds: `laya_v2` by the new code = by the old code (27/27); `laya_v3` built twice = identical (12/12); every
  `laya_v3` file through Laya's own reader (all items, nothing skipped); the new notebook's data cells and
  `--questions verdict` on the stored rows (one verdict item per row).
- The `laya_review.ipynb` "Setup" and "Load lessons" cells in the server environment: the recall table prints as before
  (v4 recall 0.736 on 16 lessons).
- Feature check: 5 cards of `laya_v3/v3_mixed/test` (your own labels) labelled by the fake teacher (5/5, $0), then by
  Gemini `gemini-3.5-flash-lite` on the free tier: one request, 2.8 s, $0, agreeing with your label on 5/5; both in
  the app's request log as "teacher".

**Try:**

```bash
cd server
uv run python -m wahy.laya label --teacher fake --n 5                       # a teacher labels 5 of your cards
uv run python -m wahy.laya skew-run6 ../data/laya_datagen/datasets/laya_v3  # how laya_v3 differs from run 6's rows
uv run pytest -q tests/laya                                                 # the research side's tests
```
