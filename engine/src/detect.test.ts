// Tests at detect()'s interface, on a tiny corpus (src/fixtures/small-corpus.json), so they run in about a second
// and need no download. Parity with the old app is the golden test's job (golden.test.ts).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { detect, parseEngineChoice, synthesizeWordsFromRawText } from "./index.ts";
import type { Corpus, CustomQuote } from "./index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const small = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/small-corpus.json"), "utf8"));
const corpus: Corpus = { ayat: small.ayat, hadiths: small.hadiths };

// a cue, surah al-Ikhlas (words 3-17), a dhikr (words 20-25), a hadith, then ordinary speech
const LESSON = "قال الله تعالى قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد ثم قال سبحان الله وبحمده "
  + "سبحان الله العظيم وقال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى وهذا كلام عادي في الدرس";
const words = synthesizeWordsFromRawText(LESSON);
const brief = (f: ReturnType<typeof detect>) => f.map((d) => [d.sourceType, d.displayRef, d.wordStartIdx, d.wordEndIdx]);

describe("detect", () => {
  test("finds the verses, the dhikr and the hadith, with word indices and times from the given words", () => {
    const found = detect(words, { corpus, engine: "v3" });
    expect(brief(found)).toEqual([
      ["QURAN", "الإخلاص: 1", 3, 6],
      ["QURAN", "الإخلاص: 2", 7, 8],
      ["QURAN", "الإخلاص: 3", 9, 12],
      ["QURAN", "الإخلاص: 4", 13, 17],
      ["ADHKAR", "ذكر", 20, 25],
      ["HADITH", "الأربعون النووية (1)", 32, 39],
    ]);
    expect(found[0].startTime).toBe(words[3].start);
    expect(found[0].endTime).toBe(words[6].end);
    expect(found[0].matchedText).toBe("قل هو الله أحد");
  });

  test("leaves the caller's words as they were", () => {
    const mine = structuredClone(words).map((w) => ({ word: ` ${w.word} `, start: w.start, end: w.end }));
    const before = structuredClone(mine);
    detect(mine, { corpus, engine: "v3" });
    expect(mine).toEqual(before);
  });

  test("trims words, as the old app did before joining them", () => {
    const padded = words.map((w) => ({ word: ` ${w.word}  `, start: w.start, end: w.end }));
    expect(detect(padded, { corpus, engine: "v3" })).toEqual(detect(words, { corpus, engine: "v3" }));
  });

  test("an empty transcript has no findings", () => {
    expect(detect([], { corpus })).toEqual([]);
    expect(detect([{ word: "كلمة", start: 0, end: 1 }], { corpus })).toEqual([]);
  });

  test("the default Qira'ah relabels v3's Hafs findings and leaves v5 alone (as in the old app)", () => {
    const warsh = detect(words, { corpus, engine: "v3", qiraat: "warsh" });
    expect(warsh[0].qiraah).toBe("warsh");
    expect(warsh[0].qiraahDisplay).toBe("رواية ورش عن نافع");
    expect(brief(warsh)).toEqual(brief(detect(words, { corpus, engine: "v3" })));
    expect(detect(words, { corpus, qiraat: "warsh" })).toEqual(detect(words, { corpus }));
  });

  test("an empty adhkar list turns adhkar off", () => {
    const found = detect(words, { corpus, engine: "v3", adhkar: [] });
    expect(found.map((d) => d.sourceType)).not.toContain("ADHKAR");
    expect(found).toHaveLength(5);
  });

  test("a custom quote is found like any other reference", () => {
    const quote: CustomQuote = { id: "Outside:1", book: "OutsideCorpus", ref: "قول مالك", t: "العلم نور يقذفه الله في قلب من يشاء من عباده الصالحين" };
    const speech = synthesizeWordsFromRawText("قال الإمام مالك رحمه الله العلم نور يقذفه الله في قلب من يشاء من عباده الصالحين وهذا كلام عادي");
    expect(detect(speech, { corpus, engine: "v3" })).toEqual([]);
    const found = detect(speech, { corpus, engine: "v3", customQuotes: [quote] });
    expect(found.map((d) => [d.displayRef, d.isOutsideCorpus, d.wordStartIdx, d.wordEndIdx])).toEqual([["قول مالك", true, 6, 15]]);
  });

  test("the same options give the same findings on every call (matchers are reused, never changed by a call)", () => {
    const first = detect(words, { corpus, engine: "v5", profile: "loose" });
    detect(words, { corpus, engine: "v4" });
    expect(detect(words, { corpus, engine: "v5", profile: "loose" })).toEqual(first);
    expect(detect(words, { corpus: { ...corpus }, engine: "v5", profile: "loose" })).toEqual(first);
  });

  test("bad options are refused with a clear message", () => {
    expect(() => detect(words, {} as never)).toThrow(/corpus/);
    expect(() => detect(words, { corpus, engine: "v6" as never })).toThrow(/unknown engine "v6"/);
    expect(() => detect(words, { corpus, engine: "v4", profile: "loose" })).toThrow(/no profile "loose"/);
    expect(() => detect(words, { corpus, qiraat: "imaginary" })).toThrow(/unknown qira'ah/);
  });
});

describe("parseEngineChoice", () => {
  test("reads the old app's engine choices", () => {
    expect(parseEngineChoice("v5")).toEqual({ engine: "v5", profile: "normal" });
    expect(parseEngineChoice("v5:loose")).toEqual({ engine: "v5", profile: "loose" });
    expect(parseEngineChoice("v3")).toEqual({ engine: "v3", profile: "normal" });
    expect(() => parseEngineChoice("v9")).toThrow();
    expect(() => parseEngineChoice("v5:tight")).toThrow();
  });
});

test("the package touches no browser API and adds no globals (plain Node, no DOM)", () => {
  const script = `
    const before = new Set(Object.getOwnPropertyNames(globalThis));
    const m = await import(${JSON.stringify(path.join(HERE, "index.ts"))});
    const fs = await import("node:fs");
    const c = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(HERE, "fixtures/small-corpus.json"))}, "utf8"));
    const words = m.synthesizeWordsFromRawText(${JSON.stringify(LESSON)});
    let n = 0;
    for (const engine of ["v3", "v4", "v5"]) n += m.detect(words, { corpus: c, engine }).length;
    const added = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
    console.log(JSON.stringify({ added, hasWindow: typeof window, hasDocument: typeof document, n }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  const { n, ...rest } = JSON.parse(out);
  expect(rest).toEqual({ added: [], hasWindow: "undefined", hasDocument: "undefined" });
  expect(n).toBeGreaterThan(0); // the engines really ran
});
