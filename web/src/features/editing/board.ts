// The editor's state as plain data and pure functions: the word board's selection (a reducer), which finding each
// word belongs to, the board's chunks, a finding's neighbours (for merging) and its matching references. No React
// here, so all of it is tested with plain inputs (board.test.ts).
import type { ViewFinding, Word } from "../lectures/view/model";
import type { SourceType } from "./api";

// ---- the selection (F-051) ----------------------------------------------------------------------------------------

/** What the board has selected. At most one of `range` and `finding` drives the inspector: a range opens the
 *  missed-quote studio, a finding opens the quote inspector. `anchor` is the first click of a two-click range. */
export type BoardState = {
  anchor: number | null;
  /** the word under the pointer while an anchor is set: the range it would make is previewed */
  hover: number | null;
  /** first and last word, inclusive */
  range: [number, number] | null;
  /** the database id of the finding in the inspector */
  finding: number | null;
  /** the kind the studio opens with ("+ verse", "+ hadith", "+ dhikr"); null: the studio guesses */
  kind: SourceType | null;
};

export const EMPTY: BoardState = { anchor: null, hover: null, range: null, finding: null, kind: null };

export type BoardAction =
  /** a click on word `i`; `findingId` is the finding the word belongs to, if any */
  | { type: "click"; i: number; findingId: number | null }
  | { type: "hover"; i: number | null }
  /** a drag from one word to another (always a range, also over findings) */
  | { type: "drag"; from: number; to: number }
  /** the studio's editable start and end (clamped to the lecture) */
  | { type: "setRange"; start: number; end: number; count: number }
  | { type: "kind"; kind: SourceType | null }
  | { type: "selectFinding"; id: number | null }
  | { type: "clear" };

const ordered = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "click": {
      const { i, findingId } = action;
      // nothing being selected: a click on a quote opens it in the inspector
      if (state.anchor === null && state.range === null && findingId !== null) return { ...EMPTY, finding: findingId };
      // a third click starts a new range from that word
      if (state.range !== null) return { ...state, range: null, anchor: i, hover: null, kind: null };
      if (state.anchor === null) return { ...state, anchor: i, hover: null };
      return { ...state, range: ordered(state.anchor, i), anchor: null, hover: null };
    }
    case "hover":
      if (state.anchor === null || state.hover === action.i) return state;
      return { ...state, hover: action.i };
    case "drag":
      return { ...state, range: ordered(action.from, action.to), anchor: null, hover: null };
    case "setRange": {
      const last = Math.max(0, action.count - 1);
      const clamp = (x: number) => Math.max(0, Math.min(last, Math.round(Number.isFinite(x) ? x : 0)));
      return { ...state, range: ordered(clamp(action.start), clamp(action.end)), anchor: null, hover: null };
    }
    case "kind":
      return { ...state, kind: action.kind };
    case "selectFinding":
      return { ...EMPTY, finding: action.id };
    case "clear":
      return { ...state, anchor: null, hover: null, range: null, kind: null };
  }
}

/** The words lit on the board: the chosen range, or the range the pointer would make (a preview). */
export function litRange(state: BoardState): { lo: number; hi: number; preview: boolean } | null {
  if (state.range) return { lo: state.range[0], hi: state.range[1], preview: false };
  if (state.anchor !== null && state.hover !== null) {
    const [lo, hi] = ordered(state.anchor, state.hover);
    return { lo, hi, preview: true };
  }
  return null;
}

// ---- words and findings -------------------------------------------------------------------------------------------

/** For each word, the index (in `findings`) of the finding it belongs to, or -1. Of two overlapping findings the
 *  first one wins, as in the transcript and the captions. */
export function findingAtWord(count: number, findings: readonly ViewFinding[]): Int32Array {
  const at = new Int32Array(count).fill(-1);
  findings.forEach((f, k) => {
    for (let i = Math.max(0, f.start); i <= Math.min(count - 1, f.end); i++) if (at[i] < 0) at[i] = k;
  });
  return at;
}

/** The findings that can be edited (the live ones, with a database id), in word order. */
export function editable(findings: readonly ViewFinding[]): ViewFinding[] {
  return findings.filter((f) => f.id !== null).sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The finding `delta` steps away from `id`, going round at the ends (the inspector's previous / next). */
export function stepFinding(list: readonly ViewFinding[], id: number | null, delta: number): number | null {
  if (!list.length) return null;
  const k = list.findIndex((f) => f.id === id);
  const from = k < 0 ? (delta > 0 ? -1 : 0) : k;
  return list[(((from + delta) % list.length) + list.length) % list.length].id;
}

/** The board in chunks the browser can skip drawing when they are off screen (content-visibility), so a 2-hour
 *  lecture stays light. A chunk ends after a long pause once it has 40 words, and at 160 words at the latest; it
 *  never ends inside a finding. */
export function boardChunks(words: readonly Word[], at: Int32Array): { first: number; last: number }[] {
  const chunks: { first: number; last: number }[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const size = i - first + 1;
    const next = words[i + 1];
    if (!next) break;
    const inside = at[i] >= 0 && at[i] === at[i + 1];
    if (inside) continue;
    if ((size >= 40 && next.start - words[i].end >= 1.2) || size >= 160) {
      chunks.push({ first, last: i });
      first = i + 1;
    }
  }
  if (words.length) chunks.push({ first, last: words.length - 1 });
  return chunks;
}

// ---- merging (F-063) ----------------------------------------------------------------------------------------------

/** As in the old app (MERGE_MAX_GAP_WORDS): a neighbour further than this is not offered for merging. */
export const MERGE_MAX_GAP = 12;

export type Neighbour = {
  direction: "previous" | "next";
  f: ViewFinding;
  gapWords: number;
  gapText: string;
  /** a verifier suggested this merge (and how it read the words between) */
  suggested: { confidence: number; gapType: "PART_OF_QUOTE" | "COMMENTARY" } | null;
  dismissed: boolean;
};

type MergeDetails = { previous?: boolean; next?: boolean; previous_id?: number | null; next_id?: number | null; confidence?: number; gap_type?: string };

const mergeOf = (f: ViewFinding): MergeDetails | null => {
  const details = (f.details ?? null) as { merge?: MergeDetails | null } | null;
  return details?.merge ?? null;
};

/** The finding's previous and next neighbours within the gap limit, each with the verifier's merge suggestion for
 *  that pair (stored on either of the two findings) and whether the user dismissed it. */
export function neighbours(list: readonly ViewFinding[], f: ViewFinding, words: readonly Word[]): Neighbour[] {
  const k = list.findIndex((x) => x.id === f.id);
  if (k < 0) return [];
  const out: Neighbour[] = [];
  const dismissed = Array.isArray(f.data.mergeDismissed) ? (f.data.mergeDismissed as string[]) : [];
  for (const direction of ["previous", "next"] as const) {
    const nb = list[direction === "previous" ? k - 1 : k + 1];
    if (!nb) continue;
    const [a, b] = direction === "previous" ? [nb, f] : [f, nb];
    const gapWords = Math.max(0, b.start - a.end - 1);
    if (gapWords > MERGE_MAX_GAP || b.start <= a.end) continue;
    const own = mergeOf(f);
    const theirs = mergeOf(nb);
    const opposite = direction === "previous" ? "next" : "previous";
    const hit =
      own && own[direction] && own[`${direction}_id`] === nb.id ? own : theirs && theirs[opposite] && theirs[`${opposite}_id`] === f.id ? theirs : null;
    out.push({
      direction,
      f: nb,
      gapWords,
      gapText: words
        .slice(a.end + 1, b.start)
        .map((w) => w.text)
        .join(" "),
      suggested: hit ? { confidence: hit.confidence ?? 0.75, gapType: hit.gap_type === "COMMENTARY" ? "COMMENTARY" : "PART_OF_QUOTE" } : null,
      dismissed: dismissed.includes(direction),
    });
  }
  return out;
}

// ---- references (F-061) -------------------------------------------------------------------------------------------

export type Candidate = { unitId: string; ref: string; text: string; manual: boolean };

/** The finding's matching references, its own first. The engine keeps them in `candidates` once the user has
 *  edited them; before that they are the detection's `candidateUnitIds` / `candidateRefs`. */
export function candidatesOf(f: ViewFinding): Candidate[] {
  const own = String(f.data.unitId ?? "");
  const saved = f.data.candidates;
  let list: Candidate[];
  if (Array.isArray(saved)) {
    list = (saved as { unitId?: string; displayRef?: string; text?: string; addedManually?: boolean }[]).map((c) => ({
      unitId: String(c.unitId ?? ""),
      ref: String(c.displayRef ?? c.unitId ?? ""),
      text: String(c.text ?? ""),
      manual: Boolean(c.addedManually),
    }));
  } else {
    const ids = Array.isArray(f.data.candidateUnitIds) ? f.data.candidateUnitIds : [];
    const refs = f.candidates;
    list = ids.map((id, k) => ({ unitId: String(id), ref: refs[k] ?? String(id), text: "", manual: false }));
  }
  if (own && !list.some((c) => c.unitId === own)) list.unshift({ unitId: own, ref: f.ref, text: "", manual: false });
  return [...list.filter((c) => c.unitId === own), ...list.filter((c) => c.unitId !== own)];
}

/** Arabic letters only, so that a word picked from the source can be compared with a spoken one. */
export const bare = (text: string) => text.replace(/[ً-ٰٟۖ-ۭـ]/g, "").replace(/[إأآٱ]/g, "ا");
