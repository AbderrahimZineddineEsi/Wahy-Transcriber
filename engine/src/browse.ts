// browse(): read-only paging through the Quran and hadith corpus (F-076). It reads the raw corpus arrays, so it
// never builds a matcher (hundreds of MB): the corpora screen can open at once.
import { normalizeArabic } from "./v3.js";
import type { Corpus } from "./types.ts";

export interface BrowseOptions {
  kind: "QURAN" | "HADITH";
  /** Quran only: one surah number */
  surah?: number;
  /** hadith only: one book id (as in `hadith.book`) */
  book?: string;
  /** reference or text contains this (diacritics and alef forms don't matter) */
  q?: string;
  offset?: number;
  /** default 25, at most 200 */
  limit?: number;
}

export interface BrowseItem {
  id: string;
  ref: string;
  text: string;
  /** surah name or book id */
  group: string;
}

export interface BrowseResult {
  total: number;
  items: BrowseItem[];
  /** the filter choices: surah number → [name, ayat], or book id → hadiths */
  groups: Record<string, [string, number]>;
}

export function browse(corpus: Corpus, options: BrowseOptions): BrowseResult {
  const { kind, surah, book, q = "" } = options;
  if (kind !== "QURAN" && kind !== "HADITH") throw new Error(`unknown kind "${kind}" (QURAN or HADITH)`);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 25)));
  const qRaw = String(q).trim();
  const qNorm = normalizeArabic(qRaw);

  const groups: BrowseResult["groups"] = {};
  const matches: BrowseItem[] = [];
  let total = 0;
  const consider = (item: BrowseItem, groupKey: string, groupName: string, selected: boolean) => {
    const g = (groups[groupKey] ??= [groupName, 0]);
    g[1] += 1;
    if (!selected) return;
    if (qNorm && !(item.ref.includes(qRaw) || item.id.toLowerCase().includes(qRaw.toLowerCase()) ||
        normalizeArabic(item.text).includes(qNorm))) return;
    if (total >= offset && matches.length < limit) matches.push(item);
    total += 1;
  };

  if (kind === "QURAN") {
    for (const a of corpus.ayat as any[]) {
      const name = a.surahName ?? String(a.s);
      consider({ id: `${a.s}:${a.a}`, ref: `${name}: ${a.a}`, text: a.t, group: name }, String(a.s), name,
        surah == null || a.s === surah);
    }
  } else {
    for (const h of corpus.hadiths as any[]) {
      consider({ id: h.id, ref: h.ref ?? h.id, text: h.t, group: h.book ?? "" }, h.book ?? "", h.book ?? "",
        book == null || book === "" || h.book === book);
    }
  }
  return { total, items: matches, groups };
}
