// What the Tafrigh tab remembers about a run, and how it becomes the request the server takes. Pure, so it is tested
// without a screen. The settings are kept in this browser (like the old app did); the runs themselves are on the
// server.
import type { components } from "../../api/schema";
import { readStored, writeStored } from "../../shell/storage";

type Schemas = components["schemas"];
export type RunRequest = Schemas["TafrighRunRequest"];
export type SourceRequest = Schemas["TafrighPreviewRequest"];
export type TextSource = NonNullable<RunRequest["text_source"]>;
export type Candidate = NonNullable<RunRequest["model_candidate"]>;
export type Mode = NonNullable<RunRequest["processing_mode"]>;
export type TypoStrategy = NonNullable<RunRequest["typo_strategy"]>;
export type GeminiRoute = NonNullable<RunRequest["gemini_route"]>;
export type JevOrder = NonNullable<RunRequest["jev_execution_order"]>;

export type RunSettings = {
  textSource: TextSource;
  usePunctuation: boolean;
  pauseSec: number;
  minWords: number;
  maxWords: number;
  matnText: string;
  candidate: Candidate;
  geminiModel: string; // "auto" or a model name
  geminiRoute: GeminiRoute;
  chatModel: string; // for the OpenRouter chat model
  mode: Mode;
  windowSize: number;
  jevOrder: JevOrder;
  typo: TypoStrategy;
  disableThinking: boolean;
  /** 1-based, both ends included; empty means "all" */
  from: string;
  to: string;
};

export const DEFAULT_SETTINGS: RunSettings = {
  textSource: "raw_findings",
  usePunctuation: true,
  pauseSec: 0.7,
  minWords: 2,
  maxWords: 40,
  matnText: "",
  candidate: "gemini_all",
  geminiModel: "auto",
  geminiRoute: "auto",
  chatModel: "",
  mode: "windowed",
  windowSize: 15,
  jevOrder: "parallel",
  typo: "gated",
  disableThinking: false,
  from: "",
  to: "",
};

const KEY = "wahy.tafrigh.settings";

export function loadSettings(): RunSettings {
  try {
    const saved = JSON.parse(readStored(KEY) ?? "{}") as Partial<RunSettings>;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: RunSettings): void {
  writeStored(KEY, JSON.stringify(settings));
}

/** A whole number from a text field, or null when it is empty or not a positive number. */
export function positiveInt(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : null;
}

/** No upper bound typed: the server clamps the end to the number of sentences. */
const TO_THE_END = 1_000_000;

/** The sentences to classify as the server wants them: [from, to), counted from 0. Null means all of them. */
export function targetRange(s: Pick<RunSettings, "from" | "to">): [number, number] | null {
  const from = positiveInt(s.from);
  const to = positiveInt(s.to);
  if (from === null && to === null) return null;
  return [(from ?? 1) - 1, to ?? TO_THE_END];
}

/** How the transcript is cut into sentences, and which text is read (F-106, F-107, F-109). */
export function sourceRequest(s: RunSettings): SourceRequest {
  return {
    text_source: s.textSource,
    seg_config: { use_punctuation: s.usePunctuation, pause_sec: s.pauseSec, min_words: s.minWords, max_words: s.maxWords },
  };
}

/** The whole request of a run (F-107 to F-113). */
export function runRequest(s: RunSettings, name?: string): RunRequest {
  const matn = s.matnText.trim();
  const range = targetRange(s);
  return {
    ...sourceRequest(s),
    processing_mode: s.mode,
    window_size: s.windowSize,
    model_candidate: s.candidate,
    model_name: s.geminiModel || "auto",
    gemini_route: s.geminiRoute,
    openrouter_chat_model: s.candidate === "openrouter_chat" && s.chatModel.trim() ? s.chatModel.trim() : null,
    jev_layout: "independent_questions",
    jev_execution_order: s.jevOrder,
    typo_strategy: s.typo,
    disable_thinking: s.disableThinking,
    matn: matn ? { mode: "upload", raw_matn_text: matn } : { mode: "no_matn" },
    target_range: range,
    ...(name ? { name } : {}),
  };
}
