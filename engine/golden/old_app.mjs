// Loads the old browser app's own JS files (js/*.js) into a Node vm, the way backend/laya_datagen/js/harness.js does,
// so the golden files are produced by the exact code the old app runs. Nothing here re-implements app logic.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";

// index.html's load order, minus the files that only drive the page (i18n, corpus download, events, menus)
export const OLD_APP_FILES = [
  "js/state.js", "js/engine.js", "js/engine_v4.js", "js/engine_v5.js", "js/caption-builder.js",
  "js/ai-verifier.js", "js/editor.js", "js/render.js",
];

export const ENGINE_CHOICES = ["v3", "v4", "v5", "v5:loose"];
const EXPECTED_CLASS = { v3: "QuotationMatcherJS", v4: "WahyEngine", v5: "WahyEngineV5" };

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

export function loadOldApp(root, { corpusPath = path.join(root, "data/corpus.json") } = {}) {
  const store = {};
  const el = () => ({ value: "", textContent: "", classList: { add() {}, remove() {}, toggle() {} }, style: {}, addEventListener() {}, appendChild() {} });
  const sandbox = {
    console: { log() {}, warn() {}, info() {}, error: (...a) => process.stderr.write(a.join(" ") + "\n") },
    // deferred callbacks are page work (autosave, toasts): never run, so nothing changes state behind the generator
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    performance: { now: () => 0 },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, body: el() },
    indexedDB: undefined, navigator: { userAgent: "node" }, addEventListener() {}, removeEventListener() {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name || "golden-eval" });

  const files = {};
  for (const f of OLD_APP_FILES) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    files[f] = sha256(src);
    try { run(src, f); } catch (e) { throw new Error(`failed loading ${f}: ${e.message}`); }
  }
  const corpusRaw = fs.readFileSync(corpusPath);
  const corpus = JSON.parse(corpusRaw);
  // the app's default corpus (corpus-loader.js applyNormalizedCorpusToState): data/corpus.json's ayat and hadiths,
  // the built-in adhkar, no outside hadiths (custom quotes)
  sandbox.__ayat = corpus.ayat; sandbox.__hadiths = corpus.hadiths;
  run("RAW_QURAN_DATA = __ayat; RAW_HADITH_DATA = __hadiths; DEFAULT_HADITH_DATA = __hadiths;");

  const matchers = {};
  // the app's own switch (state.js rebuildMatcher reads localStorage.wahyEngine), then check the class it built:
  // rebuildMatcher silently falls back to v3 when an engine fails to build
  function useEngine(name) {
    const base = name.split(":")[0];
    if (!EXPECTED_CLASS[base]) throw new Error(`unknown engine ${name}`);
    if (!matchers[name]) {
      store.wahyEngine = name;
      run("rebuildMatcher()");
      const built = run("activeMatcher.constructor.name");
      if (built !== EXPECTED_CLASS[base]) throw new Error(`engine ${name} fell back to ${built}`);
      if (run("activeEngineName()") !== name) throw new Error(`engine ${name} built as ${run("activeEngineName()")}`);
      matchers[name] = run("activeMatcher");
    }
    sandbox.__m = matchers[name];
    run("activeMatcher = __m");
  }

  return {
    run, sandbox, useEngine,
    fingerprint: { files, corpus: sha256(corpusRaw) },
  };
}
