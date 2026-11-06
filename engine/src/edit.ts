// edit(): the editor's changes to findings (ROADMAP phase 16), the old editor's functions (js/editor.js) moved here
// with their logic unchanged, because they need the corpus units and the canonical re-alignment
// (recomputeCanonicalForDetection) that live in the engine. The server keeps the edit log and undo (features/editing);
// this module only answers "what does the finding look like after this change".
//
//   add_quote         a missed quote over words start..end with a corpus unit, or outside the corpus with a typed
//                     reference (commitFnQuoteHelper)
//   move_edge         the start or the end moved by some words (adjustFindingWordBoundary)
//   set_kind          verse, hadith or dhikr (changeFindingCategory)
//   snap              show the source text instead of the spoken words, or back (toggleSnapFindingToCanonical)
//   canonical_words   the reference words the user picked become the quote's text (applyReferenceWordsToTranscript)
//   link_reference    another reference: a candidate, a corpus unit from the search, or a typed one
//                     (linkFindingToCorpusUnit); each reference's word edits are kept and come back with it
//   add_candidate / remove_candidate   the finding's list of matching references (addReferenceToFinding, ...)
//   merge             two neighbouring findings into one (mergeFindingWithNeighbor)
//
// Changes from the old functions: the finding, words and engine options are arguments and a changed copy comes back
// (the input is not touched); no toasts, undo or page state; the merge does not touch AI merge suggestions (the
// server keeps those with the verdicts); an outside-corpus quote is not added to the adhkar or hadith lists here.
import { matcherFor } from "./detect.ts";
import { QIRAAT_AR_NAME, getUnitFullWordView, recomputeCanonicalForDetection, tokenizeText } from "./v3.js";
import type { DetectOptions, Finding, Word } from "./types.ts";

export type EditRequest =
  | { op: "add_quote"; start: number; end: number; unitId?: string | null; sourceType?: string; ref?: string; qiraah?: string }
  | { op: "move_edge"; finding: Finding; edge: "start" | "end"; delta: number }
  | { op: "set_kind"; finding: Finding; kind: "ayah" | "hadith" | "dhikr" }
  | { op: "snap"; finding: Finding; on: boolean }
  | { op: "canonical_words"; finding: Finding; indices: number[]; full?: boolean }
  | { op: "link_reference"; finding: Finding; unitId?: string | null; ref?: string }
  | { op: "add_candidate"; finding: Finding; unitId?: string | null; ref?: string }
  | { op: "remove_candidate"; finding: Finding; unitId: string }
  | { op: "merge"; first: Finding; second: Finding; gapType?: "PART_OF_QUOTE" | "COMMENTARY" };

export interface EditResult {
  finding: Finding;
  /** merge: which of the two findings the merged one continues ("first" or "second": the one whose reference
   *  explains more of the merged words); the other one is gone */
  kept?: "first" | "second";
}

export class EditError extends Error {
  name = "EditError";
}

const SLUG: Record<string, string> = { QURAN: "ayah", HADITH: "hadith", ADHKAR: "dhikr" };
const slugOf = (sourceType: string) => SLUG[sourceType] ?? "ayah";
const sourceOf = (slug: string) => (slug === "hadith" ? "HADITH" : slug === "dhikr" ? "ADHKAR" : "QURAN");

/** The finding (or findings) after the change. Throws EditError when the change can't be made. */
export function edit(req: EditRequest, words: Word[], options: DetectOptions): EditResult {
  const matcher = matcherFor(options);
  const ctx = new Ctx(words, matcher);
  switch (req.op) {
    case "add_quote": return { finding: addQuote(ctx, req) };
    case "move_edge": return { finding: moveEdge(ctx, structuredClone(req.finding), req.edge, req.delta) };
    case "set_kind": return { finding: setKind(structuredClone(req.finding), req.kind) };
    case "snap": return { finding: snap(ctx, structuredClone(req.finding), req.on) };
    case "canonical_words": return { finding: canonicalWords(ctx, structuredClone(req.finding), req.indices, Boolean(req.full)) };
    case "link_reference": return { finding: linkReference(ctx, structuredClone(req.finding), req.unitId ?? null, req.ref ?? "") };
    case "add_candidate": return { finding: addCandidate(ctx, structuredClone(req.finding), req.unitId ?? null, req.ref ?? "") };
    case "remove_candidate": return { finding: removeCandidate(ctx, structuredClone(req.finding), req.unitId) };
    case "merge": return merge(ctx, structuredClone(req.first), structuredClone(req.second), req.gapType);
    default: throw new EditError(`unknown edit "${(req as { op: string }).op}"`);
  }
}

/** What every edit needs: the words with their characters (js/state.js syncRawTextFromWords), the engine tokens of
 *  the transcript, and the corpus units. */
class Ctx {
  timed: { word: string; start: number; end: number; char_start: number; char_end: number }[];
  private _tokens: any[] | null = null;
  words: Word[];
  matcher: any;
  constructor(words: Word[], matcher: any) {
    this.words = words;
    this.matcher = matcher;
    let cursor = 0;
    this.timed = words.map((w) => {
      const word = String(w.word || "").trim();
      const out = { word, start: Number(w.start), end: Number(w.end), char_start: cursor, char_end: cursor + word.length };
      cursor = out.char_end + 1;
      return out;
    });
  }
  get tokens(): any[] {
    return (this._tokens ??= tokenizeText(this.timed.map((w) => w.word).join(" ")));
  }
  unit(id: string | null | undefined): any {
    return id ? this.matcher.units?.get(id) ?? null : null;
  }
  recompute(det: any): void {
    if (this.tokens.length && det.wordEndIdx < this.tokens.length) recomputeCanonicalForDetection(det, this.tokens, this.matcher);
  }
  span(a: number, b: number): string {
    return this.timed.slice(a, b + 1).map((w) => w.word).join(" ");
  }
}

function checkSpan(ctx: Ctx, start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= ctx.words.length) {
    throw new EditError(`words ${start}..${end} are not in the lecture (0..${ctx.words.length - 1})`);
  }
}

function addQuote(ctx: Ctx, req: Extract<EditRequest, { op: "add_quote" }>): Finding {
  checkSpan(ctx, req.start, req.end);
  const wordStartIdx = req.start;
  const wordEndIdx = req.end;
  const sIdx = wordStartIdx;
  const eIdx = wordEndIdx + 1;
  const raw = ctx.span(wordStartIdx, wordEndIdx);
  const firstW = ctx.timed[wordStartIdx];
  const lastW = ctx.timed[wordEndIdx];
  const qKey = req.qiraah || "hafs";
  const where = {
    tStart: sIdx, tEnd: eIdx, wordStartIdx, wordEndIdx,
    startIndex: firstW.char_start, endIndex: lastW.char_end, charStart: firstW.char_start, charEnd: lastW.char_end,
    startTime: Number(firstW.start), endTime: Number(lastW.end), matchedText: raw,
  };
  const unit = req.unitId && req.unitId !== "OUTSIDE_CORPUS" ? ctx.unit(req.unitId) : null;
  if (req.unitId && req.unitId !== "OUTSIDE_CORPUS" && !unit) throw new EditError(`no corpus unit ${req.unitId}`);

  if (!unit) {
    const sType = req.sourceType && SLUG[req.sourceType] ? req.sourceType : "QURAN";
    const fallback = sType === "QURAN" ? "آية قرآنية" : sType === "ADHKAR" ? "ذكر مأثور" : "حديث خارج القاعدة";
    const finalRef = (req.ref || "").trim() || fallback;
    const det: any = {
      type: slugOf(sType), sourceType: sType, unitId: "OUTSIDE_CORPUS", displayRef: finalRef, reference: finalRef,
      candidateRefs: [finalRef], candidateUnitIds: ["OUTSIDE_CORPUS"], isAmbiguous: false, isOutsideCorpus: true,
      confidenceBand: "VERIFIED", confidence: 1.0, totalScore: 25.0, hasCitationCue: true, hasFuzzyHeal: false,
      ...where, canonicalText: raw, segments: [[sIdx, eIdx]], qSegments: [[0, eIdx - sIdx]], canonicalSegments: [raw],
      commentaryGaps: [], qiraah: sType === "QURAN" ? qKey : "",
      qiraahDisplay: sType === "QURAN" ? (QIRAAT_AR_NAME[qKey] || "رواية حفص عن عاصم") : "", snappedToCanonical: false,
      addedByHand: true,
    };
    return det;
  }

  const vocal = (unit.vocalizedWords || []).join(" ") || unit.fullText || raw;
  const det: any = {
    type: slugOf(unit.sourceType), sourceType: unit.sourceType, unitId: unit.unitId, displayRef: unit.displayRef,
    reference: unit.displayRef, candidateRefs: [unit.displayRef], candidateUnitIds: [unit.unitId], isAmbiguous: false,
    confidenceBand: "VERIFIED", confidence: 1.0, totalScore: 25.0, hasCitationCue: true, hasFuzzyHeal: false,
    ...where, canonicalText: vocal, segments: [[sIdx, eIdx]],
    qSegments: [[0, Math.min((unit.vocalizedWords || []).length, eIdx - sIdx)]], canonicalSegments: [vocal],
    commentaryGaps: [], qiraah: unit.sourceType === "QURAN" ? qKey : "",
    qiraahDisplay: unit.sourceType === "QURAN" ? (QIRAAT_AR_NAME[qKey] || "رواية حفص عن عاصم") : "",
    snappedToCanonical: unit.sourceType === "QURAN", addedByHand: true,
  };
  ctx.recompute(det);
  return det;
}

function moveEdge(ctx: Ctx, det: any, edge: "start" | "end", delta: number): Finding {
  if (!ctx.words.length) throw new EditError("the lecture has no words");
  const maxIdx = ctx.words.length - 1;
  if (edge === "start") det.wordStartIdx = Math.max(0, Math.min(det.wordEndIdx, det.wordStartIdx + delta));
  else if (edge === "end") det.wordEndIdx = Math.max(det.wordStartIdx, Math.min(maxIdx, det.wordEndIdx + delta));
  else throw new EditError(`edge must be "start" or "end", not ${edge}`);
  det.segments = [[det.wordStartIdx, det.wordEndIdx + 1]];
  det.commentaryGaps = [];
  ctx.recompute(det);
  return retime(ctx, det);
}

function setKind(det: any, kind: string): Finding {
  if (!["ayah", "hadith", "dhikr"].includes(kind)) throw new EditError(`kind must be ayah, hadith or dhikr, not ${kind}`);
  det.type = kind;
  det.sourceType = sourceOf(kind);
  if (kind === "dhikr" && (!det.displayRef || String(det.displayRef).includes("سورة"))) {
    det.displayRef = "ذكر مأثور";
    det.reference = "ذكر مأثور";
  }
  return det;
}

function snap(ctx: Ctx, det: any, on: boolean): Finding {
  det.snappedToCanonical = Boolean(on);
  if (det.snappedToCanonical && (!det.canonicalText || !String(det.canonicalText).trim())) {
    const unit = ctx.unit(det.unitId);
    if (unit && unit.fullText) {
      det.canonicalText = unit.fullText;
      det.canonicalSegments = [unit.fullText];
    }
  }
  return det;
}

/** The words a finding's reference offers for picking: its matn, or the whole hadith (chain and takhrij too). */
export function referenceWords(unit: any): { matn: string[]; full: { words: string[]; matnStart: number; matnEnd: number } | null } {
  const matn = unit ? (unit.vocalizedWords || String(unit.fullText || "").split(/\s+/)) : [];
  const view = unit ? getUnitFullWordView(unit) : null;
  return { matn, full: view ? { words: view.words, matnStart: view.matnStart, matnEnd: view.matnEnd } : null };
}

function canonicalWords(ctx: Ctx, det: any, indices: number[], full: boolean): Finding {
  if (!Array.isArray(indices) || !indices.length) throw new EditError("pick at least one word");
  const unit = ctx.unit(det.unitId);
  const ref = referenceWords(unit);
  const matnWords = unit ? ref.matn : String(det.canonicalText || "").split(/\s+/);
  if (full && !ref.full) throw new EditError("this reference has no text outside its matn");
  const pool = full ? ref.full!.words : matnWords;
  const matnOffset = full ? ref.full!.matnStart : 0;
  const sorted = [...indices].sort((a, b) => a - b);
  const chosen = sorted.map((i) => pool[i]).filter(Boolean);
  if (!chosen.length) throw new EditError("none of the picked words is in the reference");
  const text = chosen.join(" ");
  det.canonicalText = text;
  det.canonicalSegments = [text];
  const qs = Math.max(0, Math.min(matnWords.length, sorted[0] - matnOffset));
  const qe = Math.max(0, Math.min(matnWords.length, sorted[sorted.length - 1] - matnOffset + 1));
  if (qe > qs) det.qSegments = [[qs, qe]];
  det.refSelection = { unitId: det.unitId, full, indices: sorted };
  if (full) det.qFullSegments = [[sorted[0], sorted[sorted.length - 1] + 1]];
  det.snappedToCanonical = true;
  return det;
}

/** The finding's matching references, created on first use with its own reference first (getFindingCandidates). */
function candidates(ctx: Ctx, det: any): any[] {
  if (!Array.isArray(det.candidates)) {
    const unit = ctx.unit(det.unitId);
    det.candidates = unit
      ? [{ unitId: unit.unitId, displayRef: unit.displayRef, text: unit.fullText, sourceType: unit.sourceType }]
      : det.displayRef ? [{ unitId: det.unitId || `MANUAL:${det.displayRef}`, displayRef: det.displayRef, text: det.canonicalText || "" }] : [];
  }
  return det.candidates;
}

function addCandidate(ctx: Ctx, det: any, unitId: string | null, ref: string): Finding {
  const list = candidates(ctx, det);
  const unit = ctx.unit(unitId);
  if (unitId && !unit && !ref.trim()) throw new EditError(`no corpus unit ${unitId}`);
  if (!unit && !ref.trim()) throw new EditError("give a corpus unit or a reference");
  const id = unit ? unit.unitId : `MANUAL:${ref.trim()}`;
  if (list.some((c) => c.unitId === id)) throw new EditError("this reference is already in the list");
  list.push(unit
    ? { unitId: unit.unitId, displayRef: unit.displayRef, text: unit.fullText, sourceType: unit.sourceType, addedManually: true }
    : { unitId: id, displayRef: ref.trim(), text: "", addedManually: true });
  return det;
}

function removeCandidate(ctx: Ctx, det: any, unitId: string): Finding {
  if (unitId === det.unitId) throw new EditError("the finding's own reference can't be removed; link another one first");
  det.candidates = candidates(ctx, det).filter((c) => c.unitId !== unitId);
  return det;
}

const REF_EDIT_FIELDS = ["canonicalText", "canonicalSegments", "qSegments", "qFullSegments", "refSelection", "snappedToCanonical"];

function linkReference(ctx: Ctx, det: any, unitId: string | null, ref: string): Finding {
  const unit = ctx.unit(unitId);
  if (!unit && !ref.trim()) throw new EditError(unitId ? `no corpus unit ${unitId}` : "give a corpus unit or a reference");
  candidates(ctx, det);
  // keep this reference's word edits so switching back restores them
  det.refEdits = det.refEdits || {};
  if (det.unitId) det.refEdits[det.unitId] = Object.fromEntries(REF_EDIT_FIELDS.map((k) => [k, det[k] ?? null]));
  const restored = unitId ? det.refEdits[unitId] : null;
  if (unit) {
    det.unitId = unit.unitId;
    det.sourceType = unit.sourceType;
    det.type = slugOf(unit.sourceType);
    det.displayRef = unit.displayRef;
    det.reference = unit.displayRef;
    det.confidenceBand = "VERIFIED";
    det.confidence = 1.0;
    det.isOutsideCorpus = false;
    if (restored) {
      for (const k of REF_EDIT_FIELDS) {
        if (restored[k] === null) delete det[k];
        else det[k] = restored[k];
      }
    } else if (ctx.tokens.length && det.wordEndIdx < ctx.tokens.length) {
      det.segments = [[det.wordStartIdx, det.wordEndIdx + 1]];
      det.commentaryGaps = [];
      delete det.qFullSegments;
      recomputeCanonicalForDetection(det, ctx.tokens, ctx.matcher);
      det.snappedToCanonical = false;
    } else {
      det.canonicalText = unit.fullText;
      det.canonicalSegments = [unit.fullText];
    }
  } else {
    det.unitId = unitId || det.unitId;
    det.displayRef = ref.trim();
    det.reference = ref.trim();
  }
  return det;
}

/** How many reference words a span aligns to under `unitId` (scoreMergedSpanAgainstUnit). */
function alignedWords(ctx: Ctx, det: any, unitId: string): number {
  const probe = { ...det, unitId, qSegments: undefined, qFullSegments: undefined };
  recomputeCanonicalForDetection(probe, ctx.tokens, ctx.matcher);
  return (probe.qFullSegments || probe.qSegments || []).reduce((acc: number, [s, e]: number[]) => acc + Math.max(0, e - s), 0);
}

function merge(ctx: Ctx, first: any, second: any, gapType?: string): EditResult {
  if (first.wordStartIdx > second.wordStartIdx) [first, second] = [second, first];
  if (first.wordEndIdx >= second.wordStartIdx) throw new EditError("the two findings overlap");
  const gapWords = Math.max(0, second.wordStartIdx - first.wordEndIdx - 1);
  const kind = gapType || "PART_OF_QUOTE";
  const segsOf = (d: any) => (Array.isArray(d.segments) && d.segments.length ? d.segments : [[d.wordStartIdx, d.wordEndIdx + 1]]).map((s: number[]) => s.slice());
  const aSegs = segsOf(first);
  const bSegs = segsOf(second);
  let segments: number[][];
  const gaps = [...(first.commentaryGaps || []), ...(second.commentaryGaps || [])];
  if (kind === "COMMENTARY" && gapWords > 0) {
    segments = [...aSegs, ...bSegs];
    gaps.push([first.wordEndIdx + 1, second.wordStartIdx]);
  } else {
    segments = [...aSegs.slice(0, -1), [aSegs[aSegs.length - 1][0], bSegs[0][1]], ...bSegs.slice(1)];
  }
  // keep the reference that best explains the merged span
  const merged = { ...first, segments, commentaryGaps: gaps, wordStartIdx: first.wordStartIdx, wordEndIdx: second.wordEndIdx };
  let keep = first;
  let other = second;
  let kept: "first" | "second" = "first";
  const canAlign = ctx.tokens.length && merged.wordEndIdx < ctx.tokens.length;
  if (first.unitId !== second.unitId && canAlign && ctx.unit(second.unitId)) {
    const sFirst = ctx.unit(first.unitId) ? alignedWords(ctx, merged, first.unitId) : -1;
    const sSecond = alignedWords(ctx, merged, second.unitId);
    if (sSecond > sFirst) {
      keep = second;
      other = first;
      kept = "second";
    }
  }
  const list = candidates(ctx, keep).slice();
  for (const c of candidates(ctx, other)) if (!list.some((x) => x.unitId === c.unitId)) list.push(c);
  Object.assign(keep, {
    segments, commentaryGaps: gaps, wordStartIdx: first.wordStartIdx, wordEndIdx: second.wordEndIdx, candidates: list,
    totalScore: Math.max(first.totalScore || 0, second.totalScore || 0), snappedToCanonical: false,
  });
  delete keep.qFullSegments;
  if (canAlign) recomputeCanonicalForDetection(keep, ctx.tokens, ctx.matcher);
  return { finding: retime(ctx, keep), kept };
}

/** The finding's times and matched text read again from its words, its characters from its tokens. */
function retime(ctx: Ctx, det: any): Finding {
  const a = ctx.timed[det.wordStartIdx];
  const b = ctx.timed[det.wordEndIdx];
  if (!a || !b) return det;
  det.startTime = a.start;
  det.endTime = b.end;
  det.matchedText = ctx.span(det.wordStartIdx, det.wordEndIdx);
  // the characters follow the engine's tokens, as recomputeCanonicalForDetection sets them
  const t = ctx.tokens;
  if (Number.isInteger(det.tStart) && Number.isInteger(det.tEnd) && t[det.tStart] && t[det.tEnd - 1]) {
    det.charStart = det.startIndex = t[det.tStart].charStart;
    det.charEnd = det.endIndex = t[det.tEnd - 1].charEnd;
  }
  return det;
}
