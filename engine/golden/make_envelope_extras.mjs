// Golden cases the expected/ files miss (ROADMAP phase 5), recorded from the OLD app's own code:
//   - v1 envelopes with passages: what Gemini, JEV and OpenRouter chat received by default (the "passages" prompt rule
//     is on by default), built by js/ai-verifier.js buildPromptProviderItems;
//   - envelopes for some findings only (`targets`), the way the datagen asks for them;
//   - corpus search (js/corpus-loader.js searchCorpusUnits), for the reference picker.
// Like make_golden.mjs, the output is never edited or regenerated to make a test pass.
//
// Run from the repo root (needs data/corpus.json; about a minute):
//   node --max-old-space-size=4096 engine/golden/make_envelope_extras.mjs    writes engine/golden/extra/envelopes.json
//                                                                            and engine/golden/extra/search.json
//
// Two old functions are private to their file, so this script re-runs the files' own source with one change: the
// function is also put on a global. The function bodies run as they are.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOldApp, sha256 } from "./old_app.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const INPUTS = path.join(HERE, "inputs");
const EXTRA = path.join(HERE, "extra");

const CASE_INPUTS = ["sample", "yt_pckn5mI4Q5g"]; // the sample, and the lecture with a long Quran passage
const CASE_ENGINES = ["v3", "v5"];                // v3's corpus units differ from v4 / v5's
const SEARCHES = ["البقرة: 255", "2:255", "الحمد لله رب العالمين", "إنما الأعمال بالنيات", "سبحان الله", "Bukhari",
  "OHD:Muslim", "التهليل", ""];
const KINDS = ["ALL", "QURAN", "HADITH", "ADHKAR"];

const app = loadOldApp(ROOT);
const { run, sandbox } = app;

// ai-verifier.js again, with buildPromptProviderItems also exported (it is the passages path of the prompt providers)
const verifierSrc = fs.readFileSync(path.join(ROOT, "js/ai-verifier.js"), "utf8");
const marker = "window.WahyAiVerifier = {";
if (verifierSrc.split(marker).length !== 2) throw new Error("js/ai-verifier.js changed: find its export object again");
run(verifierSrc.replace(marker, `${marker} buildPromptProviderItems,`), "js/ai-verifier.js");
// searchCorpusUnits alone (the rest of corpus-loader.js downloads the corpus and drives the page)
const loaderSrc = fs.readFileSync(path.join(ROOT, "js/corpus-loader.js"), "utf8");
const searchSrc = loaderSrc.match(/function searchCorpusUnits\([\s\S]*?\n}\n/);
if (!searchSrc) throw new Error("js/corpus-loader.js changed: find searchCorpusUnits again");
run(searchSrc[0], "js/corpus-loader.js#searchCorpusUnits");

const json = (x) => JSON.stringify(x, null, 1) + "\n";
const cases = [];
const searches = [];

for (const name of CASE_INPUTS) {
  const input = JSON.parse(fs.readFileSync(path.join(INPUTS, `${name}.json`), "utf8"));
  for (const engine of CASE_ENGINES) {
    openLecture(input, engine);
    const n = run("currentState.detections.length");
    const some = Array.from({ length: n }, (_, i) => i).filter((i) => i % 3 === 1); // every third finding
    // v1 with passages, for all findings and for some
    for (const targets of [null, some]) {
      sandbox.__targets = targets;
      const expected = run(`(() => {
        const dets = currentState.detections;
        const want = __targets ? __targets.map(i => dets[i]) : dets;
        return WahyAiVerifier.buildPromptProviderItems(want, 25).map(it => ({
          members: (it.members || [it.det]).map(m => dets.indexOf(m)),
          state: it.envelope.state, questions: it.envelope.questions, merge: it.envelope.merge
        }));
      })()`);
      cases.push({ input: name, engine, version: 1, options: { passages: true }, targets, expected });
    }
    // v1 without passages, v2 (both options) and v3 for some findings only
    sandbox.__targets = some;
    cases.push({
      input: name, engine, version: 1, options: { passages: false }, targets: some,
      expected: run(`__targets.map(i => {
        const e = WahyAiVerifier.buildCanonicalDecisionEnvelope(currentState.detections[i], currentState.words, 25);
        return { members: [i], state: e.state, questions: e.questions, merge: e.merge };
      })`),
    });
    for (const [version, builder, opts] of [
      [2, "buildLayaV2Requests", { passages: true, neighbours: true }],
      [3, "buildLayaV3Requests", { passages: true }],
    ]) {
      sandbox.__opts = opts;
      const expected = run(`(() => {
        const dets = currentState.detections;
        return WahyAiVerifier.${builder}(dets, currentState.words, __opts, __targets.map(i => dets[i])).map(r => {
          const out = { members: r.members.map(m => dets.indexOf(m)), state: r.state, questions: r.questions };
          if (${version} === 3) out.boundaryByRule = WahyAiVerifier.boundaryByRule(r.state);
          return out;
        });
      })()`);
      cases.push({ input: name, engine, version, options: opts, targets: some, expected });
    }
  }
}

for (const engine of CASE_ENGINES) {
  app.useEngine(engine);
  for (const text of SEARCHES) {
    for (const kind of KINDS) {
      sandbox.__q = text;
      sandbox.__kind = kind;
      const hits = run(`searchCorpusUnits(__q, __kind, 30).map(u => ({
        unitId: u.unitId, sourceType: u.sourceType, displayRef: u.displayRef, fullText: u.fullText }))`);
      // the unit ids to read, and a hash of every field (the texts would make the file large)
      searches.push({ engine, text, kind, limit: 30, ids: hits.map((h) => h.unitId), sha256: sha256(JSON.stringify(hits)) });
    }
  }
}

fs.mkdirSync(EXTRA, { recursive: true });
const about = "Made by engine/golden/make_envelope_extras.mjs from the old app's code; never edit by hand.";
fs.writeFileSync(path.join(EXTRA, "envelopes.json"), json({ about, old_app: app.fingerprint, cases }));
fs.writeFileSync(path.join(EXTRA, "search.json"), json({ about, old_app: app.fingerprint, searches }));
console.log(`wrote ${cases.length} envelope cases and ${searches.length} searches to ${path.relative(ROOT, EXTRA)}/`);

/** A new lecture, as make_golden.mjs opens one: pasted text or ASR words. */
function openLecture(input, engine) {
  app.useEngine(engine);
  if (input.text !== undefined) {
    sandbox.__text = String(input.text).trim();
    run("runDetectionAndBuildCaptions({ rawText: __text, words: synthesizeWordsFromRawText(__text) })");
  } else {
    sandbox.__words = structuredClone(input.words);
    sandbox.__text = input.words.map((w) => w.word).join(" ");
    run("runDetectionAndBuildCaptions({ rawText: __text, words: __words })");
  }
}
