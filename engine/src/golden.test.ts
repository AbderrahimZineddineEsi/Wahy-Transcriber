// Golden test (ROADMAP phases 4 and 5): the new engine package must give exactly the old app's findings and Laya
// envelopes for every engine choice on every golden input (engine/golden/, made by make_golden.mjs and
// make_envelope_extras.mjs from the old js/ files), and the same corpus search results.
// Needs data/corpus.json (git-ignored, fetched by ./run.sh); without it the test is skipped and says so.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { detect, envelopes, parseEngineChoice, search, synthesizeWordsFromRawText } from "./index.ts";
import type { Corpus, Envelope, EnvelopeVersion, Finding, Word } from "./index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GOLDEN = path.join(ROOT, "engine/golden");
const CORPUS = path.join(ROOT, "data/corpus.json");
const manifest = JSON.parse(fs.readFileSync(path.join(GOLDEN, "expected/manifest.json"), "utf8"));
const INPUTS: string[] = Object.keys(manifest.inputs);
const ENGINES: string[] = manifest.engines;
const extras = JSON.parse(fs.readFileSync(path.join(GOLDEN, "extra/envelopes.json"), "utf8"));
const searches = JSON.parse(fs.readFileSync(path.join(GOLDEN, "extra/search.json"), "utf8")).searches;

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
        found.set(`${name} ${choice}`, findings);
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

  // envelopes, from the findings above: v1 as the old app built it per finding, and every v2 and v3 option set a
  // Laya checkpoint was trained with
  for (const name of INPUTS) {
    for (const choice of ENGINES) {
      test(`${name} ${choice} envelopes`, () => {
        const findings = findingsOf(corpus, name, choice);
        const words = goldenWords(name);
        const dir = `${name}/${choice.replace(":", "-")}`;
        const options = { corpus, ...parseEngineChoice(choice) };
        expectGolden(`${dir}/envelopes.v1.json`, envelopes(findings, words, 1, options)
          .map(({ state, questions, merge }) => ({ state, questions, merge })));
        for (const [tag, opts] of Object.entries(manifest.v2_options)) {
          expectGolden(`${dir}/envelopes.v2.${tag}.json`, envelopes(findings, words, 2, { ...options, ...(opts as object) }));
        }
        for (const [tag, opts] of Object.entries(manifest.v3_options)) {
          expectGolden(`${dir}/envelopes.v3.${tag}.json`, envelopes(findings, words, 3, { ...options, ...(opts as object) }));
        }
      });
    }
  }

  // v1 with passages (what Gemini, JEV and OpenRouter received by default) and envelopes for some findings only
  for (const c of extras.cases) {
    const label = `${c.input} ${c.engine} envelope v${c.version} ${JSON.stringify(c.options)} for ${c.targets ? c.targets.length : "all"} findings`;
    test(label, () => {
      const findings = findingsOf(corpus, c.input, c.engine);
      let got: unknown[] = envelopes(findings, goldenWords(c.input), c.version as EnvelopeVersion,
        { corpus, ...parseEngineChoice(c.engine), ...c.options, targets: c.targets });
      if (c.version === 1) got = (got as Envelope[]).map(({ members, state, questions, merge }) => ({ members, state, questions, merge }));
      expect(JSON.stringify(got, null, 1)).toBe(JSON.stringify(c.expected, null, 1));
    });
  }

  test("corpus search gives the old app's results", () => {
    for (const s of searches) {
      const hits = search(s.text, { corpus, ...parseEngineChoice(s.engine), kind: s.kind, limit: s.limit });
      expect({ ...s, ids: hits.map((h) => h.unitId), sha256: sha256(Buffer.from(JSON.stringify(hits))) }).toEqual(s);
    }
  });

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

const found = new Map<string, Finding[]>();

/** The findings of one golden lecture and engine: kept from the findings test, or detected here when run alone. */
function findingsOf(corpus: Corpus, name: string, choice: string): Finding[] {
  const key = `${name} ${choice}`;
  if (!found.has(key)) found.set(key, detect(wordsOf(name), { corpus, ...parseEngineChoice(choice) }));
  return found.get(key)!;
}

/** The lecture's words as the old app held them when it built the envelopes. */
function goldenWords(name: string): Word[] {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN, "expected", name, "words.json"), "utf8"));
}

/** The file must match exactly; on a difference, show the first envelope that differs, not two huge strings. */
function expectGolden(file: string, got: unknown[]) {
  const expected = fs.readFileSync(path.join(GOLDEN, "expected", file), "utf8");
  const actual = JSON.stringify(got, null, 1) + "\n";
  if (actual !== expected) {
    const want = JSON.parse(expected);
    const i = want.findIndex((w: unknown, k: number) => JSON.stringify(w) !== JSON.stringify(got[k]));
    expect({ file, count: got.length, index: i, envelope: got[i] }).toEqual({ file, count: want.length, index: i, envelope: want[i] });
  }
  expect(actual).toBe(expected);
}

/** The words the old app detected on: ASR words as given, or pasted text turned into words the way the app does. */
function wordsOf(name: string): Word[] {
  const input = JSON.parse(fs.readFileSync(path.join(GOLDEN, "inputs", `${name}.json`), "utf8"));
  if (input.text !== undefined) return synthesizeWordsFromRawText(String(input.text).trim());
  return input.words;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
