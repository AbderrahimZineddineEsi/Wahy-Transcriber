// =============================================================================
// Wahy Studio (Wahy-Transcriber v2.1) — Event Listeners, FN Studio Bindings,
// Dataset/Adhkar CRUD Handlers, Modals & Media Playback Sync
// File: js/events.js
// =============================================================================

const LS_GROQ_KEY = "wahyFinder_groqApiKey_v2";
const LS_MODEL_KEY = "wahyFinder_selectedModel_v2";
const LS_THEME_KEY = "wahyTranscriber_theme_v21";

function switchInputSourceTab(tabName) {
  currentState.inputType = tabName;
  const tabs = ["text", "youtube", "media"];
  tabs.forEach(t => {
    const btn = document.getElementById(`btnInputTab_${t}`);
    const panel = document.getElementById(`panelInput_${t}`);
    if (btn) {
      if (t === tabName) {
        btn.className = "seg-btn is-active";
      } else {
        btn.className = "seg-btn";
      }
    }
    if (panel) {
      if (t === tabName) panel.classList.remove("hidden");
      else panel.classList.add("hidden");
    }
  });
}

// Overall bar = weighted stages; each stage reports 0-100 (or null when its length is unknown)
const TRANSCRIBE_STAGE_WEIGHTS = [["download", 35], ["audio", 10], ["transcribe", 45], ["engine", 10]];
let _transcribeProgressTimer = null;

function setTranscriptionProgress(stage, stagePct, message) {
  const order = TRANSCRIBE_STAGE_WEIGHTS.map(x => x[0]);
  const idx = order.indexOf(stage);
  if (idx < 0) return;
  let overall = 0;
  TRANSCRIBE_STAGE_WEIGHTS.forEach(([name, w], k) => {
    if (k < idx) overall += w;
    else if (k === idx) overall += w * ((stagePct == null ? 0 : stagePct) / 100);
  });
  const pct = Math.round(overall);
  const bar = document.getElementById("transcriptionProgressBar");
  const pctEl = document.getElementById("transcriptionPercent");
  const txt = document.getElementById("transcriptionStatusText");
  if (bar) { bar.style.width = `${pct}%`; bar.classList.toggle("animate-pulse", stagePct == null); }
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (txt && message) txt.textContent = message;
  document.querySelectorAll("#transcriptionStages [data-stage]").forEach(el => {
    const k = order.indexOf(el.getAttribute("data-stage"));
    el.className = k < idx ? "text-emerald-400 font-bold" : (k === idx ? "text-sky-200 font-bold" : "");
  });
}

function startTranscriptionProgressPolling(jobId) {
  stopTranscriptionProgressPolling();
  _transcribeProgressTimer = setInterval(async () => {
    try {
      const r = await fetch(`/api/transcribe/progress/${jobId}`, { trapError: false });
      if (!r.ok) return;
      const d = await r.json();
      if (d.stage && d.stage !== "unknown" && d.stage !== "done" && d.stage !== "error") {
        setTranscriptionProgress(d.stage, d.percent, d.message);
      }
    } catch (e) { /* polling is best effort */ }
  }, 600);
}

function stopTranscriptionProgressPolling() {
  if (_transcribeProgressTimer) { clearInterval(_transcribeProgressTimer); _transcribeProgressTimer = null; }
}

function setTranscriptionBusyUI(isBusy, statusMessage = "") {
  const banner = document.getElementById("transcriptionStatusBanner");
  const txt = document.getElementById("transcriptionStatusText");
  const btnYt = document.getElementById("btnTranscribeYoutube");
  const btnMedia = document.getElementById("btnTranscribeMediaFile");

  if (banner) {
    if (isBusy) banner.classList.remove("hidden");
    else banner.classList.add("hidden");
  }
  if (isBusy) setTranscriptionProgress("download", 0);
  else stopTranscriptionProgressPolling();
  if (txt && statusMessage) txt.textContent = statusMessage;
  if (btnYt) btnYt.disabled = isBusy;
  if (btnMedia) btnMedia.disabled = isBusy;
}


// -----------------------------------------------------------------------------
// Saved lectures: apply a session loaded into currentState, and the manager list
// -----------------------------------------------------------------------------
function applyRestoredSessionToUi() {
  const ta = document.getElementById("textareaFastPathInput");
  if (ta) ta.value = currentState.rawTranscript || "";
  const titleInp = document.getElementById("inpLectureTitle");
  if (titleInp) titleInp.value = currentState.lectureTitle || "";
  attachMediaUrlToPlayer(currentState.mediaUrl, currentState.lectureTitle);
  if (!currentState.captions.length) {
    currentState.captions = buildSmartCaptions(currentState.words, currentState.detections, currentState.outputPrefs);
  }
  renderAllViews();
  switchMainSection("display");
}

async function renderSavedLecturesList() {
  const box = document.getElementById("savedLecturesList");
  if (!box) return;
  const list = (await listSavedLectureSessions()).filter(x => Array.isArray(x.words) && x.words.length);
  if (!list.length) {
    box.innerHTML = `<div class="text-xs text-slate-500 py-3 text-center">لا توجد محاضرات محفوظة بعد — ستُضاف هنا تلقائياً بعد كل تفريغ.</div>`;
    return;
  }
  const fmt = iso => { try { return new Date(iso).toLocaleString((typeof WahyI18n === "object" ? WahyI18n.dateLocale() : "ar-u-nu-latn"), { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return ""; } };
  box.innerHTML = list.map(x => {
    const isCurrent = x.id === currentState.currentLectureId;
    const st = x.stats || {};
    return `
      <div class="flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2.5 ${isCurrent ? "bg-emerald-950/40 border-emerald-500/50" : "bg-slate-950 border-slate-800"}" data-lecture-id="${escapeHtml(x.id)}">
        <div class="flex-1 min-w-[200px]">
          <div class="text-sm font-bold text-slate-100 truncate">${isCurrent ? "● " : ""}${escapeHtml(x.title || "بدون عنوان")}</div>
          <div class="text-[11px] text-slate-400">${escapeHtml(fmt(x.updated_at))} • ${st.wordsCount || 0} كلمة • ${st.detectionsCount || 0} مقتبس${x.mediaUrl ? " • 🎬 فيديو" : ""}</div>
        </div>
        <button type="button" data-lec-act="open" class="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition">فتح</button>
        <button type="button" data-lec-act="rename" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold transition">إعادة تسمية</button>
        <button type="button" data-lec-act="delete" class="px-3 py-1.5 rounded-xl bg-rose-600/15 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-[11px] font-bold transition">حذف</button>
      </div>`;
  }).join("");
}

function initSavedLecturesManager() {
  document.getElementById("savedLecturesList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-lec-act]");
    const row = e.target.closest("[data-lecture-id]");
    if (!btn || !row) return;
    const id = row.getAttribute("data-lecture-id");
    const act = btn.getAttribute("data-lec-act");
    if (act === "open") {
      await flushSessionAutosave();                      // never lose pending edits of the lecture we are leaving
      if (await loadLectureSession(id)) {
        applyRestoredSessionToUi();
        renderSavedLecturesList();
        showToast(`📂 تم فتح «${currentState.lectureTitle}»`);
      }
    } else if (act === "rename") {
      const cur = row.querySelector(".font-bold")?.textContent.replace(/^● /, "") || "";
      const name = (prompt("العنوان الجديد للمحاضرة:", cur) || "").trim();
      if (!name) return;
      await renameSavedLectureSession(id, name);
      if (id === currentState.currentLectureId) {
        currentState.lectureTitle = name;
        const titleInp = document.getElementById("inpLectureTitle");
        if (titleInp) titleInp.value = name;
      }
      renderSavedLecturesList();
    } else if (act === "delete") {
      if (!confirm("حذف هذه المحاضرة المحفوظة؟ لا يمكن التراجع.")) return;
      await deleteSavedLectureSession(id);
      if (id === currentState.currentLectureId) { currentState.currentLectureId = null; currentState.lectureCreatedAt = null; }
      renderSavedLecturesList();
    }
  });
  document.getElementById("btnClearAllLectures")?.addEventListener("click", async () => {
    if (!confirm("حذف جميع المحاضرات المحفوظة؟ لا يمكن التراجع.")) return;
    for (const x of await listSavedLectureSessions()) await deleteSavedLectureSession(x.id);
    currentState.currentLectureId = null; currentState.lectureCreatedAt = null;
    renderSavedLecturesList();
  });
  // keep the saved title in sync when the user edits the title field
  document.getElementById("inpLectureTitle")?.addEventListener("change", (e) => {
    currentState.lectureTitle = e.target.value.trim() || currentState.lectureTitle;
    scheduleSessionAutosave();
  });
}

function attachMediaUrlToPlayer(mediaUrl, title = "") {
  currentState.mediaUrl = mediaUrl || "";
  if (title) {
    currentState.lectureTitle = title;
    const titleInp = document.getElementById("inpLectureTitle");
    if (titleInp) titleInp.value = title;
  }

  const videoEl = document.getElementById("wahyVideoPlayer");
  const placeholder = document.getElementById("videoPlaceholderBanner");
  if (!videoEl) return;

  if (mediaUrl) {
    videoEl.src = mediaUrl;
    videoEl.classList.remove("hidden");
    if (placeholder) placeholder.classList.add("hidden");
  } else {
    videoEl.removeAttribute("src");
    videoEl.classList.add("hidden");
    if (placeholder) placeholder.classList.remove("hidden");
  }
}

async function handleBackendTranscribeRequest({ youtubeUrl = "", mediaFile = null }) {
  const modelSel = document.getElementById("selTranscriptionModel")?.value || "groq-whisper-large-v3-turbo";
  const groqKey = document.getElementById("inpGroqApiKey")?.value?.trim() || "";
  const autoFallback = document.getElementById("chkAutoFallback")?.checked !== false;

  currentState.selectedModel = modelSel;
  currentState.groqApiKey = groqKey;
  currentState.autoFallback = autoFallback;

  try {
    localStorage.setItem(LS_GROQ_KEY, groqKey);
    localStorage.setItem(LS_MODEL_KEY, modelSel);
  } catch (e) {}

  const jobId = "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("model_selected", modelSel);
  formData.append("groq_api_key", groqKey);
  formData.append("auto_fallback", String(autoFallback));
  if (youtubeUrl) formData.append("youtube_url", youtubeUrl);
  if (mediaFile) formData.append("file", mediaFile);

  setTranscriptionBusyUI(
    true,
    youtubeUrl
      ? "جاري تحميل الفيديو واستخراج الصوت وتفريغه مع التوقيت اللحظي للكلمات..."
      : "جاري معالجة الملف الصوتي/المرئي وتفريغه مع التوقيت اللحظي للكلمات..."
  );

  startTranscriptionProgressPolling(jobId);
  try {
    const resp = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
      trapError: true
    });

    if (!resp.ok) {
      setTranscriptionBusyUI(false);
      return;
    }

    const data = await resp.json();
    stopTranscriptionProgressPolling();
    setTranscriptionProgress("engine", 0, "جاري تشغيل محرك الكشف عن الآيات والأحاديث...");
    await new Promise(r => setTimeout(r, 30));   // let the bar paint before the synchronous engine run

    if (data.media_url) {
      attachMediaUrlToPlayer(data.media_url, data.title || "محاضرة مفرّغة");
    }

    const fastPathBox = document.getElementById("textareaFastPathInput");
    if (fastPathBox) fastPathBox.value = data.full_text || "";

    runDetectionAndBuildCaptions({
      rawText: data.full_text || "",
      words: Array.isArray(data.words) ? data.words : []
    });

    setTranscriptionProgress("engine", 100, "اكتمل");
    setTranscriptionBusyUI(false);
    renderSavedLecturesList();
    switchMainSection("display");
    showToast(`✅ اكتمل التفريغ (${data.model_used || modelSel}): ${currentState.words.length} كلمة و ${currentState.detections.length} مقتبس`);
  } catch (err) {
    setTranscriptionBusyUI(false);
  }
}

function handleTextFastPathExecution(rawContent, fileName = "", navigateToDisplay = true) {
  const content = String(rawContent || "").trim();
  if (!content) {
    showToast("⚠️ يرجى لصق نص المحاضرة أو رفع ملف (.txt / .srt / .vtt) أولاً.");
    return;
  }

  const customTitle = document.getElementById("inpLectureTitle")?.value?.trim();
  if (fileName) {
    currentState.lectureTitle = fileName.replace(/\.[^.]+$/, "");
    const titleInp = document.getElementById("inpLectureTitle");
    if (titleInp) titleInp.value = currentState.lectureTitle;
  } else if (customTitle) {
    currentState.lectureTitle = customTitle;
  }

  const ext = fileName.toLowerCase().split(".").pop();
  const looksLikeSubtitles = ext === "srt" || ext === "vtt" || /(\d{2}):(\d{2})[.,](\d{3})\s*-->/.test(content);

  pushUndoSnapshot("تحليل النص واكتشاف المقتبسات");

  if (looksLikeSubtitles) {
    const parsed = parseSubtitleFileToWords(content);
    runDetectionAndBuildCaptions({
      rawText: parsed.full_text,
      words: parsed.words
    });
  } else {
    const words = synthesizeWordsFromRawText(content);
    runDetectionAndBuildCaptions({
      rawText: content,
      words
    });
  }

  if (navigateToDisplay) {
    switchMainSection("display");
    showToast(`✨ تم اكتشاف ${currentState.detections.length} مقتبس وبناء ${currentState.captions.length} مقطع كابشن متزامن!`);
  }
}

async function checkBackendHealthStatus() {
  try {
    const resp = await fetch("/api/health", { trapError: false });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const info = await resp.json();
    const badge = document.getElementById("backendStatusBadge");
    const dot = document.getElementById("backendStatusDot");
    if (badge) {
      badge.textContent = `الخادم متصل (${info.gpu_device || "CPU"})`;
    }
    if (dot) {
      dot.className = "w-2 h-2 rounded-full bg-emerald-400";
    }
  } catch (_) {
    const badge = document.getElementById("backendStatusBadge");
    const dot = document.getElementById("backendStatusDot");
    if (badge) {
      badge.textContent = "وضع المتصفح الذكي";
    }
    if (dot) {
      dot.className = "w-2 h-2 rounded-full bg-sky-400";
    }
  }
}

function applyThemeMode(theme) {
  const htmlEl = document.documentElement;
  const lbl = document.getElementById("lblThemeToggle");
  if (theme === "light") {
    htmlEl.classList.remove("dark");
    htmlEl.classList.add("light");
    if (lbl) lbl.textContent = "☾";
  } else {
    htmlEl.classList.remove("light");
    htmlEl.classList.add("dark");
    if (lbl) lbl.textContent = "☀";
  }
  try {
    localStorage.setItem(LS_THEME_KEY, theme);
  } catch (e) {}
}

function openModalById(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.classList.remove("hidden");
  m.classList.add("flex");
}

function closeModalById(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.classList.add("hidden");
  m.classList.remove("flex");
}

window.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    try { window.lucide.createIcons(); } catch (_) {}
  }

  initSavedLecturesManager();

  // Restore Theme
  try {
    const savedTheme = localStorage.getItem(LS_THEME_KEY) || "dark";
    applyThemeMode(savedTheme);
  } catch (_) {}

  document.getElementById("btnToggleTheme")?.addEventListener("click", () => {
    const isLight = document.documentElement.classList.contains("light");
    applyThemeMode(isLight ? "dark" : "light");
  });

  // Restore saved API key and model selection
  try {
    const savedKey = localStorage.getItem(LS_GROQ_KEY) || "";
    const savedModel = localStorage.getItem(LS_MODEL_KEY) || "groq-whisper-large-v3-turbo";
    const keyInp = document.getElementById("inpGroqApiKey");
    const modSel = document.getElementById("selTranscriptionModel");
    if (keyInp) keyInp.value = savedKey;
    if (modSel) modSel.value = savedModel;
    currentState.groqApiKey = savedKey;
    currentState.selectedModel = savedModel;
  } catch (_) {}

  // Top Navigation Section Switchers
  ["input", "display", "editor", "datasets", "ai_logs", "training_data"].forEach(sec => {
    document.getElementById(`navBtn_${sec}`)?.addEventListener("click", () => {
      switchMainSection(sec);
    });
  });

  // Quick Jump Buttons across Sections
  document.getElementById("btnQuickGoToEditor")?.addEventListener("click", () => {
    switchMainSection("editor");
  });
  document.getElementById("btnQuickGoToInput")?.addEventListener("click", () => {
    switchMainSection("input");
  });
  document.getElementById("btnQuickGoToDisplayFromEditor")?.addEventListener("click", () => {
    // land on the quote being edited, if any
    const sel = currentState.selectedPredIndex;
    if (sel >= 0 && sel < currentState.detections.length && typeof openFindingInDisplay === "function") openFindingInDisplay(sel);
    else switchMainSection("display");
  });

  // Editor Sub-Mode Switchers (FN Studio & Inspector vs Full Text Editor vs Captions Timeline)
  ["fn_studio", "text_edit", "captions_edit"].forEach(m => {
    document.getElementById(`btnEditorSubMode_${m}`)?.addEventListener("click", () => {
      switchEditorSubMode(m);
    });
  });

  // Editor Dock Tabs (FN Studio vs Finding Inspector)
  document.getElementById("btnDockTabFnStudio")?.addEventListener("click", () => {
    switchEditorDockTab("fn");
  });
  document.getElementById("btnDockTabInspector")?.addEventListener("click", () => {
    switchEditorDockTab("inspector");
  });

  // Bind FN Studio Interactive 2-Click Word Range Selector & Hover Preview on #editorLectureStage
  const editorLectureStage = document.getElementById("editorLectureStage");
  if (editorLectureStage) {
    editorLectureStage.addEventListener("click", handleFnWordClick);
    editorLectureStage.addEventListener("mouseover", handleFnWordHover);
  }

  // FN Studio Inputs & Buttons
  ["inpFnStartIdx", "inpFnEndIdx", "selFnSourceType", "inpFnCorpusSearch"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      currentState.fnClickStep = 0;
      updateFnStudioSuggestions();
      updateFnRangeVisualHighlight();
    });
    el.addEventListener("change", () => {
      currentState.fnClickStep = 0;
      updateFnStudioSuggestions();
      updateFnRangeVisualHighlight();
    });
  });

  document.getElementById("selFnMatchedUnit")?.addEventListener("change", renderFnSelectedUnitPreview);
  document.getElementById("inpFnCustomOutsideRef")?.addEventListener("input", renderFnSelectedUnitPreview);

  document.getElementById("btnResetFnRangeSelection")?.addEventListener("click", () => {
    currentState.fnClickStep = 0;
    const sInp = document.getElementById("inpFnStartIdx");
    const eInp = document.getElementById("inpFnEndIdx");
    if (sInp) sInp.value = "0";
    if (eInp) eInp.value = "1";
    updateFnStudioSuggestions();
    updateFnRangeVisualHighlight();
    showToast("↺ تمت إعادة ضبط التحديد — انقر على أول كلمة ثم آخر كلمة من المقتبس المفقود");
  });

  document.getElementById("btnCommitNewFnQuote")?.addEventListener("click", () => commitFnQuoteHelper(false));
  document.getElementById("btnCommitOutsideCorpusFn")?.addEventListener("click", () => commitFnQuoteHelper(true));
  document.getElementById("btnCommitDhikrToAdhkarDb")?.addEventListener("click", () => commitFnDhikrToAdhkarDatabase());

  // Prev / Next Finding Navigation in Inspector
  document.getElementById("btnPrevFindingInsp")?.addEventListener("click", () => {
    if (!currentState.detections.length) return;
    const nextIdx = currentState.selectedPredIndex > 0
      ? currentState.selectedPredIndex - 1
      : currentState.detections.length - 1;
    selectFindingForEdit(nextIdx, false);
  });
  document.getElementById("btnNextFindingInsp")?.addEventListener("click", () => {
    if (!currentState.detections.length) return;
    const nextIdx = (currentState.selectedPredIndex + 1) % currentState.detections.length;
    selectFindingForEdit(nextIdx, false);
  });

  // Editor Sticky Mini Player Controls (listen without scrolling the text!)
  document.getElementById("btnEditorMiniPlayPause")?.addEventListener("click", () => {
    toggleSimulatedPlayback();
  });
  document.getElementById("btnEditorMiniBack2s")?.addEventListener("click", () => {
    seekToMediaTimestamp(Math.max(0, currentState.currentTime - 2.0), false);
  });
  document.getElementById("btnEditorMiniForward2s")?.addEventListener("click", () => {
    seekToMediaTimestamp(currentState.currentTime + 2.0, false);
  });

  // Input Tab Switchers
  ["text", "youtube", "media"].forEach(tab => {
    document.getElementById(`btnInputTab_${tab}`)?.addEventListener("click", () => {
      switchInputSourceTab(tab);
    });
  });

  // Display Workspace Layout Switchers
  ["SPLIT", "LECTURE_ONLY", "CAPTIONS_ONLY"].forEach(mode => {
    document.getElementById(`btnLayout_${mode}`)?.addEventListener("click", () => {
      setWorkspaceLayoutMode(mode);
    });
  });

  // Auto-follow Lecture Word toggle in Display section
  const chkFollowWord = document.getElementById("chkAutoFollowWord");
  if (chkFollowWord) {
    chkFollowWord.checked = Boolean(currentState.autoFollowLectureWord);
    chkFollowWord.addEventListener("change", (e) => {
      currentState.autoFollowLectureWord = e.target.checked;
      showToast(e.target.checked ? "✓ تم تفعيل متابعة الكلمة الجارية تلقائياً في شاشة العرض" : "✕ تم إيقاف التمرير التلقائي للكلمة");
    });
  }

  // Export & Formatting Modal
  const openFormattingModal = () => {
    const prefs = getOutputDisplayPrefs();
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    setVal("inpPrefQuranOpen", prefs.quranBracketOpen ?? "﴿");
    setVal("inpPrefQuranClose", prefs.quranBracketClose ?? "﴾");
    setVal("inpPrefHadithOpen", prefs.hadithBracketOpen ?? "«");
    setVal("inpPrefHadithClose", prefs.hadithBracketClose ?? "»");
    setVal("inpPrefAdhkarOpen", prefs.adhkarBracketOpen ?? "〖");
    setVal("inpPrefAdhkarClose", prefs.adhkarBracketClose ?? "〗");
    setChk("chkPrefShowQuranRef", prefs.showQuranSource !== false);
    setChk("chkPrefShowHadithRef", prefs.showHadithSource !== false);
    setChk("chkPrefShowAdhkarRef", prefs.showAdhkarTag !== false);
    setChk("chkPrefGroupAyat", prefs.groupContiguousAyat !== false);
    openModalById("exportModal");
  };
  document.getElementById("btnOpenExportModal")?.addEventListener("click", openFormattingModal);
  document.getElementById("btnToggleDisplayFormattingPanel")?.addEventListener("click", openFormattingModal);
  document.getElementById("btnCloseExportModal")?.addEventListener("click", () => closeModalById("exportModal"));
  document.getElementById("exportModal")?.addEventListener("click", (e) => {
    if (e.target.id === "exportModal") closeModalById("exportModal");
  });

  document.getElementById("btnSaveFormattingPrefs")?.addEventListener("click", () => {
    saveOutputDisplayPrefs({
      quranBracketOpen: document.getElementById("inpPrefQuranOpen")?.value ?? "﴿",
      quranBracketClose: document.getElementById("inpPrefQuranClose")?.value ?? "﴾",
      hadithBracketOpen: document.getElementById("inpPrefHadithOpen")?.value ?? "«",
      hadithBracketClose: document.getElementById("inpPrefHadithClose")?.value ?? "»",
      adhkarBracketOpen: document.getElementById("inpPrefAdhkarOpen")?.value ?? "〖",
      adhkarBracketClose: document.getElementById("inpPrefAdhkarClose")?.value ?? "〗",
      showQuranSource: document.getElementById("chkPrefShowQuranRef")?.checked !== false,
      showHadithSource: document.getElementById("chkPrefShowHadithRef")?.checked !== false,
      showAdhkarTag: document.getElementById("chkPrefShowAdhkarRef")?.checked !== false,
      groupContiguousAyat: document.getElementById("chkPrefGroupAyat")?.checked !== false
    });
    recalculateCaptionsFromCurrentFindings();
    showToast("✅ تم حفظ تفضيلات الأقواس والعزو وتحديث العرض والكابشن");
  });

  // Settings Modal (Engine Sensitivity, Corpus URLs, Diagnostics)
  document.getElementById("btnOpenSettingsModal")?.addEventListener("click", () => {
    const cfg = getCorpusEndpointsConfig();
    const customInp = document.getElementById("inpCustomCorpusUrl");
    const quranInp = document.getElementById("inpQuranUthmaniUrl");
    if (customInp) customInp.value = cfg.customCorpusJsonUrl || "";
    if (quranInp) quranInp.value = cfg.quranUthmaniUrl || "";
    openModalById("settingsModal");
    if (typeof renderHadithCorpusSettings === "function") renderHadithCorpusSettings();
  });
  document.getElementById("btnCloseSettingsModal")?.addEventListener("click", () => closeModalById("settingsModal"));
  document.getElementById("settingsModal")?.addEventListener("click", (e) => {
    if (e.target.id === "settingsModal") closeModalById("settingsModal");
  });

  // Advanced Engine Parameters Change Listeners
  [
    "selDefaultQiraah", "rngMinIslandIdf", "rngMaxTranscriptGap", "rngMaxVerseGap",
    "rngVerifiedThreshold", "rngCandidateThreshold", "rngUncuedHadithThreshold",
    "rngMinHadithContentWords", "rngUncuedQuranCoverage"
  ].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      rebuildMatcher();
      if (currentState.rawTranscript) runDetectionAndBuildCaptions();
      showToast("⚙️ تم تحديث إعدادات حساسية المحرك وإعادة فحص المحاضرة");
    });
  });

  document.getElementById("btnForceUpdateCorpus")?.addEventListener("click", () => {
    closeModalById("settingsModal");
    clearAndRedownloadCorpus();
  });

  document.getElementById("btnSaveCorpusSettings")?.addEventListener("click", async () => {
    const customUrl = document.getElementById("inpCustomCorpusUrl")?.value?.trim() || "";
    const quranUrl = document.getElementById("inpQuranUthmaniUrl")?.value?.trim() || DEFAULT_CORPUS_ENDPOINTS.quranUthmaniUrl;
    saveCorpusEndpointsConfig({
      customCorpusJsonUrl: customUrl,
      quranUthmaniUrl: quranUrl
    });
    closeModalById("settingsModal");
    await clearAndRedownloadCorpus();
  });

  document.getElementById("inpUploadLocalCorpusJson")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt);
      const norm = {
        version: "2.1",
        loadedAt: new Date().toISOString(),
        sourceSummary: `Local File (${file.name})`,
        ayat: Array.isArray(parsed.ayat) ? parsed.ayat : (Array.isArray(parsed.quran) ? parsed.quran : RAW_QURAN_DATA),
        hadiths: Array.isArray(parsed.hadiths) ? parsed.hadiths : RAW_HADITH_DATA,
        adhkar: Array.isArray(parsed.adhkar) ? parsed.adhkar : RAW_ADHKAR_DATA
      };
      await WahyCorpusLoader.writeCorpusToWahyDB(norm);
      WahyCorpusLoader.applyNormalizedCorpusToState(norm);
      if (currentState.rawTranscript) runDetectionAndBuildCaptions();
      closeModalById("settingsModal");
      showToast(`✅ تم استيراد وحفظ قاعدة البيانات المحلية (${file.name})`);
    } catch (err) {
      showDiagnosticErrorModal({
        error_type: "LocalCorpusJSONParseError",
        message: `تعذر قراءة ملف JSON المحلي (${file.name}): ${err.message}`,
        traceback: err.stack || String(err)
      });
    }
  });

  document.getElementById("btnTriggerDiagnosticReport")?.addEventListener("click", () => {
    closeModalById("settingsModal");
    showDiagnosticErrorModal({
      error_type: "DiagnosticInspectionReport",
      message: "فحص تشخيصي لحالة التطبيق والعتاد وسجل العمليات.",
      traceback: [
        "Wahy Studio v2.1 Diagnostic Snapshot",
        `Active Model: ${currentState.selectedModel}`,
        `Loaded Corpus: Ayat=${RAW_QURAN_DATA.length}, Hadiths=${RAW_HADITH_DATA.length}, Adhkar=${RAW_ADHKAR_DATA.length}`,
        `Active Transcript Words: ${currentState.words.length}, Findings: ${currentState.detections.length}, Captions: ${currentState.captions.length}`
      ].join("\n"),
      context: {
        endpoint: "/diagnostic/manual-inspect",
        model_selected: currentState.selectedModel,
        vram_allocated_mb: "0 (Idle)",
        input_source: currentState.mediaUrl || currentState.inputType
      }
    });
  });

  document.getElementById("btnUndoAction")?.addEventListener("click", () => {
    popUndoSnapshot();
  });

  // ---------------------------------------------------------------------------
  // Input Pipelines
  // ---------------------------------------------------------------------------
  document.getElementById("btnTranscribeYoutube")?.addEventListener("click", () => {
    const url = document.getElementById("inpYoutubeUrl")?.value?.trim() || "";
    if (!url) {
      showToast("⚠️ يرجى إدخال رابط فيديو يوتيوب أولاً.");
      return;
    }
    handleBackendTranscribeRequest({ youtubeUrl: url });
  });

  document.getElementById("btnTranscribeMediaFile")?.addEventListener("click", () => {
    const fileInp = document.getElementById("inpMediaFileUpload");
    const file = fileInp?.files?.[0];
    if (!file) {
      showToast("⚠️ يرجى اختيار ملف فيديو أو صوت أولاً.");
      return;
    }
    const localObjUrl = URL.createObjectURL(file);
    attachMediaUrlToPlayer(localObjUrl, file.name);
    handleBackendTranscribeRequest({ mediaFile: file });
  });

  document.getElementById("inpLocalPreviewMediaFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    attachMediaUrlToPlayer(localUrl, file.name);
    showToast(`🎬 تم ربط ملف الوسائط (${file.name}) بالمشغل المتزامن`);
  });

  document.getElementById("inpTextFileUpload")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const ta = document.getElementById("textareaFastPathInput");
    if (ta) ta.value = text;
    handleTextFastPathExecution(text, file.name, true);
  });

  document.getElementById("btnRunTextFastPath")?.addEventListener("click", () => {
    const ta = document.getElementById("textareaFastPathInput");
    handleTextFastPathExecution(ta ? ta.value : "", "", true);
  });

  document.getElementById("btnLoadDynamicDemoLecture")?.addEventListener("click", () => {
    const sampleText = buildDynamicSampleLectureFromCorpus();
    const ta = document.getElementById("textareaFastPathInput");
    if (ta) ta.value = sampleText;
    switchInputSourceTab("text");
    handleTextFastPathExecution(sampleText, "محاضرة تجريبية — آيات وأحاديث وأذكار", true);
  });

  // Edit selected words (selection toolbar -> dialog)
  document.getElementById("btnFloatingEditSpan")?.addEventListener("click", () => {
    const sp = currentState.pendingSelectionSpan;
    if (sp) openSpanEditModal(sp.wordStartIdx, sp.wordEndIdx);
  });
  document.getElementById("btnSpanEditApply")?.addEventListener("click", applySpanEditModal);
  document.getElementById("btnSpanEditCancel")?.addEventListener("click", closeSpanEditModal);
  document.getElementById("btnSpanEditDelete")?.addEventListener("click", () => {
    const n = (document.getElementById("spanEditOriginal")?.textContent || "").split(/\s+/).filter(Boolean).length;
    if (!confirm(`حذف ${n} كلمة من نص المحاضرة؟ (يمكن التراجع)`)) return;
    document.getElementById("spanEditText").value = "";
    applySpanEditModal();
  });
  document.getElementById("btnSpanEditPlay")?.addEventListener("click", playSelectedSpanAudio);
  document.getElementById("spanEditModal")?.addEventListener("click", (e) => {
    if (e.target.id === "spanEditModal") closeSpanEditModal();
  });
  document.getElementById("spanEditText")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) applySpanEditModal();
    if (e.key === "Escape") closeSpanEditModal();
  });

  // Full Lecture Text Editor Actions
  document.getElementById("btnApplyLectureEdit")?.addEventListener("click", () => {
    const textVal = document.getElementById("inpLectureFullEditor")?.value || "";
    applyLectureTextEdits(textVal);
  });
  document.getElementById("btnCancelLectureEdit")?.addEventListener("click", () => {
    switchEditorSubMode("fn_studio");
  });
  document.getElementById("inpLectureFullEditor")?.addEventListener("input", (e) => {
    const countBadge = document.getElementById("lectureEditorWordCount");
    if (countBadge) {
      const wordsCount = e.target.value.split(/\s+/).filter(Boolean).length;
      countBadge.textContent = `${wordsCount} كلمة`;
    }
  });

  // Lecture View Filters & Snap All
  document.getElementById("selLectureCategoryFilter")?.addEventListener("change", (e) => {
    currentState.lectureFilterCategory = e.target.value;
    renderFormattedLectureView();
  });

  document.getElementById("inpLectureSearch")?.addEventListener("input", (e) => {
    currentState.lectureSearchQuery = e.target.value;
    renderFormattedLectureView();
    if (currentState.activeSection === "editor") {
      renderEditorLectureStage();
    }
  });

  // ---------------------------------------------------------------------------
  // AI Tafrigh: preview (default view) -> run with live details, pause and cancel -> results
  // ---------------------------------------------------------------------------
  const tfg = { preview: null, jobId: null, paused: false, previewTimer: null };

  const tfgEl = id => document.getElementById(id);
  const fmtSec = s => {
    if (s == null || !isFinite(s)) return "—";
    s = Math.max(0, Math.round(s));
    return s >= 60 ? `${Math.floor(s / 60)}د ${String(s % 60).padStart(2, "0")}ث` : `${s}ث`;
  };
  const TAG_AR = {
    paragraph: "فقرة", heading: "عنوان", list_intro: "تمهيد قائمة", list_item: "عنصر قائمة",
    matn_section: "متن", continuation: "تكملة", comment: "تعليق عارض"
  };
  const CUT_AR = { punctuation: "ترقيم", pause: "سكتة", length: "طول", detection: "اقتباس", end: "نهاية النص" };

  function tafrighShow(view) {
    ["tafrighEmptyState", "tafrighProgressWrap", "tafrighErrorWrap", "tafrighResultsView"].forEach(id => {
      tfgEl(id)?.classList.toggle("hidden", id !== view);
    });
  }

  // The Tafrigh input is the current session, not the original raw transcript: the text is rebuilt from the
  // current words (manual text edits included). How quotes are sent depends on «مصدر النص»:
  //   raw_findings — every quote (engine-detected or added by hand) placed by its word range, so the segmenter
  //                  makes each ayah / hadith / dhikr its own sentence (default)
  //   corrected    — the same, but each quote's spoken words are replaced by its text from the source (as in Display)
  //   raw          — the plain text, quotes not marked at all
  function tafrighTextSourceMode() {
    return tfgEl("selTafrighTextSource")?.value || "raw_findings";
  }

  function tafrighQuoteDets(words) {
    let lastEnd = -1;
    return (currentState.detections || [])
      .filter(d => d.aiVerification?.verdict !== "FALSE")          // rejected by the AI verifier: not a quote
      .filter(d => words[d.wordStartIdx] && words[d.wordEndIdx] && d.wordEndIdx >= d.wordStartIdx)
      .slice()
      .sort((a, b) => a.wordStartIdx - b.wordStartIdx)
      .filter(d => {                                               // overlapping quotes: keep the first
        if (d.wordStartIdx <= lastEnd) return false;
        lastEnd = d.wordEndIdx;
        return true;
      });
  }

  function tafrighSpanMeta(d) {
    return {
      type: d.sourceType === "QURAN" ? "quran" : (d.sourceType === "HADITH" ? "hadith" : "adhkar"),
      unit_id: d.unitId, ref: d.displayRef || d.reference || "", band: d.confidenceBand || "",
      canonical: d.canonicalText || (Array.isArray(d.canonicalSegments) ? d.canonicalSegments.join(" ") : "")
    };
  }

  /**
   * Rebuild the text with every quote written from its source: each quote segment's spoken words are replaced by
   * its reference words (commentary gaps between segments stay as spoken). The new words get times spread evenly
   * over the spoken quote's time, so pause-based sentence cuts still work around it.
   */
  function tafrighCorrectedSource(words, dets) {
    const out = [];       // { word, start, end }
    const spans = [];
    const pushWord = (word, start, end) => { if (word) out.push({ word, start, end }); };
    let i = 0;
    dets.forEach(d => {
      for (; i < d.wordStartIdx; i++) pushWord(words[i].word, words[i].start, words[i].end);
      const segs = (Array.isArray(d.segments) && d.segments.length ? d.segments : [[d.wordStartIdx, d.wordEndIdx + 1]])
        .map(([a, b]) => [Math.max(d.wordStartIdx, a), Math.min(d.wordEndIdx + 1, b)])
        .filter(([a, b]) => b > a);
      const segTexts = Array.isArray(d.canonicalSegments) && d.canonicalSegments.length === segs.length
        ? d.canonicalSegments
        : null;
      const parts = segTexts ? segs.map((sg, k) => [sg, segTexts[k]]) : [[[d.wordStartIdx, d.wordEndIdx + 1], d.canonicalText]];
      let cur = d.wordStartIdx;
      parts.forEach(([[a, b], canon]) => {
        for (; cur < a; cur++) pushWord(words[cur].word, words[cur].start, words[cur].end);   // commentary gap
        const spoken = words.slice(a, b);
        const toks = String(canon || "").split(/\s+/).filter(Boolean);
        const useToks = toks.length ? toks : spoken.map(w => w.word);
        const t0 = Number(spoken[0].start), t1 = Number(spoken[spoken.length - 1].end);
        const step = (t1 - t0) / useToks.length;
        const first = out.length;
        useToks.forEach((tk, k) => pushWord(tk, t0 + k * step, t0 + (k + 1) * step));
        spans.push({ firstWord: first, lastWord: out.length - 1, meta: Object.assign(tafrighSpanMeta(d), { canonical: useToks.join(" ") }) });
        cur = b;
      });
      for (; cur <= d.wordEndIdx; cur++) pushWord(words[cur].word, words[cur].start, words[cur].end);
      i = d.wordEndIdx + 1;
    });
    for (; i < words.length; i++) pushWord(words[i].word, words[i].start, words[i].end);

    let cursor = 0;
    const asr = out.map(w => {
      const o = { start: w.start, end: w.end, char_start: cursor, char_end: cursor + w.word.length };
      cursor = o.char_end + 1;
      return o;
    });
    return {
      raw_text: out.map(w => w.word).join(" "),
      asr_words: asr,
      detection_spans: spans
        .filter(sp => sp.lastWord >= sp.firstWord)
        .map(sp => Object.assign({ start: asr[sp.firstWord].char_start, end: asr[sp.lastWord].char_end }, sp.meta)),
      use_detection_boundaries: true,
      text_source: "corrected"
    };
  }

  function tafrighSource() {
    if (typeof syncRawTextFromWords === "function") syncRawTextFromWords();
    const words = currentState.words || [];
    const text = currentState.rawTranscript || "";
    const mode = tafrighTextSourceMode();
    const asrWords = words.map(w => ({ start: w.start, end: w.end, char_start: w.char_start, char_end: w.char_end }));
    if (mode === "raw") {
      return { raw_text: text, asr_words: asrWords, detection_spans: [], use_detection_boundaries: false, text_source: mode };
    }
    const dets = tafrighQuoteDets(words);
    if (mode === "corrected") return tafrighCorrectedSource(words, dets);
    const spans = dets
      .map(d => Object.assign({ start: words[d.wordStartIdx].char_start, end: words[d.wordEndIdx].char_end }, tafrighSpanMeta(d)))
      .filter(sp => sp.end > sp.start);
    return {
      raw_text: text,
      asr_words: asrWords,
      detection_spans: spans,
      use_detection_boundaries: true,
      text_source: mode
    };
  }

  function renderTafrighSourceInfo(src) {
    const el = tfgEl("lblTafrighSourceInfo");
    if (!el) return;
    const by = src.detection_spans.reduce((acc, sp) => { acc[sp.type] = (acc[sp.type] || 0) + 1; return acc; }, {});
    const engine = typeof WahyEngine !== "undefined" && activeMatcher instanceof WahyEngine ? "v4" : "v3";
    const modeNote = {
      raw: "النص الخام كما هو، دون تمييز المقتبسات",
      corrected: "كل مقتبس جملة مستقلة بنصه من المصدر",
      raw_findings: "كل مقتبس جملة مستقلة بلفظ الشيخ"
    }[src.text_source] || "";
    el.textContent = src.text_source === "raw"
      ? `${(currentState.words || []).length} كلمة — ${modeNote} • يشمل تعديلاتك اليدوية`
      : `${(currentState.words || []).length} كلمة • ﴿ ${by.quran || 0} آية • « ${by.hadith || 0} حديث • 〖 ${by.adhkar || 0} ذكر — ${modeNote} • يشمل تعديلاتك اليدوية • المحرك: ${engine}`;
    const sel = tfgEl("selTafrighEngine");
    if (sel && document.activeElement !== sel) sel.value = engine;
  }

  function tafrighQuoteStyle() {
    const p = typeof getOutputDisplayPrefs === "function" ? getOutputDisplayPrefs() : {};
    return {
      quran_open: p.quranBracketOpen ?? "﴿", quran_close: p.quranBracketClose ?? "﴾",
      hadith_open: p.hadithBracketOpen ?? "«", hadith_close: p.hadithBracketClose ?? "»",
      adhkar_open: p.adhkarBracketOpen ?? "〖", adhkar_close: p.adhkarBracketClose ?? "〗",
      show_quote_refs: p.showQuranSource !== false
    };
  }

  function tafrighSegConfig() {
    return {
      pause_sec: parseFloat(tfgEl("inpSegPause")?.value || "0.7"),
      min_words: parseInt(tfgEl("inpSegMin")?.value || "2", 10),
      max_words: parseInt(tfgEl("inpSegMax")?.value || "40", 10),
      use_punctuation: tfgEl("chkSegPunct")?.checked !== false
    };
  }

  // Provider & model. OpenRouter: one search over its whole catalog — a JEV model is classified through JEV's
  // decisions API (split/typo fixes then go to the helper model), any other model does the whole job itself.
  // Keys come from the AI verification settings.
  const tfgProvider = () => tfgEl("selTafrighProvider")?.value || "openrouter";
  const tfgModelId = (inputId) => {
    const m = (tfgEl(inputId)?.value || "").trim();
    return /^gemini-/i.test(m) ? `google/${m}` : m;
  };
  const tfgChatModel = () => tfgModelId("inpTafrighChatModel");
  const tfgHelperModel = () => tfgModelId("inpTafrighHelperModel");
  const tfgIsJev = (id) => /typesafe\/jev/.test(id);
  // JEV / Laya only classify: the helper model handles splits and typo fixes
  const tfgNeedsHelper = () => tfgProvider() === "laya" || (tfgProvider() === "openrouter" && tfgIsJev(tfgChatModel()));
  const tfgHelperDirect = () => Boolean(tfgEl("chkTafrighHelperDirect")?.checked);

  function tfgStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
  }
  function tfgLoad(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  const tfgCatalog = () => currentState.aiVerification?.openRouterModelsCatalog || [];
  const tfgPrice = (m) => `$${(parseFloat(m.pricing.prompt || 0) * 1e6).toFixed(3)} / $${(parseFloat(m.pricing.completion || 0) * 1e6).toFixed(3)}`;

  function renderTafrighModelInfo(infoId, id) {
    const info = tfgEl(infoId);
    if (!info) return;
    const meta = tfgCatalog().find(m => m.id === id);
    info.innerHTML = meta
      ? `${escapeHtml(meta.name)} • <span class="text-emerald-400 font-mono">${tfgPrice(meta)}</span> لكل مليون رمز • سياق ${Math.round((meta.context_length || 0) / 1000)}k${tfgIsJev(id) ? " • 🎯 يُصنَّف عبر JEV" : ""}`
      : (tfgCatalog().length && id ? '<span class="text-rose-300">النموذج غير موجود في قائمة OpenRouter؛ اختره من نتائج البحث.</span>' : "");
  }

  /** Searchable dropdown over the whole OpenRouter catalog (id, name, price), filtered as you type. */
  function attachTafrighModelSearch(inputId, listId, infoId, storeKey) {
    const input = tfgEl(inputId), list = tfgEl(listId);
    if (!input || !list) return;
    const render = () => {
      const q = input.value.toLowerCase().trim();
      const words = q.split(/\s+/).filter(Boolean);
      const hits = tfgCatalog().filter(m => {
        const hay = `${m.id} ${m.name}`.toLowerCase();
        return words.every(w => hay.includes(w) || (w === "free" && m.isFree));
      });
      if (!tfgCatalog().length) {
        list.innerHTML = `<div class="p-3 text-slate-400 text-center">⏳ جاري تحميل قائمة نماذج OpenRouter...</div>`;
      } else if (!hits.length) {
        list.innerHTML = `<div class="p-3 text-slate-400 text-center">لا توجد نماذج مطابقة.</div>`;
      } else {
        list.innerHTML = hits.slice(0, 60).map(m => `
          <div class="model-dropdown-item ${m.id === input.value.trim() ? "selected" : ""}" data-model-id="${escapeHtml(m.id)}">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-slate-200">${escapeHtml(m.name)}</span>
              <span class="font-mono text-[10px] text-emerald-400" dir="ltr">${m.isFree ? "مجاني" : tfgPrice(m)}</span>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
              <span class="font-mono" dir="ltr">${escapeHtml(m.id)}</span>
              <span>${Math.round((m.context_length || 0) / 1000)}k</span>
            </div>
          </div>`).join("") + (hits.length > 60 ? `<div class="p-2 text-center text-[10px] text-slate-500">+${hits.length - 60} — اكتب أكثر لتضييق البحث</div>` : "");
        list.querySelectorAll("[data-model-id]").forEach(item => item.addEventListener("mousedown", (e) => {
          e.preventDefault();   // keep focus handling simple: pick before the input's blur hides the list
          input.value = item.getAttribute("data-model-id");
          list.classList.add("hidden");
          commit();
        }));
      }
      list.classList.remove("hidden");
    };
    const commit = () => {
      tfgStore(storeKey, tfgModelId(inputId));
      renderTafrighModelInfo(infoId, tfgModelId(inputId));
      syncTafrighProviderUI();
    };
    input.addEventListener("focus", async () => { render(); await loadTafrighCatalog(); render(); });
    input.addEventListener("input", render);
    input.addEventListener("change", commit);
    input.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 120));
  }

  async function loadTafrighCatalog() {
    if (typeof WahyAiVerifier !== "object") return;
    await WahyAiVerifier.fetchOpenRouterModelsCatalog();
    renderTafrighModelInfo("lblTafrighChatModelInfo", tfgChatModel());
    renderTafrighModelInfo("lblTafrighHelperModelInfo", tfgHelperModel());
  }

  function syncTafrighProviderUI() {
    const prov = tfgProvider();
    tfgEl("wrapTafrighChatModel")?.classList.toggle("hidden", prov !== "openrouter");
    tfgEl("wrapTafrighGeminiModel")?.classList.toggle("hidden", prov !== "gemini");
    tfgEl("wrapTafrighHelperRoute")?.classList.toggle("hidden", !tfgNeedsHelper());
    const helperInp = tfgEl("inpTafrighHelperModel");
    if (helperInp) helperInp.disabled = tfgHelperDirect();
    const modeSel = tfgEl("selTafrighMode");
    const windowed = modeSel?.querySelector('option[value="windowed"]');
    if (windowed) windowed.disabled = tfgNeedsHelper();   // windowed batches need a chat model (Gemini / OpenRouter non-JEV)
    if (modeSel && windowed?.disabled && modeSel.value === "windowed") modeSel.value = "per_sentence";
    if (prov === "openrouter" || tfgNeedsHelper()) loadTafrighCatalog();
    updateTafrighRangeSummary();
  }

  /** The model part of the run request for the chosen provider. */
  function tafrighModelPayload() {
    const prov = tfgProvider();
    const chatModel = tfgChatModel();
    const helper = tfgHelperDirect()
      ? { gemini_route: "direct" }
      : { gemini_route: "openrouter", openrouter_gemini_model: tfgHelperModel() || "google/gemini-3.1-flash-lite" };
    if (prov === "openrouter" && tfgIsJev(chatModel)) {
      return { model_candidate: "jev_hybrid", model_name: chatModel, jev_model: chatModel, ...helper };
    }
    if (prov === "openrouter") return { model_candidate: "openrouter_chat", model_name: chatModel, openrouter_chat_model: chatModel };
    if (prov === "laya") return { model_candidate: "laya_hybrid", model_name: "local-laya", ...helper };
    return { model_candidate: "gemini_all", model_name: tfgEl("selTafrighModel")?.value || "auto", gemini_route: "direct" };
  }

  /** Why a run with the chosen provider cannot start (missing key / model), or "" when it can. */
  function tafrighProviderProblem() {
    const ai = currentState.aiVerification || {};
    const prov = tfgProvider();
    const orKey = (ai.openRouterApiKey || tfgLoad("wahy_openrouter_api_key") || "").trim();
    const gemKey = (ai.geminiApiKey || tfgLoad("wahy_gemini_api_key") || "").trim();
    const known = (id) => !tfgCatalog().length || tfgCatalog().some(m => m.id === id);
    if ((prov === "openrouter" || (tfgNeedsHelper() && !tfgHelperDirect())) && !orKey) return "أدخل مفتاح OpenRouter API في إعدادات التدقيق الذكي أولاً.";
    if ((prov === "gemini" || (tfgNeedsHelper() && tfgHelperDirect())) && !gemKey) return "أدخل مفتاح Google Gemini API في إعدادات التدقيق الذكي أولاً.";
    if (prov === "openrouter") {
      if (!tfgChatModel()) return "ابحث عن نموذج OpenRouter واختره أولاً.";
      if (!tfgIsJev(tfgChatModel()) && !known(tfgChatModel())) return `النموذج «${tfgChatModel()}» غير موجود على OpenRouter — اختره من نتائج البحث.`;
    }
    if (tfgNeedsHelper() && !tfgHelperDirect() && tfgHelperModel() && !known(tfgHelperModel())) {
      return `نموذج المساعدة «${tfgHelperModel()}» غير موجود على OpenRouter — اختره من نتائج البحث.`;
    }
    return "";
  }

  function tafrighRange() {
    const n = tfg.preview ? tfg.preview.segments.length : 0;
    let from = Math.max(1, Math.min(n, parseInt(tfgEl("inpTafrighFrom")?.value || "1", 10) || 1));
    let to = Math.max(from, Math.min(n, parseInt(tfgEl("inpTafrighTo")?.value || String(n), 10) || n));
    return { from, to, count: n ? to - from + 1 : 0 };
  }

  async function openTafrighPrep() {
    if (typeof switchLectureStageTab === "function") switchLectureStageTab("tafrigh");
    tafrighShow("tafrighEmptyState");
    await refreshTafrighPreview();
  }

  async function refreshTafrighPreview() {
    const list = tfgEl("tafrighSegList");
    const src = tafrighSource();
    renderTafrighSourceInfo(src);
    if (!src.raw_text.trim()) {
      if (list) list.innerHTML = `<div class="p-4 text-center text-slate-400">لا يوجد نص محاضرة بعد — أدخل نصاً أو رابطاً أولاً.</div>`;
      tfg.preview = null;
      renderTafrighStats();
      return;
    }
    if (list) list.innerHTML = `<div class="p-4 text-center text-slate-400">⏳ جاري تقطيع الجمل...</div>`;
    try {
      const r = await fetch("/api/tafrigh/segment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...src, seg_config: tafrighSegConfig() })
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message || "segment failed");
      const prevCount = tfg.preview ? tfg.preview.segments.length : 0;
      tfg.preview = d;
      const n = d.segments.length;
      const toEl = tfgEl("inpTafrighTo"), fromEl = tfgEl("inpTafrighFrom");
      if (toEl) { toEl.max = n; if (!prevCount || parseInt(toEl.value, 10) > n || parseInt(toEl.value, 10) === prevCount) toEl.value = n; }
      if (fromEl) { fromEl.max = n; if (parseInt(fromEl.value, 10) > n) fromEl.value = 1; }
      renderTafrighStats();
      renderTafrighSegList();
    } catch (e) {
      if (list) list.innerHTML = `<div class="p-4 text-center text-rose-300">تعذر تقطيع النص: ${escapeHtml(e.message)}</div>`;
    }
  }

  function statCard(label, value, tone = "text-white") {
    return `<div class="rounded-xl bg-slate-950/80 border border-slate-800 px-2 py-2">
      <div class="text-[10px] text-slate-400">${label}</div><div class="font-mono font-bold text-sm ${tone}">${value}</div></div>`;
  }

  function renderTafrighStats() {
    const box = tfgEl("tafrighSegStats"), sum = tfgEl("tafrighRangeSummary");
    if (!box) return;
    const st = tfg.preview?.stats;
    if (!st) { box.innerHTML = ""; if (sum) sum.textContent = ""; return; }
    const reasons = Object.entries(st.cut_reasons || {}).map(([k, v]) => `${CUT_AR[k] || k}: ${v}`).join(" • ");
    box.innerHTML = [
      statCard("عدد الجمل", st.sentences, "text-amber-300"),
      statCard("جمل مقتبسات", st.quote_sentences ?? 0, "text-emerald-300"),
      statCard("مجموع الكلمات", st.words_total),
      statCard("أقصر جملة", `${st.min_words} كلمة`),
      statCard("أطول جملة", `${st.max_words} كلمة`, st.over_cap ? "text-rose-300" : "text-white"),
      statCard("المتوسط / الوسيط", `${st.avg_words} / ${st.median_words}`),
      statCard("متوسط المدة", st.avg_duration_sec != null ? `${st.avg_duration_sec}ث` : "—")
    ].join("") + `<div class="col-span-3 sm:col-span-6 text-[11px] text-slate-400 text-right">سبب نهاية الجمل: ${escapeHtml(reasons || "—")}${st.has_timestamps ? "" : " • (لا توجد توقيتات كلمات: التقطيع بالسكتات غير متاح)"}</div>`;
    updateTafrighRangeSummary();
  }

  function updateTafrighRangeSummary() {
    const sum = tfgEl("tafrighRangeSummary");
    if (!sum || !tfg.preview) return;
    const { from, to, count } = tafrighRange();
    const perSentence = tfgNeedsHelper() && tfgProvider() === "openrouter" ? 3.5 : 2.5;   // measured: JEV ≈ 3.5 s / sentence
    const words = tfg.preview.segments.slice(from - 1, to).reduce((a, s) => a + s.words, 0);
    sum.textContent = `سيعمل النموذج على ${count} جملة (من ${from} إلى ${to}، ${words} كلمة) • الوقت التقريبي ≈ ${fmtSec(count * perSentence)}`;
    const lbl = tfgEl("lblRunTafrigh");
    if (lbl) lbl.textContent = `تشغيل التفريغ على ${count} جملة`;
    tfgEl("tafrighSegList")?.querySelectorAll("[data-seg-idx]").forEach(row => {
      const k = parseInt(row.getAttribute("data-seg-idx"), 10) + 1;
      row.classList.toggle("opacity-40", k < from || k > to);
    });
  }

  function renderTafrighSegList() {
    const list = tfgEl("tafrighSegList");
    if (!list || !tfg.preview) return;
    const maxW = tafrighSegConfig().max_words;
    list.innerHTML = tfg.preview.segments.map(sg => {
      const t = sg.start_time != null ? formatSecondsToShortTime(sg.start_time) : "";
      const long = maxW && sg.words > maxW;
      return `<div class="flex items-start gap-2 px-3 py-1.5 hover:bg-slate-900/70" data-seg-idx="${sg.index}">
        <span class="font-mono text-[10px] text-slate-500 w-8 shrink-0 pt-0.5">${sg.index + 1}</span>
        ${sg.has_detection ? `<span class="shrink-0 px-1.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 text-[10px]">${(sg.quote_kinds || []).map(k => ({ quran: "آية", hadith: "حديث", adhkar: "ذكر" }[k] || k)).join(" + ") || "مقتبس"}</span>` : ""}
        <span class="flex-1 leading-relaxed ${sg.has_detection ? "text-emerald-200" : "text-slate-200"}" data-no-i18n>${escapeHtml(sg.text)}</span>
        <span class="shrink-0 text-[10px] font-mono ${long ? "text-rose-300" : "text-slate-500"}" title="عدد الكلمات">${sg.words}ك</span>
        <span class="shrink-0 text-[10px] text-slate-500 w-14 text-left" title="سبب نهاية الجملة">${CUT_AR[sg.cut_reason] || ""}</span>
        <span class="shrink-0 text-[10px] font-mono text-slate-600 w-16 text-left" dir="ltr">${t}</span>
      </div>`;
    }).join("");
    updateTafrighRangeSummary();
  }

  function renderTafrighProgress(d) {
    const info = d.details || {};
    const pct = Math.round(d.percent ?? 0);
    const bar = tfgEl("tafrighProgressBar");
    if (bar) bar.style.width = `${Math.max(parseFloat(bar.style.width) || 0, pct)}%`;
    const pctEl = tfgEl("tafrighProgressPct");
    if (pctEl) pctEl.textContent = `${Math.max(parseInt(pctEl.textContent, 10) || 0, pct)}%`;
    if (tfgEl("tafrighProgressTitle") && d.message) tfgEl("tafrighProgressTitle").textContent = d.message;
    if (tfgEl("tafrighProgressSubtitle")) {
      tfgEl("tafrighProgressSubtitle").textContent = info.paused ? "⏸️ متوقف مؤقتاً — اضغط «استئناف» للمتابعة" : "";
    }
    const det = tfgEl("tafrighProgressDetails");
    if (det && info.total != null) {
      det.innerHTML = [
        statCard("الجمل", `${info.done} / ${info.total}`, "text-amber-300"),
        statCard("الوقت المنقضي", fmtSec(info.elapsed_sec)),
        statCard("المتبقي تقريباً", fmtSec(info.eta_sec)),
        statCard("ثانية لكل جملة", info.sec_per_sentence ?? "—"),
        statCard("طلبات النموذج", info.model_calls ?? 0),
        statCard("التكلفة", `$${(info.cost_usd || 0).toFixed(5)}`),
        statCard("أخطاء", info.errors ?? 0, info.errors ? "text-rose-300" : "text-white"),
        statCard("تقسيم / تصحيح", `${info.splits ?? 0} / ${info.edits ?? 0}`)
      ].join("");
    }
    const tags = tfgEl("tafrighProgressTags");
    if (tags && info.tags) {
      tags.innerHTML = Object.entries(info.tags).map(([k, v]) =>
        `<span class="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-200 ${k === info.last_tag ? "ring-1 ring-amber-400" : ""}">${TAG_AR[k] || k}: <b>${v}</b></span>`).join("");
    }
    if (info.current && tfgEl("tafrighProgressCurrent")) {
      tfgEl("tafrighProgressCurrent").textContent = info.current.text || "—";
      const purpose = { classify: "تصنيف", split: "تقسيم", correct: "تصحيح", classify_window: "تصنيف نافذة" }[info.current.purpose] || "";
      if (tfgEl("tafrighProgressPurpose")) tfgEl("tafrighProgressPurpose").textContent = purpose ? `(${purpose})` : "";
    }
  }

  async function tafrighControl(action) {
    if (!tfg.jobId) return;
    try {
      await fetch("/api/tafrigh/control", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: tfg.jobId, action })
      });
    } catch (e) { showToast("تعذر الاتصال بالخادم"); }
  }

  let tafrighRunInFlight = false;

  // A run ends either when /api/tafrigh/run answers or, for a cancel, right away (its late answer is ignored)
  function endTafrighRun(jobId) {
    if (tfg.jobId !== jobId) return;
    clearInterval(tfg.poll);
    tafrighRunInFlight = false;
    tfg.jobId = null;
    const btnTop = tfgEl("btnRunAiTafrigh");
    if (btnTop) btnTop.disabled = false;
  }

  // Back to what was on screen before the run: the previous result, or the preview if there is none
  function restoreTafrighBeforeRun() {
    if (currentState.tafrigh && currentState.tafrigh.hasRun) tafrighShow("tafrighResultsView");
    else openTafrighPrep();
  }

  async function triggerRunAiTafrigh() {
    if (tafrighRunInFlight) {
      showToast("⏳ التفريغ الذكي قيد التشغيل بالفعل، انتظر حتى ينتهي أو ألغِه.");
      return;
    }
    if (tfgProvider() === "openrouter" || tfgNeedsHelper()) await loadTafrighCatalog();
    const problem = tafrighProviderProblem();
    if (problem) { showToast(`⚠️ ${problem}`); return; }
    if (!tfg.preview || !tfg.preview.segments.length) {
      await refreshTafrighPreview();
      if (!tfg.preview || !tfg.preview.segments.length) { showToast("⚠️ لا توجد جمل للتشغيل"); return; }
    }
    tafrighRunInFlight = true;
    await runAiTafrighOnce();
  }

  async function runAiTafrighOnce() {
    const { from, to, count } = tafrighRange();
    const matnText = (tfgEl("inpTafrighMatn")?.value || "").trim();
    const jobId = "tfg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    tfg.jobId = jobId;
    tfg.paused = false;

    tafrighShow("tafrighProgressWrap");
    if (tfgEl("tafrighProgressBar")) tfgEl("tafrighProgressBar").style.width = "0%";
    if (tfgEl("tafrighProgressPct")) tfgEl("tafrighProgressPct").textContent = "0%";
    if (tfgEl("tafrighProgressTitle")) tfgEl("tafrighProgressTitle").textContent = `جاري التحضير لـ ${count} جملة...`;
    ["tafrighProgressDetails", "tafrighProgressTags"].forEach(id => { if (tfgEl(id)) tfgEl(id).innerHTML = ""; });
    if (tfgEl("tafrighProgressCurrent")) tfgEl("tafrighProgressCurrent").textContent = "—";
    if (tfgEl("btnTafrighPause")) tfgEl("btnTafrighPause").textContent = "⏸️ إيقاف مؤقت";
    ["btnTafrighStop", "btnTafrighCancel", "btnTafrighPause"].forEach(id => { if (tfgEl(id)) tfgEl(id).disabled = false; });
    const btnTop = tfgEl("btnRunAiTafrigh");
    if (btnTop) btnTop.disabled = true;

    clearInterval(tfg.poll);
    tfg.poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/transcribe/progress/${jobId}`, { trapError: false });
        const d = await r.json();
        if (d.stage === "tafrigh") renderTafrighProgress(d);
      } catch (e) { /* polling is best effort */ }
    }, 600);

    const payload = {
      job_id: jobId,
      ...tafrighSource(),
      seg_config: tafrighSegConfig(),
      quote_style: tafrighQuoteStyle(),
      target_range: [from - 1, to],
      matn_config: matnText ? { mode: "upload", raw_matn_text: matnText } : { mode: "no_matn" },
      lecture_slug: (currentState.lectureTitle || "lecture").slice(0, 40),
      processing_mode: tfgEl("selTafrighMode")?.value || "per_sentence",
      ...tafrighModelPayload(),
      typo_strategy: tfgEl("selTafrighTypoStrategy")?.value || "gated",
      gemini_api_key: currentState?.aiVerification?.geminiApiKey || localStorage.getItem("wahy_gemini_api_key") || "",
      openrouter_api_key: currentState?.aiVerification?.openRouterApiKey || localStorage.getItem("wahy_openrouter_api_key") || ""
    };

    try {
      const resp = await fetch("/api/tafrigh/run", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (tfg.jobId !== jobId) return; // cancelled: the UI already went back
      endTafrighRun(jobId);
      if (data.discarded) {
        restoreTafrighBeforeRun();
        showToast(`⏹️ ${data.message || "تم إلغاء التفريغ دون تطبيق أي تغيير"}`);
        return;
      }
      const warnBox = tfgEl("tafrighWarnings");
      if (warnBox) {
        const ws = Array.isArray(data.warnings) ? data.warnings : [];
        warnBox.classList.toggle("hidden", !ws.length);
        warnBox.innerHTML = ws.map(w => `<div>⚠️ ${escapeHtml(w)}</div>`).join("");
      }
      if (data.success) {
        if (typeof renderTafrighOutput === "function") renderTafrighOutput(data);
        tafrighShow("tafrighResultsView");
        showToast(data.cancelled ? "⏹️ تم الإيقاف — عرض الجمل المكتملة" : "✅ اكتمل التفريغ الذكي");
      } else {
        tafrighShow("tafrighErrorWrap");
        if (tfgEl("tafrighErrorMessage")) tfgEl("tafrighErrorMessage").textContent = data.message || "حدث خطأ أثناء معالجة التفريغ في الخادم.";
        showToast("❌ تعذر إكمال التفريغ الذكي");
      }
    } catch (e) {
      if (tfg.jobId !== jobId) return;
      endTafrighRun(jobId);
      console.error("Tafrigh error:", e);
      tafrighShow("tafrighErrorWrap");
      if (tfgEl("tafrighErrorMessage")) tfgEl("tafrighErrorMessage").textContent = `تعذر الاتصال بخادم التفريغ الذكي (${e.message}).`;
    }
  }

  // Wiring: the toolbar button and "re-run" open the preview; only the preview's run button starts a run
  tfgEl("btnRunAiTafrigh")?.addEventListener("click", openTafrighPrep);
  tfgEl("btnRerunTafrigh")?.addEventListener("click", openTafrighPrep);
  tfgEl("btnTafrighRetry")?.addEventListener("click", openTafrighPrep);
  tfgEl("btnRunTafrighFromEmpty")?.addEventListener("click", triggerRunAiTafrigh);
  tfgEl("btnOpenSaveTafrighRun")?.addEventListener("click", () => openSaveTafrighRunModal());
  // Provider, models and text source: restored from the last session, saved on change. Older sessions saved
  // "jev" / "openrouter_chat" as separate providers and the helper as a fixed route: mapped onto the search fields.
  const savedProv = tfgLoad("wahyTafrighProvider");
  if (savedProv === "jev" || savedProv === "openrouter_chat") tfgStore("wahyTafrighProvider", "openrouter");
  if (savedProv === "jev" && !tfgLoad("wahyTafrighChatModel")) tfgStore("wahyTafrighChatModel", tfgLoad("wahyTafrighJevModel") || "typesafe/jev-1.14");
  const savedRoute = tfgLoad("wahyTafrighGeminiRoute") || "";
  if (savedRoute === "direct") tfgStore("wahyTafrighHelperDirect", "1");
  if (savedRoute.startsWith("openrouter:google/") && !tfgLoad("wahyTafrighHelperModel")) tfgStore("wahyTafrighHelperModel", savedRoute.slice("openrouter:".length));

  [["selTafrighProvider", "wahyTafrighProvider"], ["selTafrighTextSource", "wahyTafrighTextSource"]].forEach(([id, key]) => {
    const el = tfgEl(id);
    if (!el) return;
    const saved = tfgLoad(key);
    if (saved && [...el.options].some(o => o.value === saved)) el.value = saved;
    el.addEventListener("change", () => tfgStore(key, el.value));
  });
  if (tfgEl("inpTafrighChatModel")) {
    tfgEl("inpTafrighChatModel").value = tfgLoad("wahyTafrighChatModel") || currentState.aiVerification?.openRouterSelectedModel || "typesafe/jev-1.14";
  }
  if (tfgEl("inpTafrighHelperModel")) {
    tfgEl("inpTafrighHelperModel").value = tfgLoad("wahyTafrighHelperModel") || "google/gemini-3.1-flash-lite";
  }
  if (tfgEl("chkTafrighHelperDirect")) {
    tfgEl("chkTafrighHelperDirect").checked = tfgLoad("wahyTafrighHelperDirect") === "1";
    tfgEl("chkTafrighHelperDirect").addEventListener("change", (e) => {
      tfgStore("wahyTafrighHelperDirect", e.target.checked ? "1" : "0");
      syncTafrighProviderUI();
    });
  }
  attachTafrighModelSearch("inpTafrighChatModel", "tafrighChatModelList", "lblTafrighChatModelInfo", "wahyTafrighChatModel");
  attachTafrighModelSearch("inpTafrighHelperModel", "tafrighHelperModelList", "lblTafrighHelperModelInfo", "wahyTafrighHelperModel");
  tfgEl("selTafrighProvider")?.addEventListener("change", syncTafrighProviderUI);
  tfgEl("selTafrighTextSource")?.addEventListener("change", refreshTafrighPreview);
  syncTafrighProviderUI();
  // Optional: re-detect quotes with the chosen engine before the Tafrigh (replaces manual quote edits; undoable)
  tfgEl("btnTafrighRerunEngine")?.addEventListener("click", async () => {
    if (!(currentState.words || []).length) { showToast("لا يوجد نص لإعادة فحصه بعد"); return; }
    const choice = tfgEl("selTafrighEngine")?.value === "v4" ? "v4" : "v3";
    if (!confirm(`إعادة اكتشاف المقتبسات بالمحرك ${choice}؟ ستُستبدل المقتبسات الحالية وتعديلاتك اليدوية عليها (يمكن التراجع).`)) return;
    if (typeof pushUndoSnapshot === "function") pushUndoSnapshot(`إعادة تشغيل المحرك ${choice} قبل التفريغ`);
    try { localStorage.setItem("wahyEngine", choice); } catch (e) { /* storage blocked */ }
    ["selEngineVersion", "selEngineVersionQuick"].forEach(id => { const el = document.getElementById(id); if (el) el.value = choice; });
    rebuildMatcher();
    runDetectionAndBuildCaptions();
    const isV4 = typeof WahyEngine !== "undefined" && activeMatcher instanceof WahyEngine;
    showToast(choice === "v4" && !isV4 ? "⚠ تعذّر تشغيل v4، تم استخدام v3" : `🔄 تمت إعادة تشغيل المحرك (${isV4 ? "v4" : "v3"})`);
    await refreshTafrighPreview();
  });
  tfgEl("btnTafrighPause")?.addEventListener("click", async () => {
    tfg.paused = !tfg.paused;
    await tafrighControl(tfg.paused ? "pause" : "resume");
    tfgEl("btnTafrighPause").textContent = tfg.paused ? "▶️ استئناف" : "⏸️ إيقاف مؤقت";
  });
  // Stop: end now and show the sentences already done (the server answers without waiting for the in-flight request)
  tfgEl("btnTafrighStop")?.addEventListener("click", async () => {
    ["btnTafrighStop", "btnTafrighCancel", "btnTafrighPause"].forEach(id => { if (tfgEl(id)) tfgEl(id).disabled = true; });
    if (tfgEl("tafrighProgressTitle")) tfgEl("tafrighProgressTitle").textContent = "جاري الإيقاف وتجهيز الجمل المكتملة...";
    await tafrighControl("stop");
  });
  // Cancel: discard this run entirely and go back to what was shown before it
  tfgEl("btnTafrighCancel")?.addEventListener("click", async () => {
    if (!confirm("إلغاء التفريغ؟ لن يُطبَّق أي شيء من هذا التشغيل وستعود للنتيجة السابقة.")) return;
    const jobId = tfg.jobId;
    await tafrighControl("cancel");
    endTafrighRun(jobId);
    restoreTafrighBeforeRun();
    showToast("✕ تم إلغاء التفريغ دون تطبيق أي تغيير");
  });
  ["inpSegPause", "inpSegMin", "inpSegMax", "chkSegPunct"].forEach(id => tfgEl(id)?.addEventListener("change", () => {
    clearTimeout(tfg.previewTimer);
    tfg.previewTimer = setTimeout(refreshTafrighPreview, 250);
  }));
  ["inpTafrighFrom", "inpTafrighTo"].forEach(id => tfgEl(id)?.addEventListener("input", updateTafrighRangeSummary));
  document.querySelectorAll("[data-tafrigh-range]").forEach(btn => btn.addEventListener("click", () => {
    const n = tfg.preview ? tfg.preview.segments.length : 0;
    const v = btn.getAttribute("data-tafrigh-range");
    tfgEl("inpTafrighFrom").value = 1;
    tfgEl("inpTafrighTo").value = v === "all" ? n : Math.min(n, parseInt(v, 10));
    updateTafrighRangeSummary();
  }));
  document.querySelectorAll(".tafrigh-view-tab").forEach(b => b.addEventListener("click", () => setTafrighResultsView(b.getAttribute("data-tafrigh-view"))));
  window.openTafrighPrep = openTafrighPrep;

  // Tab switching buttons
  document.getElementById("btnLectureTab_SYNC")?.addEventListener("click", () => {
    if (typeof switchLectureStageTab === "function") {
      switchLectureStageTab("sync");
    }
  });

  document.getElementById("btnLectureTab_TAFRIGH")?.addEventListener("click", () => {
    if (typeof switchLectureStageTab === "function") {
      switchLectureStageTab("tafrigh");
    }
    // no result yet (and nothing running): the preview is the default view
    if (!(currentState.tafrigh && currentState.tafrigh.hasRun) && !tafrighRunInFlight) openTafrighPrep();
  });

  // Markdown copy button
  document.getElementById("btnCopyTafrighMarkdown")?.addEventListener("click", () => {
    const md = currentState.tafrigh?.data?.markdown;
    if (!md) {
      showToast("⚠️ لا يوجد نص Markdown متوفر للنسخ");
      return;
    }
    navigator.clipboard.writeText(md).then(() => {
      showToast("📋 تم نسخ التفريغ المهيكل بصيغة Markdown إلى الحافظة");
    }).catch(() => {
      showToast("❌ تعذر النسخ إلى الحافظة");
    });
  });

  // Export HTML button
  document.getElementById("btnExportTafrighHtml")?.addEventListener("click", () => {
    const htmlContent = currentState.tafrigh?.data?.html;
    if (!htmlContent) {
      showToast("⚠️ لا يوجد محتوى HTML جاهز للتصدير");
      return;
    }
    const fullHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>التفريغ المهيكل — Wahy Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Tajawal:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Tajawal', sans-serif;
      background-color: #020617;
      color: #e2e8f0;
      padding: 2.5rem 1.5rem;
      max-width: 860px;
      margin: 0 auto;
      line-height: 2;
    }
    .tafrigh-matn-block {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.1));
      border-right: 4px solid #f59e0b;
      border-radius: 0.5rem;
      padding: 0.85rem 1.25rem;
      margin: 1.25rem 0;
      font-family: 'Amiri', serif;
      font-size: 1.35rem;
      line-height: 2.3;
      color: #fef3c7;
    }
    .tafrigh-matn-block .tafrigh-label {
      color: #fbbf24;
      font-weight: 700;
      margin-left: 0.5rem;
    }
    .tafrigh-sharh-block {
      margin-top: 1.25rem;
      margin-bottom: 0.5rem;
    }
    .tafrigh-sharh-block .tafrigh-label {
      color: #38bdf8;
      font-weight: 700;
      font-size: 1.2rem;
      border-bottom: 2px solid rgba(56, 189, 248, 0.3);
      padding-bottom: 0.2rem;
      display: inline-block;
    }
    .tafrigh-heading {
      color: #38bdf8;
      font-weight: 700;
      margin: 2rem 0 0.85rem 0;
    }
    .tafrigh-list-intro {
      font-weight: 600;
      color: #e2e8f0;
      margin-top: 1rem;
    }
    .tafrigh-list-item {
      margin: 0.35rem 1.5rem;
      list-style-type: disc;
      color: #cbd5e1;
    }
    .tafrigh-comment {
      background-color: rgba(100, 116, 139, 0.15);
      border: 1px dashed rgba(148, 163, 184, 0.4);
      border-radius: 0.5rem;
      padding: 0.6rem 0.85rem;
      margin: 0.85rem 0;
      color: #94a3b8;
      font-style: italic;
    }
    .tafrigh-comment-badge {
      display: inline-block;
      background-color: rgba(148, 163, 184, 0.25);
      color: #e2e8f0;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.1rem 0.4rem;
      border-radius: 0.25rem;
      margin-left: 0.35rem;
      font-style: normal;
    }
    .tafrigh-paragraph {
      margin: 0.75rem 0;
      text-align: justify;
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tafrigh_lecture_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("📥 تم تصدير صفحة التفريغ بصيغة HTML");
  });

  document.getElementById("btnSnapAllToCanonical")?.addEventListener("click", () => {
    pushUndoSnapshot("تبديل الرسم القياسي لجميع المقتبسات");
    currentState.snapAllToCanonical = !currentState.snapAllToCanonical;
    currentState.detections.forEach(d => {
      d.snappedToCanonical = currentState.snapAllToCanonical;
    });
    const btn = document.getElementById("btnSnapAllToCanonical");
    if (btn) {
      btn.textContent = currentState.snapAllToCanonical
        ? "✨ الرسم القياسي: مفعّل"
        : "✨ توحيد بالرسم القياسي";
    }
    recalculateCaptionsFromCurrentFindings();
    showToast(
      currentState.snapAllToCanonical
        ? "✅ تم استبدال جميع الآيات والأحاديث بالرسم العثماني والقياسي المعتمد"
        : "↩️ تمت استعادة إملاء التفريغ الأصلي"
    );
  });

  // ---------------------------------------------------------------------------
  // Floating Text Selection Toolbar -> Direct FN Studio Integration
  // ---------------------------------------------------------------------------
  document.addEventListener("selectionchange", () => {
    handleLectureSelectionChange();
  });

  document.getElementById("btnFloatingOpenFnStudio")?.addEventListener("click", () => {
    const span = currentState.pendingSelectionSpan;
    if (!span) return;
    openFnStudioWithWordRange(span.wordStartIdx, span.wordEndIdx, null);
  });
  document.getElementById("btnFloatingMarkAyah")?.addEventListener("click", () => {
    const span = currentState.pendingSelectionSpan;
    if (!span) return;
    openFnStudioWithWordRange(span.wordStartIdx, span.wordEndIdx, "ayah");
  });
  document.getElementById("btnFloatingMarkHadith")?.addEventListener("click", () => {
    const span = currentState.pendingSelectionSpan;
    if (!span) return;
    openFnStudioWithWordRange(span.wordStartIdx, span.wordEndIdx, "hadith");
  });
  document.getElementById("btnFloatingMarkDhikr")?.addEventListener("click", () => {
    const span = currentState.pendingSelectionSpan;
    if (!span) return;
    openFnStudioWithWordRange(span.wordStartIdx, span.wordEndIdx, "dhikr");
  });

  // Corpus Reference Search Modal (for re-linking existing finding)
  document.getElementById("btnCloseCorpusSearchModal")?.addEventListener("click", () => {
    closeModalById("corpusSearchModal");
  });
  document.getElementById("inpModalCorpusSearch")?.addEventListener("input", () => {
    renderCorpusModalSearchResults();
  });
  document.getElementById("selModalCorpusCategory")?.addEventListener("change", () => {
    renderCorpusModalSearchResults();
  });
  document.getElementById("btnCommitCustomRefModal")?.addEventListener("click", () => {
    commitModalCorpusSelection(null);
  });

  // ---------------------------------------------------------------------------
  // Datasets & Adhkar Management Studio Event Listeners (#section_datasets)
  // ---------------------------------------------------------------------------
  ["ADHKAR", "OUTSIDE_CORPUS", "QURAN", "HADITH"].forEach(tabKey => {
    document.getElementById(`btnDsTab_${tabKey}`)?.addEventListener("click", () => {
      currentState.datasetBrowser.activeTab = tabKey;
      currentState.datasetBrowser.page = 1;
      renderDatasetsSection();
    });
  });

  // Engine choice (settings dropdown + toolbar dropdown stay in sync) and one-click re-run on the current transcript
  const engineSelects = ["selEngineVersion", "selEngineVersionQuick"].map(id => document.getElementById(id)).filter(Boolean);
  let savedEngine = "v3";
  try { savedEngine = localStorage.getItem("wahyEngine") === "v4" ? "v4" : "v3"; } catch (e) { /* storage blocked */ }
  const applyEngine = (choice, rerun) => {
    try { localStorage.setItem("wahyEngine", choice); } catch (e) { /* storage blocked */ }
    engineSelects.forEach(el => { el.value = choice; });
    rebuildMatcher();
    if (rerun && currentState.rawTranscript) runDetectionAndBuildCaptions();
    const isV4 = typeof WahyEngine !== "undefined" && activeMatcher instanceof WahyEngine;
    showToast(choice === "v4" && !isV4 ? "⚠ تعذّر تشغيل v4، تم استخدام v3" : `✓ المحرك الحالي: ${isV4 ? "v4" : "v3"}`);
  };
  engineSelects.forEach(el => {
    el.value = savedEngine;
    el.addEventListener("change", () => applyEngine(el.value, true));
  });
  document.getElementById("btnRerunEngine")?.addEventListener("click", () => {
    if (!currentState.rawTranscript) { showToast("لا يوجد نص لإعادة فحصه بعد"); return; }
    rebuildMatcher();
    runDetectionAndBuildCaptions();
    showToast(`🔄 تمت إعادة تشغيل المحرك (${typeof WahyEngine !== "undefined" && activeMatcher instanceof WahyEngine ? "v4" : "v3"})`);
  });

  document.getElementById("chkToggleAdhkarEngine")?.addEventListener("change", (e) => {
    currentState.adhkarEnabled = e.target.checked;
    rebuildMatcher();
    if (currentState.rawTranscript) runDetectionAndBuildCaptions();
    showToast(currentState.adhkarEnabled ? "✓ تم تفعيل اكتشاف الأذكار والأدعية في المحرك" : "✕ تم إيقاف اكتشاف الأذكار مؤقتاً");
  });

  document.getElementById("btnAddAdhkarItem")?.addEventListener("click", () => {
    const inpT = document.getElementById("inpNewAdhkarText");
    const inpR = document.getElementById("inpNewAdhkarRef");
    const txt = (inpT ? inpT.value : "").trim();
    const ref = (inpR && inpR.value.trim()) ? inpR.value.trim() : "ذكر مأثور";
    const added = registerOutsideDhikrInDataset(txt, ref, ref);
    if (added) {
      if (inpT) inpT.value = "";
      if (inpR) inpR.value = "";
      currentState.datasetBrowser.activeTab = "ADHKAR";
      currentState.datasetBrowser.page = 1;
      renderDatasetsSection();
      if (currentState.rawTranscript) runDetectionAndBuildCaptions();
      showToast(`📿 تمت إضافة الذكر «${ref}» وتحديث محرك الاكتشاف فوراً!`);
    }
  });

  document.getElementById("btnAddOutsideHadithItem")?.addEventListener("click", () => {
    const inpT = document.getElementById("inpNewOutsideHadithText");
    const inpR = document.getElementById("inpNewOutsideHadithRef");
    const txt = (inpT ? inpT.value : "").trim();
    const ref = (inpR && inpR.value.trim()) ? inpR.value.trim() : "حديث خارج القاعدة";
    if (!txt || txt.split(/\s+/).length < 2) {
      showToast("⚠️ يرجى إدخال متن الحديث أو الأثر (كلمتان على الأقل).");
      return;
    }
    registerOutsideCorpusHadithInDataset(txt, ref);
    if (inpT) inpT.value = "";
    if (inpR) inpR.value = "";
    currentState.datasetBrowser.activeTab = "OUTSIDE_CORPUS";
    currentState.datasetBrowser.page = 1;
    renderDatasetsSection();
    if (currentState.rawTranscript) runDetectionAndBuildCaptions();
    showToast("📌 تمت إضافة الحديث خارج القاعدة وتحديث المحرك!");
  });

  document.getElementById("inpDatasetBrowserSearch")?.addEventListener("input", (e) => {
    currentState.datasetBrowser.searchQuery = e.target.value;
    currentState.datasetBrowser.page = 1;
    renderDatasetsSection();
  });

  document.getElementById("selDatasetAdhkarFilter")?.addEventListener("change", (e) => {
    currentState.datasetBrowser.adhkarFilter = e.target.value;
    currentState.datasetBrowser.page = 1;
    renderDatasetsSection();
  });

  document.getElementById("selDatasetBrowserSurah")?.addEventListener("change", (e) => {
    currentState.datasetBrowser.surahFilter = e.target.value;
    currentState.datasetBrowser.page = 1;
    renderDatasetsSection();
  });

  document.getElementById("selDatasetBrowserBook")?.addEventListener("change", (e) => {
    currentState.datasetBrowser.bookFilter = e.target.value;
    currentState.datasetBrowser.page = 1;
    renderDatasetsSection();
  });

  document.getElementById("btnDatasetPrevPage")?.addEventListener("click", () => {
    if (currentState.datasetBrowser.page > 1) {
      currentState.datasetBrowser.page--;
      renderDatasetsSection();
    }
  });

  document.getElementById("btnDatasetNextPage")?.addEventListener("click", () => {
    currentState.datasetBrowser.page++;
    renderDatasetsSection();
  });

  document.getElementById("btnExportAdhkarJson")?.addEventListener("click", () => {
    const jsonStr = JSON.stringify(RAW_ADHKAR_DATA, null, 2);
    triggerFileDownload(`wahy-adhkar-${new Date().toISOString().slice(0, 10)}.json`, jsonStr, "application/json;charset=utf-8");
    showToast("📤 تم تصدير قاعدة بيانات الأذكار بصيغة JSON");
  });

  document.getElementById("btnImportAdhkarJson")?.addEventListener("click", () => {
    document.getElementById("fileInputAdhkarJson")?.click();
  });

  document.getElementById("fileInputAdhkarJson")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.adhkar) ? parsed.adhkar : []);
      if (!list.length) {
        showToast("⚠️ الملف لا يحتوي على مصفوفة أذكار صالحة.");
        return;
      }
      let added = 0;
      const seenNorm = new Set(RAW_ADHKAR_DATA.map(x => normalizeArabic(x.t)));
      list.forEach(item => {
        const t = typeof item === "string" ? item.trim() : String(item.t || item.text || item.zekr || "").trim();
        const ref = typeof item === "object" ? String(item.ref || item.category || "ذكر مستورد").trim() : "ذكر مستورد";
        if (t && t.length >= 6) {
          const norm = normalizeArabic(t);
          if (!seenNorm.has(norm)) {
            seenNorm.add(norm);
            RAW_ADHKAR_DATA.unshift({
              id: item?.id || `Adhkar:import_${Date.now()}_${added + 1}`,
              category: ref,
              ref,
              t,
              isCustom: true
            });
            added++;
          }
        }
      });
      persistUserDatasetsToStorage();
      rebuildMatcher();
      renderDatasetsSection();
      if (currentState.rawTranscript) runDetectionAndBuildCaptions();
      showToast(`✅ تم استيراد وإضافة ${added} ذكراً جديداً إلى القاعدة!`);
    } catch (err) {
      showToast("⚠️ تعذر قراءة ملف JSON المستورد.");
    }
    e.target.value = "";
  });

  document.getElementById("btnResetDefaultAdhkar")?.addEventListener("click", () => {
    if (!confirm("استعادة الأذكار المدمجة فقط؟ ستُحذف الأذكار التي أضفتها بنفسك (يمكنك تصديرها أولاً).")) return;
    RAW_ADHKAR_DATA = BUILTIN_ADHKAR_DATA.map(x => ({ ...x }));
    persistUserDatasetsToStorage();
    rebuildMatcher();
    renderDatasetsSection();
    if (currentState.rawTranscript) runDetectionAndBuildCaptions();
    showToast(`↺ تمت استعادة الأذكار المدمجة (${BUILTIN_ADHKAR_DATA.length} ذكراً) — حُذفت إضافاتك`);
  });

  // Table Row Actions in Dataset Browser
  document.getElementById("tbodyDatasetBrowserRows")?.addEventListener("click", (e) => {
    const saveAdhkarBtn = e.target.closest(".btn-save-adhkar-row");
    if (saveAdhkarBtn) {
      const id = saveAdhkarBtn.getAttribute("data-save-adhkar-id");
      const txtInp = document.querySelector(`.inp-adhkar-row-text[data-adhkar-edit-id="${id}"]`);
      const refInp = document.querySelector(`.inp-adhkar-row-ref[data-adhkar-ref-id="${id}"]`);
      const item = RAW_ADHKAR_DATA.find(x => x.id === id);
      if (item && txtInp && txtInp.value.trim()) {
        item.t = txtInp.value.trim();
        if (refInp && refInp.value.trim()) {
          item.ref = refInp.value.trim();
          item.category = refInp.value.trim();
        }
        persistUserDatasetsToStorage();
        rebuildMatcher();
        if (currentState.rawTranscript) runDetectionAndBuildCaptions();
        showToast("💾 تم حفظ تعديل الذكر وتحديث الفهرس والمحاضرة!");
      }
      return;
    }

    const delAdhkarBtn = e.target.closest(".btn-del-adhkar-row");
    if (delAdhkarBtn) {
      const id = delAdhkarBtn.getAttribute("data-del-adhkar-id");
      const idx = RAW_ADHKAR_DATA.findIndex(x => x.id === id);
      if (idx !== -1) {
        RAW_ADHKAR_DATA.splice(idx, 1);
        persistUserDatasetsToStorage();
        rebuildMatcher();
        renderDatasetsSection();
        if (currentState.rawTranscript) runDetectionAndBuildCaptions();
        showToast("🗑️ تم حذف الذكر من قاعدة الأذكار");
      }
      return;
    }

    const saveOutsideBtn = e.target.closest(".btn-save-outside-row");
    if (saveOutsideBtn) {
      const id = saveOutsideBtn.getAttribute("data-save-outside-id");
      const txtInp = document.querySelector(`.inp-outside-row-text[data-outside-text-id="${id}"]`);
      const refInp = document.querySelector(`.inp-outside-row-ref[data-outside-ref-id="${id}"]`);
      const item = RAW_OUTSIDE_HADITH_DATA.find(x => x.id === id);
      if (item && txtInp && txtInp.value.trim()) {
        item.t = txtInp.value.trim();
        item.ref = (refInp && refInp.value.trim()) ? refInp.value.trim() : "حديث خارج القاعدة";
        persistUserDatasetsToStorage();
        rebuildMatcher();
        if (currentState.rawTranscript) runDetectionAndBuildCaptions();
        showToast("💾 تم حفظ تعديل المقتبس خارج القاعدة");
      }
      return;
    }

    const delOutsideBtn = e.target.closest(".btn-del-outside-row");
    if (delOutsideBtn) {
      const id = delOutsideBtn.getAttribute("data-del-outside-id");
      const idx = RAW_OUTSIDE_HADITH_DATA.findIndex(x => x.id === id);
      if (idx !== -1) {
        RAW_OUTSIDE_HADITH_DATA.splice(idx, 1);
        persistUserDatasetsToStorage();
        rebuildMatcher();
        renderDatasetsSection();
        if (currentState.rawTranscript) runDetectionAndBuildCaptions();
        showToast("🗑️ تم حذف العنصر من قائمة خارج القاعدة");
      }
      return;
    }

    const copyBtn = e.target.closest(".btn-copy-corpus-row");
    if (copyBtn) {
      const txt = copyBtn.getAttribute("data-copy-corpus-text") || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).catch(() => {});
      }
      showToast("📋 تم نسخ النص إلى الحافظة");
    }
  });

  // ---------------------------------------------------------------------------
  // Video/Audio Player Sync & Controls
  // ---------------------------------------------------------------------------
  const videoEl = document.getElementById("wahyVideoPlayer");
  if (videoEl) {
    videoEl.addEventListener("timeupdate", () => {
      updateVideoCaptionOverlay(videoEl.currentTime);
    });
    videoEl.addEventListener("loadedmetadata", () => {
      if (videoEl.duration && !isNaN(videoEl.duration)) {
        currentState.duration = videoEl.duration;
      }
    });
    videoEl.addEventListener("play", () => {
      currentState.isPlaying = true;
      if (typeof syncPlayPauseButtonsUI === "function") syncPlayPauseButtonsUI(true);
    });
    videoEl.addEventListener("pause", () => {
      currentState.isPlaying = false;
      if (typeof syncPlayPauseButtonsUI === "function") syncPlayPauseButtonsUI(false);
    });
  }

  document.getElementById("btnTogglePlayPause")?.addEventListener("click", () => {
    toggleSimulatedPlayback();
  });
  document.getElementById("btnPlayerBack5s")?.addEventListener("click", () => {
    seekToMediaTimestamp(Math.max(0, currentState.currentTime - 5.0), false);
  });
  document.getElementById("btnPlayerForward5s")?.addEventListener("click", () => {
    seekToMediaTimestamp(currentState.currentTime + 5.0, false);
  });

  document.getElementById("playerTimelineSlider")?.addEventListener("input", (e) => {
    const sec = parseFloat(e.target.value || "0");
    seekToMediaTimestamp(sec, false);
  });

  // ---------------------------------------------------------------------------
  // Export Modal Buttons
  // ---------------------------------------------------------------------------
  document.getElementById("btnExportStyledHtml")?.addEventListener("click", () => exportLectureAsStyledHTML());
  document.getElementById("btnExportPrintPdf")?.addEventListener("click", () => {
    closeModalById("exportModal");
    exportLectureAsPrintSheet();
  });
  document.getElementById("btnExportMarkdown")?.addEventListener("click", () => exportLectureAsMarkdown());
  document.getElementById("btnExportPlainTxt")?.addEventListener("click", () => exportLectureAsPlainText());
  document.getElementById("btnExportJson")?.addEventListener("click", () => exportLectureAsJSON());

  document.getElementById("btnExportSrt")?.addEventListener("click", () => {
    const srt = exportCaptionsToSRT(currentState.captions);
    triggerFileDownload("wahy-captions.srt", srt, "text/plain;charset=utf-8");
    showToast("🎬 تم تصدير ملف الترجمة بصيغة .SRT");
  });

  document.getElementById("btnExportVtt")?.addEventListener("click", () => {
    const vtt = exportCaptionsToVTT(currentState.captions);
    triggerFileDownload("wahy-captions.vtt", vtt, "text/vtt;charset=utf-8");
    showToast("🎬 تم تصدير ملف الترجمة الملونة بصيغة .VTT");
  });

  document.getElementById("btnExportAss")?.addEventListener("click", () => {
    const ass = exportCaptionsToASS(currentState.captions, currentState.lectureTitle);
    triggerFileDownload("wahy-captions.ass", ass, "text/plain;charset=utf-8");
    showToast("🎬 تم تصدير ملف الترجمة المتقدمة بصيغة .ASS");
  });

  // ---------------------------------------------------------------------------
  // AI Verification & Laya Studio Event Listeners
  // ---------------------------------------------------------------------------
  function initAiVerificationEventListeners() {
    const selQuickProv = document.getElementById("selAiQuickProvider");
    if (selQuickProv) {
      selQuickProv.value = currentState.aiVerification.activeProvider || "gemini";
      selQuickProv.addEventListener("change", (e) => {
        currentState.aiVerification.activeProvider = e.target.value;
        saveAiConfigToStorage();
        if (typeof updateAiLaunchButtonLabel === "function") updateAiLaunchButtonLabel();
      });
    }

    document.getElementById("btnGoToAiLogsTab")?.addEventListener("click", () => {
      switchMainSection("ai_logs");
    });

    const btnStart = document.getElementById("btnStartAiVerification");
    const launchWrap = document.getElementById("wrapAiLaunchSplit") || btnStart;
    const btnStartFromLogs = document.getElementById("btnRunAiVerificationFromLogs");
    const btnPause = document.getElementById("btnPauseAiVerification");
    const btnCancel = document.getElementById("btnCancelAiVerification");
    const wrapProgress = document.getElementById("aiVerificationProgressWrap");
    const barProgress = document.getElementById("aiVerificationProgressBar");
    const lblStatus = document.getElementById("aiVerificationStatusMsg");
    const lblPercent = document.getElementById("aiVerificationPercentLabel");

    let isAiVerificationRunning = false;
    const triggerVerification = async (selectedIndices = null) => {
      if (isAiVerificationRunning) {
        showToast("⏳ يوجد تدقيق ذكي قيد التشغيل بالفعل.");
        return;
      }
      if (!currentState.detections.length) {
        showToast("⚠️ لا توجد مقتبسات لفحصها. يرجى تفريغ محاضرة أولاً.");
        return;
      }

      if (launchWrap) launchWrap.classList.add("hidden");
      if (btnPause) {
        btnPause.classList.remove("hidden");
        btnPause.textContent = "⏸ إيقاف مؤقت";
      }
      if (btnCancel) btnCancel.classList.remove("hidden");
      if (wrapProgress) wrapProgress.classList.remove("hidden");

      isAiVerificationRunning = true;
      try {
        const summary = await WahyAiVerifier.runBatchAiVerification((p) => {
          const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
          if (barProgress) barProgress.style.width = `${pct}%`;
          if (lblPercent) lblPercent.textContent = `${pct}% (${p.processed}/${p.total})`;
          if (lblStatus) lblStatus.textContent = p.message || "جاري الفحص...";
        }, selectedIndices);
        if (summary && summary.failed) {
          showToast(`⚠️ اكتمل التدقيق مع ${summary.failed} طلب فاشل من ${summary.total} — راجع السبب في فاحص المقتبس أو سجل الطلبات.`);
        } else if (summary && !summary.cancelled) {
          showToast("✅ اكتمل الفحص والتدقيق الذكي للمقتبسات بنجاح!");
        }
      } catch (err) {
        showToast(`⚠️ تنبيه التدقيق: ${err.message}`);
      } finally {
        isAiVerificationRunning = false;
        if (launchWrap) launchWrap.classList.remove("hidden");
        if (btnPause) btnPause.classList.add("hidden");
        if (btnCancel) btnCancel.classList.add("hidden");
        setTimeout(() => {
          if (wrapProgress) wrapProgress.classList.add("hidden");
        }, 4000);
      }
    };

    window.triggerAiVerification = triggerVerification;
    window.isAiVerificationRunning = () => isAiVerificationRunning;

    btnStart?.addEventListener("click", () => triggerVerification());
    btnStartFromLogs?.addEventListener("click", () => {
      switchMainSection("display");
      triggerVerification();
    });

    let isPaused = false;
    btnPause?.addEventListener("click", () => {
      if (!isPaused) {
        WahyAiVerifier.pauseAiVerification();
        btnPause.textContent = "▶ استئناف";
        if (lblStatus) lblStatus.textContent = "⏸ الفحص متوقف مؤقتاً...";
        isPaused = true;
      } else {
        WahyAiVerifier.resumeAiVerification();
        btnPause.textContent = "⏸ إيقاف مؤقت";
        if (lblStatus) lblStatus.textContent = "جاري استئناف الفحص...";
        isPaused = false;
      }
    });

    btnCancel?.addEventListener("click", () => {
      WahyAiVerifier.cancelAiVerification();
      isPaused = false;
    });

    // AI Verdict Filter Checkboxes & Presets
    const filterKeys = [
      { id: "chkFilterShowCorrect", key: "showCorrect" },
      { id: "chkFilterShowNotSure", key: "showNotSure" },
      { id: "chkFilterShowFalse", key: "showFalse" },
      { id: "chkFilterShowUnverified", key: "showUnverified" }
    ];

    function syncFilterPillUI() {
      filterKeys.forEach(item => {
        const chk = document.getElementById(item.id);
        const val = currentState.aiVerification.visibilityFilter[item.key];
        if (chk) {
          chk.checked = Boolean(val);
          const parentPill = chk.closest(".ai-filter-pill");
          if (parentPill) {
            parentPill.classList.toggle("active", Boolean(val));
          }
        }
      });
    }
    syncFilterPillUI();

    filterKeys.forEach(item => {
      const chk = document.getElementById(item.id);
      if (!chk) return;
      chk.addEventListener("change", (e) => {
        currentState.aiVerification.visibilityFilter[item.key] = e.target.checked;
        syncFilterPillUI();
        saveAiConfigToStorage();
        renderFormattedLectureView();
        recalculateCaptionsFromCurrentFindings();
      });
    });

    document.getElementById("btnFilterPreset_ALL")?.addEventListener("click", () => {
      currentState.aiVerification.visibilityFilter = { showCorrect: true, showNotSure: true, showFalse: true, showUnverified: true, showClippedOnly: false };
      syncFilterPillUI();
      saveAiConfigToStorage();
      renderFormattedLectureView();
      recalculateCaptionsFromCurrentFindings();
      if (typeof updateAiMetricsUI === "function") updateAiMetricsUI();
      showToast("عرض كل المقتبسات (الصحيح وغير المتأكد والمستبعد)");
    });

    document.getElementById("btnFilterPreset_CORRECT_ONLY")?.addEventListener("click", () => {
      currentState.aiVerification.visibilityFilter = { showCorrect: true, showNotSure: false, showFalse: false, showUnverified: false, showClippedOnly: false };
      syncFilterPillUI();
      saveAiConfigToStorage();
      renderFormattedLectureView();
      recalculateCaptionsFromCurrentFindings();
      if (typeof updateAiMetricsUI === "function") updateAiMetricsUI();
      showToast("عرض المقتبسات الصحيحة المؤكدة فقط");
    });

    document.getElementById("btnFilterPreset_FALSE_ONLY")?.addEventListener("click", () => {
      currentState.aiVerification.visibilityFilter = { showCorrect: false, showNotSure: false, showFalse: true, showUnverified: false, showClippedOnly: false };
      syncFilterPillUI();
      saveAiConfigToStorage();
      renderFormattedLectureView();
      recalculateCaptionsFromCurrentFindings();
      if (typeof updateAiMetricsUI === "function") updateAiMetricsUI();
      showToast("عرض المقتبسات المستبعدة (الكلام العادي) للمراجعة");
    });

    document.getElementById("btnFilterOnlyClipped")?.addEventListener("click", () => {
      currentState.aiVerification.visibilityFilter.showClippedOnly = !currentState.aiVerification.visibilityFilter.showClippedOnly;
      const isClippedOnly = currentState.aiVerification.visibilityFilter.showClippedOnly;
      const btn = document.getElementById("btnFilterOnlyClipped");
      if (btn) btn.classList.toggle("btn-filter-clipped-active", isClippedOnly);
      saveAiConfigToStorage();
      renderFormattedLectureView();
      recalculateCaptionsFromCurrentFindings();
      showToast(isClippedOnly ? "✂️ تصفية المقتبسات ناقصة الحدود فقط" : "إلغاء تصفية المقتبسات ناقصة الحدود");
    });

    // Gemini Settings Save
    document.getElementById("btnSaveGeminiConfig")?.addEventListener("click", () => {
      currentState.aiVerification.geminiApiKey = document.getElementById("inpGeminiApiKey")?.value?.trim() || "";
      currentState.aiVerification.geminiModel = document.getElementById("selGeminiModel")?.value || "gemini-3.5-flash-lite";
      currentState.aiVerification.geminiFreeTierMode = document.getElementById("chkGeminiFreeTierMode")?.checked !== false;
      currentState.aiVerification.geminiRpmLimit = parseInt(document.getElementById("inpGeminiRpmLimit")?.value || "12", 10);
      currentState.aiVerification.geminiBatchSize = parseInt(document.getElementById("inpGeminiBatchSize")?.value || "5", 10);
      saveAiConfigToStorage();
      showToast("✅ تم حفظ إعدادات Google Gemini بنجاح");
    });

    // OpenRouter Mode Switch
    const btnOrJev = document.getElementById("btnOpenRouterMode_jev");
    const btnOrChat = document.getElementById("btnOpenRouterMode_chat");
    const wrapOrJev = document.getElementById("wrapOpenRouterJevConfig");
    const wrapOrChat = document.getElementById("wrapOpenRouterChatConfig");
    const badgeOrStatus = document.getElementById("badgeOpenRouterModeStatus");

    function setOpenRouterModeUI(mode) {
      currentState.aiVerification.openRouterMode = mode;
      if (mode === "jev") {
        btnOrJev?.classList.add("bg-indigo-600/30", "text-indigo-300", "border-indigo-500/50");
        btnOrJev?.classList.remove("text-slate-400");
        btnOrChat?.classList.remove("bg-indigo-600/30", "text-indigo-300", "border-indigo-500/50");
        btnOrChat?.classList.add("text-slate-400");
        wrapOrJev?.classList.remove("hidden");
        wrapOrChat?.classList.add("hidden");
        if (badgeOrStatus) {
          badgeOrStatus.textContent = "JEV Decisions API";
          badgeOrStatus.className = "px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-bold";
        }
      } else {
        btnOrChat?.classList.add("bg-indigo-600/30", "text-indigo-300", "border-indigo-500/50");
        btnOrChat?.classList.remove("text-slate-400");
        btnOrJev?.classList.remove("bg-indigo-600/30", "text-indigo-300", "border-indigo-500/50");
        btnOrJev?.classList.add("text-slate-400");
        wrapOrChat?.classList.remove("hidden");
        wrapOrJev?.classList.add("hidden");
        if (badgeOrStatus) {
          badgeOrStatus.textContent = "Universal Chat API";
          badgeOrStatus.className = "px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-bold";
        }
      }
    }

    // Picking a mode in the studio card also makes it the provider the next run uses
    function selectOpenRouterProvider(mode) {
      setOpenRouterModeUI(mode);
      currentState.aiVerification.activeProvider = mode === "chat" ? "openrouter_chat" : "openrouter_jev";
      if (selQuickProv) selQuickProv.value = currentState.aiVerification.activeProvider;
      saveAiConfigToStorage();
      if (typeof updateAiLaunchButtonLabel === "function") updateAiLaunchButtonLabel();
    }

    btnOrJev?.addEventListener("click", () => selectOpenRouterProvider("jev"));
    btnOrChat?.addEventListener("click", () => {
      selectOpenRouterProvider("chat");
      WahyAiVerifier.fetchOpenRouterModelsCatalog().then(renderOpenRouterDropdown);
    });
    setOpenRouterModeUI(currentState.aiVerification.openRouterMode || "jev");

    // OpenRouter Live Model Search & Chips
    const inpSearchModel = document.getElementById("inpOpenRouterModelSearch");
    const dropdownList = document.getElementById("openRouterModelDropdownList");
    let activeCategoryFilter = "all";

    function renderOpenRouterDropdown() {
      if (!dropdownList) return;
      const catalog = currentState.aiVerification.openRouterModelsCatalog || [];
      const q = (inpSearchModel?.value || "").toLowerCase().trim();

      const filtered = catalog.filter(m => {
        if (activeCategoryFilter === "jev" && !m.isJev) return false;
        if (activeCategoryFilter === "gemini" && !m.isGemini) return false;
        if (activeCategoryFilter === "chinese" && !m.isChinese) return false;
        if (activeCategoryFilter === "free" && !m.isFree) return false;

        if (!q) return true;
        return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
      });

      if (!filtered.length) {
        dropdownList.innerHTML = `<div class="p-3 text-slate-400 text-center">لا توجد نماذج مطابقة. جرب البحث باسم آخر.</div>`;
        dropdownList.classList.remove("hidden");
        return;
      }

      dropdownList.innerHTML = filtered.slice(0, 40).map(m => {
        const priceIn = (parseFloat(m.pricing.prompt || 0) * 1000000).toFixed(3);
        const priceOut = (parseFloat(m.pricing.completion || 0) * 1000000).toFixed(3);
        const isSelected = currentState.aiVerification.openRouterSelectedModel === m.id;
        return `
          <div class="model-dropdown-item ${isSelected ? "selected" : ""}" data-model-id="${escapeHtml(m.id)}">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-slate-200">${escapeHtml(m.name)}</span>
              <span class="font-mono text-[10px] text-emerald-400">$${priceIn} / $${priceOut} (1M)</span>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
              <span class="font-mono">${escapeHtml(m.id)}</span>
              <span>سياق: ${Math.round(m.context_length / 1024)}k</span>
            </div>
          </div>
        `;
      }).join("");

      dropdownList.querySelectorAll(".model-dropdown-item").forEach(item => {
        item.addEventListener("click", () => {
          const pickedId = item.getAttribute("data-model-id");
          currentState.aiVerification.openRouterSelectedModel = pickedId;
          const displayLabel = document.getElementById("lblOpenRouterSelectedModelDisplay");
          if (displayLabel) displayLabel.textContent = pickedId;
          dropdownList.classList.add("hidden");
          saveAiConfigToStorage();
          showToast(`🎯 تم اختيار النموذج: ${pickedId}`);
        });
      });

      dropdownList.classList.remove("hidden");
    }

    inpSearchModel?.addEventListener("input", renderOpenRouterDropdown);
    inpSearchModel?.addEventListener("focus", () => {
      WahyAiVerifier.fetchOpenRouterModelsCatalog().then(renderOpenRouterDropdown);
    });

    const chips = [
      { id: "chipCatAll", cat: "all" },
      { id: "chipCatJev", cat: "jev" },
      { id: "chipCatGemini", cat: "gemini" },
      { id: "chipCatChinese", cat: "chinese" },
      { id: "chipCatFree", cat: "free" }
    ];

    chips.forEach(c => {
      document.getElementById(c.id)?.addEventListener("click", () => {
        activeCategoryFilter = c.cat;
        chips.forEach(other => {
          const el = document.getElementById(other.id);
          if (other.id === c.id) {
            el.className = "px-1.5 py-0.5 rounded bg-indigo-600 text-white font-bold";
          } else {
            el.className = "px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300";
          }
        });
        renderOpenRouterDropdown();
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("#wrapOpenRouterChatConfig")) {
        dropdownList?.classList.add("hidden");
      }
    });

    document.getElementById("btnSaveOpenRouterConfig")?.addEventListener("click", () => {
      currentState.aiVerification.openRouterApiKey = document.getElementById("inpOpenRouterApiKey")?.value?.trim() || "";
      currentState.aiVerification.openRouterJevModel = document.getElementById("selOpenRouterJevModel")?.value || "typesafe/jev-1.14";
      saveAiConfigToStorage();
      showToast("✅ تم حفظ إعدادات OpenRouter بنجاح");
    });

    // Local Laya Controls
    document.getElementById("selLayaCheckpointOption")?.addEventListener("change", (e) => {
      const isCustom = e.target.value === "custom";
      document.getElementById("inpLayaCustomPath")?.classList.toggle("hidden", !isCustom);
    });

    document.getElementById("btnLoadLayaEngine")?.addEventListener("click", async () => {
      const isCustom = document.getElementById("selLayaCheckpointOption")?.value === "custom";
      const customPath = document.getElementById("inpLayaCustomPath")?.value?.trim() || "";
      const ckpt = isCustom && customPath ? customPath : "convaiinnovations/laya-multilingual";
      const dev = document.getElementById("selLayaDeviceChoice")?.value || "auto";

      showToast("⏳ جاري تحميل نموذج Laya-Multilingual (3GB Safe)...");
      try {
        const res = await fetch("/api/laya/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkpoint: ckpt, device: dev })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        checkAndUpdateLayaBackendStatus();
        showToast(`✅ تم تحميل Laya بنجاح على: ${data.device === "cuda" ? "البطاقة الرسومية CUDA FP16" : "المعالج المركزي CPU"}`);
      } catch (err) {
        showToast(`❌ فشل تحميل Laya: ${err.message}`);
      }
    });

    document.getElementById("btnUnloadLayaEngine")?.addEventListener("click", async () => {
      try {
        await fetch("/api/laya/unload", { method: "POST" });
        checkAndUpdateLayaBackendStatus();
        showToast("⏹ تم تفريغ نموذج Laya وتنظيف ذاكرة البطاقة بالكامل.");
      } catch (err) {
        showToast(`خطأ في تفريغ الذاكرة: ${err.message}`);
      }
    });

    document.getElementById("btnTestLayaPredict")?.addEventListener("click", async () => {
      showToast("🧪 جاري فحص استدلال تجريبي على Laya...");
      try {
        const testEnv = {
          state: {
            source_type: "HADITH",
            candidate_reference: "صحيح البخاري (1)",
            canonical_corpus_text: "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
            context_before: "وقال النبي صلى الله عليه وسلم في الحديث المشهور:",
            matched_span_in_lecture: "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
            context_after: "فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله"
          },
          questions: {
            verdict: {
              type: "choice",
              instructions: "Determine if matched_span_in_lecture is a quote.",
              criteria: { CORRECT: "True quote", FALSE: "False positive", NOT_SURE: "Unsure" }
            }
          }
        };
        const res = await fetch("/api/laya/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(testEnv)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const choice = data.answers?.verdict?.choice || "UNKNOWN";
        showToast(`✅ نتيجة فحص Laya: [${choice}] خلال ${data.latency_ms || 0}ms على (${data.device || "GPU"})`);
      } catch (err) {
        showToast(`فحص Laya التجريبي: ${err.message}`);
      }
    });

    // Laya Dataset Bank Exports
    document.getElementById("btnExportLayaJsonl")?.addEventListener("click", () => {
      WahyAiVerifier.exportLayaFineTuningJsonl();
    });

    document.getElementById("btnDownloadFinetuneScript")?.addEventListener("click", () => {
      const finetuneScript = `# Wahy Laya Fine-Tuning Helper Script\n# Run:\n# python backend/finetune_laya.py --data wahy_laya_train.jsonl --head-only\n`;
      triggerFileDownload("finetune_laya.py", finetuneScript, "text/x-python;charset=utf-8");
      showToast("🐍 تم تنزيل أمر وتشغيل سكريبت تدريب Laya");
    });

    document.getElementById("btnClearLayaTrainingDB")?.addEventListener("click", async () => {
      if (confirm("هل أنت متأكد من رغبتك في مسح كافة سجلات تدريب Laya المحفوظة في IndexedDB؟")) {
        await clearVerificationRecordsDB();
        renderLayaDatasetBankStats();
        showToast("🗑️ تم مسح بنك بيانات التدريب بنجاح.");
      }
    });

    document.getElementById("btnClearAiRequestLogs")?.addEventListener("click", () => {
      currentState.aiVerification.requestLogs = [];
      renderAiRequestLogsTable();
      updateAiMetricsUI();
      showToast("🗑️ تم مسح سجل طلبات التدقيق.");
    });

    // Payload modal close & copy
    document.getElementById("btnCloseAiPayloadModal")?.addEventListener("click", () => {
      document.getElementById("aiPayloadModal")?.classList.add("hidden");
      document.getElementById("aiPayloadModal")?.classList.remove("flex");
    });
    document.getElementById("btnCopyAiPayloadReq")?.addEventListener("click", () => {
      const t = document.getElementById("preAiPayloadRequest")?.textContent || "";
      navigator.clipboard.writeText(t);
      showToast("📋 تم نسخ مدخلات الطلب (JSON)");
    });
    document.getElementById("btnCopyAiPayloadResp")?.addEventListener("click", () => {
      const t = document.getElementById("preAiPayloadResponse")?.textContent || "";
      navigator.clipboard.writeText(t);
      showToast("📋 تم نسخ مخرجات النموذج (JSON)");
    });
  }

  // ---------------------------------------------------------------------------
  // Startup Sequence
  // ---------------------------------------------------------------------------
  (async () => {
    checkBackendHealthStatus();
    initAiVerificationEventListeners();
    await initDynamicCorpus(false);

    // Resume the last working session (transcript, edits, media) instead of the demo lecture
    try {
      if (await restoreLatestLectureSession()) {
        applyRestoredSessionToUi();
        showToast(`↩️ تم استرجاع آخر جلسة: ${currentState.lectureTitle || "محاضرة"} (${currentState.words.length} كلمة)`);
        renderSavedLecturesList();
        return;
      }
    } catch (err) {
      console.error("Session restore failed, starting from the demo lecture", err);
    }
    renderSavedLecturesList();

    const demoText = buildDynamicSampleLectureFromCorpus();
    const ta = document.getElementById("textareaFastPathInput");
    if (ta && !ta.value.trim()) {
      ta.value = demoText;
    }
    handleTextFastPathExecution(demoText, "محاضرة افتتاحية — استوديو الوحيين", false);
    currentState.isDemoSession = true;      // the demo is never autosaved over a real session
    switchMainSection("display");
  })();


  // ===========================================================================
  // Module 13: Wahy Studio v2.3 New Controls & Dialog Handlers
  // ===========================================================================

  // 1. Playback Follows Selection Toggle
  const btnSync = document.getElementById("btnToggleEditorSyncPlayback");
  if (btnSync) {
    btnSync.addEventListener("click", () => {
      currentState.editorPlaybackFollowsSelection = !currentState.editorPlaybackFollowsSelection;
      const isSync = currentState.editorPlaybackFollowsSelection;
      const lbl = document.getElementById("editorSyncLabel");
      if (lbl) {
        lbl.textContent = isSync ? "مزامنة الفيديو مع المؤشر: مفعّلة" : "مزامنة الفيديو مع المؤشر: متوقفة";
      }
      btnSync.classList.toggle("btn-playback-sync-active", isSync);
      btnSync.classList.toggle("btn-playback-sync-inactive", !isSync);
      showToast(isSync ? "🔗 تم تفعيل مزامنة موضع الفيديو مع الكلمة المحددة" : "🔒 تم إيقاف مزامنة موضع الفيديو لراحة التحرير");
    });
  }

  // 2. Editor Rasm Qiyasi and Full Matn Toggles
  document.getElementById("btnEditorToggleRasmQiyasi")?.addEventListener("click", () => {
    currentState.editorViewRasmQiyasi = !currentState.editorViewRasmQiyasi;
    const btn = document.getElementById("btnEditorToggleRasmQiyasi");
    if (btn) {
      btn.classList.toggle("is-on", currentState.editorViewRasmQiyasi);
    }
    if (typeof renderEditorLectureStage === "function") renderEditorLectureStage();
    showToast(currentState.editorViewRasmQiyasi ? "✨ تم تفعيل عرض الرسم القياسي في لوحة التحرير" : "تم إلغاء عرض الرسم القياسي في لوحة التحرير");
  });

  document.getElementById("btnEditorToggleFullMatn")?.addEventListener("click", () => {
    currentState.editorViewFullCanonicalSpan = !currentState.editorViewFullCanonicalSpan;
    const btn = document.getElementById("btnEditorToggleFullMatn");
    if (btn) {
      btn.classList.toggle("is-on", currentState.editorViewFullCanonicalSpan);
    }
    if (typeof renderEditorLectureStage === "function") renderEditorLectureStage();
    showToast(currentState.editorViewFullCanonicalSpan ? "📜 تم تفعيل عرض المتن كاملاً في لوحة التحرير" : "تم التبديل لعرض المقطع المنطوق فقط");
  });

  // 3. Deletion Intent Modal
  document.querySelectorAll("[data-delete-intent]").forEach(btn => {
    btn.addEventListener("click", () => {
      const intent = btn.getAttribute("data-delete-intent");
      if (typeof executeDeleteFindingIntent === "function") {
        executeDeleteFindingIntent(intent);
      }
    });
  });

  document.getElementById("btnCancelDeleteIntent")?.addEventListener("click", () => {
    const modal = document.getElementById("modalDeleteIntent");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
  });

  document.getElementById("btnFetchGeminiModels")?.addEventListener("click", async () => {
    const hint = document.getElementById("tafrighModelsHint");
    const sel = document.getElementById("selTafrighModel");
    const key = currentState?.aiVerification?.geminiApiKey || localStorage.getItem("wahy_gemini_api_key") || "";
    if (hint) hint.textContent = "جاري الجلب...";
    try {
      const r = await fetch("/api/tafrigh/models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: key }), trapError: false
      });
      const d = await r.json();
      if (!d.success) { if (hint) hint.textContent = d.message || "تعذر جلب النماذج."; return; }
      const keep = [...sel.options].filter(o => !o.value.startsWith("gemini") && o.value !== "auto");
      const flash = d.models.filter(m => /flash/.test(m) && !/tts|image|live|audio/.test(m));
      sel.innerHTML = `<option value="auto">Gemini — تلقائي (${escapeHtml(d.recommended || "")})</option>` +
        flash.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
      keep.forEach(o => sel.appendChild(o));
      if (hint) hint.textContent = `تم جلب ${flash.length} نموذج Flash متاح لمفتاحك.`;
    } catch (e) {
      if (hint) hint.textContent = "تعذر الاتصال بالخادم.";
    }
  });


  // 5. Validate All Decisions Command
  document.getElementById("btnValidateAllAiDecisions")?.addEventListener("click", async () => {
    const verifiedList = (currentState.detections || []).filter(d => d.aiVerification?.status === "VERIFIED");
    if (!verifiedList.length) {
      showToast("⚠️ لا توجد اقتباسات مفحوصة لاعتمادها دفعة واحدة.");
      return;
    }
    let count = 0;
    for (const det of verifiedList) {
      if (!det.humanOverride) {
        det.humanOverride = true;
        det.aiVerification.humanOverride = true;
        det.aiVerification.confidence = 0.98;
        if (typeof WahyAiVerifier === "object" && typeof WahyAiVerifier.buildCanonicalDecisionEnvelope === "function") {
          const env = WahyAiVerifier.buildCanonicalDecisionEnvelope(det, currentState.words);
          const layaRec = WahyAiVerifier.convertRecordToLayaTrainingEnvelope(det, env);
          layaRec.answers.verdict.choice = det.aiVerification.verdict || "CORRECT";
          layaRec.human_gold_resolution = {
            verdict: det.aiVerification.verdict || "CORRECT",
            user_action: "VALIDATE_ALL",
            timestamp: new Date().toISOString()
          };
          if (typeof saveVerificationRecordToDB === "function") {
            await saveVerificationRecordToDB(layaRec);
          }
        }
        count++;
      }
    }
    recalculateCaptionsFromCurrentFindings();
    if (typeof renderAllViews === "function") renderAllViews();
    showToast(`✅ تم اعتماد جميع نتائج الذكاء الاصطناعي (${count} مقتبس) وحفظها كبيانات تدريب ذهبية!`);
  });

  // 7. Training Data Hub Controls
  document.getElementById("selTrainingTaskFilter")?.addEventListener("change", () => {
    if (typeof renderTrainingDataHub === "function") renderTrainingDataHub();
  });
  document.getElementById("selTrainingLabelFilter")?.addEventListener("change", () => {
    if (typeof renderTrainingDataHub === "function") renderTrainingDataHub();
  });
  document.getElementById("inpTrainingDataSearch")?.addEventListener("input", () => {
    if (typeof renderTrainingDataHub === "function") renderTrainingDataHub();
  });

  document.getElementById("btnExportLayaJsonl")?.addEventListener("click", () => {
    if (typeof WahyAiVerifier === "object" && typeof WahyAiVerifier.exportLayaJsonlDataset === "function") {
      WahyAiVerifier.exportLayaJsonlDataset();
    }
  });

  document.getElementById("btnClearTrainingDB")?.addEventListener("click", async () => {
    if (!confirm("هل أنت متأكد من مسح جميع سجلات التدريب المحفوظة محلياً؟")) return;
    if (typeof clearVerificationRecordsDB === "function") {
      await clearVerificationRecordsDB();
      if (typeof renderTrainingDataHub === "function") renderTrainingDataHub();
      showToast("🗑️ تم مسح سجلات التدريب بنجاح.");
    }
  });

});
