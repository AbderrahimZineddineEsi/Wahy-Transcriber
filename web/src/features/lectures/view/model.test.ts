import { buildCaptions } from "@wahy/engine/captions";
import { describe, expect, test } from "vitest";
import {
  buildParagraphs,
  counts,
  DEFAULT_FILTER,
  fromRow,
  isShown,
  normalizeArabic,
  PRESETS,
  presetOf,
  quoteTokens,
  searchHits,
  type ViewFinding,
  type Word,
} from "./model";
import { row, sampleWords } from "./fixtures";

const verse = fromRow(row({}));
const hadith = fromRow(
  row({ id: 2, idx: 1, source_type: "HADITH", display_ref: "البخاري (1)", word_start: 10, word_end: 12, verdict: { verdict: "FALSE", boundary: "COMPLETE", verifier: "laya", model: "v3_mixed" } }),
);

describe("findings from the server", () => {
  test("kind, span, reference and the newest verdict", () => {
    expect(verse).toMatchObject({ key: "f1", id: 1, kind: "quran", start: 3, end: 6, ref: "الإخلاص: 1", verdict: "none", boundary: null });
    expect(hadith).toMatchObject({ kind: "hadith", verdict: "bad", boundary: "complete", verifier: "laya", model: "v3_mixed" });
    expect(fromRow(row({ source_type: "ADHKAR", data: { sourceType: "ADHKAR" } })).kind).toBe("dhikr");
  });

  test("counts by kind, and the clipped ones", () => {
    const clipped = fromRow(row({ id: 3, verdict: { verdict: "CORRECT", boundary: "MISSING_END", verifier: "laya" } }));
    expect(counts(sampleWords, [verse, hadith, clipped])).toEqual({ words: 14, quran: 2, hadith: 1, dhikr: 0, clipped: 1 });
  });
});

describe("filters", () => {
  test("by kind", () => {
    expect(isShown(verse, { ...DEFAULT_FILTER, kind: "hadith" })).toBe(false);
    expect(isShown(hadith, { ...DEFAULT_FILTER, kind: "hadith" })).toBe(true);
  });

  test("by verdict, with presets", () => {
    const noFalse = { ...DEFAULT_FILTER, show: { ...DEFAULT_FILTER.show, bad: false } };
    expect(isShown(hadith, noFalse)).toBe(false);
    expect(isShown(verse, noFalse)).toBe(true);
    expect(isShown(verse, { ...DEFAULT_FILTER, show: PRESETS.false })).toBe(false);
    expect(presetOf(PRESETS.correct)).toBe("correct");
    expect(presetOf(noFalse.show)).toBeNull();
  });

  test("clipped only: a missing start or end, never a false finding", () => {
    const missStart = fromRow(row({ verdict: { verdict: "NOT_SURE", boundary: "MISSING_START", verifier: "laya" } }));
    const falseClipped = fromRow(row({ verdict: { verdict: "FALSE", boundary: "MISSING_END", verifier: "laya" } }));
    const f = { ...DEFAULT_FILTER, clipped: true };
    expect([missStart, falseClipped, verse].map((x) => isShown(x, f))).toEqual([true, false, false]);
  });

  test("a hidden finding keeps its words in the captions, as plain speech", () => {
    const words = sampleWords.map((w) => ({ word: w.text, start: w.start, end: w.end }));
    const all = buildCaptions(words, [verse, hadith].map((f) => f.data));
    const noFalse = buildCaptions(words, [verse].map((f) => f.data));
    expect(all.map((c) => c.displayText).join(" ")).toContain("«إنما الأعمال بالنيات» [البخاري (1)]");
    expect(noFalse.map((c) => c.displayText).join(" ")).toContain("إنما الأعمال بالنيات");
    expect(noFalse.map((c) => c.displayText).join(" ")).not.toContain("«");
  });
});

describe("paragraphs", () => {
  const flat = (ps: ReturnType<typeof buildParagraphs>) => ps.flatMap((p) => p.pieces);

  test("every word appears once, quotes as one piece", () => {
    const pieces = flat(buildParagraphs(sampleWords, [verse, hadith], "spoken"));
    expect(pieces.map((p) => (p.type === "word" ? p.i : `q${p.f.start}`))).toEqual([0, 1, 2, "q3", 7, 8, 9, "q10", 13]);
  });

  test("a finding inside another one is skipped; of two at one start the first is kept", () => {
    const inner = fromRow(row({ id: 9, word_start: 4, word_end: 5 }));
    const second = fromRow(row({ id: 8, word_start: 3, word_end: 8 }));
    const pieces = flat(buildParagraphs(sampleWords, [verse, inner, second], "spoken"));
    expect(pieces.filter((p) => p.type === "quote").map((p) => p.type === "quote" && p.f.key)).toEqual(["f1"]);
    expect(pieces.map((p) => (p.type === "word" ? p.i : "q"))).toEqual([0, 1, 2, "q", 7, 8, 9, 10, 11, 12, 13]);
  });

  test("long speech is cut at sentence ends, never inside a quote", () => {
    const long: Word[] = Array.from({ length: 400 }, (_, i) => ({ idx: i, text: i % 45 === 44 ? "نهاية." : "كلمة", start: i * 0.4, end: i * 0.4 + 0.3 }));
    const quote: ViewFinding = { ...verse, key: "fq", start: 80, end: 100 };
    const ps = buildParagraphs(long, [quote], "spoken");
    expect(ps.length).toBeGreaterThan(3);
    expect(ps[0].first).toBe(0);
    expect(ps[ps.length - 1].last).toBe(399);
    for (let k = 1; k < ps.length; k++) expect(ps[k].first).toBe(ps[k - 1].last + 1);
    for (const p of ps) expect(p.first <= 80 && p.last >= 80 && p.last < 100).toBe(false);
  });

  test("standard script shows the source words, each tied to a spoken word", () => {
    expect(quoteTokens(sampleWords, verse, "spoken").map((t) => t.text)).toEqual(["قل", "هو", "الله", "أحد"]);
    expect(quoteTokens(sampleWords, verse, "standard")).toEqual([
      { text: "قُلْ", i: 3 },
      { text: "هُوَ", i: 4 },
      { text: "اللَّهُ", i: 5 },
      { text: "أَحَدٌ", i: 6 },
    ]);
    const short = { ...verse, canonicalText: "قُلْ أَحَدٌ" };
    expect(quoteTokens(sampleWords, short, "standard").map((t) => t.i)).toEqual([3, 5]);
    expect(quoteTokens(sampleWords, { ...verse, canonicalText: "" }, "standard").map((t) => t.text)).toEqual(["قل", "هو", "الله", "أحد"]);
  });

  test("a finding switched to its source text shows it even as spoken (the editor's snap)", () => {
    const snapped = { ...verse, data: { ...verse.data, snappedToCanonical: true } };
    expect(quoteTokens(sampleWords, snapped, "spoken").map((t) => t.text)).toEqual(["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]);
  });

  // a hadith in two parts (words 10-12 and 16-18) with the speaker's words 13-15 between them; the engine counts
  // tokens, and here every word is one token
  const words = "قال النبي إنما الأعمال بالنيات يعني كل عمل وإنما لكل امرئ ما نوى".split(" ").map((w, i) => ({ idx: i, text: w, start: i, end: i + 0.5 }));
  const parted = {
    ...verse,
    kind: "hadith" as const,
    start: 2,
    end: 11,
    canonicalText: "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى",
    data: { ...verse.data, segments: [[2, 5], [8, 12]], commentaryGaps: [[5, 8]], canonicalSegments: ["إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ", "وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى"] },
  };

  test("commentary gaps keep the speaker's words, marked as gaps (phase 16's split)", () => {
    const toks = quoteTokens(words, parted, "spoken");
    expect(toks.filter((t) => t.gap).map((t) => t.text)).toEqual(["يعني", "كل", "عمل"]);
    expect(toks.filter((t) => !t.gap).map((t) => t.i)).toEqual([2, 3, 4, 8, 9, 10, 11]);
  });

  test("in standard script each part shows its own source words, and the gap stays as spoken", () => {
    const toks = quoteTokens(words, parted, "standard");
    expect(toks.map((t) => t.text).join(" ")).toBe("إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ يعني كل عمل وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى");
    expect(toks.filter((t) => t.gap).map((t) => t.i)).toEqual([5, 6, 7]);
  });

  test("token ranges are read through the token → word map", () => {
    // word 5 holds two tokens: tokens 5-6 are word 5, so the gap [5, 8) is words 5-6
    const tokWord = [0, 1, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10, 11];
    const toks = quoteTokens(words, { ...parted, data: { ...parted.data, commentaryGaps: [[5, 8]] } }, "spoken", tokWord);
    expect(toks.filter((t) => t.gap).map((t) => t.i)).toEqual([5, 6]);
  });

  // a hadith with a verse inside it and no gap (user decision after phase 17: the verse gets its own ﴿…﴾)
  const withVerse: ViewFinding = {
    ...parted,
    start: 2,
    end: 7,
    data: { ...parted.data, segments: [[2, 8]], commentaryGaps: [], canonicalSegments: [], embeddedQuran: [{ tStart: 4, tEnd: 7 }] },
  };

  test("the words of a verse inside a hadith are marked, in the spoken words only", () => {
    expect(quoteTokens(words, withVerse, "spoken").map((t) => t.verse ?? null)).toEqual([null, null, 0, 0, 0, null]);
    expect(quoteTokens(words, withVerse, "standard").some((t) => t.verse !== undefined)).toBe(false);
  });
});

describe("search", () => {
  const norm = sampleWords.map((w) => normalizeArabic(w.text));
  test("diacritics, alef forms and punctuation do not matter", () => {
    expect(normalizeArabic("الْأَعْمَالُ،")).toBe("الاعمال");
    expect(normalizeArabic("إِلَى")).toBe("الي");
  });
  test("one word matches every word that contains it", () => {
    expect(searchHits(norm, "الله")).toEqual([1, 5]);
    expect(searchHits(norm, "  ")).toEqual([]);
  });
  test("several words match a run", () => {
    expect(searchHits(norm, "هو الله")).toEqual([4, 5]);
    expect(searchHits(norm, "الأعمال بالنيات")).toEqual([11, 12]);
    expect(searchHits(norm, "الله هو")).toEqual([]);
  });
});
