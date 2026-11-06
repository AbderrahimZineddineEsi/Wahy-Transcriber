// edit() at its interface, on the tiny corpus: each editor change gives the finding the old editor gave, and never
// changes the finding it was handed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { detect, edit, synthesizeWordsFromRawText } from "./index.ts";
import type { Corpus, Finding } from "./index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const small = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/small-corpus.json"), "utf8"));
const corpus: Corpus = { ayat: small.ayat, hadiths: small.hadiths };
const options = { corpus, engine: "v3" as const };

//              0   1    2     3  4  5    6   7    8     9  10  11    12   13      14     15    16  17   18  19
const LESSON = "قال الله تعالى قل هو الله أحد الله الصمد ثم قال النبي إنما الأعمال بالنيات وإنما لكل امرئ ما نوى";
const words = synthesizeWordsFromRawText(LESSON);
const found = detect(words, options);
const verse = found.find((d) => d.unitId === "112:1")!;
const ayah = (s: number, a: number): string => small.ayat.find((x: any) => x.s === s && x.a === a).t;
const text = (f: any) => words.slice(f.wordStartIdx, f.wordEndIdx + 1).map((w) => w.word).join(" ");

describe("edit", () => {
  test("the lesson has verse 112:1 on words 3..6", () => {
    expect([verse.wordStartIdx, verse.wordEndIdx]).toEqual([3, 6]);
  });

  test("add a missed quote with a corpus unit: re-aligned, verified, a verse snapped to the source text", () => {
    const { finding } = edit({ op: "add_quote", start: 7, end: 8, unitId: "112:2" }, words, options) as { finding: any };
    expect(finding).toMatchObject({ unitId: "112:2", sourceType: "QURAN", type: "ayah", displayRef: "الإخلاص: 2",
      wordStartIdx: 7, wordEndIdx: 8, segments: [[7, 9]], confidenceBand: "VERIFIED", snappedToCanonical: true,
      startTime: words[7].start, endTime: words[8].end, matchedText: "الله الصمد", addedByHand: true });
    expect(finding.canonicalText).toBe(ayah(112, 2));
  });

  test("add an outside-corpus quote with a typed reference", () => {
    const { finding } = edit({ op: "add_quote", start: 9, end: 11, sourceType: "HADITH", ref: "أثر عن عمر" }, words, options) as { finding: any };
    expect(finding).toMatchObject({ unitId: "OUTSIDE_CORPUS", isOutsideCorpus: true, sourceType: "HADITH", type: "hadith",
      displayRef: "أثر عن عمر", canonicalText: "ثم قال النبي" });
    expect(() => edit({ op: "add_quote", start: 5, end: 99 }, words, options)).toThrow(/not in the lecture/);
    expect(() => edit({ op: "add_quote", start: 1, end: 2, unitId: "999:1" }, words, options)).toThrow(/no corpus unit/);
  });

  test("move an edge by one word; the input finding is not changed", () => {
    const before = structuredClone(verse);
    const { finding } = edit({ op: "move_edge", finding: verse, edge: "start", delta: -1 }, words, options) as { finding: any };
    expect([finding.wordStartIdx, finding.wordEndIdx, finding.segments]).toEqual([2, 6, [[2, 7]]]);
    expect(finding.startTime).toBe(words[2].start);
    expect(verse).toEqual(before);
    const shrunk = edit({ op: "move_edge", finding: verse, edge: "end", delta: -10 }, words, options).finding as any;
    expect(shrunk.wordEndIdx).toBe(verse.wordStartIdx);      // never before the start
  });

  test("change the kind", () => {
    const { finding } = edit({ op: "set_kind", finding: verse, kind: "dhikr" }, words, options) as { finding: any };
    expect([finding.type, finding.sourceType]).toEqual(["dhikr", "ADHKAR"]);
  });

  test("snap to the source text and back", () => {
    const on = edit({ op: "snap", finding: verse, on: true }, words, options).finding as any;
    expect(on.snappedToCanonical).toBe(true);
    expect(edit({ op: "snap", finding: on, on: false }, words, options).finding.snappedToCanonical).toBe(false);
  });

  test("canonical word chips: the picked reference words become the quote's text", () => {
    const { finding } = edit({ op: "canonical_words", finding: verse, indices: [3, 0, 1, 2] }, words, options) as { finding: any };
    expect(finding).toMatchObject({ canonicalText: ayah(112, 1), snappedToCanonical: true, qSegments: [[0, 4]],
      refSelection: { unitId: "112:1", full: false, indices: [0, 1, 2, 3] } });
    expect(() => edit({ op: "canonical_words", finding: verse, indices: [] }, words, options)).toThrow();
  });

  test("link another reference, and get the first one's word edits back when linking it again", () => {
    const picked = edit({ op: "canonical_words", finding: verse, indices: [0, 1] }, words, options).finding;
    const other = edit({ op: "link_reference", finding: picked, unitId: "112:2" }, words, options).finding as any;
    expect(other).toMatchObject({ unitId: "112:2", displayRef: "الإخلاص: 2", confidenceBand: "VERIFIED", snappedToCanonical: false });
    expect(other.candidates.map((c: any) => c.unitId)).toEqual(["112:1"]);
    const back = edit({ op: "link_reference", finding: other, unitId: "112:1" }, words, options).finding as any;
    expect(back).toMatchObject({ unitId: "112:1", canonicalText: ayah(112, 1).split(" ").slice(0, 2).join(" "), snappedToCanonical: true });
    const typed = edit({ op: "link_reference", finding: verse, ref: "مرجع يدوي" }, words, options).finding as any;
    expect([typed.unitId, typed.displayRef]).toEqual(["112:1", "مرجع يدوي"]);
  });

  test("the list of matching references: add a unit or a typed one, remove one, never the finding's own", () => {
    const added = edit({ op: "add_candidate", finding: verse, unitId: "112:2" }, words, options).finding;
    const typed = edit({ op: "add_candidate", finding: added, ref: "سنن أبي داود (1)" }, words, options).finding as any;
    expect(typed.candidates.map((c: any) => c.unitId)).toEqual(["112:1", "112:2", "MANUAL:سنن أبي داود (1)"]);
    expect(() => edit({ op: "add_candidate", finding: typed, unitId: "112:2" }, words, options)).toThrow(/already/);
    const removed = edit({ op: "remove_candidate", finding: typed, unitId: "112:2" }, words, options).finding as any;
    expect(removed.candidates.map((c: any) => c.unitId)).toEqual(["112:1", "MANUAL:سنن أبي داود (1)"]);
    expect(() => edit({ op: "remove_candidate", finding: typed, unitId: "112:1" }, words, options)).toThrow(/own reference/);
  });

  test("merge two findings of one quote split by a word, as one part or around a commentary", () => {
    const [a, b] = [cutVerse(3, 4), cutVerse(6, 6)];
    const whole = edit({ op: "merge", first: a, second: b }, words, options) as any;
    expect(whole.kept).toBe("first");
    expect(whole.finding).toMatchObject({ wordStartIdx: 3, wordEndIdx: 6, segments: [[3, 7]], commentaryGaps: [] });
    expect(text(whole.finding)).toBe("قل هو الله أحد");
    const around = edit({ op: "merge", first: b, second: a, gapType: "COMMENTARY" }, words, options).finding as any;
    expect(around).toMatchObject({ segments: [[3, 5], [6, 7]], commentaryGaps: [[5, 6]] });
    expect(() => edit({ op: "merge", first: verse, second: verse }, words, options)).toThrow(/overlap/);
  });
});

/** The verse finding cut down to words a..b. */
function cutVerse(a: number, b: number): Finding {
  const d: any = structuredClone(verse);
  d.wordStartIdx = a;
  d.wordEndIdx = b;
  d.segments = [[a, b + 1]];
  return d;
}
