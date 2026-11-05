// The engine package's public types. The matching code behind them (v3.js, v4.js, v5.js) is the old app's code,
// moved verbatim and still untyped ("loose types first", ROADMAP phase 4); only this interface is typed.

/** One transcript word with its time in seconds, as ASR or a subtitle file gives it. */
export interface Word {
  word: string;
  start: number;
  end: number;
}

/** One ayah of the Quran corpus (`data/corpus.json` → `ayat`). */
export interface Ayah {
  s: number; // surah
  a: number; // ayah
  t: string; // vocalised text
  [extra: string]: unknown;
}

/** One hadith of the corpus (`data/corpus.json` → `hadiths`). */
export interface Hadith {
  id: string;
  book: string;
  ref: string;
  t: string;
  [extra: string]: unknown;
}

/** The reference texts the engine searches. Load it once and pass the same object to every call: the engine keeps
 *  its built indexes per corpus object. */
export interface Corpus {
  ayat: Ayah[];
  hadiths: Hadith[];
}

/** One dhikr of the adhkar list. */
export interface Dhikr {
  id: string;
  category: string;
  ref: string;
  t: string;
  isCustom?: boolean;
}

/** A text the user added so the engine finds it like any other reference (the old app's "outside hadith"). */
export interface CustomQuote {
  id: string;
  book: string;
  ref: string;
  t: string;
}

export type EngineVersion = "v3" | "v4" | "v5";
export type EngineProfile = "normal" | "loose";
/** "AUTO" (Hafs plus the ten Qira'at), or one reading such as "hafs", "warsh" or "qaloon". Only engine v3 reads it,
 *  and there it only relabels a Hafs finding's reading (the old app behaves the same). */
export type Qiraah = string;

export interface DetectOptions {
  corpus: Corpus;
  /** default "v5" */
  engine?: EngineVersion;
  /** default "normal"; "loose" exists for v5 only */
  profile?: EngineProfile;
  /** default "AUTO" */
  qiraat?: Qiraah;
  /** default: the built-in adhkar list; [] turns adhkar off */
  adhkar?: Dhikr[];
  /** default: none */
  customQuotes?: CustomQuote[];
}

export type SourceType = "QURAN" | "HADITH" | "ADHKAR";
export type ConfidenceBand = "VERIFIED" | "CANDIDATE" | "AMBIGUOUS";

/** A span of transcript words the engine proposes as a quote of a reference. Word indices are inclusive. Engines
 *  add their own extra fields (v4 and v5: `evidence`, `candidateCount`, …), so the type stays open. */
export interface Finding {
  id: string;
  sourceType: SourceType;
  type: "ayah" | "hadith" | "dhikr";
  unitId: string;
  displayRef: string;
  reference: string;
  candidateRefs: string[];
  candidateUnitIds: string[];
  isAmbiguous: boolean;
  isOutsideCorpus: boolean;
  confidenceBand: ConfidenceBand;
  confidence: number;
  totalScore: number;
  hasCitationCue: boolean;
  /** [start, end) token ranges in the transcript; more than one when the speaker comments inside the quote */
  segments: [number, number][];
  /** the same ranges in the reference's words */
  qSegments: [number, number][];
  canonicalSegments: string[];
  canonicalText: string;
  matchedText: string;
  wordStartIdx: number;
  wordEndIdx: number;
  startTime: number;
  endTime: number;
  qiraah: string;
  qiraahDisplay: string;
  [extra: string]: unknown;
}
