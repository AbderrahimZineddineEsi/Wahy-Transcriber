// The exports against the old app's golden files (ROADMAP phase 16), and the one expected difference: commentary
// gaps outside the brackets.
//
// With `splitCommentary: false` every export (SRT, VTT, ASS, Markdown, text) of every golden input and engine choice
// must equal the old app's file, in the default style and the alternative one. With the split on (the default), the
// only captions allowed to change are those of findings that have commentary gaps.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildCaptions, applyCaptionEdits, checkCaptionEdit, type CaptionFinding, type CaptionPrefs } from "./captions.ts";
import { exportLecture, formattedText, type ExportFormat } from "./export.ts";

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../golden");
const EXPECTED = path.join(GOLDEN, "expected");
const manifest = JSON.parse(fs.readFileSync(path.join(EXPECTED, "manifest.json"), "utf8"));
const read = (rel: string) => fs.readFileSync(path.join(EXPECTED, rel), "utf8");
const OLD = { splitCommentary: false } satisfies CaptionPrefs;
const ALT_STYLE: CaptionPrefs = { ...manifest.alt_style, ...OLD };
const FILES: [ExportFormat, string][] = [
  ["srt", "wahy-captions.srt"], ["vtt", "wahy-captions.vtt"], ["ass", "wahy-captions.ass"],
  ["md", "wahy-lecture.md"], ["txt", "wahy-lecture.txt"],
];

describe("golden exports (commentary split off)", () => {
  for (const name of Object.keys(manifest.inputs)) {
    const words = JSON.parse(read(`${name}/words.json`));
    const title = JSON.parse(fs.readFileSync(path.join(GOLDEN, "inputs", `${name}.json`), "utf8")).title;
    for (const engine of manifest.engines as string[]) {
      const dir = `${name}/${engine.replace(":", "-")}`;
      const findings = JSON.parse(read(`${dir}/findings.json`));
      for (const [format, file] of FILES) {
        test(`${dir}/${file}`, () => {
          expect(exportLecture({ format, words, findings, title, prefs: OLD }).content).toBe(read(`${dir}/${file}`));
        });
        if (engine === "v5") {
          test(`${dir}/alt-style/${file}`, () => {
            expect(exportLecture({ format, words, findings, title, prefs: ALT_STYLE }).content).toBe(read(`${dir}/alt-style/${file}`));
          });
        }
      }
    }
  }
});

describe("golden captions with the commentary split on", () => {
  for (const name of Object.keys(manifest.inputs)) {
    const words = JSON.parse(read(`${name}/words.json`));
    for (const engine of manifest.engines as string[]) {
      const dir = `${name}/${engine.replace(":", "-")}`;
      const findings: CaptionFinding[] = JSON.parse(read(`${dir}/findings.json`));
      test(`${dir}: only findings with gaps change`, () => {
        const off = buildCaptions(words, findings, { prefs: OLD });
        const on = buildCaptions(words, findings);
        expect(on.length).toBe(off.length);
        const gapIds = new Set(findings.filter((f) => f.commentaryGaps?.length).map((f) => f.id));
        on.forEach((c, k) => {
          expect({ ...c, displayText: "", text: "" }).toEqual({ ...off[k], displayText: "", text: "" });
          if (!gapIds.has(c.findingId as string)) expect(c.displayText).toBe(off[k].displayText);
        });
        // every finding with a gap that is shown as a quote shows the gap outside the brackets (a finding that
        // starts inside an earlier one has no caption of its own, as in the old app)
        for (const f of findings.filter((x) => gapIds.has(x.id))) {
          const caps = on.filter((c) => c.findingId === f.id);
          if (caps.length) expect(caps.some((c) => /[»﴾〗] \[/.test(c.displayText))).toBe(true);
        }
      });
    }
  }

  test("a real hadith with a gap (Tirmidhi 757, yt_ExkaemlknP4 v5) in the text export", () => {
    const words = JSON.parse(read("yt_ExkaemlknP4/words.json"));
    const findings = JSON.parse(read("yt_ExkaemlknP4/v5/findings.json"));
    const f = findings.find((x: CaptionFinding) => x.unitId === "Tirmidhi:757");
    const w = (a: number, b: number) => words.slice(a, b).map((x: { word: string }) => x.word).join(" ");
    const txt = formattedText(words, findings, "plain");
    expect(txt).toContain(`«${w(357, 371)}» [${w(371, 377)}] «${w(377, 408)}» [${f.displayRef}]`);
  });
});

// ---- the three commentary-gap cases (ROADMAP phase 16) -------------------------------------------------------------

const timed = (text: string) => text.split(" ").map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.3 }));

describe("commentary gaps", () => {
  // 0     1     2     3       4       5    6     7      8   9     10  11
  const hadithWords = timed("قال النبي إنما الأعمال بالنيات يعني القصد وإنما لكل امرئ ما نوى");
  const hadith = {
    id: "h", sourceType: "HADITH", type: "hadith", unitId: "Bukhari:1", displayRef: "صحيح البخاري (1)",
    wordStartIdx: 2, wordEndIdx: 11, segments: [[2, 5], [7, 12]], commentaryGaps: [[5, 7]],
  };

  test("a hadith with a gap: «part one» [commentary] «part two» [ref]", () => {
    const want = "«إنما الأعمال بالنيات» [يعني القصد] «وإنما لكل امرئ ما نوى» [صحيح البخاري (1)]";
    expect(formattedText(hadithWords, [hadith], "plain")).toBe(`قال النبي ${want}`);
    expect(buildCaptions(hadithWords, [hadith]).map((c) => c.displayText)).toEqual(["قال النبي", want]);
    expect(formattedText(hadithWords, [hadith], "markdown"))
      .toBe("قال النبي **«إنما الأعمال بالنيات»** [يعني القصد] **«وإنما لكل امرئ ما نوى»** * [صحيح البخاري (1)]*");
  });

  test("turned off, the commentary stays inside the brackets (the old app)", () => {
    expect(formattedText(hadithWords, [hadith], "plain", { prefs: OLD }))
      .toBe("قال النبي «إنما الأعمال بالنيات يعني القصد وإنما لكل امرئ ما نوى» [صحيح البخاري (1)]");
  });

  test("a hadith with a gap and an embedded verse: the verse keeps its own brackets inside its part", () => {
    // 0   1     2   3      4      5    6      7    8    9     10   11   12
    const words = timed("قال النبي ثم قرأ وما خلقت الجن والإنس إلا ليعبدون أي ليوحدون فاعبدوه");
    const f = {
      id: "e", sourceType: "HADITH", type: "hadith", unitId: "Muslim:9", displayRef: "صحيح مسلم (9)",
      wordStartIdx: 2, wordEndIdx: 12, segments: [[2, 10], [12, 13]], commentaryGaps: [[10, 12]],
      embeddedQuran: [{ tStart: 4, tEnd: 10, unitId: "51:56", displayRef: "الذاريات: 56" }],
    };
    const want = "«ثم قرأ ﴿وما خلقت الجن والإنس إلا ليعبدون﴾» [أي ليوحدون] «فاعبدوه» [صحيح مسلم (9)]";
    expect(formattedText(words, [f], "plain")).toBe(`قال النبي ${want}`);
    expect(buildCaptions(words, [f])[1].displayText).toBe(want);
  });

  test("a verse with a gap: ﴿part one﴾ [commentary] ﴿part two﴾ [ref], in the source text when snapped", () => {
    // 0   1    2    3   4   5    6    7   8
    const words = timed("قال تعالى قل هو الله يعني ربنا أحد ثم");
    const f = {
      id: "q", sourceType: "QURAN", type: "ayah", unitId: "112:1", displayRef: "الإخلاص: 1",
      wordStartIdx: 2, wordEndIdx: 7, segments: [[2, 5], [7, 8]], commentaryGaps: [[5, 7]],
      canonicalSegments: ["قُلْ هُوَ اللَّهُ", "أَحَدٌ"], canonicalText: "قُلْ هُوَ اللَّهُ أَحَدٌ",
    };
    expect(formattedText(words, [f], "plain")).toBe("قال تعالى ﴿قل هو الله﴾ [يعني ربنا] ﴿أحد﴾ [الإخلاص: 1] ثم");
    expect(formattedText(words, [{ ...f, snappedToCanonical: true }], "plain"))
      .toBe("قال تعالى ﴿قُلْ هُوَ اللَّهُ﴾ [يعني ربنا] ﴿أَحَدٌ﴾ [الإخلاص: 1] ثم");
    expect(buildCaptions(words, [f], { standardScript: true })[1].displayText)
      .toBe("﴿قُلْ هُوَ اللَّهُ﴾ [يعني ربنا] ﴿أَحَدٌ﴾ [الإخلاص: 1]");
  });
});

// ---- export options ------------------------------------------------------------------------------------------------

describe("export options", () => {
  const words = timed("قال الله تعالى قل هو الله أحد ثم قال");
  const verse = { id: 7, sourceType: "QURAN", unitId: "112:1", displayRef: "الإخلاص: 1", wordStartIdx: 3, wordEndIdx: 6,
    canonicalText: "قُلْ هُوَ اللَّهُ أَحَدٌ" };

  test("the verdict filter: a hidden finding's words stay, as speech", () => {
    const out = exportLecture({ format: "txt", words, findings: [verse], visibleIds: [] }).content;
    expect(out).toBe(words.map((w) => w.word).join(" "));
    expect(exportLecture({ format: "txt", words, findings: [verse], visibleIds: [7] }).content).toContain("﴿قل هو الله أحد﴾");
  });

  test("standard script shows the source text in the captions and the text", () => {
    expect(exportLecture({ format: "srt", words, findings: [verse], standardScript: true }).content).toContain("﴿قُلْ هُوَ اللَّهُ أَحَدٌ﴾");
    expect(exportLecture({ format: "txt", words, findings: [verse], standardScript: true }).content).toContain("﴿قُلْ هُوَ اللَّهُ أَحَدٌ﴾");
  });

  test("JSON and HTML", () => {
    const json = JSON.parse(exportLecture({ format: "json", words, findings: [verse], title: "t", exportedAt: "2026-11-06T00:00:00Z" }).content);
    expect(json).toMatchObject({ title: "t", exportedAt: "2026-11-06T00:00:00Z", full_text: words.map((w) => w.word).join(" ") });
    expect(json.captions[1].displayText).toBe("﴿قل هو الله أحد﴾ [الإخلاص: 1]");
    const html = exportLecture({ format: "html", words, findings: [verse], title: "<t>" }).content;
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("&lt;t&gt;");
    expect(html).toContain('<span class="citation-ayah">﴿قل هو الله أحد﴾ [الإخلاص: 1]</span>');
  });
});

// ---- the caption timing editor ---------------------------------------------------------------------------------------

describe("caption edits", () => {
  const words = timed("بسم الله نبدأ درسنا قل هو الله أحد ثم نكمل الكلام اليوم");
  const verse = { id: 1, sourceType: "QURAN", unitId: "112:1", displayRef: "الإخلاص: 1", wordStartIdx: 4, wordEndIdx: 7 };
  const caps = buildCaptions(words, [verse]);

  test("split a speech caption at a word: the second starts at that word's time", () => {
    const out = applyCaptionEdits(caps, words, [{ op: "split", word: 2 }]);
    expect(out.map((c) => c.text)).toEqual(["بسم الله", "نبدأ درسنا", "قل هو الله أحد", "ثم نكمل الكلام اليوم"]);
    expect(out[1].start).toBe(words[2].start);
    expect(out.map((c) => c.index)).toEqual([1, 2, 3, 4]);
  });

  test("merge two speech captions, nudge a time; a quote is a locked unit", () => {
    const split = applyCaptionEdits(caps, words, [{ op: "split", word: 2 }, { op: "merge", word: 2 }]);
    expect(split.map((c) => c.text)).toEqual(caps.map((c) => c.text));
    const timedOut = applyCaptionEdits(caps, words, [{ op: "time", word: 8, start: 3.0, end: 4.9 }]);
    expect([timedOut[2].start, timedOut[2].end]).toEqual([3, 4.9]);
    expect(checkCaptionEdit(caps, { op: "split", word: 5 })).toBe("locked");
    expect(checkCaptionEdit(caps, { op: "merge", word: 4 })).toBe("locked");
    expect(checkCaptionEdit(caps, { op: "merge", word: 99 })).toBe("none");
    expect(applyCaptionEdits(caps, words, [{ op: "split", word: 5 }])).toEqual(caps);
  });
});
