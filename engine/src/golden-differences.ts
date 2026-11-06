// The expected differences between the new exports (commentary split off) and the old app's golden files.
//
// The golden files are never regenerated or edited (they are the old app's output). Where the new app writes
// something else on purpose, the difference is listed here, by hand, and the golden tests apply exactly these
// replacements to the old file before comparing. Each `old` text must occur exactly once in its file, so a list that
// no longer fits the files fails loudly instead of passing quietly.
//
// Today there is one reason: a Quran verse inside a hadith (`embeddedQuran`) gets its own ﴿…﴾ even when the hadith
// has no commentary gap (captions.ts `BRACKET_EMBEDDED_QURAN`, user decision 2026-11-06). Of all the golden inputs and
// engine choices, one finding has such a verse: Muslim 6889 in yt_iG2F8nymm1A, found by v3 (the engine marked words
// 457-461 as the verse, so the bracket closes before «العرش العظيم»). If the decision is reverted, empty this list.

export type GoldenDifference = {
  /** the golden file, relative to engine/golden/expected/ */
  file: string;
  old: string;
  new: string;
};

const MUSLIM_6889_OLD = "«رب السماوات ورب الأرض رب العرش العظيم،»";
const MUSLIM_6889_NEW = "«﴿رب السماوات ورب الأرض رب﴾ العرش العظيم،»";

export const EMBEDDED_VERSE_DIFFERENCES: GoldenDifference[] = [
  "wahy-captions.srt", "wahy-captions.vtt", "wahy-captions.ass", "wahy-lecture.md", "wahy-lecture.txt",
].map((name) => ({ file: `yt_iG2F8nymm1A/v3/${name}`, old: MUSLIM_6889_OLD, new: MUSLIM_6889_NEW }));

/** The golden file `file` (its text `content`) with its listed differences applied. Throws when a listed `old` text
 *  is not in the file exactly once. */
export function expectedGolden(file: string, content: string, list: GoldenDifference[] = EMBEDDED_VERSE_DIFFERENCES): string {
  let out = content;
  for (const d of list.filter((x) => x.file === file)) {
    const count = out.split(d.old).length - 1;
    if (count !== 1) throw new Error(`${file}: the expected difference ${JSON.stringify(d.old)} occurs ${count} times, not once`);
    out = out.replace(d.old, d.new);
  }
  return out;
}
