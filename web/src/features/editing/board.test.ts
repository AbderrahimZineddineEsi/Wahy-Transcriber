import { describe, expect, test } from "vitest";
import { fromRow, type Word } from "../lectures/view/model";
import { row, sampleWords } from "../lectures/view/fixtures";
import {
  boardChunks,
  boardReducer,
  candidatesOf,
  EMPTY,
  findingAtWord,
  litRange,
  neighbours,
  stepFinding,
  type BoardAction,
  type BoardState,
} from "./board";

const run = (actions: BoardAction[], from: BoardState = EMPTY) => actions.reduce(boardReducer, from);

describe("the word board's selection (F-051)", () => {
  test("two clicks on plain words select the range between them, in either order", () => {
    const s = run([
      { type: "click", i: 9, findingId: null },
      { type: "click", i: 7, findingId: null },
    ]);
    expect(s.range).toEqual([7, 9]);
    expect(s.anchor).toBeNull();
  });

  test("with nothing selected, a click on a quote opens it in the inspector", () => {
    expect(run([{ type: "click", i: 4, findingId: 1 }])).toEqual({ ...EMPTY, finding: 1 });
  });

  test("once the first word is chosen, the second click may land on a quote", () => {
    const s = run([
      { type: "click", i: 1, findingId: null },
      { type: "click", i: 5, findingId: 1 },
    ]);
    expect(s.range).toEqual([1, 5]);
  });

  test("hovering previews the range; a third click starts again from that word", () => {
    let s = run([{ type: "click", i: 2, findingId: null }, { type: "hover", i: 6 }]);
    expect(litRange(s)).toEqual({ lo: 2, hi: 6, preview: true });
    s = run([{ type: "click", i: 6, findingId: null }, { type: "click", i: 11, findingId: null }], s);
    expect(s).toMatchObject({ anchor: 11, range: null });
    expect(litRange(s)).toBeNull();
  });

  test("a hover with no first word, or on the same word, changes nothing (no re-render)", () => {
    expect(boardReducer(EMPTY, { type: "hover", i: 3 })).toBe(EMPTY);
    const s = run([{ type: "click", i: 2, findingId: null }, { type: "hover", i: 4 }]);
    expect(boardReducer(s, { type: "hover", i: 4 })).toBe(s);
  });

  test("a drag selects a range even across a quote, and the studio's numbers are clamped", () => {
    expect(run([{ type: "drag", from: 5, to: 2 }]).range).toEqual([2, 5]);
    expect(run([{ type: "setRange", start: -4, end: 99, count: 14 }]).range).toEqual([0, 13]);
    expect(run([{ type: "setRange", start: 8, end: 3, count: 14 }]).range).toEqual([3, 8]);
  });

  test("clear drops the selection but keeps the inspected quote", () => {
    const s = run([{ type: "selectFinding", id: 2 }, { type: "drag", from: 1, to: 2 }, { type: "clear" }]);
    expect(s).toEqual({ ...EMPTY, finding: 2 });
  });
});

const verse = fromRow(row({}));
const hadith = fromRow(row({ id: 2, idx: 1, source_type: "HADITH", display_ref: "البخاري (1)", word_start: 10, word_end: 12 }));

describe("words, chunks and neighbours", () => {
  test("each word knows its finding; the first of two overlapping ones wins", () => {
    const inner = fromRow(row({ id: 3, word_start: 5, word_end: 8 }));
    const at = findingAtWord(14, [verse, inner, hadith]);
    expect([...at.slice(2, 10)]).toEqual([-1, 0, 0, 0, 0, 1, 1, -1]);
  });

  test("previous / next walk the quotes and go round at the ends", () => {
    expect(stepFinding([verse, hadith], 1, 1)).toBe(2);
    expect(stepFinding([verse, hadith], 2, 1)).toBe(1);
    expect(stepFinding([verse, hadith], 1, -1)).toBe(2);
    expect(stepFinding([], 1, 1)).toBeNull();
  });

  test("a chunk ends at a long pause or 160 words, never inside a quote", () => {
    const words: Word[] = Array.from({ length: 400 }, (_, i) => ({ idx: i, text: "w", start: i, end: i + 0.5 }));
    const long = fromRow(row({ id: 9, word_start: 150, word_end: 175 }));
    const chunks = boardChunks(words, findingAtWord(400, [long]));
    expect(chunks[0]).toEqual({ first: 0, last: 175 }); // 160 words falls inside the quote: it ends with the quote
    expect(chunks[1]).toEqual({ first: 176, last: 335 });
    expect(chunks.at(-1)!.last).toBe(399);
    expect(chunks.every((c, k) => k === 0 || c.first === chunks[k - 1].last + 1)).toBe(true);
  });

  test("a close neighbour can be merged; the verifier's suggestion is read from either finding", () => {
    const suggestion = { merge: { next: true, next_id: 2, previous: false, previous_id: null, confidence: 0.8, gap_type: "COMMENTARY" } };
    const v = { ...verse, details: suggestion };
    const [next] = neighbours([v, hadith], v, sampleWords);
    expect(next).toMatchObject({ direction: "next", gapWords: 3, gapText: "ثم قال النبي", dismissed: false });
    expect(next.suggested).toEqual({ confidence: 0.8, gapType: "COMMENTARY" });
    const [previous] = neighbours([v, hadith], hadith, sampleWords);
    expect(previous.direction).toBe("previous");
    expect(previous.suggested?.gapType).toBe("COMMENTARY");
  });

  test("a neighbour more than 12 words away is not offered", () => {
    const far = fromRow(row({ id: 4, word_start: 30, word_end: 32 }));
    expect(neighbours([verse, far], verse, sampleWords)).toEqual([]);
  });

  test("matching references: the finding's own first, from the detection's lists or the edited list", () => {
    const amb = fromRow(row({ data: { candidateUnitIds: ["112:3", "112:1"], candidateRefs: ["الإخلاص: 3", "الإخلاص: 1"] } }));
    expect(candidatesOf(amb).map((c) => c.unitId)).toEqual(["112:1", "112:3"]);
    const edited = fromRow(row({ data: { candidates: [{ unitId: "112:1", displayRef: "الإخلاص: 1" }, { unitId: "MANUAL:رواه أحمد", displayRef: "رواه أحمد", addedManually: true }] } }));
    expect(candidatesOf(edited)).toEqual([
      { unitId: "112:1", ref: "الإخلاص: 1", text: "", manual: false },
      { unitId: "MANUAL:رواه أحمد", ref: "رواه أحمد", text: "", manual: true },
    ]);
  });
});
