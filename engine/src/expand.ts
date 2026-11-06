// expand(): grow a finding whose start or end a verifier says is missing (ROADMAP phase 14). The old editor's
// autoHealClippedBoundary (js/editor.js), moved with its logic unchanged: look at up to 10 transcript words before
// (or after) the finding, and take in each one that matches one of the corpus words just before (or after) the
// matched part. Going left stops at a citation or isnad word («قال», «عن», ...), so a cue is never swallowed.
// Then the finding is one segment and its canonical words are re-aligned (recomputeCanonicalForDetection).
//
// Changes from the old function: the finding, words, boundary and engine options are arguments; it returns a changed
// copy (the input is not touched) instead of editing the page's state, toasts and undo; when no word matched it says
// so and changes nothing (the old one still flattened the segments and marked the boundary complete); and the
// finding's startTime / endTime follow its new first and last word.
import { matcherFor } from "./detect.ts";
import { isCitationOrIsnadWord, normalizeArabic, recomputeCanonicalForDetection, tokenizeText, wordMatchQuality } from "./v3.js";
import type { DetectOptions, Finding, Word } from "./types.ts";

export type ClippedBoundary = "MISSING_START" | "MISSING_END" | "MISSING_BOTH";

export interface ExpandResult {
  /** false when the finding is not linked to a corpus unit (expand it by hand), or no neighbouring word matched */
  changed: boolean;
  /** "no_unit" | "no_match" when nothing changed */
  reason?: string;
  /** the finding with its new wordStartIdx / wordEndIdx / segments and re-aligned canonical words */
  finding: Finding;
  /** words added on each side */
  added: { start: number; end: number };
}

/** The finding grown over the missing words (see the module comment). `boundary` defaults to MISSING_BOTH, as the
 *  old code did for a finding without a verifier's boundary. */
export function expand(
  finding: Finding, words: Word[], boundary: ClippedBoundary | null | undefined, options: DetectOptions,
): ExpandResult {
  const det: any = structuredClone(finding);
  const matcher = matcherFor(options);
  const unit = matcher.units?.get(det.unitId);
  if (!words.length || !unit || !Array.isArray(unit.normWords) || !unit.normWords.length) {
    return { changed: false, reason: "no_unit", finding: det, added: { start: 0, end: 0 } };
  }

  const qSegs = (Array.isArray(det.qSegments) && det.qSegments.length)
    ? det.qSegments
    : [[0, unit.normWords.length]];
  const qStart = Math.max(0, qSegs[0][0]);
  const qEnd = Math.min(unit.normWords.length, qSegs[qSegs.length - 1][1]);

  let newWordStart = det.wordStartIdx;
  let newWordEnd = det.wordEndIdx;
  const bStatus = boundary || "MISSING_BOTH";

  // 1. Heal Prefix (Expand Left) if MISSING_START or MISSING_BOTH
  if ((bStatus === "MISSING_START" || bStatus === "MISSING_BOTH") && qStart > 0) {
    const maxLookback = Math.min(10, qStart, det.wordStartIdx);
    let bestLeftShift = 0;
    for (let step = 1; step <= maxLookback; step++) {
      const prevWordObj = words[det.wordStartIdx - step];
      if (!prevWordObj) break;
      const tWordNorm = normalizeArabic(prevWordObj.word);
      // Check against unmatched prefix window in unit.normWords
      const qWindow = unit.normWords.slice(Math.max(0, qStart - maxLookback - 2), qStart);
      const isMatch = qWindow.some((qw: string) => qw === tWordNorm || wordMatchQuality(tWordNorm, qw) >= 0.72);
      if (isMatch && !isCitationOrIsnadWord(tWordNorm)) {
        bestLeftShift = step;
      } else if (isCitationOrIsnadWord(tWordNorm)) {
        // Stop before "قال رسول الله..." citation cues
        break;
      }
    }
    if (bestLeftShift > 0) newWordStart = Math.max(0, det.wordStartIdx - bestLeftShift);
  }

  // 2. Heal Suffix (Expand Right) if MISSING_END or MISSING_BOTH
  if ((bStatus === "MISSING_END" || bStatus === "MISSING_BOTH") && qEnd < unit.normWords.length) {
    const remainingCorpusWords = unit.normWords.length - qEnd;
    const maxLookahead = Math.min(10, remainingCorpusWords, words.length - 1 - det.wordEndIdx);
    let bestRightShift = 0;
    for (let step = 1; step <= maxLookahead; step++) {
      const nextWordObj = words[det.wordEndIdx + step];
      if (!nextWordObj) break;
      const tWordNorm = normalizeArabic(nextWordObj.word);
      const qWindow = unit.normWords.slice(qEnd, Math.min(unit.normWords.length, qEnd + maxLookahead + 2));
      const isMatch = qWindow.some((qw: string) => qw === tWordNorm || wordMatchQuality(tWordNorm, qw) >= 0.72);
      if (isMatch) bestRightShift = step;
    }
    if (bestRightShift > 0) newWordEnd = Math.min(words.length - 1, det.wordEndIdx + bestRightShift);
  }

  const added = { start: det.wordStartIdx - newWordStart, end: newWordEnd - det.wordEndIdx };
  if (!added.start && !added.end) {
    return { changed: false, reason: "no_match", finding: structuredClone(finding), added };
  }

  det.wordStartIdx = newWordStart;
  det.wordEndIdx = newWordEnd;
  det.segments = [[newWordStart, newWordEnd + 1]];

  // js/state.js syncRawTextFromWords: the transcript text the engine read (each word trimmed, single spaces)
  const rawTokens = tokenizeText(words.map((w) => String(w.word || "").trim()).join(" "));
  if (rawTokens.length && newWordEnd < rawTokens.length) {
    recomputeCanonicalForDetection(det, rawTokens, matcher);
  }
  // the finding's own times follow its new words
  if (words[newWordStart]) det.startTime = words[newWordStart].start;
  if (words[newWordEnd]) det.endTime = words[newWordEnd].end;
  return { changed: true, finding: det, added };
}
