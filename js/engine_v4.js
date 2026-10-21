/* =============================================================================
   WAHY ENGINE v4  —  js/engine_v4.js            (load AFTER js/engine.js)
   -----------------------------------------------------------------------------
   Drop-in replacement for `QuotationMatcherJS` (same constructor signature, same
   detection object shape, same formatAnnotatedTranscript()).

   Design (why it differs from v3):
   1. ONE scoring model.  Every candidate (verse / hadith / dhikr) is scored by a
      banded local alignment (Smith-Waterman style, affine-ish gaps) whose match
      weights are IDF-based (rarity inside that corpus).  No per-phrase patches.
   2. Interruptions are priced, not special-cased:  extra transcript words between
      two verse-adjacent islands cost  open + ext*k;  a far-side island is only
      bridged when it carries more evidence than the gap costs.  Trailing speech
      is never absorbed (local alignment ends on a matched word).
   3. Ambiguity is computed, not guessed:  every unit whose alignment is within a
      margin of the best joins the candidate set.  VERIFIED requires a unique
      winner;  ties become AMBIGUOUS with the full candidate list.
   4. Priority QURAN > HADITH > ADHKAR is applied when explanations COMPETE for the
      same words (conflict multipliers 1.0 / 0.55 / 0.35 on evidence), so a short
      Quran fragment cannot hijack a long hadith, but a full verse always beats
      a dhikr that merely contains it.  Verses quoted inside a hadith are kept as
      `embeddedQuran`;  a dhikr that is really a verse/hadith is tagged
      `alsoAdhkar` on the winner.
   5. Qiraat (Warsh etc.), fused/split ASR tokens, honorific ligatures and the
      cue / formula lists are REUSED from engine.js (no duplication).
   ============================================================================= */

const WV4_DEFAULTS = {
  idfCap: 9.0,
  lowSpecMul: 0.30,          // weight multiplier for very common words
  formulaMul: 0.20,          // weight multiplier inside quarantined formulas (Quran, when uncued)
  formulaMulHadith: 0.05,    // ... for hadith: khutbat al-haja & co. never count as evidence
  maxTGap: 12,               // max extra transcript words between two aligned words
  maxVGap: 3,                // max skipped verse/hadith words between two aligned words
  gapTOpen: 1.6, gapTExt: 0.7,
  gapVOpen: 1.0, gapVExt: 0.55,        // x weight of the skipped word
  mismatchBase: 0.5, mismatchMul: 0.35,
  segmentGapMin: 3,          // transcript gap >= this is reported as commentary
  seedMinMass: 6.5, singleSeedMass: 8.6,
  bgMax: 250, uniMax: 40, uniMinW: 4.5, bigramMinMass: 2.8,
  clusterGapT: 22, clusterGapD: 20, clusterMaxSpan: 80,
  maxClustersPerRegion: 60,
  ambAbs: 1.5, ambRel: 0.06,
  conflictMul: { QURAN: 1.0, HADITH: 0.55, ADHKAR: 0.35 },
  th: {
    QURAN:  { cand: 14, ver: 26, amb: 20 },
    HADITH: { cand: 22, ver: 48, amb: 34 },
    ADHKAR: { cand: 22, ver: 34, amb: 30 }
  },
  completeVerse: { cand: 13, ver: 17, amb: 15, candCue: 10, verCue: 14, ambCue: 13 },
  quranCarrierShare: 0.7,
  cueBonus: 3.0, continuityBonus: 5.0, surahBonus: 3.0,
  maxListedCandidates: 12, maxPerBookListed: 3
};

const WV4_ADHKAR_CUES = new Set(["يقول","تقول","قل","قولوا","فقل","فقولوا","ذكر","الذكر","اذكار","الاذكار","دعاء","الدعاء","ادعيه","الادعيه","يدعو","ويقول","وتقول","فيقول","فتقول","اذكاره","وردا","ورد"]);
const WV4_TAKHRIJ_TAILS = [
  ["قال", "ابو", "عيسي"], ["قال", "الترمذي"], ["وفي", "الباب", "عن"], ["وهذا", "حديث", "حسن"],
  ["وهذا", "اسناد", "صحيح"], ["متفق", "عليه"], ["رواه", "السبعه"], ["اخرجه", "البخاري"],
  ["قال", "ابو", "داود"], ["قال", "الشيخ", "الالباني"], ["قال", "ابو", "عبد", "الرحمن"]
];

/* Matn extraction: prefer the Prophetic quote marks used by the hadith-api
   editions;  fall back to the (patched) stripIsnad() of engine.js. */
function wv4_extractMatn(rawText) {
  let text = expandHonorificLigatures(rawText || "");
  const q = text.search(/["“«]/);
  let matn = null;
  if (q > 0) {
    const pre = text.slice(0, q).match(WORD_TOKEN_RE) || [];
    if (pre.length >= 3) {
      const after = text.slice(q + 1).replace(/["“”«»]/g, " ").replace(/\s+/g, " ").trim();
      if ((after.match(WORD_TOKEN_RE) || []).length >= 3) matn = after;
    }
  }
  if (matn === null) matn = stripIsnad(text);
  const toks = tokenizeText(matn);
  const norms = toks.map(t => t.norm);
  for (let i = 4; i < norms.length - 1; i++) {
    for (const tail of WV4_TAKHRIJ_TAILS) {
      let ok = true;
      for (let k = 0; k < tail.length; k++) if (norms[i + k] !== tail[k]) { ok = false; break; }
      if (ok) return matn.slice(0, toks[i - 1].charEnd);
    }
  }
  return matn;
}

class WahyEngine {
  constructor(quranData, hadithData, params = {}, adhkarData, outsideHadithData) {
    if (adhkarData === undefined) adhkarData = (typeof RAW_ADHKAR_DATA !== "undefined") ? RAW_ADHKAR_DATA : [];
    if (outsideHadithData === undefined) outsideHadithData = (typeof RAW_OUTSIDE_HADITH_DATA !== "undefined") ? RAW_OUTSIDE_HADITH_DATA : [];
    const P = Object.assign({}, WV4_DEFAULTS, params.v4 || {});
    P.th = Object.assign({}, WV4_DEFAULTS.th, (params.v4 && params.v4.th) || {});
    if (params.maxTranscriptGap) P.maxTGap = params.maxTranscriptGap;      // same UI sliders as v3
    if (params.maxVerseGap !== undefined) P.maxVGap = params.maxVerseGap;
    this.P = P;

    this.units = new Map();
    this.quranUnits = []; this.hadithUnits = []; this.adhkarUnits = []; this.outsideHadithUnits = [];
    this.unitList = [];
    this._qmemo = new Map();
    this._farshUnits = new Set(Object.keys(QIRAAT_FARSH_VARIANTS).map(k => k.split("|")[0]));
    this._cueCache = null;

    const surahName = s => (typeof SURAH_NAMES_AR !== "undefined" && SURAH_NAMES_AR[s]) || `سورة ${s}`;
    for (const q of quranData) {
      let toks = tokenizeText(q.t);
      // some corpora (e.g. Tanzil) prefix the basmalah to ayah 1 of every surah except 1 and 9: it is not part of the ayah
      if (q.a === 1 && q.s !== 1 && q.s !== 9 && toks.length > 4 &&
          toks[0].norm === "بسم" && toks[1].norm === "الله" && toks[2].norm === "الرحمن" && toks[3].norm === "الرحيم") toks = toks.slice(4);
      this._addUnit({
        sourceType: "QURAN", unitId: `${q.s}:${q.a}`, surah: q.s, ayah: q.a,
        displayRef: `${surahName(q.s)}: ${q.a}`,
        vocalizedWords: toks.map(t => t.raw), normWords: toks.map(t => t.norm), fullText: q.t
      }, this.quranUnits);
    }
    const addHadith = (h, outside) => {
      // a corpus that ships its own isnad/matn split (Open Hadith Data) is used as-is; otherwise guess the cut
      const matn = h.matn ? expandHonorificLigatures(h.matn)
        : ((h.book === "Builtin" || outside) ? (outside ? wv4_extractMatn(h.t || "") : h.t) : wv4_extractMatn(h.t));
      const toks = tokenizeText(matn);
      if (toks.length < 2) return;
      const u = {
        sourceType: "HADITH", unitId: h.id,
        bookKey: h.book || String(h.id).split(":")[0] || "Builtin",
        surah: 0, ayah: 0, displayRef: h.ref,
        vocalizedWords: toks.map(t => t.raw), normWords: toks.map(t => t.norm), fullText: h.t
      };
      if (outside) u.isOutsideCorpus = true;
      this._addUnit(u, outside ? this.outsideHadithUnits : this.hadithUnits);
    };
    for (const h of hadithData) addHadith(h, false);
    for (const a of (adhkarData || [])) {
      const toks = tokenizeText(a.t);
      if (toks.length < 2) continue;
      this._addUnit({
        sourceType: "ADHKAR", unitId: a.id, bookKey: "Adhkar", surah: 0, ayah: 0,
        displayRef: "ذكر", category: a.category || "", dhikrRef: a.ref || "",
        vocalizedWords: toks.map(t => t.raw), normWords: toks.map(t => t.norm), fullText: a.t
      }, this.adhkarUnits);
    }
    for (const oh of (outsideHadithData || [])) addHadith(Object.assign({ book: "Outside" }, oh), true);
    this._buildIndex();
  }

  _addUnit(u, bucket) {
    u.typeCode = u.sourceType === "QURAN" ? 0 : (u.sourceType === "HADITH" ? 1 : 2);
    u.idx = this.unitList.length;
    this.unitList.push(u);
    this.units.set(u.unitId, u);
    bucket.push(u);
  }

  /* ---------------------------------------------------------------- index */
  _buildIndex() {
    const P = this.P, units = this.unitList, U = units.length;
    let total = 0;
    for (const u of units) total += u.normWords.length;
    const W = new Int32Array(total), unitOfPos = new Int32Array(total), unitStart = new Int32Array(U + 1);
    const vocab = new Map(), words = [];
    let p = 0;
    for (let ui = 0; ui < U; ui++) {
      const u = units[ui]; unitStart[ui] = p;
      for (const w of u.normWords) {
        let id = vocab.get(w);
        if (id === undefined) { id = words.length; vocab.set(w, id); words.push(w); }
        W[p] = id; unitOfPos[p] = ui; p++;
      }
      u.wids = W.subarray(unitStart[ui], p);
    }
    unitStart[U] = p;
    const V = words.length;

    // type-specific document frequencies -> IDF weights
    const dfT = [new Int32Array(V), new Int32Array(V), new Int32Array(V)];
    const nT = [0, 0, 0];
    const stamp = new Int32Array(V).fill(-1);
    for (let ui = 0; ui < U; ui++) {
      const u = units[ui], t = u.typeCode; nT[t]++;
      for (let k = 0; k < u.wids.length; k++) {
        const id = u.wids[k];
        if (stamp[id] !== ui) { stamp[id] = ui; dfT[t][id]++; }
      }
    }
    // adhkar words are judged against hadith+adhkar usage (they overlap heavily)
    const wt = [new Float32Array(V), new Float32Array(V), new Float32Array(V)];
    const wmax = new Float32Array(V);
    for (let id = 0; id < V; id++) {
      const low = isLowSpecWord(words[id]);
      for (let t = 0; t < 3; t++) {
        const df = t === 2 ? dfT[1][id] + dfT[2][id] : dfT[t][id];
        const N = t === 2 ? nT[1] + nT[2] : nT[t];
        let w = Math.min(P.idfCap, Math.log((N + 1) / (df + 0.5)));
        if (w < 0) w = 0;
        if (low) w *= P.lowSpecMul;
        wt[t][id] = w;
        if (dfT[t][id] > 0 || (t === 2 && dfT[1][id] > 0)) if (w > wmax[id]) wmax[id] = w;
      }
    }

    // bigram CSR
    const M = V < 262144 ? 262144 : 1048576;
    const bgMap = new Map(); const counts = [];
    for (let ui = 0; ui < U; ui++) {
      const ids = units[ui].wids;
      for (let k = 0; k < ids.length - 1; k++) {
        const a = ids[k], b = ids[k + 1];
        if (wmax[a] + wmax[b] < P.bigramMinMass) continue;
        const key = a * M + b;
        let s = bgMap.get(key);
        if (s === undefined) { s = counts.length; bgMap.set(key, s); counts.push(0); }
        counts[s]++;
      }
    }
    const bgStart = new Int32Array(counts.length + 1);
    for (let s = 0; s < counts.length; s++) bgStart[s + 1] = bgStart[s] + counts[s];
    const bgPos = new Int32Array(bgStart[counts.length]);
    const fill = bgStart.slice(0, counts.length);
    for (let ui = 0; ui < U; ui++) {
      const ids = units[ui].wids, base = unitStart[ui];
      for (let k = 0; k < ids.length - 1; k++) {
        const a = ids[k], b = ids[k + 1];
        if (wmax[a] + wmax[b] < P.bigramMinMass) continue;
        bgPos[fill[bgMap.get(a * M + b)]++] = base + k;
      }
    }

    // rare-unigram CSR
    const posCount = new Int32Array(V);
    for (let i = 0; i < total; i++) posCount[W[i]]++;
    const uniElig = new Uint8Array(V);
    const uniStart = new Int32Array(V + 1);
    for (let id = 0; id < V; id++) {
      uniElig[id] = (posCount[id] <= P.uniMax && wmax[id] >= P.uniMinW) ? 1 : 0;
      uniStart[id + 1] = uniStart[id] + (uniElig[id] ? posCount[id] : 0);
    }
    const uniPos = new Int32Array(uniStart[V]);
    const ufill = uniStart.slice(0, V);
    for (let i = 0; i < total; i++) { const id = W[i]; if (uniElig[id]) uniPos[ufill[id]++] = i; }

    // delete-neighbourhood map for ASR-damaged rare words
    const delMap = new Map();
    const addDel = (key, id) => { let a = delMap.get(key); if (!a) { a = []; delMap.set(key, a); } if (a.length < 6) a.push(id); };
    for (let id = 0; id < V; id++) {
      if (!uniElig[id]) continue;
      const w = words[id]; if (w.length < 4) continue;
      addDel(w, id);
      for (let k = 0; k < w.length; k++) addDel(w.slice(0, k) + w.slice(k + 1), id);
    }

    Object.assign(this, { vocab, words, W, unitOfPos, unitStart, wt, wmax, M, bgMap, bgStart, bgPos, uniElig, uniStart, uniPos, delMap, V });
    this._H = new Float32Array(130 * 190); this._Pp = new Int32Array(130 * 190); this._K = new Uint8Array(130 * 190);
  }

  /* v3-compatible rarity score for a normalized word, used by the editor/inspector (FN Studio suggestions,
     re-aligning a finding after its boundaries change). Same meaning as QuotationMatcherJS.getIdf. */
  getIdf(normWord) {
    if (typeof MUQATTAAT_WORDS !== "undefined" && MUQATTAAT_WORDS.has(normWord)) return 6.5;
    const w = id => (id === undefined ? undefined : this.wmax[id]);
    const full = w(this.vocab.get(normWord));
    const base = w(this.vocab.get(stripProclitic(normWord)));
    if (full !== undefined && base !== undefined) return Math.min(full, base);
    if (full !== undefined) return full;
    if (base !== undefined) return base;
    return isLowSpecWord(normWord) ? 0.2 : 5.5;
  }

  _fuzzyIds(norm) {
    const out = [], seen = new Set();
    const push = ids => { if (!ids) return; for (const id of ids) if (!seen.has(id) && out.length < 4) { seen.add(id); out.push(id); } };
    push(this.delMap.get(norm));
    for (let k = 0; k < norm.length; k++) push(this.delMap.get(norm.slice(0, k) + norm.slice(k + 1)));
    return out.filter(id => {
      const w = this.words[id];
      return Math.abs(w.length - norm.length) <= 1 && levenshteinLe1(norm, w);
    });
  }

  _qual(a, b, unit) {
    if (Math.abs(a.length - b.length) > 3) return 0;
    const key = a + "|" + b + ((unit.typeCode === 0 && this._farshUnits.has(unit.unitId)) ? "|" + unit.unitId : "");
    let q = this._qmemo.get(key);
    if (q !== undefined) return q;
    q = matchWordWithQiraat(a, b, unit.typeCode === 0 ? unit.unitId : "", "").qual;
    if (this._qmemo.size > 300000) this._qmemo.clear();
    this._qmemo.set(key, q);
    return q;
  }

  /* ----------------------------------------------------- transcript context */
  _prepare(tN) {
    const P = this.P, n = tN.length;
    const fm = new Float32Array(n).fill(1);       // QURAN: cue-exempt formula mask
    const fmH = new Float32Array(n).fill(1);      // HADITH: formulas (khutbat al-haja, tasliya ...) never count
    const cueQ = p => QuotationMatcherJS.prototype._hasCitationCue(tN, p, "QURAN");
    for (const f of QUARANTINED_FORMULAS) {
      const L = f.length;
      for (let p = 0; p + L <= n; p++) {
        let ok = true;
        for (let k = 0; k < L; k++) if (tN[p + k] !== f[k]) { ok = false; break; }
        if (!ok) continue;
        for (let k = 0; k < L; k++) fmH[p + k] = Math.min(fmH[p + k], P.formulaMulHadith);
        if (cueQ(p)) continue;
        for (let k = 0; k < L; k++) fm[p + k] = Math.min(fm[p + k], P.formulaMul);
      }
    }
    const surahMentions = [];
    if (typeof SURAH_NAME_TO_NUM !== "undefined") {
      for (let i = 0; i + 1 < n; i++) {
        if (tN[i] === "سوره" || stripProclitic(tN[i]) === "سوره") {
          const s = SURAH_NAME_TO_NUM[tN[i + 1]];
          if (s) surahMentions.push({ pos: i, surah: s });
        }
      }
    }
    return { fm, fmH, surahMentions };
  }

  /* ------------------------------------------------------------- seeding */
  _clusters(tN, tIds) {
    const P = this.P, n = tN.length;
    const buckets = new Map();
    const add = (i, p) => {
      const ui = this.unitOfPos[p], j = p - this.unitStart[ui];
      let b = buckets.get(ui); if (!b) { b = []; buckets.set(ui, b); }
      b.push(i, j);
    };
    for (let i = 0; i < n; i++) {
      const id = tIds[i];
      if (id >= 0) {
        if (i + 1 < n && tIds[i + 1] >= 0) {
          const s = this.bgMap.get(id * this.M + tIds[i + 1]);
          if (s !== undefined) {
            const a = this.bgStart[s], e = this.bgStart[s + 1];
            if (e - a <= P.bgMax) for (let k = a; k < e; k++) add(i, this.bgPos[k]);
          }
        }
        if (this.uniElig[id]) for (let k = this.uniStart[id]; k < this.uniStart[id + 1]; k++) add(i, this.uniPos[k]);
      } else if (tN[i].length >= 4) {
        for (const alt of this._fuzzyIds(tN[i])) {
          if (!this.uniElig[alt]) continue;
          for (let k = this.uniStart[alt]; k < this.uniStart[alt + 1]; k++) add(i, this.uniPos[k]);
        }
      }
    }
    const clusters = [];
    for (const [ui, seeds] of buckets) {
      const unit = this.unitList[ui], wt = this.wt[unit.typeCode];
      let cur = null;
      const flush = () => {
        if (!cur) return;
        // mass = sum over distinct transcript positions of the best seed weight
        let mass = 0, lastI = -1, best = 0, distinct = 0;
        for (let k = 0; k < cur.s.length; k += 3) {
          const i = cur.s[k];
          if (i !== lastI) { mass += best; best = 0; lastI = i; distinct++; }
          if (cur.s[k + 2] > best) best = cur.s[k + 2];
        }
        mass += best;
        // one lone seed word must be very rare; otherwise two distinct transcript words must agree
        if (mass >= P.seedMinMass && (distinct >= 2 || mass >= P.singleSeedMass)) { cur.mass = mass; clusters.push(cur); }
        cur = null;
      };
      // group seeds by diagonal (d = j - i) first, then by transcript proximity inside a diagonal group
      const sd = [];
      for (let k = 0; k < seeds.length; k += 2) sd.push({ i: seeds[k], j: seeds[k + 1], d: seeds[k + 1] - seeds[k] });
      sd.sort((a, b) => a.d - b.d || a.i - b.i);
      const dgroups = []; let dg = null;
      for (const x of sd) {
        if (!dg || x.d - dg.last > P.clusterGapD) { dg = { items: [], last: x.d }; dgroups.push(dg); }
        dg.items.push(x); dg.last = x.d;
      }
      for (const grp of dgroups) {
        grp.items.sort((a, b) => a.i - b.i || a.j - b.j);
        for (const x of grp.items) {
          const i = x.i, j = x.j, w = wt[unit.wids[j]];
          if (cur && (i - cur.i1 > P.clusterGapT || i - cur.i0 > P.clusterMaxSpan)) flush();
          if (!cur) cur = { ui, i0: i, i1: i, j0: j, j1: j, d: x.d, s: [] };
          cur.i1 = i; if (j < cur.j0) cur.j0 = j; if (j > cur.j1) cur.j1 = j;
          cur.s.push(i, j, w);
        }
        flush();
      }
      flush();
    }
    clusters.sort((a, b) => b.mass - a.mass);
    return clusters;
  }

  /* ------------------------------------------------------------ alignment */
  _align(unit, tN, tIds, fm, c, tw) {
    const P = this.P, n0 = tN.length, vN = unit.normWords, len = vN.length;
    const i0 = Math.max(0, c.i0 - 4), j0 = Math.max(0, c.j0 - 6);
    const n = Math.min(120, Math.min(n0 - 1, c.i1 + 6) - i0 + 1);
    const m = Math.min(180, Math.min(len - 1, c.j1 + 8) - j0 + 1);
    if (n < 1 || m < 1) return null;
    const H = this._H, PP = this._Pp, K = this._K;
    const wt = this.wt[unit.typeCode], wids = unit.wids;
    const wv = new Float32Array(m);
    for (let b = 0; b < m; b++) wv[b] = wt[wids[j0 + b]];
    const G = P.maxTGap, D = P.maxVGap;
    const gT = new Float32Array(G + 1);
    for (let g = 1; g <= G; g++) gT[g] = P.gapTOpen + P.gapTExt * g;

    let predV = 0, predI = -1;
    const bestPred = (as, b) => {
      predV = 0; predI = -1;
      if (as < 1 || b < 1) return;
      for (let g = 0; g <= G && as - 1 - g >= 0; g++) {
        const h = H[(as - 1 - g) * m + (b - 1)];
        if (h > 0) { const v = h - gT[g]; if (v > predV) { predV = v; predI = (as - 1 - g) * m + (b - 1); } }
      }
      let skip = 0;
      for (let d = 1; d <= D && b - 1 - d >= 0; d++) {
        skip += wv[b - d] * P.gapVExt;
        const h = H[(as - 1) * m + (b - 1 - d)];
        if (h > 0) { const v = h - P.gapVOpen - skip; if (v > predV) { predV = v; predI = (as - 1) * m + (b - 1 - d); } }
      }
    };

    let bestEnd = 0, bestIdx = -1;
    for (let a = 0; a < n; a++) {
      const i = i0 + a, tid = tIds[i], tn = tN[i], f = fm[i];
      for (let b = 0; b < m; b++) {
        const j = j0 + b, idx = a * m + b;
        const q = (tid === wids[j]) ? 1 : this._qual(tn, vN[j], unit);
        const sc = q > 0 ? q * Math.min(wv[b], tw[i]) * f : -(P.mismatchBase + P.mismatchMul * Math.min(wv[b], 6));
        bestPred(a, b);
        let val = predV + sc, pI = predI, kind = 0, isMatch = q > 0;
        if (a >= 1 && q < 1 && (a - 1) >= 0) {
          if (isFusedTwoToOneMatch(tN[i - 1], tn, vN[j])) {
            bestPred(a - 1, b);
            const v2 = predV + 0.92 * Math.min(wv[b], tw[i], tw[i - 1]) * Math.min(f, fm[i - 1]);
            if (v2 > val) { val = v2; pI = predI; kind = 1; isMatch = true; }
          }
        }
        if (val <= 0) { H[idx] = 0; PP[idx] = -1; K[idx] = 0; continue; }
        H[idx] = val; PP[idx] = pI; K[idx] = kind;
        if (isMatch && val > bestEnd) { bestEnd = val; bestIdx = idx; }
      }
    }
    if (bestIdx < 0) return null;

    const path = [];
    for (let idx = bestIdx; idx >= 0; idx = PP[idx]) {
      const a = (idx / m) | 0, b = idx - a * m, kind = K[idx];
      path.push({ i: i0 + a, j: j0 + b, kind });
    }
    path.reverse();
    return { S: bestEnd, path, i0, j0 };
  }

  _describe(unit, al, tN, fm, tw) {
    const P = this.P, vN = unit.normWords, voc = unit.vocalizedWords, wt = this.wt[unit.typeCode];
    const cells = [];
    let E = 0, matched = 0, content = 0, run = 0, exactRun = 0, qir = null, qirCells = 0;
    let prev = null;
    for (const p of al.path) {
      const tS = p.kind === 1 ? p.i - 1 : p.i;
      const r = matchWordWithQiraat(tN[p.i], vN[p.j], unit.typeCode === 0 ? unit.unitId : "", voc[p.j]);
      let q = p.kind === 1 ? 0.92 : r.qual;
      cells.push({ tS, tE: p.i + 1, j: p.j, q, vocOverride: r.vocOverride });
      if (q > 0) {
        matched++;
        E += q * Math.min(wt[unit.wids[p.j]], tw[p.i]) * fm[p.i];
        if (r.qiraah) qirCells++;
        if (q >= 0.85 && !isLowSpecWord(vN[p.j])) content++;
        if (r.qiraah && (qir === null || (QIRAAT_PRIORITY_RANK[r.qiraah] || 99) < (QIRAAT_PRIORITY_RANK[qir] || 99))) qir = r.qiraah;
        if (q >= 0.95 && prev && prev.q >= 0.95 && tS === prev.tE && p.j === prev.j + 1) run++; else run = 1;
        if (run > exactRun) exactRun = run;
      }
      prev = cells[cells.length - 1];
    }
    const segs = [], qsegs = [], gaps = [];
    let tS = cells[0].tS, qS = cells[0].j, pTE = cells[0].tE, pJ = cells[0].j;
    for (let k = 1; k < cells.length; k++) {
      const c = cells[k];
      if (c.tS - pTE >= P.segmentGapMin) {
        segs.push([tS, pTE]); qsegs.push([qS, pJ + 1]); gaps.push([pTE, c.tS]);
        tS = c.tS; qS = c.j;
      }
      pTE = c.tE; pJ = c.j;
    }
    segs.push([tS, pTE]); qsegs.push([qS, pJ + 1]);

    const overrides = new Map();
    for (const c of cells) if (c.vocOverride) overrides.set(c.j, c.vocOverride);
    const canonicalSegments = qsegs.map(([qs, qe]) => {
      const parts = [];
      for (let j = qs; j < qe; j++) parts.push(overrides.get(j) || voc[j]);
      return parts.join(" ");
    });
    const tokenSet = new Set();
    for (const [s, e] of segs) for (let k = s; k < e; k++) tokenSet.add(k);
    return {
      unit, type: unit.sourceType, S: al.S - 0.6 * qirCells, E, matched, content, exactRun,
      coverage: matched / Math.max(1, vN.length), qiraah: qir,
      tStart: segs[0][0], tEnd: segs[segs.length - 1][1],
      segments: segs, qSegments: qsegs, commentaryGaps: gaps, canonicalSegments,
      tokenSet, ntok: tokenSet.size
    };
  }

  /* --------------------------------------------------------------- detect */
  detect(transcript) {
    const P = this.P;
    const tokens = tokenizeText(transcript);
    const n = tokens.length;
    if (n < 2) return [];
    const tN = tokens.map(t => t.norm);
    const tIds = new Int32Array(n);
    for (let i = 0; i < n; i++) { const id = this.vocab.get(tN[i]); tIds[i] = id === undefined ? -1 : id; }
    const ctx = this._prepare(tN);
    ctx.tIds = tIds;
    ctx.tw = [0, 1, 2].map(t => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = tIds[i] >= 0 ? this.wt[t][tIds[i]] : 99; return a; });
    const clusters = this._clusters(tN, tIds);

    const results = [];
    const regionCount = new Int16Array(n);
    this.lastStats = { clusters: clusters.length, dp: 0, errors: 0 };
    for (const c of clusters) {
      const mid = (c.i0 + c.i1) >> 1;
      if (regionCount[mid] >= P.maxClustersPerRegion) continue;
      regionCount[mid]++;
      const unit = this.unitList[c.ui];
      try {
        const tw = ctx.tw[unit.typeCode];
        const fmUse = unit.typeCode === 2 ? (ctx.fmNone || (ctx.fmNone = new Float32Array(n).fill(1))) : (unit.typeCode === 1 ? ctx.fmH : ctx.fm);
        const al = this._align(unit, tN, tIds, fmUse, c, tw);
        this.lastStats.dp++;
        if (!al) continue;
        const th = P.th[unit.sourceType];
        if (al.S < th.cand * (unit.typeCode === 0 ? 0.35 : 0.55)) continue;
        const r = this._describe(unit, al, tN, fmUse, tw);
        results.push(r);
      } catch (e) { this.lastStats.errors++; this.lastError = e; }
    }
    this.lastResults = results;
    try { return this._finalize(results, tokens, tN, ctx); }
    catch (e) { this.lastError = e; this.lastStats.errors++; return []; }   // never take the whole lecture down
  }

  /* ------------------------------------------------------------ selection */
  /* thresholds for one candidate; a COMPLETE short verse is a far stronger claim than a fragment of the same score */
  _thr(t, cue) {
    const base = this.P.th[t.type];
    if (t.type === "QURAN" && t.coverage >= 0.99 && t.unit.normWords.length >= 3 && t.unit.normWords.length <= 10) {
      const c = this.P.completeVerse;
      return cue ? { cand: c.candCue, ver: c.verCue, amb: c.ambCue } : { cand: c.cand, ver: c.ver, amb: c.amb };
    }
    if (t.type === "ADHKAR" && cue) return { cand: 12, ver: 30, amb: 24 };
    return base;
  }

  _delta(S) { return Math.max(this.P.ambAbs, this.P.ambRel * S); }

  _finalize(results, tokens, tN, ctx) {
    const P = this.P, n = tokens.length;
    const BOOK_RANK = { Bukhari: 0, Muslim: 1, AbiDawud: 2, Tirmidhi: 3, Nasai: 4, IbnMajah: 5, Muwatta: 6, Nawawi40: 7, Qudsi40: 8 };
    for (const r of results) r.adj = r.S * P.conflictMul[r.type];
    // Quran-first: consecutive ayat quoted back-to-back are ONE explanation; their summed evidence competes
    {
      const qs = results.filter(r => r.type === "QURAN" && r.S >= P.th.QURAN.cand * 0.9).sort((a, b) => a.tStart - b.tStart);
      const parent = qs.map((_, i) => i);
      const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let a = 0; a < qs.length; a++) for (let b = 0; b < qs.length; b++) {
        if (a === b) continue;
        const ua = qs[a].unit, ub = qs[b].unit;
        // b must FOLLOW a in the transcript AND be the next ayah of the same surah (sequential, not competing)
        const gap = qs[b].tStart - qs[a].tEnd;
        if (ua.surah === ub.surah && ub.ayah === ua.ayah + 1 && gap >= -1 && gap <= 3) parent[find(b)] = find(a);
      }
      const sum = new Map(), best = new Map();
      qs.forEach((r, i) => { const k = find(i); const key = k + ":" + r.unit.ayah; if (!best.has(key) || best.get(key) < r.S) best.set(key, r.S); });
      for (const [key, v] of best) { const k = key.split(":")[0]; sum.set(k, (sum.get(k) || 0) + v); }
      qs.forEach((r, i) => { const tot = sum.get(String(find(i))); if (tot > r.S) r.adj = Math.max(r.adj, tot * P.conflictMul.QURAN); });
    }
    // Quran-first override: a hadith whose matched words are mostly Quran verses (e.g. khutbat al-haja quoting 3:102 / 33:70)
    // is just a carrier for those verses -> the verses win, the hadith is dropped.
    {
      const strongQ = results.filter(r => r.type === "QURAN" && r.S >= P.th.QURAN.ver && r.matched >= 5).sort((a, b) => b.S - a.S);
      if (strongQ.length) {
        for (let k = results.length - 1; k >= 0; k--) {
          const h = results[k];
          if (h.type !== "HADITH") continue;
          const covered = new Set();
          for (const q of strongQ) {
            let inside = 0; for (const t of q.tokenSet) if (h.tokenSet.has(t)) inside++;
            if (inside / q.ntok < 0.9) continue;
            let fresh = 0; for (const t of q.tokenSet) if (!covered.has(t)) fresh++;
            if (fresh / q.ntok < 0.9) continue;
            for (const t of q.tokenSet) covered.add(t);
          }
          if (covered.size / h.ntok >= P.quranCarrierShare) results.splice(k, 1);
        }
      }
    }
    results.sort((a, b) => b.adj - a.adj || b.S - a.S);

    const groups = [];
    for (const r of results) {
      let placed = false;
      for (const g of groups) {
        let ov = 0;
        for (const k of r.tokenSet) if (g.mask.has(k)) ov++;
        const frac = ov / Math.max(1, Math.min(r.ntok, g.top.ntok));
        if (frac >= 0.6) {
          if (r.type === g.top.type && r.S >= g.top.S - this._delta(g.top.S)) g.members.push(r); else g.losers.push(r);
          placed = true; break;
        }
        if (frac > 0.3) { g.losers.push(r); placed = true; break; }
      }
      if (!placed) groups.push({ top: r, members: [r], losers: [], mask: r.tokenSet });
    }

    const cueFor = (g) => {
      const t = g.top;
      const cueType = t.type === "QURAN" ? "QURAN" : "HADITH";
      if (t.type === "ADHKAR") {
        for (let k = Math.max(0, t.tStart - 5); k < t.tStart; k++) if (WV4_ADHKAR_CUES.has(tN[k])) return true;
        return false;
      }
      return QuotationMatcherJS.prototype._hasCitationCue(tN, t.tStart, cueType, t.tEnd);
    };
    for (const g of groups) { g.cue = cueFor(g); g.bonus = 0; g.members = g.members.filter((m, k, arr) => arr.findIndex(x => x.unit === m.unit) === k); }

    // surah-name mention in the 16 tokens before the quote selects among ambiguous verses
    for (const g of groups) {
      if (g.top.type !== "QURAN") continue;
      const near = ctx.surahMentions.filter(s => s.pos < g.top.tStart && g.top.tStart - s.pos <= 16).map(s => s.surah);
      if (!near.length) continue;
      const hit = g.members.filter(m => near.includes(m.unit.surah));
      if (hit.length && hit.length < g.members.length) g.members = hit;
      if (hit.length) g.bonus += P.surahBonus;
    }

    // neighbour logic for consecutive ayat
    const quranGroups = groups.filter(g => g.top.type === "QURAN").sort((a, b) => a.top.tStart - b.top.tStart);
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < quranGroups.length; k++) {
        const g = quranGroups[k];
        if (g.members.length < 2) continue;
        const nb = [];
        if (k > 0 && g.top.tStart - quranGroups[k - 1].top.tEnd <= 3 && quranGroups[k - 1].members.length === 1) nb.push({ u: quranGroups[k - 1].members[0].unit, dir: +1 });
        if (k + 1 < quranGroups.length && quranGroups[k + 1].top.tStart - g.top.tEnd <= 3 && quranGroups[k + 1].members.length === 1) nb.push({ u: quranGroups[k + 1].members[0].unit, dir: -1 });
        for (const x of nb) {
          const hit = g.members.filter(m => m.unit.surah === x.u.surah && m.unit.ayah === x.u.ayah + x.dir);
          if (hit.length === 1) { g.members = hit; g.bonus += P.continuityBonus; break; }
        }
      }
    }
    for (let k = 0; k + 1 < quranGroups.length; k++) {
      const a = quranGroups[k], b = quranGroups[k + 1];
      if (a.members.length !== 1 || b.members.length !== 1) continue;
      const ua = a.members[0].unit, ub = b.members[0].unit;
      if (ua.surah === ub.surah && ub.ayah === ua.ayah + 1 && b.top.tStart - a.top.tEnd <= 3 && b.top.tStart - a.top.tEnd >= -1) {
        a.bonus += P.continuityBonus; b.bonus += P.continuityBonus; a.chained = b.chained = true;
      }
    }

    this.lastGroups = groups;
    this.lastGroups = groups;
    for (const g of groups) {
      g.members.sort((x, y) => y.S - x.S);
      const t0 = g.members[0] || g.top;
      const th = this._thr(t0, g.cue);
      const S = t0.S + g.bonus + (g.cue ? P.cueBonus : 0);
      g.ev = { t0, th, S, pass: S >= th.cand && this._passesGuards(g, t0, S, tokens, tN), rescued: false };
    }
    // neighbour probe: after an accepted ayah, test ayah-1 / ayah+1 directly on the adjacent words.
    // Short verses made only of common words (112:1-2) have no rare seed, but sit right beside a found verse.
    {
      let frontier = groups.filter(g => g.top.type === "QURAN" && g.ev.pass && g.members.length === 1);
      for (let hop = 0; hop < 3 && frontier.length; hop++) {
        const fresh = [];
        for (const g of frontier) {
          const un = g.ev.t0.unit;
          for (const dir of [-1, +1]) {
            const u = this.units.get(`${un.surah}:${un.ayah + dir}`);
            if (!u) continue;
            if (groups.some(o => o.top.type === "QURAN" && o.members.some(m => m.unit === u) && o.top.tStart < g.top.tEnd + 6 && o.top.tEnd > g.top.tStart - 6)) continue;
            const len = u.normWords.length;
            const c = dir > 0
              ? { i0: Math.max(0, g.top.tEnd - 1), i1: Math.min(n - 1, g.top.tEnd + len + 8), j0: 0, j1: len - 1 }
              : { i0: Math.max(0, g.top.tStart - len - 8), i1: Math.min(n - 1, g.top.tStart + 1), j0: 0, j1: len - 1 };
            if (c.i1 < c.i0) continue;
            let al = null, r = null;
            try {
              al = this._align(u, tN, ctx.tIds, ctx.fm, { i0: c.i0 + 4, i1: c.i1 - 6, j0: c.j0 + 6, j1: c.j1 - 8 }, ctx.tw[0]);
              if (al) r = this._describe(u, al, tN, ctx.fm, ctx.tw[0]);
            } catch (e) { continue; }
            if (!r) continue;
            const adjacent = dir > 0 ? (r.tStart >= g.top.tEnd - 1 && r.tStart <= g.top.tEnd + 3) : (r.tEnd <= g.top.tStart + 1 && r.tEnd >= g.top.tStart - 3);
            const okShort = len <= 6 ? (r.coverage >= 0.99 && r.S >= 1.5) : (r.coverage >= 0.6 && r.S >= P.th.QURAN.cand);
            if (!adjacent || !okShort) continue;
            let clash = false;
            for (const o of groups) { if (!o.ev || !o.ev.pass) continue; let ov = 0; for (const k of r.tokenSet) if (o.mask.has(k)) ov++; if (ov / r.ntok > 0.3) { clash = true; break; } }
            if (clash) continue;
            r.adj = r.S;
            const ng = { top: r, members: [r], losers: [], mask: r.tokenSet, cue: false, bonus: P.continuityBonus, chained: true };
            ng.ev = { t0: r, th: this._thr(r, false), S: r.S + P.continuityBonus, pass: true, rescued: true, rescueVerified: g.ev.rescued ? g.ev.rescueVerified : g.ev.S >= g.ev.th.ver };
            groups.push(ng); fresh.push(ng);
          }
        }
        frontier = fresh;
      }
    }
    // a COMPLETE short verse right next to an accepted consecutive ayah is accepted too (e.g. 112:1-2 beside 112:3-4)
    const qg2 = groups.filter(g => g.top.type === "QURAN").sort((x, y) => x.top.tStart - y.top.tStart);
    for (let k = 0; k < qg2.length; k++) {
      const g = qg2[k];
      if (g.ev.pass || g.members.length !== 1 || g.ev.t0.coverage < 0.99 || g.ev.S < 4) continue;
      for (const d of [-1, +1]) {
        const nb = qg2[k + d]; if (!nb || !nb.ev.pass || nb.members.length !== 1) continue;
        const [x, y] = d < 0 ? [nb, g] : [g, nb];
        const ux = x.ev.t0.unit, uy = y.ev.t0.unit, gap = y.top.tStart - x.top.tEnd;
        if (ux.surah === uy.surah && uy.ayah === ux.ayah + 1 && gap >= -1 && gap <= 3) {
          g.ev.pass = true; g.ev.rescued = true; g.ev.rescueVerified = nb.ev.S >= nb.ev.th.ver; g.chained = true; break;
        }
      }
    }
    const dets = [];
    for (const g of groups) {
      if (!g.ev.pass) continue;
      const { t0, th, S } = g.ev;
      const members = g.members.slice().sort((a, b) => (a.type === "HADITH" && b.type === "HADITH")
        ? ((BOOK_RANK[a.unit.bookKey] ?? 9) - (BOOK_RANK[b.unit.bookKey] ?? 9)) || (b.S - a.S)
        : (b.S - a.S));
      const refs = [], ids = [];
      const perBook = {};
      for (const m of members) {
        if (m.type === "HADITH") {
          const b = m.unit.bookKey; perBook[b] = (perBook[b] || 0) + 1;
          if (perBook[b] > P.maxPerBookListed) continue;
        }
        if (refs.length >= P.maxListedCandidates) break;
        refs.push(m.unit.displayRef); ids.push(m.unit.unitId);
      }
      const t = members[0];
      const ambiguous = members.length > 1;
      let band;
      if (t.unit.isOutsideCorpus) band = "VERIFIED";
      else if (g.ev.rescued) band = g.ev.rescueVerified ? "VERIFIED" : "CANDIDATE";
      else if (!ambiguous) band = S >= th.ver ? "VERIFIED" : "CANDIDATE";
      else band = S >= th.amb ? "AMBIGUOUS" : "CANDIDATE";

      const alsoAdhkar = g.losers.filter(l => l.type === "ADHKAR" && l.S >= P.th.ADHKAR.cand * 0.8).slice(0, 2).map(l => ({ unitId: l.unit.unitId, category: l.unit.category, ref: l.unit.dhikrRef }));
      const det = {
        sourceType: t.type, unitId: t.unit.unitId, displayRef: t.unit.displayRef,
        candidateRefs: refs.length ? refs : [t.unit.displayRef],
        candidateUnitIds: ids.length ? ids : [t.unit.unitId],
        candidateCount: members.length,
        isAmbiguous: ambiguous,
        isOutsideCorpus: Boolean(t.unit.isOutsideCorpus),
        confidenceBand: band,
        totalScore: Math.round(S * 100) / 100,
        hasCitationCue: Boolean(g.cue),
        hasFuzzyHeal: t.commentaryGaps.length === 0 && t.matched < (t.tEnd - t.tStart),
        tStart: t.tStart, tEnd: t.tEnd,
        charStart: tokens[t.tStart].charStart, charEnd: tokens[t.tEnd - 1].charEnd,
        segments: t.segments, qSegments: t.qSegments, canonicalSegments: t.canonicalSegments,
        commentaryGaps: t.commentaryGaps,
        qiraah: t.type === "QURAN" ? (t.qiraah || "hafs") : "",
        qiraahDisplay: t.type === "QURAN" ? (QIRAAT_AR_NAME[t.qiraah || "hafs"] || "رواية حفص عن عاصم") : "",
        evidence: { S: Math.round(t.S * 10) / 10, E: Math.round(t.E * 10) / 10, matched: t.matched, content: t.content, exactRun: t.exactRun, coverage: Math.round(t.coverage * 100) / 100, margin: members.length > 1 ? 0 : Math.round((t.S - (g.losers.filter(l => l.type === t.type).reduce((m, l) => Math.max(m, l.S), 0))) * 10) / 10 },
        chainedAyah: Boolean(g.chained)
      };
      if (alsoAdhkar.length) det.alsoAdhkar = alsoAdhkar;
      if (t.type === "HADITH") {
        const emb = [];
        for (const l of g.losers) {
          if (l.type !== "QURAN") continue;
          if (l.matched < 5 || l.S < P.th.QURAN.ver) continue;
          let inside = 0; for (const k of l.tokenSet) if (g.mask.has(k)) inside++;
          if (inside / l.ntok < 0.9) continue;
          const qs = l.qSegments[0], ts = l.segments[0];
          emb.push({ tStart: l.tStart, tEnd: l.tEnd, qStart: qs[0], qEnd: qs[1], unitId: l.unit.unitId, displayRef: l.unit.displayRef, canonical: l.canonicalSegments.join(" ") });
        }
        emb.sort((a, b) => a.tStart - b.tStart);
        const kept = []; for (const e of emb) if (!kept.some(k => e.tStart < k.tEnd && k.tStart < e.tEnd)) kept.push(e);
        if (kept.length && det.segments.length === 1) det.embeddedQuran = kept;
      }
      dets.push(det);
    }
    dets.sort((a, b) => a.tStart - b.tStart || b.totalScore - a.totalScore);
    return dets;
  }

  _passesGuards(g, t, S, tokens, tN) {
    const P = this.P, unit = t.unit, cue = g.cue;
    if (unit.isOutsideCorpus) return t.matched >= 4;
    if (t.type === "QURAN") {
      if (unit.normWords.length === 1) return cue && t.matched >= 1;
      if (unit.normWords.length <= 2) return cue && t.coverage >= 0.99;
      const shortVerse = unit.normWords.length <= 4;
      if (shortVerse) return t.coverage >= 0.99 && (cue || t.content >= 2);
      if (t.matched < 3 || t.content < 2) return false;
      return true;
    }
    if (t.type === "HADITH") {
      if (t.matched < 4 || t.content < 3 || t.exactRun < 3) return false;
      let nasab = 0;
      for (let k = t.tStart; k < t.tEnd; k++) if (tN[k] === "بن" || tN[k] === "ابن") nasab++;
      if (nasab >= 2 && t.content < 7) return false;
      const pre = tN.slice(Math.max(0, t.tStart - 2), t.tStart).join(" ");
      if ((pre.endsWith("حدثنا") || pre.endsWith("اخبرنا") || pre === "الباب عن") && t.content < 5) return false;
      return true;
    }
    // ADHKAR (lowest priority): needs an explicit dhikr cue, or a long contiguous match, or a complete short dhikr
    if (cueQuranBlocks(tN, t)) return false;
    if (cue) return t.matched >= 4 && t.exactRun >= 3 && t.content >= 2;
    return t.content >= 3 && t.exactRun >= 5 && (t.coverage >= 0.8 || S >= P.th.ADHKAR.ver);
  }
}

function cueQuranBlocks(tN, t) {
  return QuotationMatcherJS.prototype._hasCitationCue(tN, t.tStart, "QURAN", t.tEnd);
}

if (typeof QuotationMatcherJS !== "undefined") {
  WahyEngine.prototype.formatAnnotatedTranscript = QuotationMatcherJS.prototype.formatAnnotatedTranscript;
}

/* engine.js (GitHub main) calls groupDetectionsForDisplay() but never defines it, so formatAnnotatedTranscript()
   throws whenever there is at least one detection.  If your local copy defines it, that one is kept;
   otherwise this compatible implementation is installed.
   Group shape: { items:[{det}], isQuranGroup, groupRefLabel, groupQiraah, groupQiraahDisplay } */
if (typeof groupDetectionsForDisplay === "undefined") {
  globalThis.groupDetectionsForDisplay = function (dets, units, groupContiguous) {
    const sorted = (dets || []).slice().sort((a, b) => a.segments[0][0] - b.segments[0][0] || b.totalScore - a.totalScore);
    const groups = [];
    let prevEnd = -1;
    for (const det of sorted) {
      const s = det.segments[0][0], e = det.segments[det.segments.length - 1][1];
      if (s < prevEnd) continue;                     // overlapping detections cannot both be rendered inline
      prevEnd = e;
      const last = groups[groups.length - 1];
      const unit = units && units.get(det.unitId);
      if (det.sourceType === "QURAN") {
        const lastDet = last && last.isQuranGroup ? last.items[last.items.length - 1].det : null;
        const lastUnit = lastDet && units.get(lastDet.unitId);
        const lastEnd = lastDet ? lastDet.segments[lastDet.segments.length - 1][1] : -1;
        if (groupContiguous && lastDet && unit && lastUnit && !det.isAmbiguous && !lastDet.isAmbiguous &&
            unit.surah === lastUnit.surah && unit.ayah === lastUnit.ayah + 1 && s - lastEnd <= 3) {
          last.items.push({ det });
          continue;
        }
        groups.push({ items: [{ det }], isQuranGroup: true });
      } else {
        groups.push({ items: [{ det }], isQuranGroup: false });
      }
    }
    for (const g of groups) {
      if (!g.isQuranGroup) continue;
      const first = g.items[0].det, last = g.items[g.items.length - 1].det;
      if (g.items.length === 1) g.groupRefLabel = first.displayRef;
      else {
        const name = String(first.displayRef).split(":")[0].trim();
        const u1 = units.get(first.unitId), u2 = units.get(last.unitId);
        g.groupRefLabel = `${name}: ${u1.ayah}-${u2.ayah}`;
      }
      const nonHafs = g.items.map(x => x.det).find(d => d.qiraah && d.qiraah !== "hafs");
      g.groupQiraah = nonHafs ? nonHafs.qiraah : "hafs";
      g.groupQiraahDisplay = nonHafs ? nonHafs.qiraahDisplay : "";
    }
    return groups;
  };
}
