/* =============================================================================
   WAHY ENGINE v5  —  js/engine_v5.js   (load AFTER js/engine.js and js/engine_v4.js)
   -----------------------------------------------------------------------------
   Engine v4 (js/engine_v4.js: banded local alignment, IDF weights, computed
   ambiguity, QURAN > HADITH > ADHKAR priority) evolved with the fixes from the
   review of ~1,100 findings (docs/review-notes.md, docs/plans/engine-v5-handoff.md).
   Same constructor signature and detection shape as v4;  v4 itself is unchanged.

   What v5 adds (review note numbers in brackets).  Each is a switch in P.fix,
   so its effect can be measured alone (backend/laya_datagen/engine_eval.py):
   variants  ASR spelling variants are near-matches, not mismatches:  first
             letters («ال» / و ف ب ك ل dropped, added or swapped, «لل» = «ال»,
             hamzat al-wasl, a misheard one-letter prefix) [13],  last letters
             (a long vowel dropped or swapped: غزى = غزا, اتق = اتقي;  pronoun /
             verb suffixes: حزبه = حزبها) [4, 6];  a word missing from the corpus
             vocabulary also SEEDS candidates through its variants [19].
   qul       «قال» for a verse-initial «قل» when the next word continues the verse [8].
   free      honorifics and asides («رضي الله عنه», «صلى الله عليه وسلم»,
             «عز وجل», «يعني» …) are skipped for free in the speech and in a
             hadith's text, and do not count toward the gap limits [14].
   muq       spelled-out muqatta'at («ألف لام ميم» = «الم») [9].
   fused     a corpus word the ASR split in two seeds its verse («لب المرصاد») [18].
   seed2     a seed bigram credits both of its words, so a fragment of common
             words can become a candidate («إن الدين عند الله الإسلام») [17].
   cues      «قوله» up to 4 words before is a Quran cue;  near-certain hadith cues
             («وفي رواية» / «وفي لفظ», «قال رسول الله ﷺ» right before, a takhrij
             «متفق عليه» / «رواه البخاري» right after) weigh more [17, 25, 27].
   short     a complete 1-2 word ayah of rare words passes without a cue;  a cue
             lowers the bar for a verse fragment [17].
   multi     a phrase found word for word in several ayat is kept, with the
             reference marked ambiguous («الله خالق كل شيء») [17].
   ref       identical words in several ayat: a finding next to another verse
             finding takes that ayah or the adjacent one [12].
   chain     two consecutive ayat that are each a near miss support each other,
             and the neighbour probe also starts from a near miss [20].
   merge     a quote longer than one alignment window is one finding, not several
             overlapping ones;  a finding never starts / ends inside an honorific [14].
   Runs of "exact" words continue through near-matches of quality >= runQ.
   ============================================================================= */

const WV5_DEFAULTS = {
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
  maxListedCandidates: 12, maxPerBookListed: 3,
  // v5 fixes, each can be switched off (params.v5.fix) to measure what it brings
  runQ: 0.85,                // a word of quality >= runQ continues an "exact" run (v4: 0.95)
  cueBonusStrong: 10.0,      // hadith cue that is near-certain: «وفي رواية» / «وفي لفظ», «قال رسول الله ﷺ» right before, a takhrij right after
  fragCueCand: 12,           // a cued Quran FRAGMENT needs this (v4: the plain th.QURAN.cand, cue or not)
  shortNoCue: 15,            // a complete 1-2 word ayah is accepted without a cue at this score (v4: never)
  refNeighbourGap: 15,       // a verse finding this close to another one prefers its ayah / the adjacent ayah (v4: 3 words, members only)
  nearMiss: 0.6,             // a rejected verse scoring >= nearMiss x its threshold can still be rescued by an adjacent ayah
  multiHomeBonus: 3.0,       // the same exact run of >= 4 words in several ayat is a Quranic phrase: quote it, reference ambiguous
  guard: { quranMatched: 3, quranContent: 2, shortContent: 2, hadithMatched: 4, hadithContent: 3, hadithRun: 3 },
  fix: { variants: true, qul: true, free: true, muq: true, fused: true, cues: true, short: true, seed2: true, ref: true, chain: true, merge: true, multi: true }
};

/* Profiles (deliverable 2 of docs/plans/engine-v5-handoff.md).  "normal" = the defaults above (the app's default).
   "loose" lowers every acceptance bar to produce many more borderline findings: Laya (the quote verifier) is the safety
   net, and the labelled loose findings are its negatives.  Chosen with params.v5Profile, else localStorage.wahyEngineProfile. */
const WV5_PROFILES = {
  normal: {},
  loose: {
    seedMinMass: 5.0, singleSeedMass: 7.0,
    th: { QURAN: { cand: 9, ver: 26, amb: 20 }, HADITH: { cand: 15, ver: 48, amb: 34 }, ADHKAR: { cand: 16, ver: 34, amb: 30 } },
    completeVerse: { cand: 9, ver: 17, amb: 15, candCue: 7, verCue: 14, ambCue: 13 },
    fragCueCand: 8, shortNoCue: 10,
    guard: { quranMatched: 2, quranContent: 1, shortContent: 1, hadithMatched: 3, hadithContent: 2, hadithRun: 2 }
  }
};

const WV5_ADHKAR_CUES = new Set(["يقول","تقول","قل","قولوا","فقل","فقولوا","ذكر","الذكر","اذكار","الاذكار","دعاء","الدعاء","ادعيه","الادعيه","يدعو","ويقول","وتقول","فيقول","فتقول","اذكاره","وردا","ورد"]);
const WV5_TAKHRIJ_TAILS = [
  ["قال", "ابو", "عيسي"], ["قال", "الترمذي"], ["وفي", "الباب", "عن"], ["وهذا", "حديث", "حسن"],
  ["وهذا", "اسناد", "صحيح"], ["متفق", "عليه"], ["رواه", "السبعه"], ["اخرجه", "البخاري"],
  ["قال", "ابو", "داود"], ["قال", "الشيخ", "الالباني"], ["قال", "ابو", "عبد", "الرحمن"]
];

/* ---- ASR spelling variants (review notes 4, 6, 13) ------------------------------------------------------------------
   The ASR damages the first and last letters of a word far more often than its middle.  Each family below is a
   near-match with its own quality, tried only when the v4 matcher (exact / qiraat / medial alef / proclitic /
   Levenshtein-1) found nothing.  Quality < 0.85 does not count as a "content" word in the guards. */
const WV5_Q = { prefix: 0.88, vowelEnd: 0.9, suffix: 0.75, firstLetter: 0.8, short: 0.75 };
const WV5_SUFFIXES = ["هما", "كما", "هم", "هن", "ها", "كم", "كن", "نا", "ني", "وا", "ون", "ين", "ان", "ه", "ك", "ت", "ن", "ا", "ي", "و"];
const WV5_VOWEL = new Set(["ا", "ي", "و"]);

/* the word with its leading clitics peeled off, one layer at a time:  و / ف,  then ب / ك / ل,  then «ال» (or a
   hamzat al-wasl alif).  «لل» is ل + ال,  «لله» / «بالله» are ل / ب + الله.  Every form keeps >= 3 letters, except
   that a bare conjunction may leave 2 (ومن = من, فلا = ولا). */
function wv5_prefixForms(w) {
  const out = new Set([w]);
  const bases = [w];
  if ((w[0] === "و" || w[0] === "ف") && w.length >= 3) { out.add(w.slice(1)); bases.push(w.slice(1)); }
  for (const b of bases) {
    if (b === "لله" || ((b[0] === "ب" || b[0] === "ت") && b.slice(1) === "الله")) { out.add("الله"); continue; }
    if (b.startsWith("لل") && b.length >= 5) { out.add(b.slice(2)); out.add("ال" + b.slice(2)); continue; }
    if ((b[0] === "ب" || b[0] === "ك") && b.startsWith("ال", 1) && b.length >= 6) { out.add(b.slice(1)); out.add(b.slice(3)); continue; }
    if (b.startsWith("ال") && b.length >= 5) { out.add(b.slice(2)); continue; }
    if (b[0] === "ا" && b.length >= 4) out.add(b.slice(1));
    if ((b[0] === "ب" || b[0] === "ك" || b[0] === "ل") && b.length >= 5) out.add(b.slice(1));
  }
  return out;
}

/* the word and every stem left after removing one known ending (pronoun, verb ending, long vowel), stem >= 3 letters */
function wv5_suffixStems(w) {
  const out = new Set([w]);
  for (const e of WV5_SUFFIXES) if (w.length - e.length >= 3 && w.endsWith(e)) out.add(w.slice(0, -e.length));
  return out;
}

function wv5_intersects(a, b) { for (const x of a) if (b.has(x)) return true; return false; }

/* near-match quality of two DIFFERENT normalised words through the v5 families (0 = no match) */
function wv5_variantQual(t, v) {
  const lt = t.length, lv = v.length;
  if (lt < 2 || lv < 2 || Math.abs(lt - lv) > 3) return 0;
  // every family keeps either the start (endings) or the end (first letters) of the word: a cheap reject first
  const sameStart = t[0] === v[0] && t[1] === v[1], sameEnd = t[lt - 1] === v[lv - 1] && t[lt - 2] === v[lv - 2];
  if (!sameStart && !sameEnd) return 0;
  // last letter: a long vowel dropped / added / swapped (اتق = اتقي, غزي (غزى) = غزا, يدعو = يدعوا)
  const st = t.slice(0, -1), sv = v.slice(0, -1);
  // (not after ه / ك / ن: حزبه -> حزبها is a pronoun change, judged by the suffix family below)
  if (Math.min(lt, lv) >= 3 && !"هكن".includes((lt < lv ? t : v).slice(-1))) {
    if ((t === sv && WV5_VOWEL.has(v[lv - 1])) || (v === st && WV5_VOWEL.has(t[lt - 1]))) return WV5_Q.vowelEnd;
  }
  if (lt === lv && lt >= 3 && st === sv && WV5_VOWEL.has(t[lt - 1]) && WV5_VOWEL.has(v[lv - 1])) return WV5_Q.vowelEnd;
  if (sameEnd && wv5_intersects(wv5_prefixForms(t), wv5_prefixForms(v))) return WV5_Q.prefix;
  // first letter misheard (لحافظين -> نحافظين): the rest identical and long enough to be safe
  if (lt === lv && lt >= 5 && t.slice(1) === v.slice(1)) return WV5_Q.firstLetter;
  if (sameStart && t[2] === v[2] && Math.min(lt, lv) >= 3 && wv5_intersects(wv5_suffixStems(t), wv5_suffixStems(v))) return WV5_Q.suffix;
  // a 3-letter ASR word with one letter of a 4-letter word dropped inside (يدو = يدعو)
  if (Math.min(lt, lv) === 3 && Math.max(lt, lv) === 4 && t !== "الله" && v !== "الله" && t[0] === v[0] && t[lt - 1] === v[lv - 1] && wv5_dropOneLetter(t, v)) return WV5_Q.short;
  return 0;
}

function wv5_dropOneLetter(a, b) {
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let k = 0; k < l.length; k++) if (l.slice(0, k) + l.slice(k + 1) === s) return true;
  return false;
}

/* the keys under which a word is indexed for variant seeding: two words that are a v5 near-match share a key */
function wv5_variantKeys(w) {
  const keys = new Set();
  for (const x of wv5_prefixForms(w)) keys.add("p" + x);
  for (const x of wv5_suffixStems(w)) keys.add("s" + x);
  if (w.length >= 5) keys.add("f" + w.slice(1));
  return keys;
}

/* ---- parenthetical phrases (review note 14) ------------------------------------------------------------------------
   Honorifics and short asides are added by the speaker or present only in the corpus.  Skipping them is free (in the
   transcript and in a hadith's text) and does not count toward the gap limits, so they never split, end or shorten a
   finding.  Normalised forms. */
const WV5_PARENTHETICALS = [
  ["صلي", "الله", "عليه", "وعلي", "اله", "وسلم"], ["صلي", "الله", "عليه", "وسلم"], ["عليه", "الصلاه", "والسلام"],
  ["عليه", "السلام"], ["عليهم", "السلام"], ["رضي", "الله", "عنهما"], ["رضي", "الله", "عنهم"], ["رضي", "الله", "عنهن"],
  ["رضي", "الله", "عنها"], ["رضي", "الله", "عنه"], ["رحمهم", "الله"], ["رحمه", "الله"], ["عز", "وجل"], ["جل", "وعلا"],
  ["جل", "جلاله"], ["سبحانه", "وتعالي"], ["تبارك", "وتعالي"], ["تعالي"], ["يعني"]
];

function wv5_phraseMask(norms) {
  const n = norms.length, mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    for (const f of WV5_PARENTHETICALS) {
      if (p + f.length > n) continue;
      let ok = true;
      for (let k = 0; k < f.length; k++) if (norms[p + k] !== f[k]) { ok = false; break; }
      if (ok) { for (let k = 0; k < f.length; k++) mask[p + k] = 1; break; }
    }
  }
  return mask;
}

/* ---- spelled-out muqatta'at (review note 9): the ASR writes «ألف لام ميم» for «الم» -------------------------------- */
const WV5_LETTER_NAMES = { "الف": "ا", "لام": "ل", "ميم": "م", "صاد": "ص", "را": "ر", "راء": "ر", "كاف": "ك", "ها": "ه", "هاء": "ه",
  "يا": "ي", "ياء": "ي", "عين": "ع", "طا": "ط", "طاء": "ط", "سين": "س", "حا": "ح", "حاء": "ح", "قاف": "ق", "نون": "ن" };

/* muq[i] = [{ norm, len }]: the transcript words ending at i spell out the muqatta'a `norm` over `len` words */
function wv5_muqattaat(tN) {
  const muq = new Array(tN.length).fill(null);
  for (let i = 0; i < tN.length; i++) {
    let letters = "";
    for (let L = 1; L <= 5 && i - L + 1 >= 0; L++) {
      const ch = WV5_LETTER_NAMES[tN[i - L + 1]];
      if (!ch) break;
      letters = ch + letters;
      if (MUQATTAAT_WORDS.has(letters) && (L >= 2 || tN[i].length >= 3)) (muq[i] = muq[i] || []).push({ norm: letters, len: L });
    }
  }
  return muq;
}

/* ---- cues (review notes 17, 25, 27) -------------------------------------------------------------------------------- */
const WV5_QAWL = new Set(["قوله", "وقوله", "بقوله", "لقوله", "كقوله"]);
const WV5_NON_QURAN_SPEAKERS = new Set(["صلي", "وسلم", "والسلام", "النبي", "رسول", "رحمه", "العلماء", "المفسرين", "الشافعي", "احمد", "مالك"]);
const WV5_STRONG_HADITH_CUES = [["وفي", "روايه"], ["في", "روايه"], ["وفي", "لفظ"], ["في", "لفظ"], ["ولفظه"], ["وفي", "لفظه"]];
// the Prophet's own speech introduced right before the span (<= 3 words before it, honorifics not counted)
const WV5_PROPHET_SAID = [["قال", "رسول", "الله"], ["فقال", "رسول", "الله"], ["يقول", "رسول", "الله"], ["قال", "النبي"], ["فقال", "النبي"],
  ["يقول", "النبي"], ["قال", "صلي", "الله", "عليه", "وسلم"], ["يقول", "صلي", "الله", "عليه", "وسلم"], ["قال", "عليه", "الصلاه", "والسلام"],
  ["يقول", "عليه", "الصلاه", "والسلام"]];
const WV5_TAKHRIJ_HEAD = new Set(["رواه", "ورواه", "اخرجه", "واخرجه", "خرجه"]);
const WV5_TAKHRIJ_BOOKS = new Set(["البخاري", "مسلم", "الترمذي", "النسائي", "ابو", "ابن", "احمد", "الامام", "الشيخان", "الخمسه", "السبعه",
  "الجماعه", "الاربعه", "الثلاثه", "مالك", "البيهقي", "الحاكم", "الطبراني", "الدارقطني", "الدارمي", "البزار", "اهل"]);

function wv5_seqAt(tN, p, seq) {
  if (p < 0 || p + seq.length > tN.length) return false;
  for (let k = 0; k < seq.length; k++) if (tN[p + k] !== seq[k] && !(k === 0 && stripProclitic(tN[p]) === seq[0])) return false;
  return true;
}

/* a takhrij within the 3 words after the span: «متفق عليه», «رواه البخاري / مسلم …», «أخرجه …» (review note 25).
   Also at the very end of the span: Riyad al-Salihin's text carries the takhrij, so its matches swallow it. */
function wv5_takhrijAfter(tN, tStart, tEnd) {
  for (let p = Math.max(tStart, tEnd - 3); p < Math.min(tN.length - 1, tEnd + 3); p++) {
    if (tN[p] === "متفق" && tN[p + 1] === "عليه") return true;
    if (WV5_TAKHRIJ_HEAD.has(tN[p]) && WV5_TAKHRIJ_BOOKS.has(tN[p + 1])) return true;
  }
  return false;
}

/* Matn extraction: prefer the Prophetic quote marks used by the hadith-api
   editions;  fall back to the (patched) stripIsnad() of engine.js. */
function wv5_extractMatn(rawText) {
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
    for (const tail of WV5_TAKHRIJ_TAILS) {
      let ok = true;
      for (let k = 0; k < tail.length; k++) if (norms[i + k] !== tail[k]) { ok = false; break; }
      if (ok) return matn.slice(0, toks[i - 1].charEnd);
    }
  }
  return matn;
}

class WahyEngineV5 {
  constructor(quranData, hadithData, params = {}, adhkarData, outsideHadithData) {
    if (adhkarData === undefined) adhkarData = (typeof RAW_ADHKAR_DATA !== "undefined") ? RAW_ADHKAR_DATA : [];
    if (outsideHadithData === undefined) outsideHadithData = (typeof RAW_OUTSIDE_HADITH_DATA !== "undefined") ? RAW_OUTSIDE_HADITH_DATA : [];
    let profile = params.v5Profile;
    if (profile === undefined) { try { profile = localStorage.getItem("wahyEngineProfile"); } catch (e) { profile = null; } }
    profile = WV5_PROFILES[profile] ? profile : "normal";
    const prof = WV5_PROFILES[profile], v5 = params.v5 || {};
    const P = Object.assign({}, WV5_DEFAULTS);
    if (params.maxTranscriptGap) P.maxTGap = params.maxTranscriptGap;      // same UI sliders as v3
    if (params.maxVerseGap !== undefined) P.maxVGap = params.maxVerseGap;
    Object.assign(P, prof, v5);                                            // profile, then engine-level overrides, win over the sliders
    for (const k of ["th", "completeVerse", "guard", "fix"]) P[k] = Object.assign({}, WV5_DEFAULTS[k], prof[k] || {}, v5[k] || {});
    P.profile = profile;
    this._ctorArgs = [params, adhkarData, outsideHadithData];      // to rebuild the same engine with other v5 params
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
        : ((h.book === "Builtin" || outside) ? (outside ? wv5_extractMatn(h.t || "") : h.t) : wv5_extractMatn(h.t));
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
    if (u.typeCode !== 0) { const fm = wv5_phraseMask(u.normWords); if (fm.some(x => x)) u.freeMask = fm; }
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

    // v5: variant keys of the rare words (an ASR spelling variant of a rare word seeds its verse / hadith too)
    const varMap = new Map();
    for (let id = 0; id < V; id++) {
      if (!uniElig[id]) continue;
      for (const k of wv5_variantKeys(words[id])) { let a = varMap.get(k); if (!a) { a = []; varMap.set(k, a); } if (a.length < 8) a.push(id); }
    }

    Object.assign(this, { vocab, words, W, unitOfPos, unitStart, wt, wmax, M, bgMap, bgStart, bgPos, uniElig, uniStart, uniPos, delMap, varMap, V });
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

  /* rare corpus words that are a v5 spelling variant of transcript word `norm` (its own id excluded) */
  _variantIds(norm, ownId) {
    if (!this.P.fix.variants || norm.length < 3) return [];
    const out = [];
    for (const k of wv5_variantKeys(norm)) {
      const ids = this.varMap.get(k);
      if (!ids) continue;
      for (const id of ids) if (id !== ownId && !out.includes(id) && wv5_variantQual(norm, this.words[id]) > 0) out.push(id);
    }
    return out.length > 6 ? out.slice(0, 6) : out;
  }

  _qual(a, b, unit) {
    if (Math.abs(a.length - b.length) > 3) return 0;
    const key = a + "|" + b + ((unit.typeCode === 0 && this._farshUnits.has(unit.unitId)) ? "|" + unit.unitId : "");
    let q = this._qmemo.get(key);
    if (q !== undefined) return q;
    q = matchWordWithQiraat(a, b, unit.typeCode === 0 ? unit.unitId : "", "").qual || (this.P.fix.variants ? wv5_variantQual(a, b) : 0);
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
    const free = P.fix.free ? wv5_phraseMask(tN) : null;
    const muq = P.fix.muq ? wv5_muqattaat(tN) : null;
    return { fm, fmH, surahMentions, free, muq };
  }

  /* «قال» written by the ASR for a verse-initial «قل» (review note 8).  «قال» is also the commonest cue word, so it only
     counts when the verse starts with «قل» and the NEXT transcript word continues the verse. */
  _qulQual(unit, tN, tIds, i) {
    const vN = unit.normWords;
    if (unit.typeCode !== 0 || tN[i] !== "قال" || vN[0] !== "قل" || vN.length < 2 || i + 1 >= tN.length) return 0;
    const q1 = tIds[i + 1] === unit.wids[1] ? 1 : this._qual(tN[i + 1], vN[1], unit);
    return q1 >= 0.85 ? 0.9 : 0;
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
            if (e - a <= P.bgMax) for (let k = a; k < e; k++) { add(i, this.bgPos[k]); if (P.fix.seed2) add(i + 1, this.bgPos[k] + 1); }
          }
        }
        if (this.uniElig[id]) for (let k = this.uniStart[id]; k < this.uniStart[id + 1]; k++) add(i, this.uniPos[k]);
      } else if (tN[i].length >= 4) {
        for (const alt of this._fuzzyIds(tN[i])) {
          if (!this.uniElig[alt]) continue;
          for (let k = this.uniStart[alt]; k < this.uniStart[alt + 1]; k++) add(i, this.uniPos[k]);
        }
      }
      // a word missing from the corpus vocabulary seeds through its spelling variants (a known word seeding its
      // variants as well multiplies the candidates by ten for nothing: its own exact seeds already exist)
      if (id < 0) for (const alt of this._variantIds(tN[i], id)) for (let k = this.uniStart[alt]; k < this.uniStart[alt + 1]; k++) add(i, this.uniPos[k]);
      // one corpus word split in two by the ASR («لب المرصاد» = «لبالمرصاد», «لا في» = «لفي»): the joined form seeds
      if (P.fix.fused && i + 1 < n) {
        const a = tN[i], b = tN[i + 1];
        for (const j of [normalizeArabic(a + b), a.endsWith("ا") ? normalizeArabic(a.slice(0, -1) + b) : null]) {
          const fid = j && this.vocab.get(j);
          if (fid !== undefined && fid !== null && this.uniElig[fid]) for (let k = this.uniStart[fid]; k < this.uniStart[fid + 1]; k++) add(i + 1, this.uniPos[k]);
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
    // v5: parenthetical words (honorifics, asides) are skipped for free and do not count toward G / D
    const tFree = this._free && this._free.length === n0 ? this._free : null;
    const vFree = P.fix.free ? unit.freeMask || null : null;
    const muq = this._muq && this._muq.length === n0 ? this._muq : null;

    let predV = 0, predI = -1;
    const bestPred = (as, b) => {
      predV = 0; predI = -1;
      if (as < 1 || b < 1) return;
      for (let g = 0, k = 0; as - 1 - g >= 0; g++) {
        if (g > 0 && !(tFree && tFree[i0 + as - g])) k++;
        if (k > G || g > G + 8) break;
        const h = H[(as - 1 - g) * m + (b - 1)];
        if (h > 0) { const v = h - gT[k]; if (v > predV) { predV = v; predI = (as - 1 - g) * m + (b - 1); } }
      }
      let skip = 0;
      for (let d = 1, dn = 0; b - 1 - d >= 0; d++) {
        if (!(vFree && vFree[j0 + b - d])) { dn++; skip += wv[b - d] * P.gapVExt; }
        if (dn > D || d > D + 8) break;
        const h = H[(as - 1) * m + (b - 1 - d)];
        if (h > 0) { const v = h - (dn ? P.gapVOpen + skip : 0); if (v > predV) { predV = v; predI = (as - 1) * m + (b - 1 - d); } }
      }
    };

    let bestEnd = 0, bestIdx = -1;
    for (let a = 0; a < n; a++) {
      const i = i0 + a, tid = tIds[i], tn = tN[i], f = fm[i];
      for (let b = 0; b < m; b++) {
        const j = j0 + b, idx = a * m + b;
        let q = (tid === wids[j]) ? 1 : this._qual(tn, vN[j], unit);
        if (q === 0 && j === 0 && P.fix.qul) q = this._qulQual(unit, tN, tIds, i);
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
        // spelled-out muqatta'at: several letter-name words = one verse word (kind 10 + number of words)
        if (muq && muq[i] && q < 1) {
          for (const mq of muq[i]) {
            if (mq.norm !== vN[j] || a - mq.len + 1 < 0) continue;
            bestPred(a - mq.len + 1, b);
            const v2 = predV + wv[b];
            if (v2 > val) { val = v2; pI = predI; kind = 10 + mq.len; isMatch = true; }
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
    const tIds = this._tIds;
    for (const p of al.path) {
      const tS = p.kind === 1 ? p.i - 1 : (p.kind >= 10 ? p.i - (p.kind - 10) + 1 : p.i);
      const r = matchWordWithQiraat(tN[p.i], vN[p.j], unit.typeCode === 0 ? unit.unitId : "", voc[p.j]);
      let q = p.kind === 1 ? 0.92 : (p.kind >= 10 ? 1 : (r.qual || (P.fix.variants ? wv5_variantQual(tN[p.i], vN[p.j]) : 0)));
      if (q === 0 && p.j === 0 && P.fix.qul && tIds) q = this._qulQual(unit, tN, tIds, p.i);
      cells.push({ tS, tE: p.i + 1, j: p.j, q, vocOverride: r.vocOverride });
      if (q > 0) {
        matched++;
        E += q * Math.min(wt[unit.wids[p.j]], tw[p.i]) * fm[p.i];
        if (r.qiraah) qirCells++;
        if (q >= 0.85 && !isLowSpecWord(vN[p.j])) content++;
        if (r.qiraah && (qir === null || (QIRAAT_PRIORITY_RANK[r.qiraah] || 99) < (QIRAAT_PRIORITY_RANK[qir] || 99))) qir = r.qiraah;
        // v5: a run continues through ASR spelling variants (q >= runQ), not only exact words
        if (q >= P.runQ && prev && prev.q >= P.runQ && tS === prev.tE && p.j === prev.j + 1) run++; else run = 1;
        if (run > exactRun) exactRun = run;
      }
      prev = cells[cells.length - 1];
    }
    const segs = [], qsegs = [], gaps = [];
    let tS = cells[0].tS, qS = cells[0].j, pTE = cells[0].tE, pJ = cells[0].j;
    for (let k = 1; k < cells.length; k++) {
      const c = cells[k];
      let gapW = c.tS - pTE;
      if (this._free && gapW > 0) for (let k = pTE; k < c.tS; k++) if (this._free[k]) gapW--;
      if (gapW >= P.segmentGapMin) {
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
    this._free = ctx.free; this._muq = ctx.muq; this._tIds = tIds;
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
    // v5: a cue also lowers the bar for a FRAGMENT of a verse (review note 17: «قال تعالى إن الدين عند الله الإسلام»)
    if (t.type === "QURAN" && cue && this.P.fix.short) return { cand: Math.min(base.cand, this.P.fragCueCand), ver: base.ver, amb: base.amb };
    return base;
  }

  /* «قوله» / «في قوله» up to 4 words before the span is a Quran cue (v3 only accepts it right before the span),
     unless a hadith / scholar speaker is named around it ("قوله صلى الله عليه وسلم", "قوله رحمه الله") */
  _qawlCue(tN, tStart) {
    for (let k = tStart - 1; k >= Math.max(0, tStart - 4); k--) {
      if (!WV5_QAWL.has(tN[k])) continue;
      for (let x = Math.max(0, k - 3); x < tStart; x++) if (WV5_NON_QURAN_SPEAKERS.has(tN[x])) return false;
      return true;
    }
    return false;
  }

  /* 2 = near-certain hadith cue, 0 = none found here (the v3 cue list is checked by the caller) */
  _hadithCueStrength(tN, tStart, tEnd) {
    if (wv5_takhrijAfter(tN, tStart, tEnd)) return 2;
    for (let p = Math.max(0, tStart - 8); p < tStart; p++) for (const c of WV5_STRONG_HADITH_CUES) if (wv5_seqAt(tN, p, c)) return 2;
    // «قال رسول الله ﷺ» introducing the span: at most 3 non-honorific words between the cue and the span
    const free = this._free;
    for (let p = Math.max(0, tStart - 12); p < tStart; p++) {
      for (const c of WV5_PROPHET_SAID) {
        if (!wv5_seqAt(tN, p, c)) continue;
        let between = 0;
        for (let x = p + c.length; x < tStart; x++) if (!(free && free[x])) between++;
        if (between <= 3) return 2;
      }
    }
    return 0;
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
        for (let k = Math.max(0, t.tStart - 5); k < t.tStart; k++) if (WV5_ADHKAR_CUES.has(tN[k])) return true;
        return false;
      }
      const v3cue = QuotationMatcherJS.prototype._hasCitationCue(tN, t.tStart, cueType, t.tEnd);
      if (!P.fix.cues) return v3cue;
      if (cueType === "QURAN") return v3cue || this._qawlCue(tN, t.tStart);
      return this._hadithCueStrength(tN, t.tStart, t.tEnd) || v3cue;
    };
    // g.cue: 0 / false = none, true / 1 = cue, 2 = near-certain hadith cue (bigger bonus)
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
      // v5 (review note 17, الزمر:62 / الرعد:16 «الله خالق كل شيء»): a phrase found word for word in several ayat
      if (P.fix.multi && t0.type === "QURAN" && g.members.length >= 2 && g.members.filter(m => m.exactRun >= 4).length >= 2) g.bonus += P.multiHomeBonus;
      const S = t0.S + g.bonus + (g.cue === 2 ? P.cueBonusStrong : (g.cue ? P.cueBonus : 0));
      g.ev = { t0, th, S, pass: S >= th.cand && this._passesGuards(g, t0, S, tokens, tN), rescued: false };
    }
    if (P.fix.ref) this._preferNeighbourRef(groups, tN, ctx);
    // neighbour probe: after an accepted ayah, test ayah-1 / ayah+1 directly on the adjacent words.
    // Short verses made only of common words (112:1-2) have no rare seed, but sit right beside a found verse.
    {
      // v5 (review note 20): two consecutive ayat that are each a near miss support each other (الانفطار:10-11)
      const nearMiss = g => g.top.type === "QURAN" && !g.ev.pass && g.members.length === 1 && g.ev.S >= P.nearMiss * g.ev.th.cand &&
        (g.ev.t0.unit.normWords.length <= 6 ? g.ev.t0.coverage >= 0.99 : g.ev.t0.coverage >= 0.6);
      if (P.fix.chain) {
        const qn = groups.filter(g => g.top.type === "QURAN" && g.members.length === 1).sort((x, y) => x.top.tStart - y.top.tStart);
        for (let k = 0; k + 1 < qn.length; k++) {
          const a = qn[k], b = qn[k + 1], ua = a.ev.t0.unit, ub = b.ev.t0.unit, gap = b.ev.t0.tStart - a.ev.t0.tEnd;
          if (ua.surah !== ub.surah || ub.ayah !== ua.ayah + 1 || gap < -1 || gap > 3) continue;
          if (!(nearMiss(a) && nearMiss(b)) || a.ev.S + b.ev.S < P.th.QURAN.cand + P.continuityBonus) continue;
          for (const g of [a, b]) Object.assign(g.ev, { pass: true, rescued: true, rescueVerified: false });
          a.chained = b.chained = true;
        }
      }
      // ... and the probe below also starts from a near miss: it is accepted only if the probed ayah is found too
      let frontier = groups.filter(g => g.top.type === "QURAN" && (g.ev.pass || (P.fix.chain && nearMiss(g))) && g.members.length === 1);
      for (let hop = 0; hop < 3 && frontier.length; hop++) {
        const fresh = [];
        for (const g of frontier) {
          const un = g.ev.t0.unit, weak = !g.ev.pass;
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
            // from a near miss, the pair must carry the evidence of one accepted verse
            if (weak && (g.ev.S + r.S < P.th.QURAN.cand + P.continuityBonus || (len <= 6 && r.S < 4))) continue;
            let clash = false;
            for (const o of groups) { if (!o.ev || !o.ev.pass) continue; let ov = 0; for (const k of r.tokenSet) if (o.mask.has(k)) ov++; if (ov / r.ntok > 0.3) { clash = true; break; } }
            if (clash) continue;
            r.adj = r.S;
            const ng = { top: r, members: [r], losers: [], mask: r.tokenSet, cue: false, bonus: P.continuityBonus, chained: true };
            ng.ev = { t0: r, th: this._thr(r, false), S: r.S + P.continuityBonus, pass: true, rescued: true, rescueVerified: !weak && (g.ev.rescued ? g.ev.rescueVerified : g.ev.S >= g.ev.th.ver) };
            if (weak) { Object.assign(g.ev, { pass: true, rescued: true, rescueVerified: false }); g.chained = true; }
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
    if (!P.fix.merge) return dets;
    return this._mergeContinued(dets, tokens).map(d => this._trimParenthetical(d, tokens));
  }

  /* A long quote (more than one alignment window, ~80 words) comes out as several findings of the same text that
     overlap or touch, each continuing the previous one in the corpus (review note 14, card 87): they are one quote. */
  _mergeContinued(dets, tokens) {
    const out = [];
    for (const d of dets) {
      const a = out.length ? out[out.length - 1] : null;
      const aLastT = a && a.segments[a.segments.length - 1], aLastQ = a && a.qSegments[a.qSegments.length - 1];
      if (!a || a.unitId !== d.unitId || d.tStart > a.tEnd || d.qSegments[0][0] > aLastQ[1] + 2 || d.qSegments[0][0] < aLastQ[0] || d.tEnd <= a.tEnd) {
        out.push(d);
        continue;
      }
      const unit = this.units.get(d.unitId);
      const segs = a.segments.slice(0, -1), qsegs = a.qSegments.slice(0, -1);
      segs.push([aLastT[0], Math.max(aLastT[1], d.segments[0][1])]);
      qsegs.push([aLastQ[0], Math.max(aLastQ[1], d.qSegments[0][1])]);
      for (let k = 1; k < d.segments.length; k++) { segs.push(d.segments[k]); qsegs.push(d.qSegments[k]); }
      const gaps = a.commentaryGaps.concat(d.commentaryGaps.filter(g => g[0] >= aLastT[1]));
      Object.assign(a, {
        tEnd: d.tEnd, charEnd: d.charEnd, segments: segs, qSegments: qsegs, commentaryGaps: gaps,
        canonicalSegments: qsegs.map(([x, y]) => unit.vocalizedWords.slice(x, y).join(" ")),
        totalScore: Math.max(a.totalScore, d.totalScore),
        confidenceBand: a.confidenceBand === "VERIFIED" || d.confidenceBand === "VERIFIED" ? "VERIFIED" : a.confidenceBand,
        hasCitationCue: a.hasCitationCue || d.hasCitationCue
      });
    }
    return out;
  }

  /* a finding never starts or ends inside a parenthetical phrase (start at «الله عنه» of «رضي الله عنه»): the partial
     phrase is dropped from the span, with the corpus words it was matched to */
  _trimParenthetical(d, tokens) {
    const free = this._free, unit = this.units.get(d.unitId);
    if (!free || d.segments.length === 0) return d;
    const vfree = unit && unit.freeMask;
    let [s0, e0] = d.segments[0], [q0, qe0] = d.qSegments[0];
    let k = 0;
    while (s0 + k < e0 - 1 && s0 + k > 0 && free[s0 + k] && free[s0 + k - 1]) k++;
    if (k > 0 && e0 - (s0 + k) >= 2) {
      let qk = 0;
      while (qk < k && vfree && q0 + qk < qe0 - 1 && vfree[q0 + qk]) qk++;
      d.segments = [[s0 + k, e0]].concat(d.segments.slice(1));
      d.qSegments = [[q0 + qk, qe0]].concat(d.qSegments.slice(1));
      d.canonicalSegments = [unit.vocalizedWords.slice(q0 + qk, qe0).join(" ")].concat(d.canonicalSegments.slice(1));
      d.tStart = s0 + k; d.charStart = tokens[d.tStart].charStart;
    }
    const L = d.segments.length - 1;
    let [s1, e1] = d.segments[L], [q1, qe1] = d.qSegments[L];
    k = 0;
    while (e1 - 1 - k > s1 + 1 && e1 - k < free.length && free[e1 - 1 - k] && free[e1 - k]) k++;
    if (k > 0) {
      let qk = 0;
      while (qk < k && vfree && qe1 - 1 - qk > q1 && vfree[qe1 - 1 - qk]) qk++;
      d.segments[L] = [s1, e1 - k];
      d.qSegments[L] = [q1, qe1 - qk];
      d.canonicalSegments[L] = unit.vocalizedWords.slice(q1, qe1 - qk).join(" ");
      d.tEnd = e1 - k; d.charEnd = tokens[d.tEnd - 1].charEnd;
    }
    return d;
  }

  /* Identical words in several ayat (review note 12: «مغفرة وأجرا عظيما» ends الأحزاب:35 and الفتح:29): a verse finding
     within refNeighbourGap words of another accepted verse finding takes that ayah, or the adjacent one, when it explains
     the same words about as well.  If neither is among its candidates (the shared words were aligned to the other ayat
     only), that ayah is aligned directly on the finding's words. */
  _preferNeighbourRef(groups, tN, ctx) {
    const P = this.P;
    const qg = groups.filter(g => g.top.type === "QURAN" && g.ev.pass).sort((a, b) => a.top.tStart - b.top.tStart);
    for (let k = 0; k < qg.length; k++) {
      const g = qg[k], t0 = g.ev.t0;
      for (const d of [-1, +1]) {
        const nb = qg[k + d];
        if (!nb || nb.members.length !== 1) continue;
        const gap = d < 0 ? t0.tStart - nb.ev.t0.tEnd : nb.ev.t0.tStart - t0.tEnd;
        if (gap < 0 || gap > P.refNeighbourGap) continue;
        const nu = nb.ev.t0.unit;
        // the same ayah continued, or the ayah that comes next in reading order
        const want = [nu, this.units.get(`${nu.surah}:${nu.ayah - d}`)].filter(Boolean);
        if (g.members.length === 1 && want.includes(t0.unit)) break;
        let r = g.members.find(m => want.includes(m.unit)) || null;
        if (!r) {
          for (const u of want) {
            let x = null;
            try {
              // up to 6 words around the finding, never back into the neighbour; the same ayah continues after (before)
              // the part of it the neighbour already matched
              const len = u.normWords.length, nq = nb.ev.t0.qSegments;
              const lo = d < 0 ? Math.max(t0.tStart - 6, nb.ev.t0.tEnd) : t0.tStart - 6;
              const hi = d > 0 ? Math.min(t0.tEnd + 5, nb.ev.t0.tStart - 1) : t0.tEnd + 5;
              const jlo = u === nu && d < 0 ? nq[nq.length - 1][1] : 0, jhi = u === nu && d > 0 ? nq[0][0] - 1 : len - 1;
              if (jhi < jlo || hi < lo) continue;
              const al = this._align(u, tN, ctx.tIds, ctx.fm, { i0: lo + 4, i1: hi - 6, j0: jlo + 6, j1: jhi - 8 }, ctx.tw[0]);
              if (al) x = this._describe(u, al, tN, ctx.fm, ctx.tw[0]);
            } catch (e) { x = null; }
            if (!x) continue;
            let ov = 0; for (const t of t0.tokenSet) if (x.tokenSet.has(t)) ov++;
            if (ov / t0.ntok >= 0.8 && x.S >= t0.S - this._delta(t0.S)) { r = x; break; }
          }
        }
        if (!r || r.S < t0.S - this._delta(t0.S)) continue;
        r.adj = r.S;
        g.members = [r]; g.bonus += P.continuityBonus; g.chained = true;
        const S = r.S + g.bonus + (g.cue === 2 ? P.cueBonusStrong : (g.cue ? P.cueBonus : 0));
        g.ev = Object.assign({}, g.ev, { t0: r, th: this._thr(r, g.cue), S });
        break;
      }
    }
  }

  _passesGuards(g, t, S, tokens, tN) {
    const P = this.P, unit = t.unit, cue = g.cue;
    if (unit.isOutsideCorpus) return t.matched >= 4;
    if (t.type === "QURAN") {
      if (unit.normWords.length === 1) return cue && t.matched >= 1;
      // v5: a complete 2-word ayah of rare words passes without a cue (review note 17: طه:41 «واصطنعتك لنفسي»)
      if (unit.normWords.length <= 2) return t.coverage >= 0.99 && (cue || (P.fix.short && S >= P.shortNoCue));
      const shortVerse = unit.normWords.length <= 4;
      if (shortVerse) return t.coverage >= 0.99 && (cue || t.content >= P.guard.shortContent);
      if (t.matched < P.guard.quranMatched || t.content < P.guard.quranContent) return false;
      return true;
    }
    if (t.type === "HADITH") {
      if (t.matched < P.guard.hadithMatched || t.content < P.guard.hadithContent || t.exactRun < P.guard.hadithRun) return false;
      let nasab = 0;
      for (let k = t.tStart; k < t.tEnd; k++) if (tN[k] === "بن" || tN[k] === "ابن") nasab++;
      if (nasab >= 2 && t.content < 7) return false;
      const pre = tN.slice(Math.max(0, t.tStart - 2), t.tStart).join(" ");
      if ((pre.endsWith("حدثنا") || pre.endsWith("اخبرنا") || pre === "الباب عن") && t.content < 5) return false;
      return true;
    }
    // ADHKAR (lowest priority): needs an explicit dhikr cue, or a long contiguous match, or a complete short dhikr
    if (wv5_cueQuranBlocks(tN, t)) return false;
    if (cue) return t.matched >= 4 && t.exactRun >= 3 && t.content >= 2;
    return t.content >= 3 && t.exactRun >= 5 && (t.coverage >= 0.8 || S >= P.th.ADHKAR.ver);
  }
}

function wv5_cueQuranBlocks(tN, t) {
  return QuotationMatcherJS.prototype._hasCitationCue(tN, t.tStart, "QURAN", t.tEnd);
}

if (typeof QuotationMatcherJS !== "undefined") {
  WahyEngineV5.prototype.formatAnnotatedTranscript = QuotationMatcherJS.prototype.formatAnnotatedTranscript;
}
