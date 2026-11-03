// Runs the app's real browser JS (engines + ai-verifier) in a Node vm, driven by JSON lines on stdin.
// Usage: node harness.js <repo_root>   -- protocol: one JSON request per line, one JSON response per line.
const fs = require("fs"), vm = require("vm"), path = require("path"), crypto = require("crypto"), readline = require("readline");

const ROOT = process.argv[2];
// Load order mirrors index.html. editor.js is required by engine.js (computeTokenIoU) even though it is UI code.
const FILES = ["js/state.js", "js/editor.js", "js/engine.js", "js/engine_v4.js", "js/ai-verifier.js"];

const store = {};
const el = () => ({ value: "", textContent: "", classList: { add() {}, remove() {}, toggle() {} }, style: {}, addEventListener() {}, appendChild() {} });
const sandbox = {
  console: { log() {}, warn() {}, info() {}, error: (...a) => process.stderr.write(a.join(" ") + "\n") },
  setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
  performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, body: el() },
  indexedDB: undefined, navigator: { userAgent: "node" }, addEventListener() {}, removeEventListener() {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);
const run = (code, name) => vm.runInContext(code, ctx, { filename: name || "harness-eval" });

const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fileHashes = {};
let corpusHash = "";
const matchers = {};

function init({ hadith_path, extra_engine_files = [] }) {
  const files = FILES.slice();
  // an engine added later (v5) is one more file, loaded after engine_v4.js
  for (const f of extra_engine_files) files.splice(files.indexOf("js/ai-verifier.js"), 0, f);
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    fileHashes[f] = sha(src);
    try { run(src, f); } catch (e) { throw new Error(`failed loading ${f}: ${e.message}`); }
  }
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "data/corpus.json"), "utf8"));
  let hadiths = corpus.hadiths;
  let hp = "corpus.json";
  if (hadith_path) {
    const h = JSON.parse(fs.readFileSync(hadith_path, "utf8"));
    hadiths = Array.isArray(h) ? h : h.hadiths;
    hp = hadith_path;
  }
  sandbox.__ayat = corpus.ayat; sandbox.__hadiths = hadiths;
  run("RAW_QURAN_DATA = __ayat; RAW_HADITH_DATA = __hadiths;");
  corpusHash = sha(JSON.stringify([corpus.ayat.length, hadiths.length, hadiths[0], hadiths[hadiths.length - 1], hp]));
  return { files: fileHashes, corpus: corpusHash, quran: corpus.ayat.length, hadiths: hadiths.length };
}

// Same path as the app: localStorage.wahyEngine + rebuildMatcher(); then verify the class that was actually built.
// "<engine>/<tag>" with `opts` = that engine rebuilt with extra engine params (params.v5 = opts), to measure one fix;
// "<engine>@<tag>" = the same engine under another name (e.g. a saved copy of the file loaded as an extra engine file);
// "v5:<profile>" = v5 with localStorage.wahyEngineProfile = <profile> (e.g. "v5:loose"), the app's own switch.
const EXPECTED_CLASS = { v3: "QuotationMatcherJS", v4: "WahyEngine", v5: "WahyEngineV5" };
function useEngine(name, opts) {
  const base = name.split(/[/@:]/)[0];
  const profile = (name.match(/:([a-z]+)/) || [])[1];
  const cls = EXPECTED_CLASS[base];
  if (!cls) throw new Error(`unknown engine ${name}`);
  if (!matchers[name]) {
    // the app's own switch: wahyEngine = "v5:loose" (state.js rebuildMatcher passes v5Profile from it; the older
    // wahyEngineProfile key is still set for engine files that read it themselves)
    store.wahyEngine = profile ? `${base}:${profile}` : base;
    if (profile) store.wahyEngineProfile = profile;
    try { run("rebuildMatcher()"); } finally { delete store.wahyEngineProfile; }
    const built = run("activeMatcher.constructor.name");
    if (built !== cls) throw new Error(`engine ${name} fell back to ${built}`);
    const gotProfile = run("activeMatcher.P && activeMatcher.P.profile");
    if (profile && gotProfile !== profile) throw new Error(`engine ${name} was built with profile ${gotProfile}, not ${profile}`);
    if (name.includes("/")) {
      sandbox.__opts = opts || {};
      run("activeMatcher = (([p, a, o]) => new activeMatcher.constructor(RAW_QURAN_DATA, RAW_HADITH_DATA, Object.assign({}, p, { v5: __opts }), a, o))(activeMatcher._ctorArgs)");
    }
    matchers[name] = run("activeMatcher");
  }
  sandbox.__m = matchers[name];
  run("activeMatcher = __m");
}

function buildWords(strs) {
  const words = []; let cur = 0;
  strs.forEach((w, i) => {
    words.push({ id: i, word: w, start: 0, end: 0, char_start: cur, char_end: cur + w.length });
    cur += w.length + 1;
  });
  return words;
}

const DET_FIELDS = ["id", "unitId", "sourceType", "displayRef", "confidenceBand", "totalScore", "hasCitationCue",
  "isAmbiguous", "wordStartIdx", "wordEndIdx", "charStart", "charEnd", "matchedText", "canonicalText",
  "segments", "qSegments", "qiraah", "candidateRefs", "embeddedQuran", "alsoAdhkar", "snappedToCanonical"];

function detect({ engine, words: strs, opts }) {
  useEngine(engine, opts);
  const words = buildWords(strs);
  const text = strs.join(" ");
  sandbox.__words = words; sandbox.__text = text;
  run("currentState.words = __words; currentState.rawTranscript = __text; currentState.rawText = __text;");
  const dets = run("mapDetectionsToWordTimestamps(activeMatcher.detect(__text), __words, __text)");
  sandbox.__dets = dets;
  run("currentState.detections = __dets");
  return dets.map((d, i) => {
    const out = {};
    for (const k of DET_FIELDS) if (d[k] !== undefined && typeof d[k] !== "function") out[k] = d[k];
    const env = run(`WahyAiVerifier.buildCanonicalDecisionEnvelope(__dets[${i}], __words, 25)`);
    out.envelope = { state: env.state, questions: env.questions };
    const unit = run("activeMatcher").units && run("activeMatcher").units.get(d.unitId);
    out.unit_len = unit && unit.vocalizedWords ? unit.vocalizedWords.length : null;
    out.unit_words = unit && unit.vocalizedWords ? unit.vocalizedWords : null;     // full original text, for review cards
    return out;
  });
}

// Laya envelope v2 for one engine run: the app's own buildLayaV2Requests on detections we already have (no re-detect).
// `dets` = every finding of the run (passages and neighbours are found among all of them), `targets` = indices of the
// findings that need a row. Members come back as their index in `dets`.
function layaV2({ engine, words: strs, dets, options = {}, targets = null }) {
  useEngine(engine);      // its matcher's units give the corpus words around each span
  const words = buildWords(strs);
  sandbox.__words = words; sandbox.__dets = dets; sandbox.__opts = options;
  sandbox.__targets = targets ? targets.map(i => dets[i]) : null;
  run("currentState.words = __words; currentState.detections = __dets;");
  const reqs = run("WahyAiVerifier.buildLayaV2Requests(__dets, __words, __opts, __targets)");
  return reqs.map(r => ({ members: r.members.map(m => dets.indexOf(m)), state: r.state, questions: r.questions }));
}

const handlers = {
  init,
  laya_v2: layaV2,
  fingerprint: () => ({ files: fileHashes, corpus: corpusHash }),
  // per-word norm tokens (a word may yield 0..n tokens), so ASR words map onto the engine's token space
  tokenize_words: ({ words }) => words.map(w => run(`tokenizeText(${JSON.stringify(w)}).map(t => t.norm)`)),
  surah_names: () => run("SURAH_NAMES_AR"),
  // engine-normalised words of corpus units: ids like "2:255" (Quran)
  unit_norms: ({ ids, engine = "v4" }) => {
    useEngine(engine);
    const units = run("activeMatcher").units;
    const out = {};
    for (const id of ids) { const u = units.get(id); if (u) out[id] = u.normWords; }
    return out;
  },
  // full vocalised words of corpus units (for showing the original verse / hadith)
  unit_words: ({ ids, engine = "v4" }) => {
    useEngine(engine);
    const units = run("activeMatcher").units;
    const out = {};
    for (const id of ids) { const u = units.get(id); if (u) out[id] = { words: u.vocalizedWords, ref: u.displayRef }; }
    return out;
  },
  tokenize: ({ text }) => run(`tokenizeText(${JSON.stringify(text)}).map(t => t.norm)`),
  detect,
};

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  let req;
  try {
    req = JSON.parse(line);
    const res = handlers[req.cmd](req);
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: res }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ id: req && req.id, ok: false, error: String(e && e.stack || e) }) + "\n");
  }
});
