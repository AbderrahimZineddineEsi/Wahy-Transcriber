// search(): corpus search for the reference picker (F-061), moved from the old app's js/corpus-loader.js
// searchCorpusUnits. Same matching, same order (the engine's units in corpus order), same limit.
import { matcherFor } from "./detect.ts";
import { isCitationOrIsnadWord, isLowSpecWord, normalizeArabic, wordMatchQuality } from "./v3.js";
import type { DetectOptions, SourceType } from "./types.ts";

export interface SearchOptions extends DetectOptions {
  /** "ALL" (default) or one source type */
  kind?: "ALL" | SourceType;
  /** default 30 */
  limit?: number;
}

/** One corpus unit (an ayah, a hadith, a dhikr or a custom quote) as the engine knows it. */
export interface SearchHit {
  unitId: string;
  sourceType: SourceType;
  displayRef: string;
  fullText: string;
}

/**
 * Units whose reference or id contains `text`, or whose text contains it (normalised, so diacritics and alef forms
 * don't matter). An empty `text` lists the first units.
 */
export function search(text: string, options: SearchOptions): SearchHit[] {
  const { kind = "ALL", limit = 30 } = options;
  if (kind !== "ALL" && kind !== "QURAN" && kind !== "HADITH" && kind !== "ADHKAR") {
    throw new Error(`unknown kind "${kind}" (ALL, QURAN, HADITH or ADHKAR)`);
  }
  const qRaw = String(text || "").trim();
  const qNorm = normalizeArabic(qRaw);
  const results: SearchHit[] = [];

  for (const unit of matcherFor(options).units.values()) {
    if (kind !== "ALL" && unit.sourceType !== kind) continue;
    if (!qNorm) {
      results.push(hit(unit));
      if (results.length >= limit) break;
      continue;
    }
    const normJoined = (unit.normWords || []).join(" ");
    const refMatch = String(unit.displayRef || "").includes(qRaw) || String(unit.unitId || "").toLowerCase().includes(qRaw.toLowerCase());
    if (refMatch || normJoined.includes(qNorm) || String(unit.fullText || "").includes(qRaw)) {
      results.push(hit(unit));
      if (results.length >= limit) break;
    }
  }
  return results;
}

function hit(unit: any): SearchHit {
  return { unitId: unit.unitId, sourceType: unit.sourceType, displayRef: unit.displayRef, fullText: unit.fullText };
}

export interface SuggestOptions extends DetectOptions {
  /** which units to rank: QURAN (default), HADITH (custom quotes too) or ADHKAR */
  kind?: SourceType;
  /** what the user typed in the search box, if anything */
  query?: string;
  /** default 30 */
  limit?: number;
}

/** One ranked unit for a missed quote, with its words and which of them the selected words match. */
export interface Suggestion extends SearchHit {
  score: number;
  /** the unit's (vocalised) words, as the full-matn preview shows them */
  words: string[];
  /** positions in `words` that one of the selected words matches */
  matched: number[];
}

/**
 * The closest references for a missed quote (F-052): the old editor's updateFnStudioSuggestions and
 * renderFnSelectedUnitPreview, moved here because they need the engine's units and word weights (IDF).
 * Every selected word found in a unit adds its weight, two selected words found together add a bonus, and the typed
 * query adds a fixed score when it is in the unit's reference or text. Best first; units that score 0 come last.
 */
export function suggest(selected: string[], options: SuggestOptions): Suggestion[] {
  const { kind = "QURAN", query = "", limit = 30 } = options;
  if (kind !== "QURAN" && kind !== "HADITH" && kind !== "ADHKAR") {
    throw new Error(`unknown kind "${kind}" (QURAN, HADITH or ADHKAR)`);
  }
  const matcher: any = matcherFor(options);
  const pool: any[] = kind === "QURAN" ? matcher.quranUnits : kind === "ADHKAR" ? matcher.adhkarUnits : matcher.hadithUnits;
  const searchQ = String(query || "").trim();
  const searchNorm = normalizeArabic(searchQ);
  const selNorms = selected.map((w) => normalizeArabic(String(w || "")));

  const scored = (pool || []).map((u: any) => {
    let sc = 0;
    const matnNormStr = (u.normWords || []).join(" ");
    if (searchQ) {
      if (String(u.displayRef || "").includes(searchQ) || String(u.unitId || "").includes(searchQ)) sc += 65;
      if (matnNormStr.includes(searchNorm)) sc += 80;
      else if (String(u.fullText || "").includes(searchQ) || normalizeArabic(u.fullText || "").includes(searchNorm)) sc += 40;
    }
    for (let i = 0; i < selNorms.length; i++) {
      const nw = selNorms[i];
      if (nw.length < 3 || isLowSpecWord(nw) || isCitationOrIsnadWord(nw)) continue;
      if (u.normWords && u.normWords.includes(nw)) {
        sc += matcher.getIdf(nw) * 2.5;
        if (i + 1 < selNorms.length && matnNormStr.includes(`${nw} ${selNorms[i + 1]}`)) sc += 18;
      }
    }
    return { u, sc };
  });
  scored.sort((a: { sc: number }, b: { sc: number }) => b.sc - a.sc); // stable: ties keep corpus order

  const selSet = new Set(selNorms.filter((w) => w.length >= 2));
  return scored.slice(0, Math.max(1, limit)).map(({ u, sc }: { u: any; sc: number }) => {
    const words: string[] = u.vocalizedWords?.length ? u.vocalizedWords : String(u.fullText || "").split(/\s+/).filter(Boolean);
    const matched: number[] = [];
    words.forEach((vw, idx) => {
      const nw = (u.normWords && u.normWords[idx]) || normalizeArabic(vw);
      if (selSet.has(nw) || [...selSet].some((sw) => sw.length >= 4 && wordMatchQuality(sw, nw) >= 0.85)) matched.push(idx);
    });
    return { ...hit(u), score: Math.round(sc * 100) / 100, words, matched };
  });
}
