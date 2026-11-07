import { expect, test } from "vitest";
import { countBySource, initialPick, quickPick } from "./laya";
import type { Segment } from "./labels";

const seg = (id: string, action?: string, confidence?: number): Segment =>
  ({ id, trace: { review: action ? { action } : undefined, decision: { answers: { tag: { confidence } } } } }) as unknown as Segment;

const segments = [seg("a", "confirm"), seg("b", "correct"), seg("c", undefined, 0.9), seg("d", undefined, 0.5)];
const review = new Set(["d"]);

test("the first pick leaves out what waits for review, or keeps the previous save", () => {
  expect([...initialPick(segments, review, null)]).toEqual(["a", "b", "c"]);
  expect([...initialPick(segments, review, ["d"])]).toEqual(["d"]);
});

test("quick picks: reviewed by you, corrected, confident, without review, invert", () => {
  const all = quickPick("all", segments, new Set(), review);
  expect([...quickPick("human", segments, all, review)]).toEqual(["a", "b"]);
  expect([...quickPick("corrected", segments, all, review)]).toEqual(["b"]);
  expect([...quickPick("confident", segments, all, review)]).toEqual(["a", "b", "c"]);
  expect([...quickPick("no_review", segments, all, review)]).toEqual(["a", "b", "c"]);
  expect([...quickPick("invert", segments, new Set(["a"]), review)]).toEqual(["b", "c", "d"]);
  expect(quickPick("none", segments, all, review).size).toBe(0);
});

test("the counts say who labelled the chosen sentences", () => {
  expect(countBySource(segments, new Set(["a", "b", "c"]))).toEqual({ model: 1, human_confirmed: 1, human_corrected: 1 });
});
