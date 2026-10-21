// =============================================================================
// Wahy Studio — Interface Language Layer
// File: js/i18n.js
// The UI is authored in Arabic. Instead of rewriting every string call site,
// this layer translates rendered UI text (text nodes + title/placeholder/
// aria-label + confirm/alert/prompt dialogs) through a dictionary keyed by the
// Arabic source text, and re-translates anything the app renders later via a
// MutationObserver.
//   • Built-in packs: ar (source), en (js/i18n-en.js)
//   • Any other language: generated once from the English pack with the user's
//     Gemini / OpenRouter key and cached in localStorage.
// Lecture transcript, Quran/Hadith/Adhkar text and form fields are never touched.
// =============================================================================

(function (window) {
  "use strict";

  const LS_LANG_KEY = "wahy_ui_lang";
  const LS_PACK_PREFIX = "wahy_i18n_pack_";
  const RTL_CODES = ["ar", "fa", "ur", "he", "ps", "ku", "ckb", "sd", "ug", "yi", "dv"];

  // Containers whose content is lecture / corpus text, not UI. The lecture
  // stages are skipped entirely (attributes too): they render thousands of
  // per-word tooltips on every refresh.
  const CONTENT_SELECTOR = [
    "#formattedLectureStage", "#editorLectureStage", "#videoCaptionOverlay",
    "#tafrighRenderedContent", "#tafrighTocBar", "[data-no-i18n]"
  ].join(",");
  const SKIP_SELECTOR = [
    CONTENT_SELECTOR, "script", "style", "textarea", "pre", "code", "[contenteditable='true']",
    ".font-arabic-text", ".font-quran-text"
  ].join(",");
  const TRANSLATED_ATTRS = ["title", "placeholder", "aria-label"];
  const AR_RE = /[؀-ۿ]/;
  const AR_LETTERS_RE = /[ء-ي]/g;

  let currentLang = "ar";
  let dict = null;          // { arabicSource: translated }
  let fragmentRe = null;    // alternation of all keys, longest first
  let countRules = [];      // keys like "{n} كلمة" → [regex, template]
  let observer = null;
  let applying = false;
  let memo = new Map();

  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ---------------------------------------------------------------------------
  // Packs
  // ---------------------------------------------------------------------------

  function listCustomPacks() {
    const packs = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(LS_PACK_PREFIX)) continue;
        const p = JSON.parse(localStorage.getItem(k) || "null");
        if (p && p.code && p.dict) packs.push({ code: p.code, name: p.name || p.code, dir: p.dir || "ltr" });
      }
    } catch (_) {}
    return packs;
  }

  function listLanguages() {
    return [
      { code: "ar", name: "العربية", dir: "rtl", builtin: true },
      { code: "en", name: "English", dir: "ltr", builtin: true },
      ...listCustomPacks().map(p => Object.assign(p, { builtin: false }))
    ];
  }

  function loadPack(code) {
    if (code === "ar") return { dict: null, dir: "rtl" };
    if (code === "en") return { dict: window.WAHY_I18N_EN || {}, dir: "ltr" };
    try {
      const p = JSON.parse(localStorage.getItem(LS_PACK_PREFIX + code) || "null");
      if (p && p.dict) return { dict: p.dict, dir: p.dir || (RTL_CODES.includes(code) ? "rtl" : "ltr") };
    } catch (_) {}
    return null;
  }

  // ---------------------------------------------------------------------------
  // String translation
  // ---------------------------------------------------------------------------

  function buildCountRules() {
    // longest first, so "{n} جملة (من" wins over "{n} جملة"
    return Object.keys(dict || {}).filter(k => k.includes("{n}")).sort((x, y) => y.length - x.length).map(k => {
      const [before, after] = k.split("{n}").map(part => escapeRe(part.trim()));
      const re = new RegExp(`${before ? before + "\\s*" : ""}(\\d[\\d,.]*)${after ? "\\s*" + after : ""}(?![\\u0621-\\u064A])`, "g");
      return [re, dict[k]];
    });
  }

  function buildFragmentRe() {
    const keys = Object.keys(dict || {}).filter(k => AR_RE.test(k) && !k.includes("{n}")).sort((a, b) => b.length - a.length);
    if (!keys.length) return null;
    // Arabic-letter boundaries so a short key never matches inside a longer word
    return new RegExp(`(?<![\\u0621-\\u064A])(?:${keys.map(escapeRe).join("|")})(?![\\u0621-\\u064A])`, "g");
  }

  /** Translate one UI string; returns null when nothing applies. */
  function translateString(str) {
    if (!dict || !str || !AR_RE.test(str)) return null;
    if (memo.has(str)) return memo.get(str);
    const out = translateUncached(str);
    if (memo.size > 5000) memo.clear();
    memo.set(str, out);
    return out;
  }

  function translateUncached(str) {
    const core = norm(str);
    const lead = /^\s/.test(str) ? " " : "";
    const trail = /\s$/.test(str) ? " " : "";
    if (Object.prototype.hasOwnProperty.call(dict, core)) {
      return lead + dict[core] + trail;
    }
    if (!fragmentRe || core.length > 300) return null;
    // Interpolated strings ("محدد 3 من 10"): replace known fragments, but only
    // accept the result if it's mostly UI text — long Arabic content that merely
    // contains a short key (e.g. «من») stays untouched.
    const before = (core.match(AR_LETTERS_RE) || []).length;
    let replaced = core;
    countRules.forEach(([re, tpl]) => { replaced = replaced.replace(re, (_, n) => tpl.replace("{n}", n)); });
    replaced = replaced.replace(fragmentRe, (m) => dict[m]);
    if (replaced === core) return null;
    const after = (replaced.match(AR_LETTERS_RE) || []).length;
    if (after > before * 0.3) return null;
    return lead + replaced + trail;
  }

  function t(str) {
    return translateString(str) ?? str;
  }

  // ---------------------------------------------------------------------------
  // DOM application
  // ---------------------------------------------------------------------------

  // UI placed inside a content area (e.g. a review card inside the rendered transcript) opts back in with data-i18n-ui
  function blockedBy(el, selector) {
    const c = el.closest(selector);
    if (!c) return false;
    const ui = el.closest("[data-i18n-ui]");
    return !(ui && c !== ui && c.contains(ui));   // the nearest content container wins over an outer UI marker
  }

  function isSkipped(el) {
    return !el || !el.closest || blockedBy(el, SKIP_SELECTOR);
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || isSkipped(parent)) return;
    const val = node.nodeValue;
    if (node.__i18nOut !== undefined && val === node.__i18nOut) return; // our own output
    node.__i18nSrc = val;                                                // app wrote new source text
    const out = translateString(val);
    if (out !== null && out !== val) {
      node.__i18nOut = out;
      node.nodeValue = out;
    } else {
      node.__i18nOut = undefined;
    }
  }

  // Attributes are always UI (tooltips, placeholders), so only content containers block them
  function translateAttrs(el) {
    if (!el.closest || blockedBy(el, CONTENT_SELECTOR)) return;
    el.__i18nAttrs = el.__i18nAttrs || {};
    TRANSLATED_ATTRS.forEach(a => {
      const val = el.getAttribute(a);
      if (!val) return;
      const rec = el.__i18nAttrs[a];
      if (rec && val === rec.out) return;
      const out = translateString(val);
      el.__i18nAttrs[a] = { src: val, out: out !== null ? out : val };
      if (out !== null && out !== val) el.setAttribute(a, out);
    });
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (blockedBy(root, CONTENT_SELECTOR)) {
        root.querySelectorAll("[data-i18n-ui]").forEach(walk);
        return;
      }
      translateAttrs(root);
      if (blockedBy(root, SKIP_SELECTOR)) return;
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.matches(CONTENT_SELECTOR) || n.matches(SKIP_SELECTOR)) {
            if (!n.matches(CONTENT_SELECTOR)) translateAttrs(n);
            n.querySelectorAll("[data-i18n-ui]").forEach(walk);
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return AR_RE.test(n.nodeValue) || n.__i18nSrc !== undefined ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) translateTextNode(n);
      else translateAttrs(n);
    }
  }

  /** Put every translated node/attribute back to its Arabic source. */
  function restoreAll() {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.__i18nOut !== undefined && n.nodeValue === n.__i18nOut) n.nodeValue = n.__i18nSrc;
        n.__i18nOut = undefined;
      } else if (n.__i18nAttrs) {
        Object.keys(n.__i18nAttrs).forEach(a => {
          const rec = n.__i18nAttrs[a];
          if (n.getAttribute(a) === rec.out) n.setAttribute(a, rec.src);
        });
        n.__i18nAttrs = undefined;
      }
    }
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((records) => {
      if (!dict || applying) return;
      applying = true;
      try {
        for (const r of records) {
          if (r.type === "childList") r.addedNodes.forEach(walk);
          else if (r.type === "characterData") translateTextNode(r.target);
          else if (r.type === "attributes") translateAttrs(r.target);
        }
      } finally {
        applying = false;
      }
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: TRANSLATED_ATTRS
    });
  }

  function applyDirection(code, dir) {
    const html = document.documentElement;
    html.setAttribute("lang", code);
    html.setAttribute("dir", dir);
  }

  function setLanguage(code) {
    const pack = loadPack(code) || loadPack("ar");
    const effective = loadPack(code) ? code : "ar";

    applying = true;
    try {
      if (dict) restoreAll();
      if (document.__i18nTitleSrc) document.title = document.__i18nTitleSrc;

      currentLang = effective;
      dict = pack.dict;
      memo = new Map();
      fragmentRe = dict ? buildFragmentRe() : null;
      countRules = dict ? buildCountRules() : [];
      applyDirection(effective, pack.dir);

      if (dict) {
        document.__i18nTitleSrc = document.__i18nTitleSrc || document.title;
        document.title = t(document.__i18nTitleSrc);
        walk(document.body);
      }
    } finally {
      applying = false;
    }
    try { localStorage.setItem(LS_LANG_KEY, effective); } catch (_) {}
    window.dispatchEvent(new CustomEvent("wahy:languagechange", { detail: { code: effective } }));
  }

  // Native dialogs don't go through the DOM
  ["alert", "confirm", "prompt"].forEach(fn => {
    const orig = window[fn].bind(window);
    window[fn] = (msg, ...rest) => orig(typeof msg === "string" ? t(msg) : msg, ...rest);
  });

  // ---------------------------------------------------------------------------
  // AI-generated language packs
  // ---------------------------------------------------------------------------

  async function callTranslationModel(promptText) {
    // currentState is a top-level const in state.js (global binding, not a window property)
    const ai = (typeof currentState !== "undefined" && currentState.aiVerification) || {};
    const geminiKey = (ai.geminiApiKey || "").trim();
    const orKey = (ai.openRouterApiKey || "").trim();

    if (geminiKey) {
      const model = ai.geminiModel || "gemini-3.5-flash-lite";
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: promptText }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
        })
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    }
    if (orKey) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${orKey}`, "Content-Type": "application/json", "X-Title": "Wahy Studio UI Translation" },
        body: JSON.stringify({
          model: ai.openRouterSelectedModel || "deepseek/deepseek-chat",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: promptText }]
        })
      });
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    }
    throw new Error("NO_AI_KEY");
  }

  /**
   * Translate the English pack into `languageName` and store it as a custom pack.
   * @param {string} languageName - what the user typed, e.g. "Français"
   * @param {function} onProgress - (done, total) callback
   */
  async function generateLanguagePack(languageName, onProgress) {
    const en = window.WAHY_I18N_EN || {};
    const arKeys = Object.keys(en);
    const enValues = arKeys.map(k => en[k]);
    const CHUNK = 120;
    const translated = new Array(arKeys.length);
    let meta = null;

    for (let start = 0; start < enValues.length; start += CHUNK) {
      const chunk = {};
      enValues.slice(start, start + CHUNK).forEach((v, i) => { chunk[String(start + i)] = v; });
      const askMeta = start === 0
        ? `Also include the keys "__name" (the language's native name), "__iso" (ISO 639-1 code, or a short lowercase code) and "__dir" ("ltr" or "rtl").\n`
        : "";
      const prompt =
        `Translate the user-interface strings below from English into ${languageName}.\n` +
        `This is an app for transcribing Islamic lectures and detecting Quran verses, hadith and adhkar.\n` +
        `Rules: keep emojis, symbols (﴿ ﴾ « » 〖 〗 ✓ ✕), punctuation, numbers, leading/trailing spaces and brackets exactly; ` +
        `keep product/technical names unchanged (Wahy Studio, FN Studio, Gemini, OpenRouter, JEV, Laya, JSON, HTML, API, CUDA, VRAM, Markdown, IndexedDB); ` +
        `keep any Arabic text inside the strings unchanged and keep the placeholder {n} exactly as written; translate fragments that end mid-sentence as fragments. ` +
        `Return ONLY a JSON object with the same keys mapped to the translations.\n` + askMeta +
        JSON.stringify(chunk);

      const result = await callTranslationModel(prompt);
      if (start === 0) meta = { name: result.__name, iso: result.__iso, dir: result.__dir };
      Object.keys(chunk).forEach(k => {
        translated[Number(k)] = typeof result[k] === "string" ? result[k] : chunk[k];
      });
      if (onProgress) onProgress(Math.min(start + CHUNK, enValues.length), enValues.length);
    }

    const code = String((meta && meta.iso) || languageName).toLowerCase().replace(/[^a-z-]/g, "").slice(0, 12) || `lang${Date.now()}`;
    const packDict = {};
    arKeys.forEach((k, i) => { packDict[k] = translated[i]; });
    const pack = {
      code: code === "ar" || code === "en" ? `${code}-x` : code,
      name: (meta && meta.name) || languageName,
      dir: (meta && meta.dir === "rtl") || RTL_CODES.includes(code) ? "rtl" : "ltr",
      source: languageName,
      dict: packDict,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(LS_PACK_PREFIX + pack.code, JSON.stringify(pack));
    return pack;
  }

  function deleteLanguagePack(code) {
    try { localStorage.removeItem(LS_PACK_PREFIX + code); } catch (_) {}
    if (currentLang === code) setLanguage("ar");
  }

  function getPackSource(code) {
    try {
      const p = JSON.parse(localStorage.getItem(LS_PACK_PREFIX + code) || "null");
      return p ? (p.source || p.name) : null;
    } catch (_) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Settings UI (#languageOptionsList in the settings modal)
  // Labels are written in Arabic like the rest of the UI and get translated by
  // this same layer.
  // ---------------------------------------------------------------------------

  function renderLanguageSettings() {
    const box = document.getElementById("languageOptionsList");
    if (!box) return;
    const esc = (v) => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    box.innerHTML = listLanguages().map(l => `
      <div class="flex items-center rounded-xl border overflow-hidden ${l.code === currentLang ? "border-sky-500/60 bg-sky-950/60" : "border-slate-700 bg-slate-900"}">
        <button type="button" data-set-lang="${esc(l.code)}" class="px-3 py-1.5 text-left">
          <span class="font-bold ${l.code === currentLang ? "text-sky-200" : "text-slate-200"}">${l.code === currentLang ? "✓ " : ""}${esc(l.name)}</span>
          <span class="block text-[10px] text-slate-500">${l.builtin ? "مدمجة" : "مولّدة بالذكاء الاصطناعي"}</span>
        </button>
        ${l.builtin ? "" : `
          <button type="button" data-regen-lang="${esc(l.code)}" class="px-2 self-stretch text-slate-400 hover:text-sky-300 border-l border-slate-700" title="🔄 إعادة توليد">🔄</button>
          <button type="button" data-del-lang="${esc(l.code)}" class="px-2 self-stretch text-slate-400 hover:text-rose-300 border-l border-slate-700" title="🗑️ حذف اللغة">🗑️</button>`}
      </div>`).join("");

    box.querySelectorAll("[data-set-lang]").forEach(b => b.addEventListener("click", () => {
      setLanguage(b.getAttribute("data-set-lang"));
      renderLanguageSettings();
    }));
    box.querySelectorAll("[data-del-lang]").forEach(b => b.addEventListener("click", () => {
      if (!window.confirm("حذف هذه اللغة؟ يمكنك توليدها مجدداً لاحقاً.")) return;
      deleteLanguagePack(b.getAttribute("data-del-lang"));
      renderLanguageSettings();
    }));
    box.querySelectorAll("[data-regen-lang]").forEach(b => b.addEventListener("click", () => {
      runGeneration(getPackSource(b.getAttribute("data-regen-lang")) || b.getAttribute("data-regen-lang"));
    }));
  }

  let generating = false;
  async function runGeneration(languageName) {
    const name = (languageName || "").trim();
    if (!name || generating) return;
    const btn = document.getElementById("btnGenerateLanguagePack");
    const progress = document.getElementById("lblLanguagePackProgress");
    generating = true;
    if (btn) btn.disabled = true;
    if (progress) {
      progress.classList.remove("hidden");
      progress.textContent = `⏳ ${name}: 0%`;
    }
    try {
      const pack = await generateLanguagePack(name, (done, total) => {
        if (progress) progress.textContent = `⏳ ${name}: ${Math.round((done / total) * 100)}% (${done}/${total})`;
      });
      setLanguage(pack.code);
      if (progress) progress.textContent = `✓ ${pack.name}`;
      const inp = document.getElementById("inpNewLanguageName");
      if (inp) inp.value = "";
    } catch (err) {
      if (progress) {
        progress.textContent = err.message === "NO_AI_KEY"
          ? t("⚠️ أدخل مفتاح Gemini أو OpenRouter في تبويب «الذكاء الاصطناعي» أولاً.")
          : `❌ ${err.message}`;
      }
    } finally {
      generating = false;
      if (btn) btn.disabled = false;
      renderLanguageSettings();
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  try { currentLang = localStorage.getItem(LS_LANG_KEY) || "ar"; } catch (_) {}
  // Set direction before first paint so the layout doesn't flip after load
  const bootPack = loadPack(currentLang);
  if (bootPack && document.documentElement) applyDirection(currentLang, bootPack.dir);

  window.addEventListener("DOMContentLoaded", () => {
    startObserver();
    if (currentLang !== "ar") setLanguage(currentLang);
    renderLanguageSettings();
    document.getElementById("btnGenerateLanguagePack")?.addEventListener("click", () => {
      runGeneration(document.getElementById("inpNewLanguageName")?.value);
    });
    document.getElementById("inpNewLanguageName")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runGeneration(e.target.value);
    });
  });

  /**
   * Locale for dates/times in the current UI language, always with Western
   * digits (0-9) — Arabic-Indic digits are never used, whatever the language.
   */
  function dateLocale() {
    return `${currentLang.split("-")[0]}-u-nu-latn`;
  }

  window.WahyI18n = {
    t,
    dateLocale,
    setLanguage,
    getLanguage: () => currentLang,
    listLanguages,
    generateLanguagePack,
    deleteLanguagePack,
    getPackSource
  };
})(window);
