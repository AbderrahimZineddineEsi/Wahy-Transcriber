// suggest(): the reference picker's ranking for a missed quote (F-052), on the tiny corpus.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { suggest } from "./search.ts";
import type { Corpus } from "./types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const small = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/small-corpus.json"), "utf8"));
const corpus: Corpus = { ayat: small.ayat, hadiths: small.hadiths };
const opts = { corpus, engine: "v3" as const };

describe("suggest", () => {
  test("a misheard verse still puts its ayah first, with the matched words marked", () => {
    // «الحمد لله رب العلمين» heard without the alef of العالمين
    const out = suggest(["الحمد", "لله", "رب", "العلمين"], { ...opts, kind: "QURAN" });
    expect(out[0].displayRef).toContain("الفاتحة");
    expect(out[0].unitId).toBe("1:2");
    expect(out[0].score).toBeGreaterThan(0);
    expect(out[0].words.length).toBe(4);
    expect(out[0].matched).toContain(0); // الْحَمْدُ
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  test("a hadith's words rank it first among the hadiths", () => {
    const out = suggest(["إنما", "الأعمال", "بالنيات"], { ...opts, kind: "HADITH" });
    expect(out[0].unitId).toBe("Nawawi40:1");
    expect(out[0].matched.length).toBeGreaterThan(0);
  });

  test("the typed query adds to the score; nothing matching scores 0; the limit holds", () => {
    const none = suggest(["كلام", "عادي"], { ...opts, kind: "QURAN", limit: 3 });
    expect(none).toHaveLength(3);
    expect(none.every((s) => s.score === 0)).toBe(true);
    const typed = suggest(["كلام"], { ...opts, kind: "QURAN", query: "الرحيم" });
    expect(typed[0].score).toBeGreaterThanOrEqual(80);
  });

  test("an unknown kind is refused", () => {
    expect(() => suggest(["x"], { ...opts, kind: "ALL" as never })).toThrow(/unknown kind/);
  });
});
