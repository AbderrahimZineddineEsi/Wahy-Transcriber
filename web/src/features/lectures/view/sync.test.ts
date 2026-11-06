import { describe, expect, test } from "vitest";
import { CAPTION_HOLD_S, captionAt, clockText, progress, startTimes, wordAt } from "./sync";

// three words with a pause between the second and the third
const words = [
  { start: 0.5, end: 0.9 },
  { start: 1.0, end: 1.4 },
  { start: 3.0, end: 3.5 },
];
const starts = startTimes(words);

describe("wordAt: time to word", () => {
  test("before the first word nothing is spoken", () => {
    expect(wordAt(starts, 0)).toBe(-1);
    expect(wordAt(starts, 0.49)).toBe(-1);
  });

  test("a word is lit from its start", () => {
    expect(wordAt(starts, 0.5)).toBe(0);
    expect(wordAt(starts, 1.0)).toBe(1);
    expect(wordAt(starts, 3.2)).toBe(2);
  });

  test("in a pause the word before stays lit", () => {
    expect(wordAt(starts, 0.95)).toBe(0);
    expect(wordAt(starts, 2.0)).toBe(1);
  });

  test("after the last word the last one stays lit", () => {
    expect(wordAt(starts, 99)).toBe(2);
  });

  test("no words: nothing", () => {
    expect(wordAt(startTimes([]), 5)).toBe(-1);
  });

  test("a word that starts before the previous one (ASR jitter) does not break the search", () => {
    const jitter = startTimes([
      { start: 1.0, end: 1.5 },
      { start: 0.9, end: 1.8 }, // starts earlier than word 0
      { start: 2.0, end: 2.5 },
    ]);
    expect(Array.from(jitter)).toEqual([1.0, 1.0, 2.0]);
    expect(wordAt(jitter, 0.95)).toBe(-1);
    expect(wordAt(jitter, 1.2)).toBe(1);
    expect(wordAt(jitter, 2.1)).toBe(2);
  });

  test("it agrees with a plain scan at every time on a long lecture", () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ start: i * 0.37 + (i % 7) * 0.01, end: i * 0.37 + 0.3 }));
    const s = startTimes(many);
    const scan = (t: number) => {
      let found = -1;
      many.forEach((w, i) => {
        if (s[i] <= t) found = i;
      });
      return found;
    };
    for (let t = -1; t < 750; t += 1.913) expect(wordAt(s, t)).toBe(scan(t));
  });

  test("20,000 words: a lookup costs microseconds, so 60 a second is free", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => ({ start: i * 0.36, end: i * 0.36 + 0.3 }));
    const s = startTimes(many);
    const t0 = performance.now();
    let sum = 0;
    for (let k = 0; k < 100_000; k++) sum += wordAt(s, (k * 7.3) % 7200);
    const perLookupMs = (performance.now() - t0) / 100_000;
    expect(sum).toBeGreaterThan(0);
    expect(perLookupMs).toBeLessThan(0.01);
  });
});

describe("captionAt: the caption on screen", () => {
  const caps = [
    { start: 0.5, end: 1.4 },
    { start: 3.0, end: 3.5 },
  ];
  const cs = startTimes(caps);
  test("shown from its start until a moment after its end", () => {
    expect(captionAt(caps, cs, 0.2)).toBe(-1);
    expect(captionAt(caps, cs, 0.5)).toBe(0);
    expect(captionAt(caps, cs, 1.4 + CAPTION_HOLD_S)).toBe(0);
  });
  test("a long pause shows no caption", () => {
    expect(captionAt(caps, cs, 2.0)).toBe(-1);
    expect(captionAt(caps, cs, 3.1)).toBe(1);
    expect(captionAt(caps, cs, 9)).toBe(-1);
  });
});

test("progress and the time label", () => {
  expect(progress(30, 120)).toBe(0.25);
  expect(progress(500, 120)).toBe(1);
  expect(progress(5, 0)).toBe(0);
  expect(clockText(75.4)).toBe("1:15");
  expect(clockText(3725)).toBe("1:02:05");
  expect(clockText(0)).toBe("0:00");
});
