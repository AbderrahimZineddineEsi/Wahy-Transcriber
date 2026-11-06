// expand() at its interface, on the tiny corpus: a finding cut short on one side grows back over the words the
// speaker really said, never over a citation cue, and never when the side is not the one reported missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { detect, expand, synthesizeWordsFromRawText } from "./index.ts";
import type { Corpus, Finding } from "./index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const small = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/small-corpus.json"), "utf8"));
const corpus: Corpus = { ayat: small.ayat, hadiths: small.hadiths };
const options = { corpus, engine: "v3" as const };

const LESSON = "قال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى وهذا كلام عادي في الدرس";
const words = synthesizeWordsFromRawText(LESSON);
const hadith = detect(words, options).find((d) => d.sourceType === "HADITH")!;

/** The same finding with `n` words cut off its start (or its end), as an engine that missed them would give it. */
function cut(f: Finding, side: "start" | "end", n: number): Finding {
  const d: any = structuredClone(f);
  if (side === "start") {
    d.wordStartIdx += n;
    d.segments = [[d.wordStartIdx, d.wordEndIdx + 1]];
    d.qSegments = [[d.qSegments[0][0] + n, d.qSegments[d.qSegments.length - 1][1]]];
  } else {
    d.wordEndIdx -= n;
    d.segments = [[d.wordStartIdx, d.wordEndIdx + 1]];
    d.qSegments = [[d.qSegments[0][0], d.qSegments[d.qSegments.length - 1][1] - n]];
  }
  return d;
}

describe("expand", () => {
  test("the hadith is found whole, after its cue", () => {
    expect(words.slice(hadith.wordStartIdx, hadith.wordEndIdx + 1).map((w) => w.word).join(" "))
      .toBe("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
  });

  test("a missing start grows back to the quote's first word, and stops at the cue", () => {
    const short = cut(hadith, "start", 2);
    const out = expand(short, words, "MISSING_START", options);
    expect(out.changed).toBe(true);
    expect(out.added).toEqual({ start: 2, end: 0 });
    expect([out.finding.wordStartIdx, out.finding.wordEndIdx]).toEqual([hadith.wordStartIdx, hadith.wordEndIdx]);
    expect(out.finding.segments).toEqual([[hadith.wordStartIdx, hadith.wordEndIdx + 1]]);
    expect(out.finding.startTime).toBe(words[hadith.wordStartIdx].start);
    expect(short.wordStartIdx).toBe(hadith.wordStartIdx + 2); // the input is not changed
  });

  test("a missing end grows back to the quote's last word", () => {
    const out = expand(cut(hadith, "end", 3), words, "MISSING_END", options);
    expect(out.added).toEqual({ start: 0, end: 3 });
    expect(out.finding.wordEndIdx).toBe(hadith.wordEndIdx);
    expect(out.finding.canonicalText).toBe(hadith.canonicalText);
  });

  test("only the side that is reported missing moves", () => {
    const out = expand(cut(hadith, "start", 2), words, "MISSING_END", options);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("no_match");
  });

  test("a finding that is not linked to a corpus unit is not changed", () => {
    const out = expand({ ...hadith, unitId: "nowhere" }, words, "MISSING_BOTH", options);
    expect([out.changed, out.reason]).toEqual([false, "no_unit"]);
  });
});
