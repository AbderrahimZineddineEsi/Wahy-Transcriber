// Tests at envelopes() and search()'s interface, on the tiny corpus (src/fixtures/small-corpus.json). Parity with the
// old app is the golden test's job (golden.test.ts); these pin what callers rely on.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { detect, envelopes, ruleBoundary, search, synthesizeWordsFromRawText } from "./index.ts";
import type { Corpus } from "./index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const small = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/small-corpus.json"), "utf8"));
const corpus: Corpus = { ayat: small.ayat, hadiths: small.hadiths };

// surah al-Ikhlas recited back to back (4 findings), a dhikr, a hadith, then ordinary speech
const LESSON = "قال الله تعالى قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد ثم قال سبحان الله وبحمده "
  + "سبحان الله العظيم وقال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى وهذا كلام عادي في الدرس";
const words = synthesizeWordsFromRawText(LESSON);
const options = { corpus, engine: "v3" as const };
const findings = detect(words, options);

describe("envelopes", () => {
  test("the findings are the ones these tests expect", () => {
    expect(findings.map((d) => d.displayRef)).toEqual(
      ["الإخلاص: 1", "الإخلاص: 2", "الإخلاص: 3", "الإخلاص: 4", "ذكر", "الأربعون النووية (1)"]);
  });

  test("v2 and v3 send consecutive verses as one passage by default, and members are finding indices", () => {
    for (const version of [2, 3] as const) {
      const out = envelopes(findings, words, version, options);
      expect(out.map((e) => e.members)).toEqual([[0, 1, 2, 3], [4], [5]]);
      expect(out[0].state.candidate_reference).toBe("الإخلاص: 1-4");
      expect(out[0].state.matched_span_in_lecture).toBe(words.slice(3, 18).map((w) => w.word).join(" "));
    }
  });

  test("passages off: one envelope per finding", () => {
    const out = envelopes(findings, words, 2, { ...options, passages: false });
    expect(out.map((e) => e.members)).toEqual([[0], [1], [2], [3], [4], [5]]);
    expect(out.every((e) => !("verses_in_passage" in e.state))).toBe(true);
  });

  test("targets: only the envelopes that hold a target, still grouped among all the findings", () => {
    expect(envelopes(findings, words, 2, { ...options, targets: [2] }).map((e) => e.members)).toEqual([[0, 1, 2, 3]]);
    expect(envelopes(findings, words, 2, { ...options, passages: false, targets: [5, 2] }).map((e) => e.members))
      .toEqual([[2], [5]]);
    expect(envelopes(findings, words, 1, { ...options, targets: [] })).toEqual([]);
  });

  test("neighbours (v2) list the nearest other envelopes without verdicts", () => {
    const [, dhikr] = envelopes(findings, words, 2, { ...options, neighbours: true });
    const nb = dhikr.state.neighbor_findings as Record<string, Record<string, unknown>>;
    expect(nb.previous.candidate_reference).toBe("الإخلاص: 1-4");
    expect(nb.next.candidate_reference).toBe("الأربعون النووية (1)");
    expect(JSON.stringify(nb)).not.toContain("verdict");
  });

  test("v1 is one canonical envelope per finding, with its merge question; v3 adds the no-model boundary", () => {
    const v1 = envelopes(findings, words, 1, options);
    expect(v1.map((e) => e.members)).toEqual([[0], [1], [2], [3], [4], [5]]);
    expect(Object.keys(v1[0].questions)).toEqual(["verdict", "boundary_status"]);
    expect(v1[0].merge).toBeTruthy();                      // al-Ikhlas 2 follows right after
    expect(v1[0].state.context_before).toBe("قال الله تعالى");
    const v3 = envelopes(findings, words, 3, options);
    expect(v3.every((e) => e.boundaryByRule && e.boundaryByRule.start === ruleBoundary(e.state).start)).toBe(true);
    expect(Object.keys(v3[0].state)[2]).toBe("canonical_corpus_text");   // v3: the corpus text near the top
  });

  test("findings that went through JSON (the worker, the datagen) give the same envelopes", () => {
    const viaJson = JSON.parse(JSON.stringify(findings));
    for (const version of [1, 2, 3] as const) {
      expect(envelopes(viaJson, words, version, options)).toEqual(envelopes(findings, words, version, options));
    }
  });

  test("rejects what it cannot build", () => {
    expect(() => envelopes(findings, words, 4 as 1, options)).toThrow(/unknown envelope version 4/);
    expect(() => envelopes(findings, words, 3, { ...options, neighbours: true })).toThrow(/neighbours option is for envelope v2/);
    expect(() => envelopes(findings, words, 2, { ...options, targets: [6] })).toThrow(/target 6 is not a finding index/);
  });
});

describe("search", () => {
  test("by reference, by unit id and by text (diacritics and alef forms don't matter)", () => {
    expect(search("الإخلاص: 2", options).map((h) => h.unitId)).toEqual(["112:2"]);
    expect(search("112:1", options).map((h) => h.unitId)).toEqual(["112:1"]);
    expect(search("لم يولد", options).map((h) => h.unitId)).toEqual(["112:3"]);
    const samad = corpus.ayat.find((x) => x.s === 112 && x.a === 2)!.t;   // vocalised: «اللَّهُ الصَّمَدُ»
    expect(search(samad, options)[0]).toEqual({ unitId: "112:2", sourceType: "QURAN", displayRef: "الإخلاص: 2", fullText: samad });
  });

  test("kind filters by source, limit caps the list, empty text lists the first units", () => {
    expect(search("الله", { ...options, kind: "HADITH" }).every((h) => h.sourceType === "HADITH")).toBe(true);
    expect(search("الله", { ...options, kind: "ADHKAR" }).length).toBeGreaterThan(0);
    expect(search("", { ...options, limit: 3 }).map((h) => h.unitId)).toEqual(["1:1", "1:2", "1:3"]);
    expect(() => search("x", { ...options, kind: "ayah" as "QURAN" })).toThrow(/unknown kind/);
  });
});
