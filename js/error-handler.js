// =============================================================================
// Wahy-Finder v2.0 — Module 2: Global Error Interceptor & "Copy for AI" Modal
// File: js/error-handler.js
// =============================================================================

(function initWahyErrorHandler() {
  const MAX_ACTION_LOGS = 25;
  window.__wahyActionLog = window.__wahyActionLog || [];
  window.__lastDiagnosticError = null;

  function logAction(action, detail = "") {
    const entry = {
      time: new Date().toISOString(),
      action: String(action || "UNKNOWN_ACTION"),
      detail: typeof detail === "object" ? JSON.stringify(detail) : String(detail || "")
    };
    window.__wahyActionLog.push(entry);
    if (window.__wahyActionLog.length > MAX_ACTION_LOGS) {
      window.__wahyActionLog.shift();
    }
  }

  function escapeErrHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureDiagnosticModalDOM() {
    let modal = document.getElementById("diagnosticErrorModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "diagnosticErrorModal";
    modal.className = "fixed inset-0 z-[100] hidden items-center justify-center bg-slate-950/85 backdrop-blur-md p-4";
    modal.setAttribute("dir", "rtl");
    modal.innerHTML = `
      <div class="w-full max-w-3xl rounded-2xl border-2 border-rose-500/80 bg-slate-900 shadow-2xl shadow-rose-950/60 overflow-hidden flex flex-col max-h-[90vh]">
        <!-- High-contrast Red Header -->
        <div class="bg-gradient-to-l from-rose-950 via-red-900/90 to-slate-900 border-b border-rose-500/50 px-5 py-4 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/50 flex items-center justify-center text-rose-300 font-bold text-lg shrink-0">
              ⚠️
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-0.5 rounded-md bg-rose-500 text-white text-[11px] font-bold tracking-wide uppercase" id="diagErrTypeBadge">SystemError</span>
                <h3 class="text-base sm:text-lg font-bold text-rose-100" id="diagErrTitle">اعتراض خطأ تشخيصي (Diagnostic Error Trap)</h3>
              </div>
              <p class="text-xs text-rose-200/90 mt-0.5" id="diagErrSubtitle">تم إيقاف الفشل الصامت — يمكنك نسخ التقرير التشخيصي الكامل وإرساله للذكاء الاصطناعي.</p>
            </div>
          </div>
          <button type="button" id="btnCloseDiagnosticModal" class="px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-600 transition">
            إغلاق ✕
          </button>
        </div>

        <!-- Body -->
        <div class="p-5 overflow-y-auto space-y-4 text-sm">
          <!-- Human-readable error summary -->
          <div class="rounded-xl bg-rose-950/50 border border-rose-500/40 p-3.5">
            <div class="text-[11px] font-bold text-rose-300 mb-1">ملخص الخطأ (Error Summary):</div>
            <div id="diagErrMessage" class="text-rose-100 font-semibold leading-relaxed break-words font-mono text-xs sm:text-sm" dir="auto"></div>
          </div>

          <!-- Context Grid -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs" id="diagErrContextGrid">
            <div class="rounded-lg bg-slate-800/80 border border-slate-700 p-2.5">
              <div class="text-[10px] text-slate-400">نقطة النهاية (Endpoint)</div>
              <div class="font-mono font-bold text-sky-300 truncate mt-0.5" id="diagCtxEndpoint" dir="ltr">-</div>
            </div>
            <div class="rounded-lg bg-slate-800/80 border border-slate-700 p-2.5">
              <div class="text-[10px] text-slate-400">النموذج النشط (Model)</div>
              <div class="font-mono font-bold text-amber-300 truncate mt-0.5" id="diagCtxModel" dir="ltr">-</div>
            </div>
            <div class="rounded-lg bg-slate-800/80 border border-slate-700 p-2.5">
              <div class="text-[10px] text-slate-400">استهلاك VRAM (MB)</div>
              <div class="font-mono font-bold text-emerald-300 truncate mt-0.5" id="diagCtxVram" dir="ltr">-</div>
            </div>
            <div class="rounded-lg bg-slate-800/80 border border-slate-700 p-2.5">
              <div class="text-[10px] text-slate-400">المصدر المدخل (Source)</div>
              <div class="font-mono font-bold text-purple-300 truncate mt-0.5" id="diagCtxSource" dir="ltr">-</div>
            </div>
          </div>

          <!-- Collapsible Full Stack Trace -->
          <details class="group rounded-xl bg-slate-950 border border-slate-800 overflow-hidden" open>
            <summary class="cursor-pointer select-none px-4 py-2.5 bg-slate-900/90 hover:bg-slate-800/80 flex items-center justify-between text-xs font-bold text-slate-300">
              <span>📜 تفاصيل التتبع الكامل (Full Stack Trace / Traceback)</span>
              <span class="text-[11px] text-slate-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <pre class="p-4 text-[11px] leading-relaxed font-mono text-rose-200/95 overflow-x-auto max-h-60 whitespace-pre-wrap" dir="ltr"><code id="diagErrTraceback"></code></pre>
          </details>

          <!-- Collapsible AI Markdown Preview -->
          <details class="group rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
            <summary class="cursor-pointer select-none px-4 py-2.5 bg-slate-900/90 hover:bg-slate-800/80 flex items-center justify-between text-xs font-bold text-slate-300">
              <span>🤖 معاينة تقرير الذكاء الاصطناعي (Markdown Diagnostic Report Preview)</span>
              <span class="text-[11px] text-slate-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <pre class="p-4 text-[11px] leading-relaxed font-mono text-emerald-200/90 overflow-x-auto max-h-48 whitespace-pre-wrap" dir="ltr"><code id="diagErrMarkdownPreview"></code></pre>
          </details>
        </div>

        <!-- Footer Actions -->
        <div class="border-t border-slate-800 bg-slate-900/95 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <span class="text-xs text-slate-400" id="diagCopyFeedback">جاهز للنسخ الفوري بصيغة Markdown مهيأة للذكاء الاصطناعي.</span>
          <div class="flex items-center gap-2.5">
            <button type="button" id="btnCopyDiagnosticForAI" class="px-4 py-2 rounded-xl bg-gradient-to-l from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs shadow-lg shadow-rose-900/40 flex items-center gap-2 transition">
              <span>📋 نسخ التقرير التشخيصي للذكاء الاصطناعي (Copy Diagnostic Report for AI)</span>
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("#btnCloseDiagnosticModal").addEventListener("click", () => {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    });

    modal.querySelector("#btnCopyDiagnosticForAI").addEventListener("click", () => {
      copyDiagnosticReportForAI();
    });

    return modal;
  }

  function getActiveStateSnapshot() {
    const st = (typeof window.state === "object" && window.state) || (typeof currentState === "object" && currentState) || {};
    const modelSel = document.getElementById("selTranscriptionModel");
    const ytInput = document.getElementById("inpYoutubeUrl");

    return {
      activeModel: (modelSel && modelSel.value) || st.selectedModel || "groq-whisper-large-v3-turbo",
      inputType: st.inputType || "text",
      inputSource: (ytInput && ytInput.value) || st.mediaUrl || st.presetKey || "local/text",
      corpusLoaded: {
        ayat: (typeof RAW_QURAN_DATA !== "undefined" && Array.isArray(RAW_QURAN_DATA)) ? RAW_QURAN_DATA.length : (st.corpus?.ayat?.length || 0),
        hadiths: (typeof RAW_HADITH_DATA !== "undefined" && Array.isArray(RAW_HADITH_DATA)) ? RAW_HADITH_DATA.length : (st.corpus?.hadiths?.length || 0),
        adhkar: (typeof RAW_ADHKAR_DATA !== "undefined" && Array.isArray(RAW_ADHKAR_DATA)) ? RAW_ADHKAR_DATA.length : (st.corpus?.adhkar?.length || 0)
      },
      wordsCount: Array.isArray(st.words) ? st.words.length : 0,
      detectionsCount: Array.isArray(st.detections) ? st.detections.length : 0,
      captionsCount: Array.isArray(st.captions) ? st.captions.length : 0,
      browser: navigator.userAgent,
      platform: navigator.platform || "unknown",
      language: navigator.language || "ar",
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timestamp: new Date().toISOString()
    };
  }

  function buildDiagnosticMarkdownReport(errObj) {
    const snap = getActiveStateSnapshot();
    const last5Actions = (window.__wahyActionLog || []).slice(-5);
    const ctx = errObj.context || {};

    const actionsLines = last5Actions.length
      ? last5Actions.map((a, idx) => `${idx + 1}. \`[${a.time}]\` **${a.action}** — ${a.detail}`).join("\n")
      : "1. No prior actions logged.";

    return [
      `# Wahy-Finder v2.0 — AI Diagnostic Bug Report`,
      ``,
      `## 1. Error Overview`,
      `- **Error Type**: \`${errObj.error_type || "RuntimeError"}\``,
      `- **Summary Message**: ${errObj.message || "Unknown error occurred"}`,
      `- **Timestamp**: \`${snap.timestamp}\``,
      ``,
      `## 2. Execution & Hardware Context`,
      `- **Endpoint**: \`${ctx.endpoint || "frontend/runtime"}\``,
      `- **Model Selected**: \`${ctx.model_selected || snap.activeModel}\``,
      `- **VRAM Allocated (MB)**: \`${ctx.vram_allocated_mb !== undefined ? ctx.vram_allocated_mb : "N/A (Browser/Cloud)"}\``,
      `- **Input Source**: \`${ctx.input_source || snap.inputSource}\``,
      ``,
      `## 3. Application State Snapshot`,
      `\`\`\`json`,
      JSON.stringify(snap, null, 2),
      `\`\`\``,
      ``,
      `## 4. Last 5 User/System Actions`,
      actionsLines,
      ``,
      `## 5. Full Stack Trace / Traceback`,
      `\`\`\`text`,
      String(errObj.traceback || "No stack trace available.").trim(),
      `\`\`\``
    ].join("\n");
  }

  function showDiagnosticErrorModal(rawError) {
    const errObj = {
      error: true,
      error_type: rawError?.error_type || rawError?.name || "ApplicationError",
      message: rawError?.message || String(rawError || "Unknown error"),
      traceback: rawError?.traceback || rawError?.stack || String(rawError || ""),
      context: Object.assign({
        endpoint: "frontend/runtime",
        model_selected: getActiveStateSnapshot().activeModel,
        vram_allocated_mb: "N/A",
        input_source: getActiveStateSnapshot().inputSource
      }, rawError?.context || {})
    };

    window.__lastDiagnosticError = errObj;
    logAction("ERROR_INTERCEPTED", `${errObj.error_type}: ${errObj.message}`);

    const modal = ensureDiagnosticModalDOM();
    const typeEl = modal.querySelector("#diagErrTypeBadge");
    const msgEl = modal.querySelector("#diagErrMessage");
    const epEl = modal.querySelector("#diagCtxEndpoint");
    const modEl = modal.querySelector("#diagCtxModel");
    const vramEl = modal.querySelector("#diagCtxVram");
    const srcEl = modal.querySelector("#diagCtxSource");
    const tbEl = modal.querySelector("#diagErrTraceback");
    const mdEl = modal.querySelector("#diagErrMarkdownPreview");

    if (typeEl) typeEl.textContent = errObj.error_type;
    if (msgEl) msgEl.textContent = errObj.message;
    if (epEl) epEl.textContent = errObj.context.endpoint || "-";
    if (modEl) modEl.textContent = errObj.context.model_selected || "-";
    if (vramEl) vramEl.textContent = String(errObj.context.vram_allocated_mb ?? "-");
    if (srcEl) srcEl.textContent = errObj.context.input_source || "-";
    if (tbEl) tbEl.textContent = errObj.traceback;
    if (mdEl) mdEl.textContent = buildDiagnosticMarkdownReport(errObj);

    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  function copyTextWithFallback(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopyExec(text));
    }
    return Promise.resolve(fallbackCopyExec(text));
  }

  function fallbackCopyExec(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
  }

  function copyDiagnosticReportForAI() {
    const errObj = window.__lastDiagnosticError || {
      error_type: "DiagnosticSnapshot",
      message: "Manual diagnostic report requested by user.",
      traceback: new Error("DiagnosticStackSnapshot").stack,
      context: {}
    };
    const md = buildDiagnosticMarkdownReport(errObj);
    copyTextWithFallback(md).then(() => {
      const fb = document.getElementById("diagCopyFeedback");
      if (fb) {
        fb.textContent = "✅ تم نسخ التقرير التشخيصي بصيغة Markdown إلى الحافظة بنجاح!";
        fb.className = "text-xs font-bold text-emerald-400";
      }
      if (typeof showToast === "function") {
        showToast("📋 تم نسخ التقرير التشخيصي الكامل للذكاء الاصطناعي (Markdown)");
      }
    });
  }

  // Global window.onerror trap
  window.addEventListener("error", (event) => {
    // Ignore benign ResizeObserver loop notifications
    if (event?.message && String(event.message).includes("ResizeObserver loop")) return;
    const err = event.error || {};
    showDiagnosticErrorModal({
      error_type: err.name || "WindowRuntimeError",
      message: event.message || err.message || "Uncaught runtime exception",
      traceback: err.stack || `${event.filename || "script"}:${event.lineno || 0}:${event.colno || 0}`,
      context: {
        endpoint: `${event.filename ? event.filename.split("/").pop() : "window.onerror"}:${event.lineno || 0}`
      }
    });
  });

  // Global window.onunhandledrejection trap
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason || {};
    showDiagnosticErrorModal({
      error_type: reason.error_type || reason.name || "UnhandledPromiseRejection",
      message: reason.message || String(reason || "Unhandled Promise Rejection"),
      traceback: reason.traceback || reason.stack || String(reason || ""),
      context: reason.context || {
        endpoint: "Promise.reject"
      }
    });
  });

  // Intercept non-200 fetch() responses on backend API calls (or explicit trapError requests)
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = async function interceptedFetch(input, init = {}) {
      const urlStr = typeof input === "string" ? input : (input?.url || "");
      const isBackendApi = urlStr.includes("/api/");
      const shouldTrap = init.trapError === true || (isBackendApi && init.trapError !== false);

      logAction("FETCH_REQUEST", `${init.method || "GET"} ${urlStr.slice(0, 100)}`);
      try {
        const response = await originalFetch(input, init);
        if (!response.ok && shouldTrap) {
          let errPayload = null;
          try {
            const cloned = response.clone();
            errPayload = await cloned.json();
          } catch (_) {
            try {
              const text = await response.clone().text();
              errPayload = { message: text || `HTTP ${response.status} ${response.statusText}` };
            } catch (__) {}
          }
          showDiagnosticErrorModal({
            error_type: errPayload?.error_type || `HTTPError_${response.status}`,
            message: errPayload?.message || `فشل الطلب (${response.status} ${response.statusText}) على المسار ${urlStr}`,
            traceback: errPayload?.traceback || `HTTP ${response.status} ${response.statusText}\nURL: ${urlStr}`,
            context: errPayload?.context || {
              endpoint: urlStr,
              model_selected: getActiveStateSnapshot().activeModel,
              vram_allocated_mb: "N/A",
              input_source: getActiveStateSnapshot().inputSource
            }
          });
        }
        return response;
      } catch (networkErr) {
        if (shouldTrap) {
          showDiagnosticErrorModal({
            error_type: "NetworkFetchError",
            message: `تعذر الاتصال بالخادم (${urlStr}): ${networkErr.message || networkErr}`,
            traceback: networkErr.stack || String(networkErr),
            context: {
              endpoint: urlStr,
              model_selected: getActiveStateSnapshot().activeModel,
              vram_allocated_mb: "N/A",
              input_source: getActiveStateSnapshot().inputSource
            }
          });
        }
        throw networkErr;
      }
    };
  }

  window.WahyErrorHandler = {
    logAction,
    showDiagnosticErrorModal,
    buildDiagnosticMarkdownReport,
    copyDiagnosticReportForAI,
    escapeErrHtml
  };
  window.showDiagnosticErrorModal = showDiagnosticErrorModal;
  window.logWahyAction = logAction;
})();
