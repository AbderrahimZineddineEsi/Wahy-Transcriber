// The engine worker (ADR 0002, ROADMAP phase 5): a long-lived Node process that loads the corpus once and answers
// one JSON request per line on stdin with one JSON response per line on stdout. The Python side (the datagen's
// engine_bridge.py today, the server's core/engine.py from phase 6) talks to the engine only through this.
//
// Run from the repo root (Node 24 runs the .ts files as they are, no build):
//   node --max-old-space-size=4096 engine/src/worker.ts [--corpus data/corpus.json] [--hadiths other_hadiths.json]
//
// Request:  {"id": 1, "cmd": "detect", ...arguments}
// Response: {"id": 1, "ok": true, "result": ...}   or   {"id": 1, "ok": false, "error": "..."}
//
// Commands (`options` are detect()'s options without the corpus: engine, profile, qiraat, adhkar, customQuotes):
//   info                                 the fingerprint (hashes of the engine files and the corpus) and corpus sizes
//   detect     {words, options}          findings; words are [{word, start, end}]
//   envelopes  {findings, words, version, options}   options also: passages, neighbours, targets, contextWords
//   search     {text, options}           corpus units; options also: kind, limit
//   expand     {finding, words, boundary, options}   the finding grown over its missing start or end (expand.ts)
//   rule_boundary {states}               the no-model boundary {start, end} of each v2 / v3 state (envelopes.ts)
//   units      {ids, options}            {id: {ref, words, norms}}: a unit's vocalised words and the engine's norms
//   tokenize   {text}                    the engine's normalised tokens
//   tokenize_words {words}               the same per word (a word can give 0, 1 or more tokens)
//   surah_names                          {"1": "الفاتحة", ...}
//
// Requests are answered one at a time, in order. Matchers (one per engine choice, seconds to build, hundreds of MB
// each) are built on first use and kept: at most 4 per process (detect.ts).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { detect, matcherFor } from "./detect.ts";
import { envelopes, ruleBoundary } from "./envelopes.ts";
import { expand } from "./expand.ts";
import { search } from "./search.ts";
import { SURAH_NAMES_AR } from "./shared.js";
import { tokenizeText } from "./v3.js";
import type { Corpus } from "./types.ts";

// stdout carries the protocol and nothing else: anything else that logs goes to stderr
console.log = console.info = console.debug = console.warn = console.error;

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SRC, "../..");

const args = parseArgs(process.argv.slice(2));
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const corpusPath = path.resolve(ROOT, args.corpus ?? "data/corpus.json");
const corpusRaw = fs.readFileSync(corpusPath);
const parsed = JSON.parse(corpusRaw.toString("utf8"));
const corpus: Corpus = { ayat: parsed.ayat, hadiths: parsed.hadiths };
const corpusHashes: Record<string, string> = { corpus: sha256(corpusRaw) };
if (args.hadiths) {
  // another hadith collection in place of the corpus's own (the datagen's engine evaluation uses one)
  const raw = fs.readFileSync(path.resolve(ROOT, args.hadiths));
  const h = JSON.parse(raw.toString("utf8"));
  corpus.hadiths = Array.isArray(h) ? h : h.hadiths;
  corpusHashes.hadiths = sha256(raw);
}
if (!Array.isArray(corpus.ayat) || !Array.isArray(corpus.hadiths)) {
  throw new Error(`${corpusPath} has no ayat or hadiths array`);
}

/** Hashes of the code that decides every answer: change any engine file and the fingerprint changes. */
const files = Object.fromEntries(
  fs.readdirSync(SRC).filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith(".test.ts")).sort()
    .map((f) => [`engine/src/${f}`, sha256(fs.readFileSync(path.join(SRC, f)))]),
);

const withCorpus = (options: object = {}) => ({ ...options, corpus });

const handlers: Record<string, (req: any) => unknown> = {
  info: () => ({ fingerprint: { files, corpus: corpusHashes }, quran: corpus.ayat.length, hadiths: corpus.hadiths.length }),
  detect: ({ words, options }) => detect(words, withCorpus(options)),
  envelopes: ({ findings, words, version, options }) => envelopes(findings, words, version, withCorpus(options)),
  search: ({ text, options }) => search(text, withCorpus(options)),
  expand: ({ finding, words, boundary, options }) => expand(finding, words, boundary, withCorpus(options)),
  rule_boundary: ({ states }) => states.map(ruleBoundary),
  units: ({ ids, options }) => {
    const units = matcherFor(withCorpus(options)).units;
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      const u = units.get(id);
      if (u) out[id] = { ref: u.displayRef, words: u.vocalizedWords ?? null, norms: u.normWords ?? null };
    }
    return out;
  },
  tokenize: ({ text }) => norms(text),
  tokenize_words: ({ words }) => words.map(norms),
  surah_names: () => SURAH_NAMES_AR,
};

function norms(text: string): string[] {
  return tokenizeText(text).map((t: { norm: string }) => t.norm);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let id: unknown = null;
  let response: object;
  try {
    const req = JSON.parse(line);
    id = req.id ?? null;
    const handler = Object.hasOwn(handlers, req.cmd) ? handlers[req.cmd] : null;
    if (!handler) throw new Error(`unknown command "${req.cmd}" (${Object.keys(handlers).join(", ")})`);
    response = { id, ok: true, result: handler(req) };
  } catch (e) {
    response = { id, ok: false, error: e instanceof Error ? e.stack ?? e.message : String(e) };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});

function parseArgs(argv: string[]): { corpus?: string; hadiths?: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(corpus|hadiths)(?:=(.*))?$/);
    if (!m) throw new Error(`unknown argument ${argv[i]} (--corpus PATH, --hadiths PATH)`);
    const value = m[2] ?? argv[++i];
    if (!value) throw new Error(`--${m[1]} needs a path`);
    out[m[1]] = value;
  }
  return out;
}
