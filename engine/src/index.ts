// The engine package (ADR 0002). Callers need only this file.
export { detect, parseEngineChoice } from "./detect.ts";
export { synthesizeWordsFromRawText, parseSubtitleFileToWords } from "./v3.js";
export { BUILTIN_ADHKAR_DATA } from "./shared.js";
export type * from "./types.ts";
