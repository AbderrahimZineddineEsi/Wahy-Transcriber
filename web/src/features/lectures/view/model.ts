// What the lecture view shows, as plain data: findings in the view's own shape, the filters (kind, verdict,
// clipped), and the transcript cut into paragraphs of words and quotes. No React here, so all of it is tested
// with plain inputs (model.test.ts).
import type { CaptionFinding } from "@wahy/engine/captions";
import type { components } from "../../../api/schema";

export type FindingRow = components["schemas"]["FindingOut"];
export type Word = components["schemas"]["WordOut"];

export type Kind = "quran" | "hadith" | "dhikr";
export type VerdictKey = "ok" | "unsure" | "bad" | "none";
export type BoundaryKey = "complete" | "missStart" | "missEnd" | "missBoth" | "extraStart" | "extraEnd";

/** The engine's finding object (what `data` holds); the caption builder reads it as it is. */
export type EngineFinding = CaptionFinding & Record<string, unknown>;

export type ViewFinding = {
  /** stable within one list: the database id for the live findings, the position for a saved version */
  key: string;
  id: number | null;
  kind: Kind;
  /** first and last word, inclusive */
  start: number;
  end: number;
  ref: string;
  candidates: string[];
  ambiguous: boolean;
  verdict: VerdictKey;
  boundary: BoundaryKey | null;
  verifier: string | null;
  model: string | null;
  /** the verdict's confidence (0 to 1) and the rest of the verifier's answer (merge suggestion...) */
  confidence: number | null;
  details: Record<string, unknown> | null;
  canonicalText: string;
  data: EngineFinding;
};

const KIND: Record<string, Kind> = { QURAN: "quran", HADITH: "hadith", ADHKAR: "dhikr" };
const VERDICT: Record<string, VerdictKey> = { CORRECT: "ok", NOT_SURE: "unsure", FALSE: "bad" };
const BOUNDARY: Record<string, BoundaryKey> = {
  COMPLETE: "complete", MISSING_START: "missStart", MISSING_END: "missEnd", MISSING_BOTH: "missBoth", EXTRA_START: "extraStart", EXTRA_END: "extraEnd",
};

export const kindOf = (sourceType: string | undefined): Kind => KIND[sourceType ?? ""] ?? "hadith"; // custom quotes read as hadith

function fromEngine(data: EngineFinding, key: string, id: number | null, verdict?: FindingRow["verdict"]): ViewFinding {
  return {
    key,
    id,
    kind: kindOf(data.sourceType),
    start: data.wordStartIdx,
    end: data.wordEndIdx,
    ref: data.displayRef || data.reference || "",
    candidates: Array.isArray(data.candidateRefs) ? data.candidateRefs : [],
    ambiguous: Boolean(data.isAmbiguous || data.confidenceBand === "AMBIGUOUS"),
    verdict: verdict ? (VERDICT[verdict.verdict] ?? "none") : "none",
    boundary: verdict?.boundary ? (BOUNDARY[verdict.boundary] ?? null) : null,
    verifier: verdict?.verifier ?? null,
    model: verdict?.model ?? null,
    confidence: verdict?.confidence ?? null,
    details: (verdict?.details as Record<string, unknown> | null | undefined) ?? null,
    canonicalText: typeof data.canonicalText === "string" ? data.canonicalText : "",
    data,
  };
}

/** A finding as the server sends it (with its newest verdict). */
export function fromRow(row: FindingRow): ViewFinding {
  const data = { ...(row.data as EngineFinding), wordStartIdx: row.word_start, wordEndIdx: row.word_end };
  return fromEngine(data, `f${row.id}`, row.id, row.verdict);
}

/** A finding kept in a saved lecture version: the engine object, and its verdict when the version has one. */
export function fromSnapshot(data: EngineFinding, i: number, verdict?: FindingRow["verdict"]): ViewFinding {
  return fromEngine(data, `v${i}`, null, verdict);
}

// ---- filters (F-035, F-036, F-037) ---------------------------------------------------------------------------

export type Filter = { kind: "all" | Kind; show: Record<VerdictKey, boolean>; clipped: boolean };

export const ALL_VERDICTS: Record<VerdictKey, boolean> = { ok: true, unsure: true, bad: true, none: true };
export const PRESETS = {
  all: ALL_VERDICTS,
  correct: { ok: true, unsure: false, bad: false, none: false },
  false: { ok: false, unsure: false, bad: true, none: false },
} satisfies Record<string, Record<VerdictKey, boolean>>;
export type PresetKey = keyof typeof PRESETS;

export const DEFAULT_FILTER: Filter = { kind: "all", show: ALL_VERDICTS, clipped: false };

/** A verdict says the start or the end of the quote is missing (a false finding is never "clipped"). */
export const isClipped = (f: ViewFinding) => (f.boundary === "missStart" || f.boundary === "missEnd" || f.boundary === "missBoth") && f.verdict !== "bad";

/** Whether a finding is shown as a quote. A hidden one keeps its words: they show as ordinary speech. */
export function isShown(f: ViewFinding, filter: Filter): boolean {
  if (filter.kind !== "all" && f.kind !== filter.kind) return false;
  if (!filter.show[f.verdict]) return false;
  return !filter.clipped || isClipped(f);
}

export function presetOf(show: Record<VerdictKey, boolean>): PresetKey | null {
  for (const [key, preset] of Object.entries(PRESETS) as [PresetKey, Record<VerdictKey, boolean>][]) {
    if ((Object.keys(preset) as VerdictKey[]).every((v) => preset[v] === show[v])) return key;
  }
  return null;
}

export function counts(words: readonly Word[], findings: readonly ViewFinding[]) {
  const by = (k: Kind) => findings.filter((f) => f.kind === k).length;
  return { words: words.length, quran: by("quran"), hadith: by("hadith"), dhikr: by("dhikr"), clipped: findings.filter(isClipped).length };
}

// ---- the transcript ------------------------------------------------------------------------------------------

export type Script = "spoken" | "standard";

/** One piece of text on screen, and the word it follows in time. `gap`: the speaker's own words between two parts
 *  of the quote (a commentary gap), written outside the quote's brackets. `verse`: the word is in the finding's
 *  embedded Quran verse number `verse` (a verse inside a hadith), which the transcript can set in its own ﴿…﴾. */
export type Token = { text: string; i: number; gap?: boolean; verse?: number };
export type Piece = { type: "word"; i: number } | { type: "quote"; f: ViewFinding; tokens: Token[] };
export type Paragraph = { key: string; first: number; last: number; pieces: Piece[] };

/** token index → word index (the engine counts tokens, and a word can hold several); `identity` when unknown */
export type TokenWords = readonly number[] | null;

/** A finding's token ranges [start, end) as word ranges [first, last]. */
function wordRanges(ranges: unknown, tokWord: TokenWords): [number, number][] {
  if (!Array.isArray(ranges)) return [];
  const w = (t: number) => (tokWord ? (tokWord[t] ?? t) : t);
  return ranges
    .filter((r): r is number[] => Array.isArray(r) && r[1] > r[0])
    .map((r) => [w(r[0]), w(Math.max(r[0], r[1] - 1))] as [number, number]);
}

/** Spread `text`'s words over spoken words a..b, in proportion. */
function spread(text: string[], a: number, b: number): Token[] {
  const n = b - a + 1;
  return text.map((t, j) => ({ text: t, i: a + Math.min(n - 1, Math.floor((j * n) / text.length)) }));
}

/** The words a quote shows. As spoken: its own words. In standard script (F-038), or when the finding was switched
 *  to its source text, the source text, each source word tied to a spoken word in proportion, so the marker still
 *  moves through the quote as it is recited. Commentary gaps keep the speaker's words, marked `gap`. */
export function quoteTokens(words: readonly Word[], f: ViewFinding, script: Script, tokWord: TokenWords = null): Token[] {
  const gaps = wordRanges(f.data.commentaryGaps, tokWord).filter(([s, e]) => e >= f.start && s <= f.end);
  const inGap = (i: number) => gaps.some(([s, e]) => s <= i && i <= e);
  const canonical = script === "standard" || f.data.snappedToCanonical === true;
  const canon = canonical ? f.canonicalText.split(/\s+/).filter(Boolean) : [];
  // embedded verses are marked in the spoken words only (the source text has no verse marks), as in the exports
  const verses = canon.length ? [] : wordRanges((f.data.embeddedQuran ?? []).map((r) => (r ? [r.tStart, r.tEnd] : [])), tokWord);
  const spoken = (a: number, b: number): Token[] => {
    const out: Token[] = [];
    for (let i = a; i <= b; i++) {
      const tok: Token = { text: words[i]?.text ?? "", i };
      if (inGap(i)) tok.gap = true;
      const v = verses.findIndex(([s, e]) => s <= i && i <= e);
      if (v >= 0) tok.verse = v;
      out.push(tok);
    }
    return out;
  };
  if (!canon.length) return spoken(f.start, f.end);
  if (!gaps.length) return spread(canon, f.start, f.end);
  // a quote in parts: each part shows its own source words, the gaps between them the speaker's
  const segs = wordRanges(f.data.segments, tokWord);
  const parts = Array.isArray(f.data.canonicalSegments) ? (f.data.canonicalSegments as unknown[]) : [];
  if (!segs.length || parts.length !== segs.length) return spoken(f.start, f.end);
  const out: Token[] = [];
  let at = f.start;
  segs.forEach(([s, e], k) => {
    const lo = Math.max(s, f.start);
    const hi = Math.min(e, f.end);
    if (lo > hi) return;
    if (lo > at) out.push(...spoken(at, lo - 1));
    const cw = String(parts[k] ?? "").split(/\s+/).filter(Boolean);
    out.push(...(cw.length ? spread(cw, lo, hi) : spoken(lo, hi)));
    at = hi + 1;
  });
  if (at <= f.end) out.push(...spoken(at, f.end));
  return out;
}

const SENTENCE_END = /[.؟?!]["»”]?$/;
/** Paragraph sizes, in words: long enough to read as prose, short enough that the browser can skip drawing
 *  the ones off screen (content-visibility), which keeps a 2-hour lecture light. */
const PARA = { minAtSentence: 40, minAtPause: 15, pause: 1.2, max: 160 };

/** The transcript as paragraphs of words and quotes. `findings` are the shown ones; a finding that starts
 *  inside an earlier one is skipped, and of two that start on the same word the first is kept (the caption
 *  builder does the same, so the transcript and the captions agree). A paragraph never breaks inside a quote. */
export function buildParagraphs(
  words: readonly Word[],
  findings: readonly ViewFinding[],
  script: Script,
  tokWord: TokenWords = null,
): Paragraph[] {
  const byStart = new Map<number, ViewFinding>();
  for (const f of findings) {
    if (f.start < 0 || f.start >= words.length || f.end < f.start) continue;
    if (!byStart.has(f.start)) byStart.set(f.start, f); // the first one wins, as in the caption builder
  }
  const paragraphs: Paragraph[] = [];
  let pieces: Piece[] = [];
  let first = 0;
  let size = 0;
  const close = (last: number) => {
    if (!pieces.length) return;
    paragraphs.push({ key: `p${first}`, first, last, pieces });
    pieces = [];
    size = 0;
    first = last + 1;
  };
  let i = 0;
  while (i < words.length) {
    const f = byStart.get(i);
    let last: number;
    if (f) {
      last = Math.min(words.length - 1, f.end);
      pieces.push({ type: "quote", f, tokens: quoteTokens(words, { ...f, end: last }, script, tokWord) });
    } else {
      last = i;
      pieces.push({ type: "word", i });
    }
    size += last - i + 1;
    const next = words[last + 1];
    const gap = next ? next.start - words[last].end : 0;
    if (
      next &&
      ((size >= PARA.minAtSentence && SENTENCE_END.test(words[last].text)) || (size >= PARA.minAtPause && gap >= PARA.pause) || size >= PARA.max)
    ) {
      close(last);
    }
    i = last + 1;
  }
  close(words.length - 1);
  return paragraphs;
}

// ---- search (F-034) ------------------------------------------------------------------------------------------

/** Arabic for matching: no diacritics or tatweel, one alef, ى as ي, ة as ه, and letters only. */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

/** The words that match a search. One word in the query matches any word containing it; several match a run
 *  of consecutive words (the first ends with the first query word, the last starts with the last, the middle
 *  ones are equal). */
export function searchHits(normWords: readonly string[], query: string): number[] {
  const q = query.split(/\s+/).map(normalizeArabic).filter(Boolean);
  if (!q.length) return [];
  const hits: number[] = [];
  if (q.length === 1) {
    normWords.forEach((w, i) => {
      if (w.includes(q[0])) hits.push(i);
    });
    return hits;
  }
  const last = q.length - 1;
  for (let i = 0; i + last < normWords.length; i++) {
    let ok = normWords[i].endsWith(q[0]) && normWords[i + last].startsWith(q[last]);
    for (let k = 1; ok && k < last; k++) ok = normWords[i + k] === q[k];
    if (ok) for (let k = 0; k <= last; k++) hits.push(i + k);
  }
  return hits;
}
