// A golden case the four golden inputs miss (ROADMAP phase 4): engine v3 turning a hadith finding into the verse
// quoted inside it, which re-aligns the finding's canonical words (recomputeCanonicalForDetection). None of the golden
// inputs takes that path; 18 of the 71 datagen lectures do. This script cuts a short window of words around the
// first such finding in a real lecture and records the OLD app's v3 findings for it. Like make_golden.mjs, the
// output is never edited or regenerated to make a test pass.
//
// Run from the repo root (needs data/corpus.json and data/laya_datagen/lectures/):
//   node --max-old-space-size=4096 engine/golden/make_nested_verse.mjs     writes engine/golden/extra/nested-verse.json
// (not in expected/: make_golden.mjs owns that folder and replaces it whole)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOldApp } from "./old_app.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const LECTURES = path.join(ROOT, "data/laya_datagen/lectures");
const OUT = path.join(HERE, "extra/nested-verse.json");
const MARGIN = 30; // words kept on each side of the finding

const app = loadOldApp(ROOT);
app.useEngine("v3");

function oldFindings(words) {
  app.sandbox.__words = structuredClone(words);
  app.sandbox.__text = words.map((w) => w.word).join(" ");
  app.run("runDetectionAndBuildCaptions({ rawText: __text, words: __words })");
  return app.run("currentState.detections");
}
// a v3 finding that started as a hadith and became the verse inside it keeps the hadith's embeddedQuran
const converted = (d) => d.sourceType === "QURAN" && Array.isArray(d.embeddedQuran) && d.embeddedQuran.length > 0;

for (const id of fs.readdirSync(LECTURES).sort()) {
  const file = path.join(LECTURES, id, "words.json");
  if (!fs.existsSync(file)) continue;
  const all = JSON.parse(fs.readFileSync(file, "utf8")).map((w) => ({ word: w.word, start: w.start, end: w.end }));
  const hit = oldFindings(all).find(converted);
  if (!hit) continue;
  const from = Math.max(0, hit.wordStartIdx - MARGIN);
  const to = Math.min(all.length, hit.wordEndIdx + 1 + MARGIN);
  const words = all.slice(from, to);
  const findings = oldFindings(words);
  if (!findings.some(converted)) continue; // the window lost the context the conversion needs: try the next lecture
  const out = {
    about: "Old app v3 findings on a window of a real lecture where a hadith finding becomes the verse inside it. "
      + "Made by engine/golden/make_nested_verse.mjs; never edit by hand.",
    lecture: id, words_from: from, words_to: to, old_app: app.fingerprint, words, findings,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${id} words ${from}-${to}, ${findings.length} findings`);
  process.exit(0);
}
console.error("no lecture window takes the conversion path");
process.exit(1);
