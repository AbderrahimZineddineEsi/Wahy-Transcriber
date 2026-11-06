import { describe, expect, test } from "vitest";
import { fromRow } from "../lectures/view/model";
import { row } from "../lectures/view/fixtures";
import { duration, rawJson, readableJson, usd } from "./format";
import { idsInScope, inScope, invert, NO_FILTER, scopeOf, selectNone, selectShown, toggle, visibleRows } from "./selection";

const verse = fromRow(row({ id: 1, data: { totalScore: 40, confidenceBand: "HIGH" } }));
const doubtfulVerse = fromRow(row({ id: 2, data: { totalScore: 40, confidenceBand: "CANDIDATE" } }));
const weakVerse = fromRow(row({ id: 3, data: { totalScore: 9, confidenceBand: "HIGH" } }));
const hadith = fromRow(row({ id: 4, source_type: "HADITH", display_ref: "البخاري (1)", data: { totalScore: 50 } }));
const dhikr = fromRow(
  row({ id: 5, source_type: "ADHKAR", display_ref: "سبحان الله", verdict: { verdict: "CORRECT", boundary: "COMPLETE", verifier: "laya", model: "m" }, data: { totalScore: 60 } }),
);
const all = [verse, doubtfulVerse, weakVerse, hadith, dhikr];

describe("scopes (the server's rule)", () => {
  test("the default scope: every hadith and every finding the engine doubts", () => {
    expect(idsInScope(all, "HADITH_AND_CANDIDATES")).toEqual([2, 3, 4]);
    expect(inScope(verse, "HADITH_AND_CANDIDATES")).toBe(false);
  });
  test("hadith only, and all", () => {
    expect(idsInScope(all, "HADITH_ONLY")).toEqual([4]);
    expect(idsInScope(all, "ALL")).toEqual([1, 2, 3, 4, 5]);
  });
  test("a picked set that equals a scope is recognised, a hand-made one is not", () => {
    expect(scopeOf(all, new Set([4]))).toBe("HADITH_ONLY");
    expect(scopeOf(all, new Set([4, 1]))).toBeNull();
  });
});

describe("the list", () => {
  const text = (f: { ref: string }) => (f.ref === "البخاري (1)" ? "إنما الأعمال بالنيات" : "قل هو الله أحد");
  test("filters by kind, verdict and search (Arabic is normalised)", () => {
    expect(visibleRows(all, { ...NO_FILTER, kind: "hadith" }, text).map((f) => f.id)).toEqual([4]);
    expect(visibleRows(all, { ...NO_FILTER, verdict: "ok" }, text).map((f) => f.id)).toEqual([5]);
    expect(visibleRows(all, { ...NO_FILTER, query: "الاعمال" }, text).map((f) => f.id)).toEqual([4]);
  });
  test("none and invert only touch the rows shown", () => {
    const shown = [hadith, dhikr];
    expect([...selectNone(new Set([1, 4, 5]), shown)]).toEqual([1]);
    expect([...invert(new Set([4]), shown)].sort()).toEqual([5]);
    expect([...selectShown(new Set([1]), shown)].sort()).toEqual([1, 4, 5]);
    expect([...toggle(new Set([1]), 1)]).toEqual([]);
  });
});

test("numbers are written the same way everywhere", () => {
  expect(usd(0)).toBe("$0.00");
  expect(usd(0.00039)).toBe("$0.0004");
  expect(usd(1.234)).toBe("$1.23");
  expect(duration(35)).toBe("35 s");
  expect(duration(120)).toBe("2.0 min");
  expect(readableJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  expect(rawJson({ a: 1 })).toBe('{"a":1}');
});
