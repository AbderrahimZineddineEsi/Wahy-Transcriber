// search(): corpus search for the reference picker (F-061), moved from the old app's js/corpus-loader.js
// searchCorpusUnits. Same matching, same order (the engine's units in corpus order), same limit.
import { matcherFor } from "./detect.ts";
import { normalizeArabic } from "./v3.js";
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
