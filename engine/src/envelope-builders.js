// Laya envelope builders v1, v2 and v3 (ADR 0003, ROADMAP phase 5), moved verbatim from the old app's
// js/ai-verifier.js (sections 1, 1a, 1a' and the passage envelope). Do not change behaviour here: golden tests pin it,
// and a different envelope means a new envelope version and a new dataset (ADR 0003).
//
// The one change from the old code: what it read from browser globals is passed in. `ctx` = {units, ayat, detections}
// replaces activeMatcher.units (the engine's corpus units), RAW_QURAN_DATA (the Quran) and currentState.detections
// (every finding of the lecture, where neighbours are looked for); `words` replaces currentState.words.
// The typed entry point is envelopes.ts; callers use that, not these functions.
import { SURAH_NAMES_AR } from "./shared.js";


/**
 * Build the canonical System-1 state and questions envelope for an engine finding.
 * @param {Object} ctx - {units, ayat, detections}: the engine's corpus units, the Quran, every finding of the lecture
 * @param {Object} det - one finding of ctx.detections
 * @param {Array} words - the lecture's words
 * @param {number} contextWindowWords - Context window around the span (default: 25)
 */
function buildCanonicalDecisionEnvelope(ctx, det, words, contextWindowWords = 25) {
  const sIdx = Math.max(0, typeof det.wordStartIdx === "number" ? det.wordStartIdx : 0);
  const maxIdx = Math.max(0, (words || []).length - 1);
  const eIdx = Math.max(sIdx, Math.min(maxIdx, typeof det.wordEndIdx === "number" ? det.wordEndIdx : sIdx));

  const beforeStart = Math.max(0, sIdx - contextWindowWords);
  const afterEnd = Math.min((words || []).length, eIdx + 1 + contextWindowWords);

  const contextBefore = words && words.length ? words.slice(beforeStart, sIdx).map(w => w.word).join(" ") : "";
  const matchedTranscriptSpan = words && words.length
    ? words.slice(sIdx, eIdx + 1).map(w => w.word).join(" ")
    : (det.matchedText || det.canonicalText || "");
  const contextAfter = words && words.length ? words.slice(eIdx + 1, afterEnd).map(w => w.word).join(" ") : "";

  // 8 words immediately before and after the detection boundary in the transcript
  const immediateBefore = words && words.length ? words.slice(Math.max(0, sIdx - 8), sIdx).map(w => w.word).join(" ") : "";
  const immediateAfter = words && words.length ? words.slice(eIdx + 1, Math.min(words.length, eIdx + 9)).map(w => w.word).join(" ") : "";

  // Extract unmatched canonical prefix & suffix from the linked corpus unit
  let unmatchedPrefix = "";
  let unmatchedSuffix = "";
  const unit = (ctx.units && det.unitId)
    ? ctx.units.get(det.unitId)
    : null;

  if (unit && Array.isArray(unit.vocalizedWords) && unit.vocalizedWords.length) {
    const qSegs = (Array.isArray(det.qSegments) && det.qSegments.length)
      ? det.qSegments
      : [[0, unit.vocalizedWords.length]];
    const qStart = Math.max(0, qSegs[0][0]);
    const qEnd = Math.min(unit.vocalizedWords.length, qSegs[qSegs.length - 1][1]);

    if (qStart > 0) {
      unmatchedPrefix = unit.vocalizedWords.slice(Math.max(0, qStart - 10), qStart).join(" ");
    }
    if (qEnd < unit.vocalizedWords.length) {
      unmatchedSuffix = unit.vocalizedWords.slice(qEnd, Math.min(unit.vocalizedWords.length, qEnd + 10)).join(" ");
    }
  }

  // Quran neighboring verses context (preceding ayah and succeeding ayah)
  let quranNeighbors = null;
  if ((det.sourceType === "QURAN" || det.type === "ayah") && Array.isArray(ctx.ayat)) {
    let surahNum = 0;
    let ayahNum = 0;
    if (det.unitId && String(det.unitId).includes(":")) {
      const parts = String(det.unitId).split(":");
      surahNum = parseInt(parts[parts.length - 2], 10);
      ayahNum = parseInt(parts[parts.length - 1], 10);
    } else if (unit && typeof unit.s === "number") {
      surahNum = unit.s;
      ayahNum = unit.a;
    }
    if (surahNum > 0 && ayahNum > 0) {
      const prevAyah = ctx.ayat.find(q => Number(q.s) === surahNum && Number(q.a) === ayahNum - 1);
      const nextAyah = ctx.ayat.find(q => Number(q.s) === surahNum && Number(q.a) === ayahNum + 1);
      quranNeighbors = {
        surah: surahNum,
        ayah: ayahNum,
        previous_ayah_text: prevAyah ? prevAyah.t.split(/\s+/).slice(-15).join(" ") : "",
        current_ayah_text: det.canonicalText || (unit ? unit.fullText : ""),
        next_ayah_text: nextAyah ? nextAyah.t.split(/\s+/).slice(0, 15).join(" ") : ""
      };
    }
  }

  const canonicalState = {
    source_type: det.sourceType || "HADITH", // "QURAN" | "HADITH" | "ADHKAR"
    candidate_reference: det.displayRef || det.reference || "",
    canonical_corpus_text: det.canonicalText || matchedTranscriptSpan,
    context_before: contextBefore,
    matched_span_in_lecture: matchedTranscriptSpan,
    context_after: contextAfter,
    unmatched_corpus_prefix_words: unmatchedPrefix,
    immediate_transcript_before: immediateBefore,
    unmatched_corpus_suffix_words: unmatchedSuffix,
    immediate_transcript_after: immediateAfter,
    quran_neighboring_context: quranNeighbors,
    engine_confidence_band: det.confidenceBand || "CANDIDATE",
    engine_score: Number((det.totalScore || 0).toFixed(2)),
    has_citation_cue: Boolean(det.hasCitationCue)
  };

  const canonicalQuestions = {
    verdict: {
      type: "choice",
      instructions:
        "In this Arabic Islamic lecture transcript, determine whether `matched_span_in_lecture` (surrounded by `context_before` and `context_after`) is an actual quotation/citation of `canonical_corpus_text` (`source_type`), or if it is merely ordinary speaker prose/explanation that happens to share words with the corpus text.",
      criteria: {
        CORRECT:
          "The speaker is genuinely quoting, reciting, or invoking this Quranic Ayah, Prophetic Hadith, or Dhikr (verbatim or as a direct religious citation in context).",
        FALSE:
          "False positive: the words are ordinary conversational speech, fiqh explanation, or narrator/person names that coincidentally overlap with corpus vocabulary without quoting the text.",
        NOT_SURE:
          "Ambiguous or partial paraphrase/meaning-only allusion where it is borderline whether the speaker intended a direct quotation."
      }
    },
    boundary_status: {
      type: "choice",
      instructions:
        "Compare `immediate_transcript_before` against `unmatched_corpus_prefix_words`, and `immediate_transcript_after` against `unmatched_corpus_suffix_words`. Determine whether the speaker actually uttered additional words of this quote at the beginning or end (even with minor ASR spelling errors) that were accidentally cut off from `matched_span_in_lecture`. If the speaker intentionally stopped quoting and resumed normal commentary, select COMPLETE_SPAN.",
      criteria: {
        COMPLETE_SPAN:
          "The detected span captures all words of the quote that the speaker actually uttered in this segment (no words of the quote were cut off in the adjacent transcript).",
        MISSING_START:
          "Words from `unmatched_corpus_prefix_words` appear inside `immediate_transcript_before` and were cut off from the beginning of the detection.",
        MISSING_END:
          "Words from `unmatched_corpus_suffix_words` appear inside `immediate_transcript_after` and were cut off from the end of the detection.",
        MISSING_BOTH:
          "Words of the quote were cut off from BOTH the beginning (`immediate_transcript_before`) and the end (`immediate_transcript_after`)."
      }
    }
  };

  return { state: canonicalState, questions: canonicalQuestions, merge: buildMergeContext(ctx, det, words) };
}

// ---------------------------------------------------------------------------
// 1a. Merge Context (one quotation the engine split into neighbouring findings)
// Sent only to prompt-capable providers and only when a neighbour is close,
// so the canonical envelope (and Laya's fixed questions) stay untouched.
// ---------------------------------------------------------------------------

const MERGE_MAX_GAP_WORDS = 12;

function clipWords(text, n) {
  const w = String(text || "").split(/\s+/).filter(Boolean);
  return w.length > n ? w.slice(0, n).join(" ") + " …" : w.join(" ");
}

/** The findings right before and after `det` in transcript order, if no more than `maxGap` words away. */
function findNeighborFindings(det, detections = [], maxGap = MERGE_MAX_GAP_WORDS) {
  const sorted = detections
    .filter(d => typeof d.wordStartIdx === "number" && typeof d.wordEndIdx === "number")
    .slice()
    .sort((a, b) => a.wordStartIdx - b.wordStartIdx);
  const pos = sorted.indexOf(det);
  if (pos < 0) return { previous: null, next: null };
  const previous = sorted[pos - 1] || null;
  const next = sorted[pos + 1] || null;
  const gapTo = (a, b) => Math.max(0, b.wordStartIdx - a.wordEndIdx - 1);
  return {
    previous: previous && gapTo(previous, det) <= maxGap ? previous : null,
    next: next && gapTo(det, next) <= maxGap ? next : null
  };
}

function describeNeighbor(det, nb, direction, words) {
  const gapStart = direction === "previous" ? nb.wordEndIdx + 1 : det.wordEndIdx + 1;
  const gapEnd = direction === "previous" ? det.wordStartIdx : nb.wordStartIdx;
  const span = (words || []).slice(nb.wordStartIdx, nb.wordEndIdx + 1).map(w => w.word).join(" ") || nb.matchedText || "";
  return {
    source_type: nb.sourceType || "HADITH",
    candidate_reference: nb.displayRef || nb.reference || "",
    same_reference_as_current: Boolean(det.unitId && nb.unitId === det.unitId),
    gap_word_count: Math.max(0, gapEnd - gapStart),
    gap_transcript_text: (words || []).slice(gapStart, Math.max(gapStart, gapEnd)).map(w => w.word).join(" "),
    neighbor_span_in_lecture: clipWords(span, 30),
    neighbor_canonical_corpus_text: clipWords(nb.canonicalText || "", 40)
  };
}

function buildMergeContext(ctx, det, words) {
  const { previous, next } = findNeighborFindings(det, ctx.detections);
  if (!previous && !next) return null;

  const criteria = {
    NO_MERGE: "This finding is a separate quotation (or the neighbour is a different text, or the gap is unrelated speech)."
  };
  if (previous) criteria.MERGE_WITH_PREVIOUS = "This finding and the `previous` neighbour are parts of the same quotation.";
  if (next) criteria.MERGE_WITH_NEXT = "This finding and the `next` neighbour are parts of the same quotation.";
  if (previous && next) criteria.MERGE_BOTH = "The `previous` neighbour, this finding and the `next` neighbour are all parts of the same quotation.";

  return {
    neighborIds: { previous: previous ? previous.id : null, next: next ? next.id : null },
    neighbors: {
      previous: previous ? describeNeighbor(det, previous, "previous", words) : null,
      next: next ? describeNeighbor(det, next, "next", words) : null
    },
    questions: {
      merge_suggestion: {
        type: "choice",
        instructions:
          "`neighbor_findings` lists the engine findings immediately before (`previous`) and/or after (`next`) this one, with the transcript words between them (`gap_transcript_text`). " +
          "The engine often splits ONE quotation into separate findings when an ASR typo, a garbled or missing word, or a short repetition breaks the match; a neighbour may even be linked to a different reference. " +
          "Decide, independently of `verdict`, whether this finding and a neighbour are consecutive parts of the same quoted text (compare the spans and the corpus texts) and should be one finding. " +
          "Do not merge two different texts quoted one after the other.",
        criteria
      },
      merge_gap_type: {
        type: "choice",
        instructions: "Only meaningful when you suggest a merge: what are the words in `gap_transcript_text` between the parts?",
        criteria: {
          PART_OF_QUOTE: "The gap is empty, or it is mis-transcribed / garbled / repeated words of the quoted text itself.",
          COMMENTARY: "The gap is the speaker's own interjection or explanation between two parts of the same quotation."
        }
      }
    }
  };
}


// ---------------------------------------------------------------------------
// 1a'. Laya envelope v2 (docs/laya-finetune/envelope-v2.md)
// Checkpoints trained on laya_v2 carry `wahy_envelope: 2` (+ the options they were trained with) in their
// config. The training data is built by THIS code (engine/src/worker.ts, called by backend/laya_datagen/engine_bridge.py),
// so the app and the training rows cannot drift apart. Changes vs v1:
//   * consecutive verses found back to back are sent as one passage (`passages` option);
//   * the engine's nearest other findings are listed, without any verdict (`neighbours` option);
//   * lecture fields come before the corpus text (a long hadith used to push the span out of max_len);
//   * `current_ayah_text` (a copy of canonical_corpus_text) is gone;
//   * the boundary is two yes/no questions (start cut off? end cut off?) with the word-overlap evidence in the state.
// ---------------------------------------------------------------------------

const LAYA_ENVELOPE_V2 = 2;
const LAYA_ENVELOPE_V3 = 3;
const LAYA_V2 = {
  contextWords: 25,
  passageMaxGapWords: 2,       // consecutive verses at most this many words apart are one passage
  passageMaxVerses: 6,         // a longer run is cut into equal passages of at most this size (splitRun)
  neighbourMaxGapWords: 40,    // farther findings are not listed
  neighbourSpanWords: 20,
  neighbourGapWords: 30,
  edgeWords: 2                 // corpus words next to the span checked for the boundary evidence (eval_laya.rule_boundary's k)
};

/** {s, a} for a Quran finding ("2:255"-style unitId, or surah/ayah properties), else null. */
function quranPos(det) {
  if (!det) return null;
  const isQuran = (det.sourceType || "").toUpperCase() === "QURAN" || ["ayah", "quran"].includes(det.type);
  if (!isQuran) return null;
  if (typeof det.surah === "number" && typeof det.ayah === "number" && det.surah > 0 && det.ayah > 0) {
    return { s: det.surah, a: det.ayah };
  }
  const parts = String(det.unitId || "").split(":");
  if (parts.length >= 2) {
    const s = parseInt(parts[parts.length - 2], 10);
    const a = parseInt(parts[parts.length - 1], 10);
    if (s > 0 && a > 0) return { s, a };
  }
  return null;
}

function detWordIndices(d, words) {
  let s = typeof d.wordStartIdx === "number" ? d.wordStartIdx : (typeof d.tStart === "number" ? d.tStart : null);
  let e = typeof d.wordEndIdx === "number" ? d.wordEndIdx : (typeof d.tEnd === "number" ? d.tEnd - 1 : null);
  if ((s === null || e === null) && words && words.length && typeof d.startIndex === "number") {
    const cStart = d.startIndex;
    const cEnd = typeof d.endIndex === "number" ? d.endIndex : cStart;
    s = 0;
    for (let i = 0; i < words.length; i++) {
      if (words[i].char_end > cStart) { s = i; break; }
    }
    e = s;
    for (let i = s; i < words.length; i++) {
      if (words[i].char_start < cEnd) { e = i; } else { break; }
    }
  }
  return { s: Math.max(0, s ?? 0), e: Math.max(0, e ?? 0) };
}

/** A run of n verses -> ceil(n / passageMaxVerses) passages of near-equal size, larger first (7 -> 4 + 3, 13 -> 5 + 4 + 4):
 *  a fixed-size cut would leave the last verse alone (6 + 1), the very case passages are meant to fix. */
function splitRun(run) {
  const k = Math.ceil(run.length / LAYA_V2.passageMaxVerses);
  const out = [];
  let start = 0;
  for (let i = 0; i < k; i++) {
    const size = Math.floor(run.length / k) + (i < run.length % k ? 1 : 0);
    out.push(run.slice(start, start + size));
    start += size;
  }
  return out;
}

/** Detections in transcript order, cut into passages: runs of consecutive verses of one surah found back to back. */
function groupLayaPassages(detections, usePassages = true, words = null) {
  const list = (detections || []).map(d => {
    const idxs = detWordIndices(d, words);
    return { det: d, sIdx: idxs.s, eIdx: idxs.e };
  });
  list.sort((a, b) => a.sIdx - b.sIdx || a.eIdx - b.eIdx);
  const runs = [];
  let cur = [];
  for (const item of list) {
    const d = item.det;
    const prev = cur[cur.length - 1];
    const p = quranPos(prev), q = quranPos(d);
    const prevIndices = prev ? detWordIndices(prev, words) : null;
    const gap = prevIndices ? item.sIdx - prevIndices.e - 1 : null;
    if (usePassages && p && q && p.s === q.s && q.a === p.a + 1 && gap !== null && gap >= -2 && gap <= Math.max(4, LAYA_V2.passageMaxGapWords)) {
      cur.push(d);
    } else {
      if (cur.length) runs.push(cur);
      cur = [d];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.flatMap(splitRun);
}

// Arabic word normalisation of eval_laya._norm_words: no diacritics / tatweel, alef forms -> ا, ة -> ه, ى -> ي, letters only
function normArabicWords(text) {
  return String(text || "").split(/\s+/).map(w => w
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[^ء-ي]/g, "")).filter(Boolean);
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// same word allowing ASR spelling errors (words of 3+ letters, >= 75 % alike)
function similarArabicWord(a, b) {
  if (a === b) return true;
  if (a.length <= 2 || b.length <= 2) return false;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.75;
}

/** "n of k": how many of the k corpus words next to the span the speaker said right there (null: nothing to check). */
function edgeWordsHeard(corpusWords, transcriptWords, side) {
  const k = LAYA_V2.edgeWords;
  const c = normArabicWords(corpusWords), t = normArabicWords(transcriptWords);
  const corpusEdge = side === "start" ? c.slice(-k) : c.slice(0, k);
  const window = side === "start" ? t.slice(-(k + 2)) : t.slice(0, k + 2);
  if (!corpusEdge.length) return null;
  const heard = corpusEdge.filter(w => window.some(x => similarArabicWord(w, x))).length;
  return `${heard} of ${corpusEdge.length}`;
}

/** The no-model boundary (eval_laya.rule_boundary): a side is cut off when any of its corpus edge words was heard
 *  right there. Used for checkpoints not trained on the boundary. {start, end} as 0 / 1. */
function boundaryByRule(state) {
  const heard = (corpus, transcript, side) => {
    const ev = edgeWordsHeard(corpus, transcript, side);
    return ev && parseInt(ev, 10) > 0 ? 1 : 0;
  };
  return {
    start: heard(state.unmatched_corpus_prefix_words, state.immediate_transcript_before, "start"),
    end: heard(state.unmatched_corpus_suffix_words, state.immediate_transcript_after, "end")
  };
}

function passageReference(group) {
  if (!Array.isArray(group) || !group.length) return "";
  const first = group[0], last = group[group.length - 1];
  const fp = quranPos(first), lp = quranPos(last);
  let ref = first.displayRef || first.reference || "";
  if (!ref && fp) {
    const sName = SURAH_NAMES_AR[fp.s] || `سورة ${fp.s}`;
    ref = `${sName}: ${fp.a}`;
  } else if (!ref) {
    ref = first.unitId || "";
  }
  if (group.length > 1 && lp) {
    if (/\d+\s*$/.test(ref)) {
      return ref.replace(/(\d+)\s*$/, `$1-${lp.a}`);
    }
    return `${ref}-${lp.a}`;
  }
  return ref;
}

function wordsText(words, from, to) {
  return (words || []).slice(Math.max(0, from), Math.max(0, to)).map(w => w.word).join(" ");
}

function describeLayaNeighbour(group, nb, direction, words) {
  const first = group[0], last = group[group.length - 1];
  const nFirst = nb[0], nLast = nb[nb.length - 1];
  const gapStart = direction === "previous" ? nLast.wordEndIdx + 1 : last.wordEndIdx + 1;
  const gapEnd = direction === "previous" ? first.wordStartIdx : nFirst.wordStartIdx;
  const me = quranPos(direction === "previous" ? first : last);
  const other = quranPos(direction === "previous" ? nLast : nFirst);
  const sameSurah = Boolean(me && other && me.s === other.s);
  return {
    candidate_reference: passageReference(nb),
    source_type: nFirst.sourceType || "HADITH",
    same_reference: nb.some(d => d.unitId && group.some(g => g.unitId === d.unitId)),
    same_surah: sameSurah,
    ayah_distance: sameSurah ? (direction === "previous" ? me.a - other.a : other.a - me.a) : null,
    gap_word_count: Math.max(0, gapEnd - gapStart),
    gap_transcript_text: clipWords(wordsText(words, gapStart, gapEnd), LAYA_V2.neighbourGapWords),
    neighbor_span_in_lecture: clipWords(wordsText(words, nFirst.wordStartIdx, nLast.wordEndIdx + 1), LAYA_V2.neighbourSpanWords)
  };
}

const LAYA_V2_QUESTIONS = {
  verdict: {
    type: "choice",
    instructions:
      "In this Arabic Islamic lecture transcript, determine whether `matched_span_in_lecture` (surrounded by `context_before` and `context_after`) is an actual quotation/citation of `canonical_corpus_text` (`source_type`), or if it is merely ordinary speaker prose/explanation that happens to share words with the corpus text. " +
      "When `verses_in_passage` is present, the span is that many consecutive verses the engine found back to back: judge them together. " +
      "When `neighbor_findings` is present, it lists the engine's nearest other findings before and after this one (unverified: they can be false too), with the words between them.",
    criteria: {
      CORRECT:
        "The speaker is genuinely quoting, reciting, or invoking this Quranic Ayah, Prophetic Hadith, or Dhikr (verbatim or as a direct religious citation in context).",
      FALSE:
        "False positive: the words are ordinary conversational speech, fiqh explanation, or narrator/person names that coincidentally overlap with corpus vocabulary without quoting the text.",
      NOT_SURE:
        "Ambiguous or partial paraphrase/meaning-only allusion where it is borderline whether the speaker intended a direct quotation."
    }
  },
  start_missing: {
    type: "noul",
    instructions:
      "Was the START of this quote cut off from the detected span? `unmatched_corpus_prefix_words` are the words of the corpus text just before the part that was matched; `immediate_transcript_before` is what the speaker said just before the span; `prefix_words_heard` counts how many of the last corpus words before the span appear there (allowing ASR spelling errors). " +
      "Answer true only if the speaker actually said words of the quote right before `matched_span_in_lecture`.",
    criteria: {
      false: "The span starts where the speaker started quoting: no words of the quote are missing at the start.",
      true: "Words of `unmatched_corpus_prefix_words` were said right before the span and are missing from its start."
    }
  },
  end_missing: {
    type: "noul",
    instructions:
      "Was the END of this quote cut off from the detected span? `unmatched_corpus_suffix_words` are the words of the corpus text just after the part that was matched; `immediate_transcript_after` is what the speaker said just after the span; `suffix_words_heard` counts how many of the first corpus words after the span appear there (allowing ASR spelling errors). " +
      "Answer true only if the speaker actually said words of the quote right after `matched_span_in_lecture`.",
    criteria: {
      false: "The span ends where the speaker stopped quoting: no words of the quote are missing at the end.",
      true: "Words of `unmatched_corpus_suffix_words` were said right after the span and are missing from its end."
    }
  }
};

/**
 * The v2 state for one group (a single finding, or a passage of consecutive verses).
 * `neighbours` = null (option off) or {previous, next} groups (each may be null).
 */
function buildLayaEnvelopeV2(ctx, group, words, neighbours = null) {
  group = Array.isArray(group) ? group : [group];
  const first = group[0], last = group[group.length - 1];
  const W = LAYA_V2.contextWords;
  const sFirst = buildCanonicalDecisionEnvelope(ctx, first, words, W).state;
  const sLast = group.length > 1 ? buildCanonicalDecisionEnvelope(ctx, last, words, W).state : sFirst;
  const sIdx = Math.max(0, first.wordStartIdx);
  const eIdx = Math.max(sIdx, Math.min((words || []).length - 1, last.wordEndIdx));
  const span = words && words.length ? wordsText(words, sIdx, eIdx + 1) : sFirst.matched_span_in_lecture;

  const state = {
    source_type: sFirst.source_type,
    candidate_reference: passageReference(group),
    has_citation_cue: group.some(d => Boolean(d.hasCitationCue)),
    context_before: sFirst.context_before,
    matched_span_in_lecture: span,
    context_after: sLast.context_after,
    immediate_transcript_before: sFirst.immediate_transcript_before,
    unmatched_corpus_prefix_words: sFirst.unmatched_corpus_prefix_words,
    prefix_words_heard: edgeWordsHeard(sFirst.unmatched_corpus_prefix_words, sFirst.immediate_transcript_before, "start"),
    immediate_transcript_after: sLast.immediate_transcript_after,
    unmatched_corpus_suffix_words: sLast.unmatched_corpus_suffix_words,
    suffix_words_heard: edgeWordsHeard(sLast.unmatched_corpus_suffix_words, sLast.immediate_transcript_after, "end")
  };
  if (group.length > 1) state.verses_in_passage = group.length;
  if (neighbours) {
    state.neighbor_findings = {
      previous: neighbours.previous ? describeLayaNeighbour(group, neighbours.previous, "previous", words) : null,
      next: neighbours.next ? describeLayaNeighbour(group, neighbours.next, "next", words) : null
    };
  }
  state.canonical_corpus_text = group.length > 1
    ? group.map(d => d.canonicalText || "").join(" ")
    : sFirst.canonical_corpus_text;
  const qFirst = sFirst.quran_neighboring_context, qLast = sLast.quran_neighboring_context;
  if (qFirst) {
    state.quran_neighboring_context = {
      surah: qFirst.surah,
      ayah: group.length > 1 && qLast ? `${qFirst.ayah}-${qLast.ayah}` : qFirst.ayah,
      previous_ayah_text: qFirst.previous_ayah_text,
      next_ayah_text: (qLast || qFirst).next_ayah_text
    };
  }
  return { state, questions: JSON.parse(JSON.stringify(LAYA_V2_QUESTIONS)) };
}

/**
 * Laya v2 requests for a lecture: [{members, state, questions}], one per group that holds a target.
 * `detections` = every finding of the engine run (neighbours and passages are found among all of them);
 * `targets` = the findings to verify (default: all); options = {passages, neighbours} as the checkpoint was trained.
 */
function buildLayaV2Requests(ctx, detections, words, options = {}, targets = null) {
  const groups = groupLayaPassages(detections, options.passages !== false, words);
  const want = targets ? new Set(targets) : null;
  const out = [];
  groups.forEach((g, i) => {
    if (want && !g.some(d => want.has(d))) return;
    let nb = null;
    if (options.neighbours) {
      const prev = groups[i - 1], next = groups[i + 1];
      const gapPrev = prev ? g[0].wordStartIdx - prev[prev.length - 1].wordEndIdx - 1 : Infinity;
      const gapNext = next ? next[0].wordStartIdx - g[g.length - 1].wordEndIdx - 1 : Infinity;
      nb = {
        previous: gapPrev <= LAYA_V2.neighbourMaxGapWords ? prev : null,
        next: gapNext <= LAYA_V2.neighbourMaxGapWords ? next : null
      };
    }
    out.push(Object.assign({ members: g }, buildLayaEnvelopeV2(ctx, g, words, nb)));
  });
  return out;
}

/**
 * The v3 state for one group (Envelope v3: corpus text at TOP, clean boundary indicators, NO neighbor_findings).
 */
function buildLayaEnvelopeV3(ctx, group, words) {
  group = Array.isArray(group) ? group : [group];
  const first = group[0], last = group[group.length - 1];
  const W = LAYA_V2.contextWords;
  const sFirst = buildCanonicalDecisionEnvelope(ctx, first, words, W).state;
  const sLast = group.length > 1 ? buildCanonicalDecisionEnvelope(ctx, last, words, W).state : sFirst;
  const sIdx = Math.max(0, first.wordStartIdx);
  const eIdx = Math.max(sIdx, Math.min((words || []).length - 1, last.wordEndIdx));
  const span = words && words.length ? wordsText(words, sIdx, eIdx + 1) : sFirst.matched_span_in_lecture;

  const canonical = group.length > 1
    ? group.map(d => d.canonicalText || "").join(" ")
    : sFirst.canonical_corpus_text;

  const state = {
    source_type: sFirst.source_type,
    candidate_reference: passageReference(group),
    canonical_corpus_text: canonical, // Golden position: AT TOP!
    has_citation_cue: group.some(d => Boolean(d.hasCitationCue)),
    context_before: sFirst.context_before,
    matched_span_in_lecture: span,
    context_after: sLast.context_after,
    immediate_transcript_before: sFirst.immediate_transcript_before,
    unmatched_corpus_prefix_words: sFirst.unmatched_corpus_prefix_words,
    prefix_words_heard: edgeWordsHeard(sFirst.unmatched_corpus_prefix_words, sFirst.immediate_transcript_before, "start"),
    immediate_transcript_after: sLast.immediate_transcript_after,
    unmatched_corpus_suffix_words: sLast.unmatched_corpus_suffix_words,
    suffix_words_heard: edgeWordsHeard(sLast.unmatched_corpus_suffix_words, sLast.immediate_transcript_after, "end")
  };
  const qFirst = sFirst.quran_neighboring_context, qLast = sLast.quran_neighboring_context;
  if (qFirst) {
    state.quran_neighboring_context = {
      surah: qFirst.surah,
      ayah: group.length > 1 && qLast ? `${qFirst.ayah}-${qLast.ayah}` : qFirst.ayah,
      previous_ayah_text: qFirst.previous_ayah_text,
      next_ayah_text: (qLast || qFirst).next_ayah_text
    };
  }
  return { state, questions: JSON.parse(JSON.stringify(LAYA_V2_QUESTIONS)) };
}

/**
 * Laya v3 requests for a lecture: [{members, state, questions}], one per group that holds a target.
 */
function buildLayaV3Requests(ctx, detections, words, options = {}, targets = null) {
  const groups = groupLayaPassages(detections, options.passages !== false, words);
  const want = targets ? new Set(targets) : null;
  const out = [];
  groups.forEach(g => {
    if (want && !g.some(d => want.has(d))) return;
    out.push(Object.assign({ members: g }, buildLayaEnvelopeV3(ctx, g, words)));
  });
  return out;
}

/** Merge question for a whole group: the finding before its first member and the one after its last. */
function buildGroupMergeContext(ctx, group, words) {
  const first = group[0], last = group[group.length - 1];
  const inGroup = new Set(group);
  const prev = findNeighborFindings(first, ctx.detections).previous;
  const next = findNeighborFindings(last, ctx.detections).next;
  const nb = { previous: prev && !inGroup.has(prev) ? prev : null, next: next && !inGroup.has(next) ? next : null };
  if (!nb.previous && !nb.next) return null;
  const one = buildMergeContext(ctx, first, words) || buildMergeContext(ctx, last, words);
  if (!one) return null;
  const criteria = { NO_MERGE: one.questions.merge_suggestion.criteria.NO_MERGE };
  if (nb.previous) criteria.MERGE_WITH_PREVIOUS = "This passage and the `previous` neighbour are parts of the same quotation.";
  if (nb.next) criteria.MERGE_WITH_NEXT = "This passage and the `next` neighbour are parts of the same quotation.";
  if (nb.previous && nb.next) criteria.MERGE_BOTH = "The `previous` neighbour, this passage and the `next` neighbour are all parts of the same quotation.";
  return {
    neighborIds: { previous: nb.previous ? nb.previous.id : null, next: nb.next ? nb.next.id : null },
    neighbors: {
      previous: nb.previous ? describeNeighbor(first, nb.previous, "previous", words) : null,
      next: nb.next ? describeNeighbor(last, nb.next, "next", words) : null
    },
    questions: Object.assign({}, one.questions, { merge_suggestion: Object.assign({}, one.questions.merge_suggestion, { criteria }) })
  };
}

/**
 * The canonical envelope for a passage (consecutive ayat found back to back), for Gemini / OpenRouter / JEV: the
 * span runs from the first ayah to the last, the boundary evidence comes from its two ends.
 */
function buildPassageEnvelope(ctx, group, words, contextWindow) {
  if (group.length === 1) return buildCanonicalDecisionEnvelope(ctx, group[0], words, contextWindow);
  const first = buildCanonicalDecisionEnvelope(ctx, group[0], words, contextWindow);
  const last = buildCanonicalDecisionEnvelope(ctx, group[group.length - 1], words, contextWindow);
  const f = first.state, l = last.state;
  const sIdx = Math.max(0, group[0].wordStartIdx), eIdx = group[group.length - 1].wordEndIdx;
  const qf = f.quran_neighboring_context, ql = l.quran_neighboring_context;
  const state = Object.assign({}, f, {
    candidate_reference: passageReference(group),
    canonical_corpus_text: group.map(d => d.canonicalText || "").join(" "),
    matched_span_in_lecture: words && words.length ? wordsText(words, sIdx, eIdx + 1) : f.matched_span_in_lecture,
    verses_in_passage: group.length,
    context_after: l.context_after,
    immediate_transcript_after: l.immediate_transcript_after,
    unmatched_corpus_suffix_words: l.unmatched_corpus_suffix_words,
    quran_neighboring_context: qf ? Object.assign({}, qf, { ayah: ql ? `${qf.ayah}-${ql.ayah}` : qf.ayah, current_ayah_text: undefined, next_ayah_text: (ql || qf).next_ayah_text }) : null,
    engine_score: Math.min(...group.map(d => Number((d.totalScore || 0).toFixed(2)))),
    has_citation_cue: group.some(d => Boolean(d.hasCitationCue))
  });
  const questions = JSON.parse(JSON.stringify(first.questions));
  questions.verdict.instructions += " `verses_in_passage` consecutive ayat were found back to back: judge them together as one recitation.";
  return { state, questions, merge: buildGroupMergeContext(ctx, group, words) };
}

export {
  buildCanonicalDecisionEnvelope, buildPassageEnvelope, buildLayaV2Requests, buildLayaV3Requests, boundaryByRule,
  groupLayaPassages, LAYA_ENVELOPE_V2, LAYA_ENVELOPE_V3,
};
