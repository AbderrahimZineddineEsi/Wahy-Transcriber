// The engine package (ADR 0002). Callers need only this file (or the worker, worker.ts, from another language).
export { detect, parseEngineChoice } from "./detect.ts";
export { envelopes, ruleBoundary } from "./envelopes.ts";
export { search } from "./search.ts";
export { synthesizeWordsFromRawText, parseSubtitleFileToWords } from "./v3.js";
export { BUILTIN_ADHKAR_DATA } from "./shared.js";
export type * from "./types.ts";
export type { Envelope, EnvelopeOptions, EnvelopeVersion } from "./envelopes.ts";
export type { SearchHit, SearchOptions } from "./search.ts";
