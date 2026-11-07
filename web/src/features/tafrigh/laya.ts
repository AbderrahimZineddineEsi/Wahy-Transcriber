// F-120: which sentences of a run go to Laya. The old app's quick picks (js/render.js openSaveTafrighRunModal), as a
// pure function so they are tested without the dialog.
import { labelSource, modelConfidence, type Segment } from "./labels";

export type QuickPick = "all" | "none" | "invert" | "human" | "corrected" | "confident" | "no_review";
export const QUICK_PICKS: QuickPick[] = ["all", "none", "invert", "human", "corrected", "confident", "no_review"];
export const CONFIDENT = 0.85;

/** The first choice: what was saved before, else every sentence that is not waiting for review (uncertain labels
 *  make poor training data). */
export function initialPick(segments: Segment[], needsReview: Set<string>, saved: string[] | null | undefined): Set<string> {
  if (saved && saved.length) return new Set(saved);
  return new Set(segments.filter((s) => !needsReview.has(s.id)).map((s) => s.id));
}

export function quickPick(kind: QuickPick, segments: Segment[], picked: Set<string>, needsReview: Set<string>): Set<string> {
  const ids = (keep: (s: Segment) => boolean) => new Set(segments.filter(keep).map((s) => s.id));
  switch (kind) {
    case "all":
      return ids(() => true);
    case "none":
      return new Set();
    case "invert":
      return ids((s) => !picked.has(s.id));
    case "human":
      return ids((s) => labelSource(s) !== "model");
    case "corrected":
      return ids((s) => labelSource(s) === "human_corrected");
    case "confident":
      return ids((s) => labelSource(s) !== "model" || (modelConfidence(s) ?? 0) >= CONFIDENT);
    case "no_review":
      return new Set([...picked].filter((id) => !needsReview.has(id)));
  }
}

/** How many of the chosen sentences each kind of labeller gave. */
export function countBySource(segments: Segment[], picked: Set<string>): Record<"model" | "human_confirmed" | "human_corrected", number> {
  const out = { model: 0, human_confirmed: 0, human_corrected: 0 };
  for (const s of segments) if (picked.has(s.id)) out[labelSource(s)]++;
  return out;
}
