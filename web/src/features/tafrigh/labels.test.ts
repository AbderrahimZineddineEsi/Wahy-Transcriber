import { expect, test } from "vitest";
import { labelSource, markSplits, modelConfidence, nextToReview, parseTag, splitInfo, tagProbabilities, tagValue, type Segment } from "./labels";

const seg = (trace: Segment["trace"], over: Partial<Segment> = {}): Segment => ({
  id: "seg_0001", text: "t", original_text: "t", tag: "paragraph", level: null, parent_id: null, comment_kind: null,
  review_flags: [], corrected_text: null, display_text: "t", cut_reason: null, start_time: null, end_time: null, quotes: [], trace, ...over,
});

test("who gave the label: the model until a person confirms or corrects it", () => {
  expect(labelSource(seg({}))).toBe("model");
  expect(labelSource(seg({ review: { action: "confirm" } }))).toBe("human_confirmed");
  expect(labelSource(seg({ review: { action: "correct" } }))).toBe("human_corrected");
  expect(labelSource(seg({ review: { action: "revert_edits" } }))).toBe("human_corrected");
});

test("the model's confidence and odds come from its own decision, or from the sentence this one was cut from", () => {
  const decision = { answers: { tag: { choice: "paragraph", confidence: 0.57, probabilities: { paragraph: 0.57, continuation: 0.4, heading_1: 0.01 } } } };
  expect(modelConfidence(seg({ decision }))).toBe(0.57);
  expect(modelConfidence(seg({ split_from: { decision } }))).toBe(0.57);
  expect(modelConfidence(seg({}))).toBeNull();
  expect(tagProbabilities(seg({ decision }))).toEqual([["paragraph", 0.57], ["continuation", 0.4]]); // under 2% is left out
});

test("a heading's level is part of the option the reviewer picks", () => {
  expect(tagValue({ tag: "heading", level: 2 })).toBe("heading:2");
  expect(tagValue({ tag: "heading", level: null })).toBe("heading:1");
  expect(tagValue({ tag: "list_item", level: null })).toBe("list_item");
  expect(parseTag("heading:3")).toEqual({ corrected_tag: "heading", corrected_level: 3 });
  expect(parseTag("comment")).toEqual({ corrected_tag: "comment", corrected_level: null });
});

test("a split sentence says who asked, where it cut and who labelled the piece", () => {
  const piece = splitInfo(seg({ split_from: { piece: 2, pieces: 3, text: "a b c d", split: { used: [2], points_by: "model_decision" }, decision: { provider: "gemini" } }, decision: { provider: "jev" } }));
  expect(piece).toMatchObject({ kind: "piece", piece: 2, pieces: 3, used: [2], asker: "gemini", label: "jev", pointsBy: "model_decision" });
  const skipped = splitInfo(seg({ split_outcome: { status: "ignored", why: "too_short", proposed: [3] }, decision: { provider: "gemini" } }));
  expect(skipped).toEqual({ kind: "skipped", why: "too_short", proposed: [3], asker: "gemini" });
  expect(splitInfo(seg({ split_outcome: { status: "applied", pieces: 2 } }))).toBeNull();
  expect(splitInfo(seg({}))).toBeNull();
  expect(markSplits("a b c d", [2])).toBe("a b ✂ c d");
});

test("'next to review' goes on from the sentence just reviewed and goes round to the start", () => {
  const order = ["a", "b", "c", "d", "e"];
  const flagged = new Set(["b", "d"]);
  expect(nextToReview(order, flagged, null)).toBe("b");
  expect(nextToReview(order, flagged, "b")).toBe("d");
  expect(nextToReview(order, flagged, "d")).toBe("b"); // round to the start
  expect(nextToReview(order, new Set(["b"]), "b")).toBeNull(); // nothing else left
  expect(nextToReview(order, new Set(), "a")).toBeNull();
});
