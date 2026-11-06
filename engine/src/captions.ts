// Captions from timed words and findings: the old app's js/caption-builder.js (buildSmartCaptions), moved here
// as a pure module so the web app's live caption preview (phase 12) and the server's export (phase 16) build
// the same captions. The logic is the old code's, step for step; only its inputs changed:
//   - the verdict filter is a `visible(finding)` argument instead of a read of the global state,
//   - a grouped ayah run takes its surah name from the finding's own candidateRefs instead of the loaded
//     corpus (the finding already carries every candidate's reference, so the browser needs no corpus).
// It imports nothing, so the web app can load it without the engine or the corpus.
//
// Rules (from the old file): normal speech is cut at 12 words, 5 s, a pause over 0.4 s or a sentence end; a
// quote always starts a new caption and ends one; a quote of at most 22 words or 9 s is one caption with its
// reference; a longer one is cut only at pauses or waqf marks into chunks of 12-18 words.
//
// New in phase 16 (not in the old app): commentary gaps. When a finding has `commentaryGaps` (the speaker's own
// words between two parts of the quote), those words go outside the brackets: «part one» [commentary] «part two»
// [ref], for Quran, Hadith and Adhkar alike, and a verse inside a hadith (`embeddedQuran`) gets its own ﴿…﴾ inside
// the part it is in. `prefs.splitCommentary: false` turns this off.
// Changed after phase 17 (user decision): a verse inside a hadith with NO gap gets its own ﴿…﴾ too, split on or off
// (`BRACKET_EMBEDDED_QURAN` below, the one switch to revert it). Every other finding is written as the old app did.
//
// `applyCaptionEdits` applies the caption timing editor's edits (split, merge, new times) to built captions.

export type CaptionWord = { word: string; start: number; end: number };

/** The finding fields the builder reads (the engine's finding object has many more). */
export type CaptionFinding = {
  id?: string | number;
  sourceType?: string;
  type?: string;
  unitId?: string | null;
  displayRef?: string | null;
  reference?: string | null;
  wordStartIdx: number;
  wordEndIdx: number;
  isAmbiguous?: boolean;
  confidenceBand?: string;
  candidateUnitIds?: string[];
  candidateRefs?: string[];
  canonicalText?: string;
  snappedToCanonical?: boolean;
  /** token ranges [start, end) of the quote's parts, and of the speaker's words between them */
  segments?: number[][];
  commentaryGaps?: number[][];
  canonicalSegments?: string[];
  embeddedQuran?: { tStart: number; tEnd: number }[];
};

export type CaptionType = "normal" | "ayah" | "hadith" | "dhikr";

export type Caption = {
  index: number;
  start: number;
  end: number;
  /** the words (or the canonical text) without brackets */
  text: string;
  /** what is shown and exported: brackets and the reference badge included */
  displayText: string;
  type: CaptionType;
  findingId: string | number | null;
  /** position of the finding in the visible findings, or -1 for normal speech */
  findingIdx: number;
  reference: string;
  wordStartIdx: number;
  wordEndIdx: number;
  isAtomicCitation: boolean;
};

export type CaptionPrefs = {
  quranBracketOpen?: string;
  quranBracketClose?: string;
  hadithBracketOpen?: string;
  hadithBracketClose?: string;
  adhkarBracketOpen?: string;
  adhkarBracketClose?: string;
  /** write a run of consecutive ayat once, as "البقرة: 1-5" (default true) */
  groupContiguousAyat?: boolean;
  /** put a finding's commentary gaps outside its brackets (default true; false = the old app) */
  splitCommentary?: boolean;
};

export type CaptionOptions<F extends CaptionFinding = CaptionFinding> = {
  prefs?: CaptionPrefs;
  /** which findings become quote captions; the others are read as normal speech. Default: all. */
  visible?: (finding: F) => boolean;
  /** show every quote in its source text (F-038 "standard script"), as if each finding were snapped */
  standardScript?: boolean;
};

const WAQF_OR_PUNCT_RE = /[،؛:.؟!۝ۖۗۚۛۜ]/;

export function bracketsFor(type: string, prefs: CaptionPrefs = {}): { open: string; close: string } {
  if (type === "ayah" || type === "QURAN") {
    return { open: prefs.quranBracketOpen ?? "﴿", close: prefs.quranBracketClose ?? "﴾" };
  }
  if (type === "hadith" || type === "HADITH") {
    return { open: prefs.hadithBracketOpen ?? "«", close: prefs.hadithBracketClose ?? "»" };
  }
  if (type === "dhikr" || type === "ADHKAR") {
    return { open: prefs.adhkarBracketOpen ?? "〖", close: prefs.adhkarBracketClose ?? "〗" };
  }
  return { open: "", close: "" };
}

/** Cut a long quote (> 22 words) into chunks of 12-18 words at pauses (> 0.35 s) or waqf marks, never leaving
 *  1-3 words alone at the end. */
export function splitLongCitationWords<W extends CaptionWord>(citationWords: W[]): W[][] {
  const n = citationWords.length;
  if (n <= 22) return [citationWords];
  const chunks: W[][] = [];
  let start = 0;
  while (start < n) {
    const remaining = n - start;
    if (remaining <= 20) {
      chunks.push(citationWords.slice(start, n));
      break;
    }
    // the ideal window is 12..18 words, keeping at least 6 words for the next chunk
    const minEnd = Math.min(n - 5, start + 12);
    const maxEnd = Math.min(n - 5, start + 18);
    let bestCut = -1;
    let bestScore = -1;
    for (let i = minEnd; i <= maxEnd; i++) {
      const currW = citationWords[i - 1];
      const nextW = citationWords[i];
      const gap = nextW ? nextW.start - currW.end : 0;
      const hasPunct = WAQF_OR_PUNCT_RE.test(currW.word);
      let score = 0;
      if (gap > 0.35) score += 5 + gap * 4;
      if (hasPunct) score += 6;
      score -= Math.abs(i - start - 15) * 0.25; // prefer about 15 words
      if (score > bestScore) {
        bestScore = score;
        bestCut = i;
      }
    }
    if (bestCut === -1) bestCut = Math.min(n - 6, start + 15);
    chunks.push(citationWords.slice(start, bestCut));
    start = bestCut;
  }
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < 4) {
    const tail = chunks.pop()!;
    const prev = chunks.pop()!;
    const combined = prev.concat(tail);
    if (combined.length <= 22) {
      chunks.push(combined);
    } else {
      const half = Math.ceil(combined.length / 2);
      chunks.push(combined.slice(0, half), combined.slice(half));
    }
  }
  return chunks;
}

type Reading = { surah: number; ayah: number; id: string };

const isAmbiguous = (d: CaptionFinding) => Boolean(d.isAmbiguous || d.confidenceBand === "AMBIGUOUS");

/** Back-to-back ayat of one surah (a few words apart) write the surah once, with a range ("البقرة: 1-5"), on
 *  the LAST ayah of the run; the earlier ones get "". Returns finding → the reference to show. */
export function buildAyahGroupRefMap<F extends CaptionFinding>(detections: F[], prefs: CaptionPrefs = {}): Map<F, string> {
  const out = new Map<F, string>();
  const dets = detections.filter((d) => d && typeof d.wordStartIdx === "number").slice().sort((a, b) => a.wordStartIdx - b.wordStartIdx);
  dets.forEach((d) => out.set(d, d.displayRef || d.reference || ""));
  if (prefs.groupContiguousAyat === false) return out;

  // every (surah, ayah) reading of a finding: its candidates when ambiguous, else its own unit
  const reads = (d: F): Reading[] => {
    if (d.sourceType !== "QURAN") return [];
    const ids = isAmbiguous(d) && Array.isArray(d.candidateUnitIds) && d.candidateUnitIds.length ? d.candidateUnitIds : [d.unitId];
    return ids
      .map((id) => /^(\d+):(\d+)$/.exec(String(id || "")))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ surah: +m[1], ayah: +m[2], id: m[0] }));
  };
  // the old code read the unit's displayRef from the corpus; the finding's candidateRefs hold the same text
  const unitRef = (r: Reading, d: F): string => {
    const k = d.candidateUnitIds?.indexOf(r.id) ?? -1;
    const fromCandidates = k >= 0 ? d.candidateRefs?.[k] : undefined;
    return fromCandidates || (r.id === d.unitId ? d.displayRef : "") || d.displayRef || "";
  };
  const MAX_GAP_WORDS = 6;
  const near = (prev: { d: F }, d: F) => d.wordStartIdx - prev.d.wordEndIdx - 1 <= MAX_GAP_WORDS;

  type RunItem = Reading & { d: F };
  let run: RunItem[] = [];
  const flush = () => {
    if (run.length > 1) {
      const name = unitRef(run[0], run[0].d).split(":")[0].trim();
      const label = `${name}: ${run[0].ayah}-${run[run.length - 1].ayah}`;
      run.forEach((r, k) => out.set(r.d, k === run.length - 1 ? label : ""));
    }
    run = [];
  };
  for (let k = 0; k < dets.length; k++) {
    const d = dets[k];
    const rs = reads(d);
    if (!rs.length) {
      flush();
      continue;
    }
    const prev = run[run.length - 1];
    const next = prev && prev.surah ? rs.find((r) => r.surah === prev.surah && r.ayah === prev.ayah + 1) : undefined;
    if (prev && next && near(prev, d)) {
      run.push({ d, ...next });
      continue;
    }
    flush();
    // a run starts at an unambiguous ayah, or at an ambiguous one that comes right before the next finding
    let start: Reading | null = !isAmbiguous(d) ? rs[0] : null;
    if (!start) {
      const nd = dets[k + 1];
      const nrs = nd && !isAmbiguous(nd) ? reads(nd) : [];
      if (nrs.length && near({ d }, nd)) start = rs.find((r) => r.surah === nrs[0].surah && r.ayah === nrs[0].ayah - 1) ?? null;
    }
    if (start) run.push({ d, ...start });
  }
  flush();
  return out;
}


// ---- commentary gaps (phase 16) --------------------------------------------------------------------------------

// The engine's token regex and the marks its normaliser removes (engine/src/v3.js WORD_TOKEN_RE, TASHKEEL_RE): a
// finding's segments and gaps count tokens, and a word can hold 0, 1 or more of them.
const TOKEN_RE = /[ؐ-ؚء-ٰٟٱ-ۓەۖ-ۭ]+/g;
const ONLY_MARKS_RE = /^[ؐ-ًؚ-ٰٟۖ-ۭ]+$/;

/** token index → word index, for the words joined by single spaces (as the engine reads them). */
export function tokenWordMap(words: CaptionWord[]): number[] {
  const out: number[] = [];
  words.forEach((w, i) => {
    for (const m of String(w.word ?? "").trim().matchAll(TOKEN_RE)) if (!ONLY_MARKS_RE.test(m[0])) out.push(i);
  });
  return out;
}

/** One run of a quote as it is written: part of the quote, or the speaker's commentary between two parts. */
export type QuotePiece = { gap: boolean; text: string };

export const hasCommentaryGaps = (f: CaptionFinding) => Array.isArray(f.commentaryGaps) && f.commentaryGaps.length > 0;

// ---- verses inside a hadith (user decision, 2026-11-06) --------------------------------------------------------

/** A Quran verse inside a hadith (`embeddedQuran`) is written in its own ﴿…﴾ inside the hadith's brackets, also when
 *  the hadith has no commentary gap: «ثم قرأ ﴿وما خلقت الجن والإنس إلا ليعبدون﴾» [ref]. The old app wrote a gapless
 *  hadith as one run with the verse unmarked. The user chose the brackets: "i think i want them bracketed, if i
 *  didn't like it i'll change it back".
 *  TO REVERT: set this to false. Gapless hadiths are then written as the old app wrote them (a hadith with a gap,
 *  split on, keeps its verse brackets either way, as in phase 16), and the list in golden-differences.ts must be
 *  emptied, since the golden files are then matched exactly again. */
export const BRACKET_EMBEDDED_QURAN = true;

const hasEmbeddedQuran = (f: CaptionFinding) =>
  Array.isArray(f.embeddedQuran) && f.embeddedQuran.some((r) => r && r.tEnd > r.tStart);

/** Whether a finding's embedded verses get their own Quran brackets (in the spoken words; the source text has no
 *  verse marks). The one rule the captions, the text exports and the web transcript all follow. */
export function bracketsEmbeddedVerses(f: CaptionFinding, splitCommentary = true): boolean {
  if (!hasEmbeddedQuran(f)) return false;
  return BRACKET_EMBEDDED_QURAN || (splitCommentary && hasCommentaryGaps(f));
}

/** How a quote is written: `null` for one plain bracketed run (the old app), or the finding to cut into pieces with
 *  `quotePieces` (its gaps dropped when the commentary split is off, so only its verses are set apart). */
export function piecesFinding<F extends CaptionFinding>(f: F, splitCommentary: boolean, useCanonical: boolean): CaptionFinding | null {
  if (splitCommentary && hasCommentaryGaps(f)) return f;
  if (!useCanonical && bracketsEmbeddedVerses(f, splitCommentary)) return { ...f, commentaryGaps: [] };
  return null;
}

/** The pieces of a finding's words `a..b` (inclusive): commentary gaps apart, a verse inside a hadith in its own
 *  Quran brackets, and in canonical mode each part's source words (spread over the part's words in proportion,
 *  so a quote cut into several captions shares them out). */
export function quotePieces(
  words: CaptionWord[], f: CaptionFinding, a: number, b: number, useCanonical: boolean, tokWord: number[], prefs: CaptionPrefs = {},
): QuotePiece[] {
  const w = (t: number) => tokWord[t] ?? t;
  const range = (r: number[]) => [w(r[0]), w(Math.max(r[0], r[1] - 1))];
  const gaps = (f.commentaryGaps ?? []).filter((g) => Array.isArray(g) && g[1] > g[0]).map(range);
  const segs = (f.segments ?? []).filter((g) => Array.isArray(g) && g[1] > g[0]).map(range);
  const verses = useCanonical ? [] : (f.embeddedQuran ?? []).filter((r) => r && r.tEnd > r.tStart).map((r) => range([r.tStart, r.tEnd]));
  const inGap = (k: number) => gaps.some(([s, e]) => s <= k && k <= e);
  const q = bracketsFor("ayah", prefs);

  const partText = (x: number, y: number): string => {
    const canon = useCanonical && Array.isArray(f.canonicalSegments) ? f.canonicalSegments : null;
    if (canon) {
      const out: string[] = [];
      segs.forEach(([s, e], idx) => {
        const lo = Math.max(s, x), hi = Math.min(e, y);
        if (lo > hi || typeof canon[idx] !== "string") return;
        const cw = canon[idx].split(/\s+/).filter(Boolean);
        const n = e - s + 1;
        out.push(cw.slice(Math.round(((lo - s) / n) * cw.length), Math.round(((hi - s + 1) / n) * cw.length)).join(" "));
      });
      const text = out.filter(Boolean).join(" ");
      if (text) return text;
    }
    const out: string[] = [];
    let k = x;
    while (k <= y) {
      const v = verses.find(([s, e]) => s <= k && k <= e);
      if (v) {
        const end = Math.min(v[1], y);
        out.push(`${q.open}${words.slice(k, end + 1).map((x) => x.word).join(" ")}${q.close}`);
        k = end + 1;
      } else {
        out.push(words[k].word);
        k++;
      }
    }
    return out.join(" ");
  };

  const pieces: QuotePiece[] = [];
  let k = a;
  while (k <= b) {
    const gap = inGap(k);
    let end = k;
    while (end + 1 <= b && inGap(end + 1) === gap) end++;
    pieces.push({ gap, text: gap ? words.slice(k, end + 1).map((x) => x.word).join(" ") : partText(k, end) });
    k = end + 1;
  }
  return pieces;
}

/** Pieces written out: «part» [commentary] «part». A caption that continues a quote opens with «… and one that
 *  is continued closes with …». */
export function writePieces(pieces: QuotePiece[], brackets: { open: string; close: string }, isFirst = true, isLast = true): string {
  return pieces.map((p, k) => {
    if (p.gap) return `[${p.text}]`;
    const open = k === 0 && !isFirst ? `${brackets.open}… ` : brackets.open;
    const close = k === pieces.length - 1 && !isLast ? ` …${brackets.close}` : brackets.close;
    return `${open}${p.text}${close}`;
  }).join(" ");
}

const round2 = (x: number) => Number(x.toFixed(2));

function captionType(f: CaptionFinding): CaptionType {
  const t = f.type;
  if (t === "ayah" || t === "hadith" || t === "dhikr") return t;
  return f.sourceType === "QURAN" ? "ayah" : f.sourceType === "ADHKAR" ? "dhikr" : "hadith";
}

/** The captions of a lecture. `words[i]` is word i; findings point at words with wordStartIdx/wordEndIdx
 *  (inclusive). A finding with `snappedToCanonical` shows its canonicalText instead of the spoken words. */
export function buildCaptions<F extends CaptionFinding>(words: CaptionWord[], detections: F[], options: CaptionOptions<F> = {}): Caption[] {
  if (!Array.isArray(words) || !words.length) return [];
  const prefs = options.prefs ?? {};
  const visible = options.visible ?? (() => true);
  const splitOn = prefs.splitCommentary !== false;
  let tokWord: number[] | null = null;
  const tokens = () => (tokWord ??= tokenWordMap(words));

  const sortedFindings = (Array.isArray(detections) ? detections : [])
    .slice()
    .filter((d) => typeof d.wordStartIdx === "number" && typeof d.wordEndIdx === "number" && visible(d))
    .sort((a, b) => a.wordStartIdx - b.wordStartIdx);

  const groupRefMap = buildAyahGroupRefMap(sortedFindings, prefs);
  const findingByStartWord = new Map<number, { finding: F; findingIdx: number }>();
  sortedFindings.forEach((f, fIdx) => {
    if (!findingByStartWord.has(f.wordStartIdx)) findingByStartWord.set(f.wordStartIdx, { finding: f, findingIdx: fIdx });
  });

  const captions: Caption[] = [];
  let normalBuffer: number[] = []; // word indexes

  const flushNormalBuffer = () => {
    if (!normalBuffer.length) return;
    const first = normalBuffer[0];
    const last = normalBuffer[normalBuffer.length - 1];
    const rawText = normalBuffer.map((i) => words[i].word).join(" ");
    captions.push({
      index: captions.length + 1,
      start: round2(words[first].start),
      end: round2(words[last].end),
      text: rawText,
      displayText: rawText,
      type: "normal",
      findingId: null,
      findingIdx: -1,
      reference: "",
      wordStartIdx: first,
      wordEndIdx: last,
      isAtomicCitation: false,
    });
    normalBuffer = [];
  };

  const totalWords = words.length;
  let i = 0;
  while (i < totalWords) {
    const hit = findingByStartWord.get(i);
    if (hit) {
      // a quote starts: close the speech caption first
      flushNormalBuffer();
      const { finding, findingIdx } = hit;
      const endIdx = Math.min(totalWords - 1, Math.max(i, finding.wordEndIdx));
      const idxs = Array.from({ length: endIdx - i + 1 }, (_, k) => i + k);
      const citationWords = idxs.map((k) => words[k]);
      const wordCount = citationWords.length;
      const duration = wordCount ? citationWords[wordCount - 1].end - citationWords[0].start : 0;
      const fType = captionType(finding);
      const brackets = bracketsFor(fType, prefs);
      const refBadge = groupRefMap.has(finding) ? groupRefMap.get(finding)! : finding.displayRef || finding.reference || "";
      const useCanonical = Boolean((finding.snappedToCanonical || options.standardScript) && finding.canonicalText);
      const piecesOf = piecesFinding(finding, splitOn, useCanonical);
      const split = piecesOf !== null;
      const pieces = (a: number, b: number) => quotePieces(words, piecesOf!, a, b, useCanonical, tokens(), prefs);

      if (split && (wordCount <= 22 || duration <= 9.0)) {
        const ps = pieces(i, endIdx);
        captions.push({
          index: captions.length + 1,
          start: round2(citationWords[0].start),
          end: round2(citationWords[wordCount - 1].end),
          text: ps.map((p) => p.text).join(" "),
          displayText: `${writePieces(ps, brackets)}${refBadge ? ` [${refBadge}]` : ""}`,
          type: fType,
          findingId: finding.id ?? null,
          findingIdx,
          reference: refBadge,
          wordStartIdx: i,
          wordEndIdx: endIdx,
          isAtomicCitation: true,
        });
      } else if (wordCount <= 22 || duration <= 9.0) {
        // one caption for the whole quote, even across pauses
        const baseText = useCanonical ? finding.canonicalText! : citationWords.map((w) => w.word).join(" ");
        captions.push({
          index: captions.length + 1,
          start: round2(citationWords[0].start),
          end: round2(citationWords[wordCount - 1].end),
          text: baseText,
          displayText: `${brackets.open}${baseText}${brackets.close}${refBadge ? ` [${refBadge}]` : ""}`,
          type: fType,
          findingId: finding.id ?? null,
          findingIdx,
          reference: refBadge,
          wordStartIdx: i,
          wordEndIdx: endIdx,
          isAtomicCitation: true,
        });
      } else {
        // a long quote: cut only at pauses or waqf marks
        const chunks = splitLongCitationWords(idxs.map((k) => ({ ...words[k], k })));
        const canonWords = useCanonical ? String(finding.canonicalText).split(/\s+/).filter(Boolean) : null;
        let canonCursor = 0;
        chunks.forEach((chunk, cIdx) => {
          const first = chunk[0];
          const last = chunk[chunk.length - 1];
          const isFirst = cIdx === 0;
          const isLast = cIdx === chunks.length - 1;
          const badge = isLast && refBadge ? ` [${refBadge}]` : "";
          if (split) {
            const ps = pieces(first.k, last.k);
            captions.push({
              index: captions.length + 1,
              start: round2(first.start),
              end: round2(last.end),
              text: ps.map((p) => p.text).join(" "),
              displayText: `${writePieces(ps, brackets, isFirst, isLast)}${badge}`,
              type: fType,
              findingId: finding.id ?? null,
              findingIdx,
              reference: isLast ? refBadge : `${refBadge} (تتمة)`,
              wordStartIdx: first.k,
              wordEndIdx: last.k,
              isAtomicCitation: false,
            });
            return;
          }
          let chunkText = chunk.map((w) => w.word).join(" ");
          if (canonWords && canonWords.length) {
            const ratioCount = isLast
              ? canonWords.length - canonCursor
              : Math.max(1, Math.round((chunk.length / citationWords.length) * canonWords.length));
            chunkText = canonWords.slice(canonCursor, canonCursor + ratioCount).join(" ");
            canonCursor += ratioCount;
          }
          const openB = isFirst ? brackets.open : `${brackets.open}… `;
          const closeB = isLast ? brackets.close : ` …${brackets.close}`;
          captions.push({
            index: captions.length + 1,
            start: round2(first.start),
            end: round2(last.end),
            text: chunkText,
            displayText: `${openB}${chunkText}${closeB}${badge}`,
            type: fType,
            findingId: finding.id ?? null,
            findingIdx,
            reference: isLast ? refBadge : `${refBadge} (تتمة)`,
            wordStartIdx: first.k,
            wordEndIdx: last.k,
            isAtomicCitation: false,
          });
        });
      }
      // the quote ends: speech resumes in a fresh caption
      i = endIdx + 1;
      continue;
    }

    const currWord = words[i];
    normalBuffer.push(i);
    const bufLen = normalBuffer.length;
    const bufDuration = currWord.end - words[normalBuffer[0]].start;
    const nextWord = i + 1 < totalWords ? words[i + 1] : null;
    const nextIsCitation = i + 1 < totalWords && findingByStartWord.has(i + 1);
    const pauseGap = nextWord ? nextWord.start - currWord.end : 999;
    const endsSentence = /[.؟!؛\n]/.test(currWord.word);
    if (nextIsCitation || bufLen >= 12 || bufDuration >= 5.0 || pauseGap > 0.4 || (endsSentence && bufLen >= 4)) {
      flushNormalBuffer();
    }
    i++;
  }
  flushNormalBuffer();
  captions.forEach((c, idx) => {
    c.index = idx + 1;
  });
  return captions;
}

// ---- the caption timing editor (F-068, phase 16) ---------------------------------------------------------------

/** One edit of the caption timing editor, anchored on a word so it survives a rebuild of the captions:
 *  split  the speech caption holding `word` into two, the second starting at `word`;
 *  merge  the speech caption starting at `word` into the one before it;
 *  time   new start and/or end (seconds) for the caption starting at `word`.
 *  Quotes are locked units: an edit that would split or merge a quote caption is skipped. */
export type CaptionEdit =
  | { op: "split"; word: number }
  | { op: "merge"; word: number }
  | { op: "time"; word: number; start?: number | null; end?: number | null };

/** What an edit would do to these captions, or why it can't be done ("locked" for a quote, "none" when no caption
 *  fits). */
export function checkCaptionEdit(captions: Caption[], edit: CaptionEdit): "ok" | "locked" | "none" {
  if (edit.op === "split") {
    const c = captions.find((x) => x.wordStartIdx <= edit.word && edit.word <= x.wordEndIdx);
    if (!c) return "none";
    if (c.type !== "normal") return "locked";
    return c.wordStartIdx < edit.word ? "ok" : "none";
  }
  const k = captions.findIndex((x) => x.wordStartIdx === edit.word);
  if (k < 0) return "none";
  if (edit.op === "merge") {
    if (k === 0) return "none";
    return captions[k].type === "normal" && captions[k - 1].type === "normal" ? "ok" : "locked";
  }
  return "ok";
}

/** The captions with the timing editor's edits applied in order (a new list; the input is not changed). */
export function applyCaptionEdits(captions: Caption[], words: CaptionWord[], edits: CaptionEdit[] = []): Caption[] {
  let out = captions.map((c) => ({ ...c }));
  const speech = (s: number, e: number, start: number, end: number): Caption => {
    const text = words.slice(s, e + 1).map((w) => w.word).join(" ");
    return { index: 0, start, end, text, displayText: text, type: "normal", findingId: null, findingIdx: -1, reference: "",
      wordStartIdx: s, wordEndIdx: e, isAtomicCitation: false };
  };
  for (const edit of edits) {
    if (checkCaptionEdit(out, edit) !== "ok") continue;
    if (edit.op === "split") {
      const k = out.findIndex((x) => x.wordStartIdx < edit.word && edit.word <= x.wordEndIdx);
      const c = out[k];
      const left = speech(c.wordStartIdx, edit.word - 1, c.start, round2(Math.max(c.start, words[edit.word - 1].end)));
      const right = speech(edit.word, c.wordEndIdx, round2(Math.min(c.end, words[edit.word].start)), c.end);
      out.splice(k, 1, left, right);
    } else if (edit.op === "merge") {
      const k = out.findIndex((x) => x.wordStartIdx === edit.word);
      const a = out[k - 1], b = out[k];
      out.splice(k - 1, 2, speech(a.wordStartIdx, b.wordEndIdx, a.start, b.end));
    } else {
      const c = out.find((x) => x.wordStartIdx === edit.word)!;
      const start = typeof edit.start === "number" ? round2(Math.max(0, edit.start)) : c.start;
      const end = typeof edit.end === "number" ? round2(edit.end) : c.end;
      c.start = Math.min(start, end);
      c.end = Math.max(start, end);
    }
  }
  out = out.map((c, i) => ({ ...c, index: i + 1 }));
  return out;
}
