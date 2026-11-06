// detect(): the engine's one entry point for findings (ADR 0002, ROADMAP phase 4).
//
// It does what the old app's runDetectionAndBuildCaptions (js/state.js) did between "here are the words" and
// "here are the findings": join the words into one text, run the chosen engine on it, and map each finding back to
// word indices and times. Everything the old code read from the page (engine choice, profile, Qira'ah, adhkar list,
// custom quotes) is an argument here.
import { BUILTIN_ADHKAR_DATA } from "./shared.js";
import { QuotationMatcherJS, QIRAAT_AR_NAME, mapDetectionsToWordTimestamps } from "./v3.js";
import { WahyEngine } from "./v4.js";
import { WahyEngineV5 } from "./v5.js";
import type { Corpus, DetectOptions, EngineProfile, EngineVersion, Finding, Word } from "./types.ts";

/** The old app's engine thresholds: its eight sliders at their default values (the sliders are gone, F-013). */
const ENGINE_PARAMS = {
  minIslandIdf: 3.8,
  maxTranscriptGap: 10,
  maxVerseGap: 2,
  verifiedThreshold: 11.0,
  candidateThreshold: 6.8,
  uncuedHadithThreshold: 16.0,
  minHadithContentWords: 3,
  uncuedQuranCoverage: 65,
};

/** Matchers are slow to build (seconds, hundreds of MB), so a few are kept per corpus object. */
const MAX_MATCHERS_PER_CORPUS = 4;
type Matcher = any;
const matchers = new WeakMap<Corpus, Map<string, Matcher>>();

/** Findings for a transcript. The words are not changed. */
export function detect(words: Word[], options: DetectOptions): Finding[] {
  const matcher = matcherFor(options);
  // js/state.js syncRawTextFromWords: trim each word, join with single spaces, remember each word's characters
  let cursor = 0;
  const timed = words.map((w, idx) => {
    const word = String(w.word || "").trim();
    const out = { ...w, id: idx, word, char_start: cursor, char_end: cursor + word.length };
    cursor = out.char_end + 1;
    return out;
  });
  const text = timed.map((w) => w.word).join(" ");
  return mapDetectionsToWordTimestamps(matcher.detect(text), timed, text);
}

/** "v5:loose" (the old app's engine choice) → { engine: "v5", profile: "loose" }. */
export function parseEngineChoice(choice: string): { engine: EngineVersion; profile: EngineProfile } {
  const [engine, profile = "normal"] = choice.split(":");
  if (!isEngine(engine)) throw new Error(`unknown engine "${engine}" (v3, v4 or v5)`);
  if (profile !== "normal" && profile !== "loose") throw new Error(`unknown profile "${profile}" (normal or loose)`);
  return { engine, profile };
}

function isEngine(x: string): x is EngineVersion {
  return x === "v3" || x === "v4" || x === "v5";
}

/** The engine built for these options (cached per corpus object). The envelope builders and corpus search read its
 *  corpus units, so a finding's envelope comes from the same units the engine matched it against. */
export function matcherFor(options: DetectOptions): Matcher {
  const { corpus, engine = "v5", profile = "normal", qiraat = "AUTO", customQuotes = [], v5 } = options;
  const adhkar = options.adhkar ?? BUILTIN_ADHKAR_DATA;
  if (!corpus || !Array.isArray(corpus.ayat) || !Array.isArray(corpus.hadiths)) {
    throw new Error("detect needs a corpus with ayat and hadiths arrays");
  }
  if (!isEngine(engine)) throw new Error(`unknown engine "${engine}" (v3, v4 or v5)`);
  if (profile !== "normal" && !(engine === "v5" && profile === "loose")) {
    throw new Error(`engine ${engine} has no profile "${profile}"`);
  }
  if (v5 !== undefined && engine !== "v5") throw new Error(`the v5 option is for engine v5, not ${engine}`);
  if (qiraat !== "AUTO" && !(qiraat in QIRAAT_AR_NAME)) {
    throw new Error(`unknown qira'ah "${qiraat}" (AUTO or one of ${Object.keys(QIRAAT_AR_NAME).join(", ")})`);
  }

  let cache = matchers.get(corpus);
  if (!cache) matchers.set(corpus, (cache = new Map()));
  // only v3 reads the qira'ah, so v4 and v5 share one matcher whatever it is
  const key = JSON.stringify([engine, profile, engine === "v3" ? qiraat : null, adhkar, customQuotes, v5 ?? null]);
  let matcher = cache.get(key);
  if (matcher) {
    cache.delete(key); // re-insert: the Map's order is the least recently used first
  } else {
    matcher = buildMatcher(corpus, engine, profile, qiraat, adhkar.map((x) => ({ ...x })), customQuotes, v5);
    if (cache.size >= MAX_MATCHERS_PER_CORPUS) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, matcher);
  return matcher;
}

/** js/state.js rebuildMatcher, with the engine choice passed in instead of read from localStorage. `v5` is the
 *  datagen harness's rebuild with params.v5 (backend/laya_datagen/js/harness.js useEngine, "v5/<tag>"). */
function buildMatcher(
  corpus: Corpus, engine: EngineVersion, profile: EngineProfile, qiraat: string, adhkar: unknown[], outside: unknown[],
  v5?: Record<string, unknown>,
): Matcher {
  if (engine === "v5") {
    const params = v5 === undefined ? { ...ENGINE_PARAMS, v5Profile: profile } : { ...ENGINE_PARAMS, v5Profile: profile, v5 };
    return new WahyEngineV5(corpus.ayat, corpus.hadiths, params, adhkar, outside);
  }
  if (engine === "v4") return new WahyEngine(corpus.ayat, corpus.hadiths, ENGINE_PARAMS, adhkar, outside);
  return new QuotationMatcherJS(corpus.ayat, corpus.hadiths, { ...ENGINE_PARAMS, defaultQiraah: qiraat }, adhkar, outside);
}
