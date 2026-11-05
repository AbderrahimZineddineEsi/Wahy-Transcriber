// Golden files: what the old app produces on fixed inputs (ADR 0001, ROADMAP phase 2). The new engine/ and server/
// code must reproduce these files exactly. If a golden test fails, the new code is wrong: never regenerate the files
// to make a test pass (ROADMAP rules).
//
// Run from the repo root (needs data/corpus.json; about 3 minutes):
//   node --max-old-space-size=4096 engine/golden/make_golden.mjs           writes engine/golden/expected/
//   node --max-old-space-size=4096 engine/golden/make_golden.mjs --check   writes nothing, exits 1 if a file differs
//   node --max-old-space-size=4096 engine/golden/make_golden.mjs --inputs  rebuilds engine/golden/inputs/ (only once)
//
// Every output comes from the old app's own functions (js/*.js loaded by old_app.mjs), called the way its buttons
// call them: runDetectionAndBuildCaptions for a new lecture, the WahyAiVerifier envelope builders, the caption and
// text exporters, setHumanOverrideVerdict and the Laya JSONL export.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOldApp, ENGINE_CHOICES, sha256 } from "./old_app.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const INPUTS = path.join(HERE, "inputs");
const EXPECTED = path.join(HERE, "expected");

// one short lecture, one with a long Quran passage, one with many hadiths (picked by running v5 on all 71 datagen
// lectures: fewest words; most Quran findings in a 6-verse passage; most hadith findings)
const LECTURES = ["yt_iG2F8nymm1A", "yt_pckn5mI4Q5g", "yt_ExkaemlknP4"];
const SAMPLE = "sample";

// every v2 option set a checkpoint was trained with (laya_v2 variants), every v3 one (run 6)
const V2_OPTIONS = {
  p0n0: { passages: false, neighbours: false }, p1n0: { passages: true, neighbours: false },
  p0n1: { passages: false, neighbours: true }, p1n1: { passages: true, neighbours: true },
};
const V3_OPTIONS = { p1: { passages: true }, p0: { passages: false } };

// a second export style, to pin what the bracket and reference settings change
const ALT_STYLE = {
  quranBracketOpen: "(", quranBracketClose: ")", hadithBracketOpen: "\"", hadithBracketClose: "\"",
  adhkarBracketOpen: "[", adhkarBracketClose: "]", showQuranSource: false, showHadithSource: false,
  showAdhkarTag: false, groupContiguousAyat: false,
};

const FIXED_NOW_MS = Date.UTC(2026, 10, 3, 12, 0, 0);
const engineDir = (e) => e.replace(":", "-");
const json = (x) => JSON.stringify(x, null, 1) + "\n";

const mode = process.argv[2] || "write";
if (!["write", "--check", "--inputs"].includes(mode)) {
  console.error(`unknown option ${mode}`);
  process.exit(2);
}

const app = loadOldApp(ROOT);
const { run, sandbox } = app;
// the Date.now and Math.random the record ids and export timestamps read: fixed (a seeded sequence for random, so
// ids still differ from one another), so the export is the same every run. The engines and captions use neither.
run(`Date.now = () => ${FIXED_NOW_MS};
  var __seed = 1; Math.random = () => (__seed = (__seed * 48271) % 2147483647) / 2147483647;`);
// export buttons hand their file to triggerFileDownload: keep it instead of downloading
run("var __downloads = {}; triggerFileDownload = (name, content) => { __downloads[name] = content; };");
// IndexedDB is absent in Node: do what saveVerificationRecordToDB's success handler does to the in-memory list
run(`saveVerificationRecordToDB = async (record) => {
  const list = currentState.aiVerification.trainingDatasetRecords;
  const i = list.findIndex(r => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  return record;
};`);
const DEFAULT_STYLE = run("JSON.stringify(currentState.outputPrefs)");

if (mode === "--inputs") {
  writeInputs();
  process.exit(0);
}

const files = {};       // path relative to expected/ -> content
const put = (rel, content) => { files[rel] = content; };

for (const name of [SAMPLE, ...LECTURES]) {
  const input = JSON.parse(fs.readFileSync(path.join(INPUTS, `${name}.json`), "utf8"));
  for (const engine of ENGINE_CHOICES) {
    const dir = `${name}/${engineDir(engine)}`;
    openLecture(input, engine);
    if (engine === ENGINE_CHOICES[0]) put(`${name}/words.json`, json(run("currentState.words")));
    put(`${dir}/findings.json`, json(run("currentState.detections")));
    put(`${dir}/envelopes.v1.json`, json(run(
      "currentState.detections.map(d => WahyAiVerifier.buildCanonicalDecisionEnvelope(d, currentState.words, 25))")));
    for (const [tag, opts] of Object.entries(V2_OPTIONS)) {
      put(`${dir}/envelopes.v2.${tag}.json`, json(requests("buildLayaV2Requests", opts, false)));
    }
    for (const [tag, opts] of Object.entries(V3_OPTIONS)) {
      put(`${dir}/envelopes.v3.${tag}.json`, json(requests("buildLayaV3Requests", opts, true)));
    }
    exportsInto(dir);
    if (engine === "v5") {
      run(`saveOutputDisplayPrefs(${JSON.stringify(ALT_STYLE)}); recalculateCaptionsFromCurrentFindings();`);
      exportsInto(`${dir}/alt-style`);
    }
  }
}
put("laya_export.jsonl", await layaExport());
put("manifest.json", json(manifest()));

if (mode === "--check") process.exit(check() ? 0 : 1);
fs.rmSync(EXPECTED, { recursive: true, force: true });
for (const [rel, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(EXPECTED, rel)), { recursive: true });
  fs.writeFileSync(path.join(EXPECTED, rel), content);
}
console.log(`wrote ${Object.keys(files).length} files to ${path.relative(ROOT, EXPECTED)}/`);

// ------------------------------------------------------------------------------------------------ steps

/** A new lecture, as the app opens one: pasted text (handleTextFastPathExecution) or ASR words (the transcribe path). */
function openLecture(input, engine) {
  app.useEngine(engine);
  run(`saveOutputDisplayPrefs(${DEFAULT_STYLE}); currentState.aiVerification.trainingDatasetRecords = [];`);
  sandbox.__title = input.title;
  run("currentState.lectureTitle = __title");
  if (input.text !== undefined) {
    sandbox.__text = String(input.text).trim();
    run("runDetectionAndBuildCaptions({ rawText: __text, words: synthesizeWordsFromRawText(__text) })");
  } else {
    sandbox.__words = structuredClone(input.words);
    sandbox.__text = input.words.map(w => w.word).join(" ");
    run("runDetectionAndBuildCaptions({ rawText: __text, words: __words })");
  }
}

/** Laya requests for every finding; members become finding indices. v3 also records the no-model boundary. */
function requests(builder, opts, withRule) {
  sandbox.__opts = opts;
  return run(`WahyAiVerifier.${builder}(currentState.detections, currentState.words, __opts).map(r => {
    const out = { members: r.members.map(m => currentState.detections.indexOf(m)), state: r.state, questions: r.questions };
    if (${withRule}) out.boundaryByRule = WahyAiVerifier.boundaryByRule(r.state);
    return out;
  })`);
}

/** The export dialog's buttons: SRT, VTT, ASS, Markdown and plain text. */
function exportsInto(dir) {
  run(`__downloads = {};
    triggerFileDownload("wahy-captions.srt", exportCaptionsToSRT(currentState.captions));
    triggerFileDownload("wahy-captions.vtt", exportCaptionsToVTT(currentState.captions));
    triggerFileDownload("wahy-captions.ass", exportCaptionsToASS(currentState.captions, currentState.lectureTitle));
    exportLectureAsMarkdown();
    exportLectureAsPlainText();`);
  for (const [name, content] of Object.entries(run("__downloads"))) put(`${dir}/${name}`, content);
}

/**
 * The Laya JSONL export over a fixed set of verification records, made the ways the app makes them: three human
 * overrides (setHumanOverrideVerdict, stored already converted) and three findings with an AI verdict on them,
 * converted at export time (the AI pass's own converter, reached through convertVerificationRecordsToLayaJsonl).
 */
function layaExport() {
  openLecture(JSON.parse(fs.readFileSync(path.join(INPUTS, `${SAMPLE}.json`), "utf8")), "v5");
  const n = run("currentState.detections.length");
  if (n < 6) throw new Error(`the sample has ${n} findings, the export needs 6`);
  return run(`(async () => {
    const dets = currentState.detections;
    dets.forEach((d, i) => { d.id = d.id || "finding_" + (i + 1); });
    await WahyAiVerifier.setHumanOverrideVerdict(dets[0].id, "CORRECT");
    await WahyAiVerifier.setHumanOverrideVerdict(dets[1].id, "FALSE");
    await WahyAiVerifier.setHumanOverrideVerdict(dets[2].id, "NOT_SURE");
    const env = d => WahyAiVerifier.buildCanonicalDecisionEnvelope(d, currentState.words, 25);
    const ai = [
      { verdict: "CORRECT", confidence: 0.91, probabilities: { CORRECT: 0.91, FALSE: 0.06, NOT_SURE: 0.03 },
        boundaryStatus: "MISSING_END", boundaryConfidence: 0.8,
        boundaryProbabilities: { COMPLETE_SPAN: 0.1, MISSING_START: 0.05, MISSING_END: 0.8, MISSING_BOTH: 0.05 },
        requestId: "req_golden_1", modelUsed: "gemini-3.5-flash-lite", provider: "gemini" },
      { verdict: "FALSE", confidence: 0.7, requestId: "req_golden_2", provider: "openrouter_chat" },
      {}
    ];
    const records = currentState.aiVerification.trainingDatasetRecords.slice();
    ai.forEach((v, i) => records.push(Object.assign({}, dets[3 + i], { aiVerification: v, envelope: env(dets[3 + i]) })));
    return WahyAiVerifier.convertVerificationRecordsToLayaJsonl(records).jsonl;
  })()`);
}

function manifest() {
  return {
    about: "Outputs of the old app on fixed inputs. Made by engine/golden/make_golden.mjs; never edit by hand.",
    old_app: app.fingerprint,
    inputs: Object.fromEntries([SAMPLE, ...LECTURES].map(n => [n, sha256(fs.readFileSync(path.join(INPUTS, `${n}.json`)))])),
    engines: ENGINE_CHOICES, v2_options: V2_OPTIONS, v3_options: V3_OPTIONS, alt_style: ALT_STYLE,
    fixed_now_ms: FIXED_NOW_MS,
    files: Object.fromEntries(Object.entries(files).sort().map(([rel, c]) => [rel, sha256(c)])),
  };
}

function check() {
  let ok = true;
  const onDisk = fs.existsSync(EXPECTED) ? walk(EXPECTED) : [];
  for (const rel of new Set([...onDisk, ...Object.keys(files)])) {
    const p = path.join(EXPECTED, rel);
    const disk = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (disk !== files[rel]) {
      ok = false;
      console.log(`${disk === null ? "missing" : files[rel] === undefined ? "extra  " : "differs"} ${rel}`);
    }
  }
  console.log(ok ? `identical: ${onDisk.length} files` : "golden files differ");
  return ok;
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]);
}

function writeInputs() {
  fs.mkdirSync(INPUTS, { recursive: true });
  const sample = { id: SAMPLE, title: "محاضرة تجريبية — آيات وأحاديث وأذكار", text: run("buildDynamicSampleLectureFromCorpus()") };
  fs.writeFileSync(path.join(INPUTS, `${SAMPLE}.json`), json(sample));
  for (const id of LECTURES) {
    const dir = path.join(ROOT, "data/laya_datagen/lectures", id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
    const words = JSON.parse(fs.readFileSync(path.join(dir, "words.json"), "utf8"))
      .map(w => ({ word: w.word, start: w.start, end: w.end }));
    fs.writeFileSync(path.join(INPUTS, `${id}.json`), json({ id, title: meta.title || id, url: meta.url || "", words }));
  }
  console.log(`wrote ${1 + LECTURES.length} inputs to ${path.relative(ROOT, INPUTS)}/`);
}
