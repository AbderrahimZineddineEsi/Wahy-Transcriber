import { expect, test } from "vitest";
import { boundaryKey, chipOf, lineage, tafrighAnswerKey } from "./format";

test("verdicts become chips; anything else is none", () => {
  expect([chipOf("CORRECT"), chipOf("FALSE"), chipOf("NOT_SURE"), chipOf(null), chipOf("paragraph")]).toEqual(["ok", "bad", "unsure", "none", "none"]);
});

test("boundaries use the transcript's words", () => {
  expect(boundaryKey("COMPLETE")).toBe("boundary.complete");
  expect(boundaryKey("MISSING_BOTH")).toBe("boundary.missBoth");
  expect(boundaryKey(null)).toBeNull();
});

test("lineage: the user's action, a legacy row's kind, the verifier of an AI row", () => {
  expect(lineage({ origin: "user", action: "ORDINARY_SPEECH", gold: true, provider: null })).toEqual({ origin: "train.origin.user", how: "train.how.deleted", provider: null });
  expect(lineage({ origin: "user", action: "VALIDATE_ALL", gold: true, provider: null }).how).toBe("train.how.approval");
  expect(lineage({ origin: "legacy", action: null, gold: true, provider: "gemini-3.5-flash-lite" })).toEqual({ origin: "train.origin.legacyGold", how: null, provider: null });
  expect(lineage({ origin: "legacy", action: null, gold: false, provider: "openrouter_chat" }).provider).toBe("openrouter_chat");
  expect(lineage({ origin: "ai", action: null, gold: false, provider: "laya-wahy-r6" })).toEqual({ origin: "train.origin.ai", how: null, provider: "laya-wahy-r6" });
  expect(lineage({ origin: "tafrigh", action: "human_corrected", gold: true, provider: "jev_hybrid" }).how).toBe("train.how.corrected");
});

test("a Tafrigh answer: headings keep their level, split rows say split", () => {
  expect(tafrighAnswerKey("heading_2_seg_0004")).toEqual({ key: "tfg.tag.heading", level: 2 });
  expect(tafrighAnswerKey("heading_1_none")).toEqual({ key: "tfg.tag.heading", level: 1 });
  expect(tafrighAnswerKey("paragraph").key).toBe("tfg.tag.paragraph");
  expect(tafrighAnswerKey("split").key).toBe("train.split.yes");
  expect(tafrighAnswerKey("unknown_tag").key).toBeNull();
});
