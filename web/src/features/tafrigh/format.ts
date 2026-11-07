import type { Estimate } from "./api";
import type { Mode, Candidate } from "./settings";

/** The estimate row of the mode a run would use (F-114). */
export function modeRow(estimate: Estimate, mode: Mode, candidate: Candidate): { requests: number; input: number; output: number } {
  const row = candidate === "jev_hybrid" ? estimate.jev : candidate === "laya_hybrid" ? estimate.laya : mode === "windowed" ? estimate.windowed : estimate.per_sentence;
  return rowOf(row);
}

export function rowOf(row: Record<string, unknown>): { requests: number; input: number; output: number } {
  const n = (k: string) => (typeof row[k] === "number" ? (row[k] as number) : 0);
  return { requests: n("requests"), input: n("input_tokens"), output: n("output_tokens") };
}

/** The price of a request row in dollars, when the model's price is known. */
export function rowCost(row: { input: number; output: number }, price: Estimate["price"] | undefined): number | null {
  return price ? row.input * price.prompt_per_token + row.output * price.completion_per_token : null;
}

export const num = (record: Record<string, unknown> | null | undefined, key: string): number => {
  const v = record?.[key];
  return typeof v === "number" ? v : 0;
};

/** "2:05" for 125 seconds; empty for no time. */
export function clock(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}
