// The engine package (ADR 0002). Callers need only this file (or the worker, worker.ts, from another language).
export { detect, parseEngineChoice } from "./detect.ts";
export { envelopes, ruleBoundary } from "./envelopes.ts";
export { search, suggest } from "./search.ts";
export { expand } from "./expand.ts";
export { edit, EditError, referenceWords } from "./edit.ts";
export { exportLecture, lectureCaptions, formattedText, toSrt, toVtt, toAss, EXPORT_FORMATS } from "./export.ts";
export { synthesizeWordsFromRawText, parseSubtitleFileToWords } from "./v3.js";
export { BUILTIN_ADHKAR_DATA } from "./shared.js";
export type * from "./types.ts";
export type { Envelope, EnvelopeOptions, EnvelopeVersion } from "./envelopes.ts";
export type { SearchHit, SearchOptions, Suggestion, SuggestOptions } from "./search.ts";
export type { ClippedBoundary, ExpandResult } from "./expand.ts";
export type { EditRequest, EditResult } from "./edit.ts";
export type { ExportFormat, ExportInput, ExportFile } from "./export.ts";
