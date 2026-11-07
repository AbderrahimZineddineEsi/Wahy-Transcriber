// browse(): paging, the surah and book filters and the text search, on the tiny corpus.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { browse } from "./browse.ts";
import type { Corpus } from "./types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const small = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/small-corpus.json"), "utf8"));
const corpus: Corpus = { ayat: small.ayat, hadiths: small.hadiths };

describe("browse", () => {
  test("a surah filter and a page: ayat of one surah, counted before paging", () => {
    const all = browse(corpus, { kind: "QURAN", surah: 1 });
    expect(all.total).toBe(7);
    const page2 = browse(corpus, { kind: "QURAN", surah: 1, offset: 5, limit: 5 });
    expect(page2.total).toBe(7);
    expect(page2.items.map((i) => i.id)).toEqual(["1:6", "1:7"]);
    expect(Object.keys(all.groups)).toEqual(["1", "112"]);
    expect(all.groups["112"][1]).toBe(4);
  });

  test("a search ignores diacritics and matches a reference", () => {
    expect(browse(corpus, { kind: "QURAN", q: "الصمد" }).items.map((i) => i.id)).toEqual(["112:2"]);
    expect(browse(corpus, { kind: "QURAN", q: "الإخلاص: 3" }).items.map((i) => i.id)).toEqual(["112:3"]);
  });

  test("hadiths by book", () => {
    const r = browse(corpus, { kind: "HADITH", book: "Nawawi40" });
    expect(r.total).toBe(2);
    expect(r.groups).toEqual({ Nawawi40: ["Nawawi40", 2] });
    expect(browse(corpus, { kind: "HADITH", book: "Nope" }).total).toBe(0);
  });

  test("an unknown kind is refused", () => {
    expect(() => browse(corpus, { kind: "ADHKAR" as any })).toThrow(/unknown kind/);
  });
});
