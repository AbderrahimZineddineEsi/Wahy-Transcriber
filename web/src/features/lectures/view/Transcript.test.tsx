// The transcript writes a quote's brackets the way the exports do (engine/src/captions.ts): here, a Quran verse
// inside a hadith with no commentary gap gets its own ﴿…﴾ inside the hadith's « » (user decision after phase 17).
import { formattedText } from "@wahy/engine/export";
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { I18nProvider } from "../../../shell/i18n";
import { buildParagraphs, type ViewFinding, type Word } from "./model";
import { Transcript } from "./Transcript";

// 0   1     2   3   4    5    6    7       8   9       10
const words: Word[] = "قال النبي ثم قرأ وما خلقت الجن والإنس إلا ليعبدون صدق"
  .split(" ")
  .map((text, i) => ({ idx: i, text, start: i, end: i + 0.5 }));
const data = {
  id: "v", sourceType: "HADITH", type: "hadith", unitId: "Muslim:9", displayRef: "صحيح مسلم (9)",
  wordStartIdx: 2, wordEndIdx: 9, segments: [[2, 10]], commentaryGaps: [],
  embeddedQuran: [{ tStart: 4, tEnd: 10 }],
};
const hadith: ViewFinding = {
  key: "f1", id: 1, kind: "hadith", start: 2, end: 9, ref: "صحيح مسلم (9)", candidates: [], ambiguous: false,
  verdict: "none", boundary: null, verifier: null, model: null, confidence: null, details: null,
  canonicalText: "ثُمَّ قَرَأَ وَمَا خَلَقْتُ الْجِنَّ وَالْإِنْسَ إِلَّا لِيَعْبُدُونِ", data,
};

const quoteText = (split: boolean, script: "spoken" | "standard" = "spoken") => {
  const { container, unmount } = render(
    <I18nProvider>
      <Transcript paragraphs={buildParagraphs(words, [hadith], script)} words={words} onWord={() => {}} onRef={() => {}} onWordDoubleClick={() => {}} split={split} />
    </I18nProvider>,
  );
  const quote = container.querySelector("[data-f]")!;
  // the quote without its reference button
  const text = Array.from(quote.childNodes).filter((n) => !(n instanceof HTMLButtonElement)).map((n) => n.textContent).join("");
  unmount();
  return text;
};

test("a verse inside a gapless hadith: ﴿…﴾ inside « », as in the exports, split on or off", () => {
  const want = "«ثم قرأ ﴿وما خلقت الجن والإنس إلا ليعبدون﴾»";
  expect(formattedText(words.map((w) => ({ word: w.text, start: w.start, end: w.end })), [data], "plain")).toContain(want);
  expect(quoteText(true)).toBe(want);
  expect(quoteText(false)).toBe(want);
});

test("in standard script the source text has no verse marks (as in the exports)", () => {
  expect(quoteText(true, "standard")).toBe(`«${hadith.canonicalText}»`);
});
