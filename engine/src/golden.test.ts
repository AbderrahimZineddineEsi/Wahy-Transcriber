// Golden test (ROADMAP phase 4): the new engine package must give exactly the old app's findings for every engine
// choice on every golden input (engine/golden/, made by make_golden.mjs from the old js/ files).
// Needs data/corpus.json (git-ignored, fetched by ./run.sh); without it the test is skipped and says so.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { detect, parseEngineChoice, synthesizeWordsFromRawText } from "./index.ts";
import type { Corpus, Word } from "./index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GOLDEN = path.join(ROOT, "engine/golden");
const CORPUS = path.join(ROOT, "data/corpus.json");
const manifest = JSON.parse(fs.readFileSync(path.join(GOLDEN, "expected/manifest.json"), "utf8"));
const INPUTS: string[] = Object.keys(manifest.inputs);
const ENGINES: string[] = manifest.engines;

const haveCorpus = fs.existsSync(CORPUS);
if (!haveCorpus) console.warn(`golden test skipped: ${CORPUS} is missing (./run.sh downloads it)`);

describe.skipIf(!haveCorpus)("golden findings", () => {
  let corpus: Corpus;
  let corpusHash: string;
  beforeAll(() => {
    const raw = fs.readFileSync(CORPUS);
    corpusHash = sha256(raw);
    const parsed = JSON.parse(raw.toString("utf8"));
    corpus = { ayat: parsed.ayat, hadiths: parsed.hadiths };
  });

  test("the corpus is the one the golden files were made with", () => {
    expect(corpusHash).toBe(manifest.old_app.corpus);
  });

  // same order as make_golden.mjs: each input, then each engine
  for (const name of INPUTS) {
    for (const choice of ENGINES) {
      test(`${name} ${choice}`, () => {
        const findings = detect(wordsOf(name), { corpus, ...parseEngineChoice(choice) });
        const file = `${name}/${choice.replace(":", "-")}/findings.json`;
        const expected = fs.readFileSync(path.join(GOLDEN, "expected", file), "utf8");
        const actual = JSON.stringify(findings, null, 1) + "\n";
        if (actual !== expected) {
          // show the first finding that differs, not two huge strings
          const want = JSON.parse(expected);
          const i = want.findIndex((w: unknown, k: number) => JSON.stringify(w) !== JSON.stringify(findings[k]));
          expect({ count: findings.length, index: i, finding: findings[i] })
            .toEqual({ count: want.length, index: i, finding: want[i] });
        }
        expect(actual).toBe(expected);
      });
    }
  }

  // make_golden.mjs reused one matcher per engine across the inputs in a fixed order; the server will not
  const last = INPUTS[INPUTS.length - 1];
  for (const choice of ["v3", "v5"]) {
    test(`${last} ${choice} on a fresh matcher, without the earlier inputs first`, () => {
      const fresh = { ayat: corpus.ayat, hadiths: corpus.hadiths }; // a new corpus object gets new matchers
      const findings = detect(wordsOf(last), { corpus: fresh, ...parseEngineChoice(choice) });
      const expected = fs.readFileSync(path.join(GOLDEN, "expected", last, choice, "findings.json"), "utf8");
      expect(JSON.stringify(findings, null, 1) + "\n").toBe(expected);
    });
  }

  // the golden inputs never take this path (made by make_nested_verse.mjs from a real lecture)
  test("v3 turning a hadith finding into the verse inside it (extra/nested-verse.json)", () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(GOLDEN, "extra/nested-verse.json"), "utf8"));
    const findings = detect(fixture.words, { corpus, engine: "v3" });
    expect(findings.some((d) => d.sourceType === "QURAN" && Array.isArray(d.embeddedQuran))).toBe(true);
    expect(JSON.stringify(findings, null, 1)).toBe(JSON.stringify(fixture.findings, null, 1));
  });
});

/** The words the old app detected on: ASR words as given, or pasted text turned into words the way the app does. */
function wordsOf(name: string): Word[] {
  const input = JSON.parse(fs.readFileSync(path.join(GOLDEN, "inputs", `${name}.json`), "utf8"));
  if (input.text !== undefined) return synthesizeWordsFromRawText(String(input.text).trim());
  return input.words;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
