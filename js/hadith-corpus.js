// =============================================================================
// Wahy Studio — Selectable Hadith Corpus
// File: js/hadith-corpus.js
// The default hadith come with the main corpus (data/corpus.json). Other corpora are prepared by the backend
// (/api/corpus/sources → data/corpora/hadith_<id>.json) and swapped in for RAW_HADITH_DATA, the same way the
// engine version is switched: pick it in the toolbar or in Settings, the matcher is rebuilt and the current
// lecture re-detected, so runs can be compared.
// =============================================================================

const LS_HADITH_CORPUS_KEY = "wahyHadithCorpus";
const DEFAULT_HADITH_CORPUS = "wahy_default";
const HADITH_CORPUS_IDB_PREFIX = "hadith_source_";

let activeHadithCorpus = DEFAULT_HADITH_CORPUS;
let hadithCorpusSources = [];          // last /api/corpus/sources answer
const preparingCorpusJobs = {};        // source id -> polling timer

function getSavedHadithCorpusChoice() {
  try { return localStorage.getItem(LS_HADITH_CORPUS_KEY) || DEFAULT_HADITH_CORPUS; } catch (e) { return DEFAULT_HADITH_CORPUS; }
}

async function fetchHadithCorpusSources() {
  try {
    const r = await fetch("/api/corpus/sources", { trapError: false });
    const d = await r.json();
    hadithCorpusSources = Array.isArray(d.sources) ? d.sources : [];
  } catch (e) {
    hadithCorpusSources = [];   // no backend (browser-only mode): only the default corpus is available
  }
  return hadithCorpusSources;
}

/** Hadith list of a prepared source, from the browser cache when the server file hasn't changed. */
async function loadHadithCorpusData(sourceId) {
  const src = (hadithCorpusSources.length ? hadithCorpusSources : await fetchHadithCorpusSources()).find(s => s.id === sourceId);
  if (!src || src.status !== "ready" || !src.url) {
    throw new Error("NOT_PREPARED");
  }
  const key = HADITH_CORPUS_IDB_PREFIX + sourceId;
  const cached = await readCorpusFromWahyDB(key);
  if (cached && cached.stamp === src.stamp && Array.isArray(cached.hadiths)) return cached.hadiths;

  updateCorpusProgressUI(40, `جاري تحميل قاعدة الأحاديث: ${src.label}...`, true);
  const data = await fetchJsonSafely(src.url);
  const hadiths = Array.isArray(data.hadiths) ? data.hadiths : [];
  await writeCorpusToWahyDB({ stamp: src.stamp, hadiths }, key);
  return hadiths;
}

function syncHadithCorpusSelects() {
  const sel = document.getElementById("selHadithCorpusQuick");
  if (sel) sel.value = activeHadithCorpus;
}

/**
 * Make `sourceId` the hadith corpus the engine searches. rerun: re-detect the current lecture right away.
 * Returns false (and keeps the current corpus) when the source isn't prepared yet.
 */
async function selectHadithCorpus(sourceId, { rerun = true, quiet = false } = {}) {
  let hadiths;
  if (sourceId === DEFAULT_HADITH_CORPUS) {
    hadiths = DEFAULT_HADITH_DATA;
  } else {
    try {
      hadiths = await loadHadithCorpusData(sourceId);
    } catch (err) {
      syncHadithCorpusSelects();
      if (!quiet) {
        showToast(err.message === "NOT_PREPARED"
          ? "⚠️ هذه القاعدة غير مجهّزة بعد — افتح الإعدادات ← مصادر القواعد ← «تحميل وتجهيز»"
          : `❌ تعذر تحميل قاعدة الأحاديث: ${err.message}`);
        if (err.message === "NOT_PREPARED" && typeof openModalById === "function") {
          openModalById("settingsModal");
          renderHadithCorpusSettings();
        }
      }
      return false;
    }
  }

  activeHadithCorpus = sourceId;
  try { localStorage.setItem(LS_HADITH_CORPUS_KEY, sourceId); } catch (e) { /* storage blocked */ }
  RAW_HADITH_DATA = hadiths;
  if (currentState?.corpus) currentState.corpus.hadiths = hadiths;
  syncHadithCorpusSelects();
  rebuildMatcher();
  if (typeof renderDatasetsSection === "function") renderDatasetsSection();
  if (typeof updateCorpusCountLabels === "function") updateCorpusCountLabels();
  updateCorpusProgressUI(100, `القرآن: ${RAW_QURAN_DATA.length} | الحديث: ${RAW_HADITH_DATA.length} | الأذكار: ${RAW_ADHKAR_DATA.length}`, false);
  if (rerun && currentState.rawTranscript) runDetectionAndBuildCaptions();
  if (!quiet) {
    const label = (hadithCorpusSources.find(s => s.id === sourceId) || {}).label || sourceId;
    showToast(`📚 قاعدة الأحاديث: ${label} (${hadiths.length} حديث)${rerun && currentState.rawTranscript ? " — أُعيد فحص المحاضرة" : ""}`);
  }
  renderHadithCorpusSettings();
  return true;
}

/** Called by initDynamicCorpus once the default corpus is in place. */
async function applySavedHadithCorpusChoice() {
  const choice = getSavedHadithCorpusChoice();
  if (choice === DEFAULT_HADITH_CORPUS) {
    activeHadithCorpus = DEFAULT_HADITH_CORPUS;
    syncHadithCorpusSelects();
    return;
  }
  await fetchHadithCorpusSources();
  const ok = await selectHadithCorpus(choice, { rerun: false, quiet: true });
  if (!ok) {
    activeHadithCorpus = DEFAULT_HADITH_CORPUS;
    syncHadithCorpusSelects();
  }
}

// -----------------------------------------------------------------------------
// Preparing a source (download + convert on the server), with live progress
// -----------------------------------------------------------------------------

function watchCorpusJob(sourceId, jobId) {
  clearInterval(preparingCorpusJobs[sourceId]);
  preparingCorpusJobs[sourceId] = setInterval(async () => {
    let d;
    try {
      const r = await fetch(`/api/transcribe/progress/${jobId}`, { trapError: false });
      d = await r.json();
    } catch (e) { return; }
    const box = document.querySelector(`[data-corpus-progress="${sourceId}"]`);
    if (box) {
      box.classList.remove("hidden");
      const pct = Math.round(d.percent ?? 0);
      box.querySelector("[data-bar]").style.width = `${pct}%`;
      box.querySelector("[data-msg]").textContent = d.message || "";
    }
    if (d.stage === "done" || d.stage === "error") {
      clearInterval(preparingCorpusJobs[sourceId]);
      delete preparingCorpusJobs[sourceId];
      await fetchHadithCorpusSources();
      renderHadithCorpusSettings();
      showToast(d.stage === "done" ? `✅ ${d.message}` : `❌ ${d.message}`);
    }
  }, 700);
}

async function startPrepareHadithCorpus(sourceId, file = null) {
  let res;
  try {
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      res = await fetch(`/api/corpus/sources/${sourceId}/upload`, { method: "POST", body: fd, trapError: false });
    } else {
      res = await fetch(`/api/corpus/sources/${sourceId}/prepare`, { method: "POST", trapError: false });
    }
    const d = await res.json();
    if (!d.success) throw new Error(d.message || "failed");
    await fetchHadithCorpusSources();
    renderHadithCorpusSettings();
    watchCorpusJob(sourceId, d.job_id);
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Settings panel (#hadithCorpusSourcesList)
// -----------------------------------------------------------------------------

function renderHadithCorpusSettings() {
  const box = document.getElementById("hadithCorpusSourcesList");
  const adhkarLbl = document.getElementById("lblAdhkarSourceSummary");
  if (adhkarLbl) {
    const builtin = new Set(BUILTIN_ADHKAR_DATA.map(b => b.id));
    const mine = RAW_ADHKAR_DATA.filter(x => !builtin.has(x.id)).length;
    adhkarLbl.innerHTML = `<span class="text-slate-400">الأذكار:</span> <span>${BUILTIN_ADHKAR_DATA.length} مدمجة + ${mine} من إضافاتك</span> <span class="text-slate-500">— تُدار من «القواعد والأذكار»</span>`;
  }
  if (!box) return;
  if (!hadithCorpusSources.length) {
    box.innerHTML = `<div class="text-[11px] text-slate-500">⏳ جاري جلب المصادر من الخادم...</div>`;
    fetchHadithCorpusSources().then(list => {
      if (list.length) renderHadithCorpusSettings();
      else box.innerHTML = `<div class="text-[11px] text-slate-400">الخادم غير متصل: القاعدة الافتراضية فقط متاحة.</div>`;
    });
    return;
  }

  box.innerHTML = hadithCorpusSources.map(src => {
    const active = src.id === activeHadithCorpus;
    const count = src.id === DEFAULT_HADITH_CORPUS ? DEFAULT_HADITH_DATA.length : src.count;
    const books = src.by_book ? Object.entries(src.by_book).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" • ") : "";
    const status = src.status === "ready"
      ? '<span class="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 text-[10px] font-bold">✓ جاهزة</span>'
      : (src.status === "preparing"
          ? '<span class="px-1.5 py-0.5 rounded bg-sky-900/60 text-sky-300 text-[10px] font-bold animate-pulse">⏳ قيد التجهيز</span>'
          : '<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-bold">غير مُحمّلة</span>');
    return `
      <div class="p-3 rounded-xl border ${active ? "bg-amber-950/30 border-amber-500/50" : "bg-slate-900 border-slate-800"} space-y-1.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-bold text-slate-100">${escapeHtml(src.label)}</span>
            ${status}
            ${active ? '<span class="px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-200 text-[10px] font-bold">★ المستخدمة الآن</span>' : ""}
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            ${src.status === "ready" && !active ? `<button type="button" data-use-corpus="${src.id}" class="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold">استخدام هذه القاعدة</button>` : ""}
            ${!src.builtin && src.status === "missing" ? `<button type="button" data-prepare-corpus="${src.id}" class="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold">⬇️ تحميل وتجهيز</button>` : ""}
            ${!src.builtin && src.status === "ready" ? `<button type="button" data-prepare-corpus="${src.id}" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="إعادة التحويل من الملف المحمّل">🔄 إعادة التجهيز</button>` : ""}
          </div>
        </div>
        <div class="text-[11px] text-slate-400">${escapeHtml(src.description || "")}</div>
        <div class="text-[11px] text-slate-300">${count != null ? `<b class="font-mono">${count}</b> <span>حديث</span>` : ""}${src.size_mb ? ` • <span class="font-mono">${src.size_mb} MB</span>` : ""}${src.version ? ` • ${escapeHtml(src.version)}` : ""}</div>
        ${books ? `<div class="text-[10px] text-slate-500 font-mono" dir="ltr">${escapeHtml(books)}</div>` : ""}
        <div data-corpus-progress="${src.id}" class="${preparingCorpusJobs[src.id] ? "" : "hidden"} space-y-1">
          <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div data-bar class="h-full bg-sky-500 transition-all" style="width:0%"></div></div>
          <div data-msg class="text-[10px] text-sky-300"></div>
        </div>
        ${!src.builtin && src.status !== "ready" ? `
          <details class="text-[11px] text-slate-400">
            <summary class="cursor-pointer">إذا فشل التحميل التلقائي: تحميل الملف يدوياً ورفعه</summary>
            <div class="pt-1.5 space-y-1.5">
              <div><span>١. حمّل</span> <code class="text-amber-300">collections-json.zip</code> — <a href="${escapeHtml(src.page_url || "#")}" target="_blank" rel="noopener" class="text-sky-300 underline">صفحة الإصدارات</a></div>
              <div><span>٢. ارفعه هنا:</span> <input type="file" accept=".zip" data-upload-corpus="${src.id}" class="text-xs text-slate-300 file:ml-2 file:py-0.5 file:px-2 file:rounded-lg file:border-0 file:bg-slate-800 file:text-sky-300" /></div>
            </div>
          </details>` : ""}
      </div>`;
  }).join("");

  box.querySelectorAll("[data-use-corpus]").forEach(b => b.addEventListener("click", () => selectHadithCorpus(b.getAttribute("data-use-corpus"))));
  box.querySelectorAll("[data-prepare-corpus]").forEach(b => b.addEventListener("click", () => startPrepareHadithCorpus(b.getAttribute("data-prepare-corpus"))));
  box.querySelectorAll("[data-upload-corpus]").forEach(inp => inp.addEventListener("change", () => {
    if (inp.files?.[0]) startPrepareHadithCorpus(inp.getAttribute("data-upload-corpus"), inp.files[0]);
  }));
  // a job still running (e.g. the panel was re-rendered): keep showing its progress
  hadithCorpusSources.filter(s => s.preparing_job && !preparingCorpusJobs[s.id]).forEach(s => watchCorpusJob(s.id, s.preparing_job));
}

window.addEventListener("DOMContentLoaded", () => {
  activeHadithCorpus = getSavedHadithCorpusChoice();
  syncHadithCorpusSelects();
  document.getElementById("selHadithCorpusQuick")?.addEventListener("change", (e) => {
    selectHadithCorpus(e.target.value);
  });
});
