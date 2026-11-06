// Which findings a pass sends (F-084), as plain functions: the scope presets, the search/kind/verdict filters of
// the list, and "none" / "invert". No React here, so it is tested with plain inputs (selection.test.ts).
import { normalizeArabic, type Kind, type VerdictKey, type ViewFinding } from "../lectures/view/model";

export type Scope = "HADITH_AND_CANDIDATES" | "HADITH_ONLY" | "ALL";
export const SCOPES: Scope[] = ["HADITH_AND_CANDIDATES", "HADITH_ONLY", "ALL"];

/** The same rule as the server's `in_scope` (verification/service.py): the default scope is every hadith and
 *  every finding the engine itself doubts (a candidate or ambiguous band, or a score under 15). The pass sends
 *  explicit finding ids, so a mistake here would send the wrong findings; the test pins the rule. */
export function inScope(f: ViewFinding, scope: Scope): boolean {
  if (scope === "ALL") return true;
  if (scope === "HADITH_ONLY") return f.kind === "hadith";
  const band = String(f.data.confidenceBand ?? "").toUpperCase();
  const score = typeof f.data.totalScore === "number" ? f.data.totalScore : 0;
  return f.kind === "hadith" || band === "CANDIDATE" || band === "AMBIGUOUS" || score < 15;
}

export const idsInScope = (findings: readonly ViewFinding[], scope: Scope): number[] =>
  findings.filter((f) => f.id !== null && inScope(f, scope)).map((f) => f.id!);

export type ListFilter = { query: string; kind: "all" | Kind; verdict: "all" | VerdictKey };
export const NO_FILTER: ListFilter = { query: "", kind: "all", verdict: "all" };

/** The rows the list shows. `text` gives a finding's words, which the search also reads. */
export function visibleRows(findings: readonly ViewFinding[], filter: ListFilter, text: (f: ViewFinding) => string): ViewFinding[] {
  const q = normalizeArabic(filter.query);
  return findings.filter((f) => {
    if (f.id === null) return false;
    if (filter.kind !== "all" && f.kind !== filter.kind) return false;
    if (filter.verdict !== "all" && f.verdict !== filter.verdict) return false;
    return !q || normalizeArabic(`${f.ref} ${text(f)}`).includes(q);
  });
}

/** Tick every shown row (the rest keep their state). */
export function selectShown(picked: ReadonlySet<number>, shown: readonly ViewFinding[]): Set<number> {
  const next = new Set(picked);
  for (const f of shown) next.add(f.id!);
  return next;
}

/** Untick every shown row. */
export function selectNone(picked: ReadonlySet<number>, shown: readonly ViewFinding[]): Set<number> {
  const next = new Set(picked);
  for (const f of shown) next.delete(f.id!);
  return next;
}

/** Flip every shown row. */
export function invert(picked: ReadonlySet<number>, shown: readonly ViewFinding[]): Set<number> {
  const next = new Set(picked);
  for (const f of shown) {
    if (next.has(f.id!)) next.delete(f.id!);
    else next.add(f.id!);
  }
  return next;
}

export function toggle(picked: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The scope the ticked set equals exactly, or null when it was picked by hand. */
export function scopeOf(findings: readonly ViewFinding[], picked: ReadonlySet<number>): Scope | null {
  for (const scope of SCOPES) {
    const ids = idsInScope(findings, scope);
    if (ids.length === picked.size && ids.every((id) => picked.has(id))) return scope;
  }
  return null;
}
