// The caption builder against the old app's golden captions: for every golden input and engine choice, the
// captions built from the golden words and findings must give the old app's SRT, line for line (with the
// default style and with the alternative style). Needs no corpus. The SRT text format itself is phase 16's
// export; `srt` below only exists to compare.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildCaptions, splitLongCitationWords, type Caption, type CaptionFinding, type CaptionPrefs } from "./captions.ts";

const EXPECTED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../golden/expected");
const manifest = JSON.parse(fs.readFileSync(path.join(EXPECTED, "manifest.json"), "utf8"));
const read = (rel: string) => fs.readFileSync(path.join(EXPECTED, rel), "utf8");
const ALT_STYLE: CaptionPrefs = {
  quranBracketOpen: "(", quranBracketClose: ")", hadithBracketOpen: '"', hadithBracketClose: '"',
  adhkarBracketOpen: "[", adhkarBracketClose: "]", groupContiguousAyat: false, splitCommentary: false,
};

function stamp(sec: number): string {
  const s = Math.max(0, sec);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(Math.floor(s % 60))},${p(ms, 3)}`;
}
const srt = (caps: Caption[]) => caps.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.displayText}\n`).join("\n");

describe("golden captions", () => {
  for (const name of Object.keys(manifest.inputs)) {
    const words = JSON.parse(read(`${name}/words.json`));
    for (const engine of manifest.engines as string[]) {
      const dir = `${name}/${engine.replace(":", "-")}`;
      const findings: CaptionFinding[] = JSON.parse(read(`${dir}/findings.json`));
      test(`${dir}: the old app's SRT`, () => {
        expect(srt(buildCaptions(words, findings, { prefs: { splitCommentary: false } }))).toBe(read(`${dir}/wahy-captions.srt`));
      });
      if (engine === "v5") {
        test(`${dir}: the old app's SRT in the alternative style`, () => {
          expect(srt(buildCaptions(words, findings, { prefs: ALT_STYLE }))).toBe(read(`${dir}/alt-style/wahy-captions.srt`));
        });
      }
    }
  }
});

describe("rules", () => {
  const w = (word: string, start: number) => ({ word, start, end: start + 0.3 });
  const words = ["قال", "الله", "تعالى", "قل", "هو", "الله", "أحد", "ثم", "قال"].map((x, i) => w(x, i * 0.35));
  const verse = { sourceType: "QURAN", unitId: "112:1", displayRef: "الإخلاص: 1", wordStartIdx: 3, wordEndIdx: 6, canonicalText: "قُلْ هُوَ اللَّهُ أَحَدٌ" };

  test("a quote is its own caption, with brackets and its reference", () => {
    const caps = buildCaptions(words, [verse]);
    expect(caps.map((c) => c.displayText)).toEqual(["قال الله تعالى", "﴿قل هو الله أحد﴾ [الإخلاص: 1]", "ثم قال"]);
    expect(caps[1]).toMatchObject({ type: "ayah", wordStartIdx: 3, wordEndIdx: 6, findingIdx: 0 });
  });

  test("a finding that is not visible is read as speech, its words kept", () => {
    const caps = buildCaptions(words, [verse], { visible: () => false });
    expect(caps.map((c) => c.displayText).join(" ")).toBe(words.map((x) => x.word).join(" "));
    expect(caps.every((c) => c.type === "normal")).toBe(true);
  });

  test("a snapped finding shows its canonical text", () => {
    const caps = buildCaptions(words, [{ ...verse, snappedToCanonical: true }]);
    expect(caps[1].displayText).toBe("﴿قُلْ هُوَ اللَّهُ أَحَدٌ﴾ [الإخلاص: 1]");
  });

  test("a long quote is cut into chunks of 12 to 22 words, none left with 1 to 3 words", () => {
    const long = Array.from({ length: 61 }, (_, i) => w(`ك${i}`, i * 0.31));
    const chunks = splitLongCitationWords(long);
    expect(chunks.flat()).toEqual(long);
    for (const c of chunks) expect(c.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks.slice(0, -1)) expect(c.length).toBeGreaterThanOrEqual(12);
  });
});
