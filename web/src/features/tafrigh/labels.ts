// How a Tafrigh sentence is named and judged on screen. Pure helpers over the server's `structured_json` rows, so the
// rules (who labelled it, what the model was sure of, what a split did) are tested without a screen.
import type { MessageKey } from "../../shell/i18n";

/** One sentence of a run as `structured_json.segments` holds it (the fields the screen reads). */
export type Segment = {
  id: string;
  text: string;
  original_text: string;
  tag: string;
  level: number | null;
  parent_id: string | null;
  comment_kind: string | null;
  review_flags: string[];
  corrected_text: string | null;
  display_text: string;
  cut_reason: string | null;
  start_time: number | null;
  end_time: number | null;
  quotes: { kind: string; ref: string; band?: string }[];
  trace: Trace;
};

type Answer = { choice?: string; confidence?: number; probabilities?: Record<string, number> };
export type Decision = {
  provider?: string;
  model?: string;
  latency_ms?: number;
  answers?: { tag?: Answer; needsSplitting?: Answer; hasTypo?: Answer };
  points_by?: string;
};
export type Trace = {
  decision?: Decision;
  review?: { action?: string };
  edits?: {
    accepted?: { original?: string; replacement?: string; reason?: string }[];
    rejected?: { original?: string; span?: string; replacement?: string; why?: string }[];
  };
  split?: { proposed?: number[]; used?: number[]; points_by?: string; source?: string };
  split_outcome?: { status?: string; why?: string; proposed?: number[]; pieces?: number };
  split_from?: { id?: string; text?: string; piece?: number; pieces?: number; split?: Trace["split"]; decision?: Decision };
};

/** The labels a reviewer can pick; "heading:2" is a heading of level 2. */
export const TAG_OPTIONS: [string, MessageKey][] = [
  ["paragraph", "tfg.tag.paragraph"],
  ["continuation", "tfg.tag.continuation"],
  ["heading:1", "tfg.tag.heading1"],
  ["heading:2", "tfg.tag.heading2"],
  ["heading:3", "tfg.tag.heading3"],
  ["list_intro", "tfg.tag.list_intro"],
  ["list_item", "tfg.tag.list_item"],
  ["comment", "tfg.tag.comment"],
  ["matn_section", "tfg.tag.matn_section"],
];

/** The kinds of quote a sentence holds (the server's names). */
export const KIND_KEYS: Record<string, MessageKey> = {
  quran: "tfg.kind.quran",
  hadith: "tfg.kind.hadith",
  adhkar: "tfg.kind.adhkar",
};

/** The name of each structural tag (a heading has its level in the options above). */
export const TAG_KEYS: Record<string, MessageKey> = {
  paragraph: "tfg.tag.paragraph",
  continuation: "tfg.tag.continuation",
  heading: "tfg.tag.heading",
  list_intro: "tfg.tag.list_intro",
  list_item: "tfg.tag.list_item",
  comment: "tfg.tag.comment",
  matn_section: "tfg.tag.matn_section",
};

/** The option value of a sentence's current label. */
export const tagValue = (s: Pick<Segment, "tag" | "level">): string => (s.tag === "heading" ? `heading:${s.level || 1}` : s.tag);

/** "heading:2" → the fields the review endpoint wants. */
export function parseTag(value: string): { corrected_tag: string; corrected_level: number | null } {
  const [tag, level] = value.split(":");
  return { corrected_tag: tag, corrected_level: level ? Number(level) : null };
}

export type LabelSource = "model" | "human_confirmed" | "human_corrected";

/** Who gave the label now on the sentence (F-118). */
export function labelSource(s: Pick<Segment, "trace">): LabelSource {
  const action = s.trace.review?.action;
  if (action === "confirm") return "human_confirmed";
  if (action === "correct" || action === "revert_edits") return "human_corrected";
  return "model";
}

/** The model's decision for this sentence, or for the longer sentence it was cut from. */
export const decisionOf = (s: Pick<Segment, "trace">): Decision => s.trace.decision ?? s.trace.split_from?.decision ?? {};

/** How sure the model was of the label, 0 to 1 (null: it gave no number). */
export function modelConfidence(s: Pick<Segment, "trace">): number | null {
  const c = decisionOf(s).answers?.tag?.confidence;
  return typeof c === "number" ? c : null;
}

export const percent = (p: number | null | undefined): string => (typeof p === "number" ? `${Math.round(p * 100)}%` : "—");

/** The model's probabilities for the tag, highest first, the ones under 2% left out. */
export function tagProbabilities(s: Pick<Segment, "trace">, limit = 4): [string, number][] {
  const p = decisionOf(s).answers?.tag?.probabilities ?? {};
  return Object.entries(p)
    .filter(([, v]) => v >= 0.02)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

export type SplitInfo =
  | { kind: "piece"; piece: number | null; pieces: number | null; text: string; used: number[]; asker: string | undefined; pointsBy: string | undefined; label: string | undefined }
  | { kind: "skipped"; why: string | undefined; proposed: number[]; asker: string | undefined };

/** What happened about splitting (F-118): this sentence is a piece of a split, or a split was asked for and not
 *  done. Null when splitting is not part of its story. */
export function splitInfo(s: Pick<Segment, "trace">): SplitInfo | null {
  const t = s.trace;
  if (t.split_from) {
    const f = t.split_from;
    return {
      kind: "piece",
      piece: f.piece ?? null,
      pieces: f.pieces ?? null,
      text: f.text ?? "",
      used: f.split?.used ?? [],
      asker: f.decision?.provider,
      pointsBy: f.split?.points_by ?? (f.split?.source === "gemini_split_request" ? "gemini" : undefined),
      label: t.decision?.provider,
    };
  }
  const out = t.split_outcome;
  if (out && out.status !== "applied") return { kind: "skipped", why: out.why, proposed: out.proposed ?? [], asker: t.decision?.provider };
  return null;
}

/** Who asked for the split: the models' own names. */
export function providerName(p: string | undefined): string {
  if (!p) return "";
  return { jev: "JEV", gemini: "Gemini", laya: "Laya" }[p.toLowerCase()] ?? p;
}

/** The sentence's text with a scissors mark before each word where the split cut (the original sentence). */
export function markSplits(text: string, used: number[]): string {
  const cuts = new Set(used);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (cuts.has(i) ? `✂ ${w}` : w))
    .join(" ");
}

/** The reason keys the server gives a review item → message keys (unknown ones are shown as they are). */
export const REASON_KEYS: Record<string, MessageKey | null> = {
  low_confidence: "tfg.reason.low_confidence",
  EDIT_REJECTED: "tfg.reason.EDIT_REJECTED",
  EDIT_CAP_EXCEEDED: "tfg.reason.EDIT_CAP_EXCEEDED",
  SPLIT_VALIDATION_FAILED: "tfg.reason.SPLIT_VALIDATION_FAILED",
  INVALID_TRANSITION_FALLBACK: "tfg.reason.INVALID_TRANSITION_FALLBACK",
  MODEL_ERROR: "tfg.reason.MODEL_ERROR",
  WINDOW_FALLBACK_USED: "tfg.reason.WINDOW_FALLBACK_USED",
  OUTLINE_REPAIR_REVIEW: "tfg.reason.OUTLINE_REPAIR_REVIEW",
  LOW_CONFIDENCE: "tfg.reason.low_confidence",
  FROM_SPLIT: null,
};

export const REJECT_KEYS: Record<string, MessageKey> = {
  char_offsets_without_quoted_original: "tfg.reject.char_offsets_without_quoted_original",
  quoted_original_does_not_match_text: "tfg.reject.quoted_original_does_not_match_text",
  inside_detected_quotation: "tfg.reject.inside_detected_quotation",
  word_index_out_of_range: "tfg.reject.word_index_out_of_range",
  bad_word_index: "tfg.reject.bad_word_index",
  out_of_bounds: "tfg.reject.out_of_bounds",
  no_change: "tfg.reject.no_change",
  replacement_too_different: "tfg.reject.replacement_too_different",
  overlaps_another_edit: "tfg.reject.overlaps_another_edit",
};

export const CUT_KEYS: Record<string, MessageKey> = {
  punctuation: "tfg.cut.punctuation",
  comma: "tfg.cut.comma",
  pause: "tfg.cut.pause",
  length: "tfg.cut.length",
  detection: "tfg.cut.detection",
  end: "tfg.cut.end",
};

export const SPLIT_SKIP_KEYS: Record<string, MessageKey> = {
  too_short: "tfg.split.too_short",
  from_split: "tfg.split.from_split",
  no_points: "tfg.split.no_points",
  inside_quote: "tfg.split.inside_quote",
  invalid: "tfg.split.invalid",
};

/** The next sentence that still needs review after `afterId`, going round to the start (F-119 "next"). */
export function nextToReview(order: readonly string[], flagged: ReadonlySet<string>, afterId: string | null): string | null {
  const from = afterId === null ? -1 : order.indexOf(afterId);
  const rotated = [...order.slice(from + 1), ...order.slice(0, Math.max(0, from))];
  return rotated.find((id) => flagged.has(id) && id !== afterId) ?? null;
}
