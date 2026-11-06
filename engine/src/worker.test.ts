// The worker as its callers use it: a real Node process, JSON lines in and out, on the tiny corpus.
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { detect, envelopes, search, synthesizeWordsFromRawText } from "./index.ts";
import type { Corpus } from "./index.ts";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMALL = path.join(HERE, "fixtures/small-corpus.json");
const small = JSON.parse(fs.readFileSync(SMALL, "utf8"));
const corpus: Corpus = { ayat: small.ayat, hadiths: small.hadiths };
const words = synthesizeWordsFromRawText("قال الله تعالى قل هو الله أحد الله الصمد ثم قال النبي إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");

let worker: ChildProcessWithoutNullStreams;
let lines: AsyncIterator<string>;
let nextId = 0;

/** One request, one response line. */
async function call(cmd: string, args: object = {}): Promise<any> {
  const id = ++nextId;
  worker.stdin.write(JSON.stringify({ id, cmd, ...args }) + "\n");
  const { value } = await lines.next();
  const res = JSON.parse(value);
  expect(res.id).toBe(id);
  return res;
}

beforeAll(() => {
  worker = spawn(process.execPath, [path.join(HERE, "worker.ts"), "--corpus", SMALL]);
  lines = readline.createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
});
afterAll(() => {
  worker.stdin.end();
});

describe("worker", () => {
  test("info: the corpus sizes and a fingerprint of the engine files and the corpus", async () => {
    const { ok, result } = await call("info");
    expect(ok).toBe(true);
    expect(result.quran).toBe(corpus.ayat.length);
    expect(Object.keys(result.fingerprint.files)).toContain("engine/src/v5.js");
    expect(Object.keys(result.fingerprint.files).some((f: string) => f.endsWith(".test.ts"))).toBe(false);
    expect(result.fingerprint.corpus.corpus).toMatch(/^[0-9a-f]{64}$/);
  });

  test("detect, envelopes and search answer what the package gives in-process", async () => {
    const options = { engine: "v3" };
    const found = await call("detect", { words, options });
    expect(found.result.length).toBeGreaterThan(1);
    expect(found.result).toEqual(JSON.parse(JSON.stringify(detect(words, { corpus, engine: "v3" }))));
    const env = await call("envelopes", { findings: found.result, words, version: 2, options: { ...options, targets: [1] } });
    expect(env.result).toEqual(envelopes(found.result, words, 2, { corpus, engine: "v3", targets: [1] }));
    const hits = await call("search", { text: "الصمد", options });
    expect(hits.result).toEqual(search("الصمد", { corpus, engine: "v3" }));
  });

  test("units, tokenize, tokenize_words and surah_names", async () => {
    const units = (await call("units", { ids: ["112:2", "nope"], options: { engine: "v4" } })).result;
    expect(Object.keys(units)).toEqual(["112:2"]);
    const samad = corpus.ayat.find((x) => x.s === 112 && x.a === 2)!.t;   // vocalised: «اللَّهُ الصَّمَدُ»
    expect(units["112:2"]).toEqual({ ref: "الإخلاص: 2", words: samad.split(" "), norms: ["الله", "الصمد"] });
    expect((await call("tokenize", { text: "قالَ اللهُ تعالى" })).result).toEqual(["قال", "الله", "تعالي"]);
    expect((await call("tokenize_words", { words: ["قال", "،", "إنَّ"] })).result).toEqual([["قال"], [], ["ان"]]);
    expect((await call("surah_names")).result["112"]).toBe("الإخلاص");
  });

  test("errors come back as a response, and the worker keeps going", async () => {
    const unknown = await call("nope");
    expect(unknown).toMatchObject({ ok: false, error: expect.stringContaining('unknown command "nope"') });
    const bad = await call("detect", { words, options: { engine: "v9" } });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('unknown engine "v9"') });
    worker.stdin.write("not json\n");
    const { value } = await lines.next();
    expect(JSON.parse(value)).toMatchObject({ id: null, ok: false });
    expect((await call("info")).ok).toBe(true);
  });
});
