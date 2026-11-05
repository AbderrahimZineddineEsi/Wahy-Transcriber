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
