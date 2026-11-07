// How a training row is named on screen: where it came from (its lineage), its answer and its boundary. Pure
// helpers, so the rules are tested without a screen.
import type { MessageKey } from "../../shell/i18n";
import { TAG_KEYS } from "../tafrigh/labels";
import type { TrainingRow } from "./api";

const CHIP: Record<string, "ok" | "bad" | "unsure"> = { CORRECT: "ok", FALSE: "bad", NOT_SURE: "unsure" };

/** A verdict as the verdict-chip class (none: no verdict, or not a verdict at all). */
export const chipOf = (verdict: string | null | undefined): "ok" | "bad" | "unsure" | "none" => (verdict ? (CHIP[verdict] ?? "none") : "none");

const BOUNDARY: Record<string, MessageKey> = {
  COMPLETE: "boundary.complete",
  MISSING_START: "boundary.missStart",
  MISSING_END: "boundary.missEnd",
  MISSING_BOTH: "boundary.missBoth",
  EXTRA_START: "boundary.extraStart",
  EXTRA_END: "boundary.extraEnd",
};
export const boundaryKey = (b: string | null | undefined): MessageKey | null => (b ? (BOUNDARY[b] ?? null) : null);

const ACTION: Record<string, MessageKey> = {
  SET: "train.how.set",
  VALIDATE_ALL: "train.how.approval",
  ORDINARY_SPEECH: "train.how.deleted",
  MISSED_QUOTE: "train.how.missed",
  human_confirmed: "train.how.confirmed",
  human_corrected: "train.how.corrected",
  model: "train.how.model",
};

/** Where the row came from: the origin and, when known, how (the user's action, or who labelled a Tafrigh row). */
export function lineage(row: Pick<TrainingRow, "origin" | "action" | "gold" | "provider">): { origin: MessageKey; how: MessageKey | null; provider: string | null } {
  const origin: MessageKey = {
    user: "train.origin.user",
    legacy: row.gold ? "train.origin.legacyGold" : "train.origin.legacyAi",
    tafrigh: "train.origin.tafrigh",
    ai: "train.origin.ai",
  }[row.origin] as MessageKey;
  const how = row.action ? (ACTION[row.action] ?? null) : null;
  const provider = row.origin === "ai" || (row.origin === "legacy" && !row.gold) ? (row.provider ?? null) : null;
  return { origin, how, provider };
}

/** A Tafrigh example's answer: "heading_2_seg_4" is a heading of level 2; "split" / "no split" for split rows. */
export function tafrighAnswerKey(answer: string | null | undefined): { key: MessageKey | null; level: number | null } {
  if (!answer) return { key: null, level: null };
  if (answer === "split") return { key: "train.split.yes", level: null };
  if (answer === "no split") return { key: "train.split.no", level: null };
  const heading = /^heading_(\d+)_/.exec(answer);
  if (heading) return { key: "tfg.tag.heading", level: Number(heading[1]) };
  return { key: TAG_KEYS[answer] ?? null, level: null };
}
