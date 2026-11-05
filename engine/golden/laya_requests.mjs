// The old app's Laya v2 and v3 requests for datagen engine runs (used by measure_skew.py).
// Usage: node --max-old-space-size=4096 engine/golden/laya_requests.mjs <runs.json> <out.json>
//   runs.json: [{id, engine, words: [str], dets, targets}], as backend/laya_datagen/laya_v2.py runs() holds them
//   out.json:  {id: {"v2.p0": [...], "v2.p1": [...], "v3.p0": [...], "v3.p1": [...]}}, each [{members, state, questions}]
// Words are built the way backend/laya_datagen/js/harness.js builds them (no times), as the datasets were.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOldApp } from "./old_app.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [runsPath, outPath] = process.argv.slice(2);
const app = loadOldApp(ROOT);

function buildWords(strs) {
  const words = []; let cur = 0;
  strs.forEach((w, i) => {
    words.push({ id: i, word: w, start: 0, end: 0, char_start: cur, char_end: cur + w.length });
    cur += w.length + 1;
  });
  return words;
}

const out = {};
for (const r of JSON.parse(fs.readFileSync(runsPath, "utf8"))) {
  app.useEngine(r.engine);
  app.sandbox.__words = buildWords(r.words);
  app.sandbox.__dets = r.dets;
  app.sandbox.__targets = r.targets;
  app.run("currentState.words = __words; currentState.detections = __dets;");
  const reqs = {};
  for (const [v, builder] of [["v2", "buildLayaV2Requests"], ["v3", "buildLayaV3Requests"]]) {
    for (const p of [0, 1]) {
      reqs[`${v}.p${p}`] = app.run(`WahyAiVerifier.${builder}(__dets, __words, { passages: ${Boolean(p)}, neighbours: false },
        __targets.map(i => __dets[i])).map(q => ({ members: q.members.map(m => __dets.indexOf(m)), state: q.state, questions: q.questions }))`);
    }
  }
  out[r.id] = reqs;
}
fs.writeFileSync(outPath, JSON.stringify(out));
