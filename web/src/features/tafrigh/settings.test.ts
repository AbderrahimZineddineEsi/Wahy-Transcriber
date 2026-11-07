import { beforeEach, expect, test } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, positiveInt, runRequest, saveSettings, sourceRequest, targetRange } from "./settings";

beforeEach(() => window.localStorage.clear());

test("the sentence range is typed from 1 and both ends are included; the server counts from 0 and leaves the end out", () => {
  expect(targetRange({ from: "", to: "" })).toBeNull();
  expect(targetRange({ from: "1", to: "10" })).toEqual([0, 10]);
  expect(targetRange({ from: "5", to: "" })![0]).toBe(4);
  expect(targetRange({ from: "5", to: "" })![1]).toBeGreaterThan(100_000); // "to the end": the server clamps it
  expect(targetRange({ from: "", to: "7" })).toEqual([0, 7]);
  expect(targetRange({ from: "abc", to: "0" })).toBeNull(); // not numbers: no range
});

test("positiveInt only takes whole numbers from 1", () => {
  expect(positiveInt("12")).toBe(12);
  expect(positiveInt(" 3 ")).toBe(3);
  for (const bad of ["", "0", "-2", "1.5", "x"]) expect(positiveInt(bad)).toBeNull();
});

test("the source request carries the cutting settings, the run request everything the server needs", () => {
  const s = { ...DEFAULT_SETTINGS, maxWords: 10, textSource: "corrected" as const };
  expect(sourceRequest(s)).toEqual({ text_source: "corrected", seg_config: { use_punctuation: true, pause_sec: 0.7, min_words: 2, max_words: 10 } });
  const r = runRequest({ ...s, mode: "per_sentence", candidate: "jev_hybrid", typo: "off", from: "1", to: "10", matnText: "  متن  " }, "اسم");
  expect(r).toMatchObject({
    processing_mode: "per_sentence",
    model_candidate: "jev_hybrid",
    typo_strategy: "off",
    target_range: [0, 10],
    matn: { mode: "upload", raw_matn_text: "متن" },
    name: "اسم",
    seg_config: { max_words: 10 },
  });
});

test("no matn text means no matn; the chat model is sent only for the chat candidate", () => {
  expect(runRequest(DEFAULT_SETTINGS).matn).toEqual({ mode: "no_matn" });
  expect(runRequest({ ...DEFAULT_SETTINGS, chatModel: "x/y" }).openrouter_chat_model).toBeNull();
  expect(runRequest({ ...DEFAULT_SETTINGS, candidate: "openrouter_chat", chatModel: "x/y" }).openrouter_chat_model).toBe("x/y");
  expect(runRequest(DEFAULT_SETTINGS)).not.toHaveProperty("name");
});

test("settings are remembered in this browser, and a broken stored value falls back to the defaults", () => {
  saveSettings({ ...DEFAULT_SETTINGS, windowSize: 8 });
  expect(loadSettings().windowSize).toBe(8);
  window.localStorage.setItem("wahy.tafrigh.settings", "{not json");
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});
