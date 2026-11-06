// Test data shared by the lecture view's tests: a 14-word lecture with a verse (words 3-6) and a hadith (10-12).
import type { FindingRow, Word } from "./model";

const text = "قال الله تعالى قل هو الله أحد ثم قال النبي إنما الأعمال بالنيات انتهى";
export const sampleWords: Word[] = text.split(" ").map((w, i) => ({ idx: i, text: w, start: i * 0.5, end: i * 0.5 + 0.4 }));

export function row(over: Partial<FindingRow> & { data?: Record<string, unknown> }): FindingRow {
  const start = over.word_start ?? 3;
  const end = over.word_end ?? 6;
  return {
    id: 1, idx: 0, engine: "v5", source_type: "QURAN", unit_id: "112:1", display_ref: "الإخلاص: 1", word_start: start, word_end: end,
    verdict: null, ...over,
    data: { sourceType: over.source_type ?? "QURAN", unitId: "112:1", displayRef: over.display_ref ?? "الإخلاص: 1", wordStartIdx: start, wordEndIdx: end, canonicalText: "قُلْ هُوَ اللَّهُ أَحَدٌ", ...over.data },
  };
}
