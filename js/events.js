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
        btn.className = "px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600/25 text-emerald-300 border border-emerald-500/50 flex items-center gap-2 shadow-sm transition";
      } else {
        btn.className = "px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 flex items-center gap-2 transition";
      }
    }
    if (panel) {
      if (t === tabName) panel.classList.remove("hidden");
      else panel.classList.add("hidden");
    }
  });
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
  if (txt && statusMessage) txt.textContent = statusMessage;
  if (btnYt) btnYt.disabled = isBusy;
  if (btnMedia) btnMedia.disabled = isBusy;
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

  const formData = new FormData();
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
    setTranscriptionBusyUI(false);

    if (data.media_url) {
      attachMediaUrlToPlayer(data.media_url, data.title || "محاضرة مفرّغة");
    }

    const fastPathBox = document.getElementById("textareaFastPathInput");
    if (fastPathBox) fastPathBox.value = data.full_text || "";

    runDetectionAndBuildCaptions({
      rawText: data.full_text || "",
      words: Array.isArray(data.words) ? data.words : []
    });

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
    if (lbl) lbl.textContent = "🌙";
  } else {
    htmlEl.classList.remove("light");
    htmlEl.classList.add("dark");
    if (lbl) lbl.textContent = "☀️";
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
  ["input", "display", "editor", "datasets", "ai_logs"].forEach(sec => {
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
    switchMainSection("display");
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
  document.getElementById("btnOpenExportModal")?.addEventListener("click", () => {
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
    openModalById("exportModal");
  });
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
      showAdhkarTag: document.getElementById("chkPrefShowAdhkarRef")?.checked !== false
    });
    recalculateCaptionsFromCurrentFindings();
    showToast("✅ تم حفظ تفضيلات الأقواس والعزو وتحديث العرض والكابشن");
  });

  // Settings Modal (Engine Sensitivity, Corpus URLs, Diagnostics)
  document.getElementById("btnOpenSettingsModal")?.addEventListener("click", () => {
    const cfg = getCorpusEndpointsConfig();
    const customInp = document.getElementById("inpCustomCorpusUrl");
    const quranInp = document.getElementById("inpQuranUthmaniUrl");
    const adhkarInp = document.getElementById("inpAdhkarMirrorUrl");
    if (customInp) customInp.value = cfg.customCorpusJsonUrl || "";
    if (quranInp) quranInp.value = cfg.quranUthmaniUrl || "";
    if (adhkarInp) adhkarInp.value = cfg.adhkarMirrorUrl || "";
    openModalById("settingsModal");
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
    const adhkarUrl = document.getElementById("inpAdhkarMirrorUrl")?.value?.trim() || DEFAULT_CORPUS_ENDPOINTS.adhkarMirrorUrl;
    saveCorpusEndpointsConfig({
      customCorpusJsonUrl: customUrl,
      quranUthmaniUrl: quranUrl,
      adhkarMirrorUrl: adhkarUrl
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

  async function triggerRunAiTafrigh() {
    let rawText = (currentState.words && currentState.words.length)
      ? currentState.words.map(w => w.word).join(" ")
      : (currentState.rawText || "");

    if (!rawText.trim()) {
      const fastPathVal = document.getElementById("textareaFastPathInput")?.value || "";
      const mainInputVal = document.getElementById("mainTranscriptInput")?.value || "";
      const editorVal = document.getElementById("lectureTranscriptEditor")?.value || "";
      rawText = (fastPathVal || mainInputVal || editorVal).trim();
    }

    if (typeof switchLectureStageTab === "function") {
      switchLectureStageTab("tafrigh");
    }

    const emptyState = document.getElementById("tafrighEmptyState");
    const progressWrap = document.getElementById("tafrighProgressWrap");
    const progressBar = document.getElementById("tafrighProgressBar");
    const progressTitle = document.getElementById("tafrighProgressTitle");
    const progressSubtitle = document.getElementById("tafrighProgressSubtitle");
    const errorWrap = document.getElementById("tafrighErrorWrap");
    const errorMessage = document.getElementById("tafrighErrorMessage");
    const resultsView = document.getElementById("tafrighResultsView");

    if (!rawText.trim()) {
      showToast("⚠️ لا يوجد نص تفريغ حالياً للبدء بمرحلة التفريغ الذكي");
      if (emptyState) emptyState.classList.remove("hidden");
      if (progressWrap) progressWrap.classList.add("hidden");
      if (resultsView) resultsView.classList.add("hidden");
      return;
    }

    const btnTop = document.getElementById("btnRunAiTafrigh");
    const btnEmpty = document.getElementById("btnRunTafrighFromEmpty");
    const btnRerun = document.getElementById("btnRerunTafrigh");

    if (btnTop) {
      btnTop.disabled = true;
      btnTop.innerHTML = `⏳ جاري التفريغ...`;
    }
    if (btnEmpty) {
      btnEmpty.disabled = true;
      btnEmpty.innerHTML = `⏳ جاري المعالجة...`;
    }
    if (btnRerun) {
      btnRerun.disabled = true;
      btnRerun.innerHTML = `⏳ جاري التحديث...`;
    }

    if (emptyState) emptyState.classList.add("hidden");
    if (errorWrap) errorWrap.classList.add("hidden");
    if (resultsView) resultsView.classList.add("hidden");
    if (progressWrap) progressWrap.classList.remove("hidden");
    if (progressBar) progressBar.style.width = "20%";

    showToast("⏳ جاري تشغيل مرحلة التفريغ الذكي (AI Tafrigh)...");

    const steps = [
      { width: "35%", title: "جاري تقطيع الجمل وفحص الفواصل...", sub: "تحليل الحدود الطبيعية للكلام العربي" },
      { width: "55%", title: "جاري استخراج المتون وعزلها عن الشرح...", sub: "مطابقة النصوص المروية وحمايتها بدقة مطلقة" },
      { width: "75%", title: "جاري هيكلة العناوين وتصنيف الاستطرادات...", sub: "توليد شجرة الأبواب والفصول وحواشي الأسئلة" },
      { width: "90%", title: "جاري التدقيق النهائي وتوليد المستند...", sub: "فحص قيود السلامة وبناء العرض النهائي" }
    ];
    let stepIdx = 0;
    const progressInterval = setInterval(() => {
      if (stepIdx < steps.length) {
        if (progressBar) progressBar.style.width = steps[stepIdx].width;
        if (progressTitle) progressTitle.textContent = steps[stepIdx].title;
        if (progressSubtitle) progressSubtitle.textContent = steps[stepIdx].sub;
        stepIdx++;
      }
    }, 450);

    const restoreButtons = () => {
      clearInterval(progressInterval);
      if (btnTop) {
        btnTop.disabled = false;
        btnTop.innerHTML = `📑 التفريغ الذكي (AI Tafrigh)`;
      }
      if (btnEmpty) {
        btnEmpty.disabled = false;
        btnEmpty.innerHTML = `<span>🚀</span><span>بدء التفريغ وهيكلة المتن والشرح الآن</span>`;
      }
      if (btnRerun) {
        btnRerun.disabled = false;
        btnRerun.innerHTML = `<span>🔄 إعادة المعالجة</span>`;
      }
    };

    try {
      let apiBase = "";
      if (window.location.protocol === "file:" || window.location.port === "8089") {
        apiBase = "http://127.0.0.1:8000";
      }

      const geminiKey = currentState?.aiVerification?.geminiApiKey || localStorage.getItem("wahy_gemini_api_key") || "";
      const payload = {
        raw_text: rawText,
        processing_mode: "per_sentence",
        model_candidate: "gemini_all",
        typo_strategy: "gated",
        gemini_api_key: geminiKey
      };

      let resp;
      try {
        resp = await fetch(`${apiBase}/api/tafrigh/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (netErr) {
        if (!apiBase) {
          resp = await fetch("http://127.0.0.1:8000/api/tafrigh/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        } else {
          throw netErr;
        }
      }

      const data = await resp.json();
      restoreButtons();

      if (data.success) {
        if (progressBar) progressBar.style.width = "100%";
        setTimeout(() => {
          if (progressWrap) progressWrap.classList.add("hidden");
          if (typeof renderTafrighOutput === "function") {
            renderTafrighOutput(data);
          }
          showToast("✅ اكتملت مرحلة التفريغ الذكي وهيكلة المتن والشرح بنجاح!");
        }, 200);
      } else {
        if (progressWrap) progressWrap.classList.add("hidden");
        if (errorWrap) {
          errorWrap.classList.remove("hidden");
          if (errorMessage) {
            errorMessage.textContent = data.message || "حدث خطأ أثناء معالجة التفريغ في الخادم.";
          }
        }
        showToast("❌ حدث خطأ أثناء تشغيل التفريغ الذكي");
      }
    } catch (e) {
      restoreButtons();
      console.error("Tafrigh error:", e);
      if (progressWrap) progressWrap.classList.add("hidden");
      if (errorWrap) {
        errorWrap.classList.remove("hidden");
        if (errorMessage) {
          errorMessage.textContent = `تعذر الاتصال بخادم التفريغ الذكي. يرجى التأكد من تشغيل خادم Wahy Backend على المنفذ 8000 (${e.message}).`;
        }
      }
      showToast("❌ تعذر الاتصال بخادم التفريغ الذكي");
    }
  }

  // Tafrigh Run Buttons
  document.getElementById("btnRunAiTafrigh")?.addEventListener("click", triggerRunAiTafrigh);
  document.getElementById("btnRunTafrighFromEmpty")?.addEventListener("click", triggerRunAiTafrigh);
  document.getElementById("btnRerunTafrigh")?.addEventListener("click", triggerRunAiTafrigh);
  document.getElementById("btnTafrighRetry")?.addEventListener("click", triggerRunAiTafrigh);

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

  document.getElementById("btnSyncRemoteAdhkar")?.addEventListener("click", () => {
    if (typeof WahyCorpusLoader?.syncRemoteAdhkarIntoDataset === "function") {
      WahyCorpusLoader.syncRemoteAdhkarIntoDataset();
    }
  });

  document.getElementById("btnResetDefaultAdhkar")?.addEventListener("click", () => {
    RAW_ADHKAR_DATA = BUILTIN_ADHKAR_DATA.map(x => ({ ...x }));
    persistUserDatasetsToStorage();
    rebuildMatcher();
    renderDatasetsSection();
    if (currentState.rawTranscript) runDetectionAndBuildCaptions();
    showToast("↺ تمت استعادة الأذكار النبوية الافتراضية (42 ذكراً)");
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
      });
    }

    const selQuickScope = document.getElementById("selAiQuickScope");
    if (selQuickScope) {
      selQuickScope.value = currentState.aiVerification.targetScope || "HADITH_AND_CANDIDATES";
      selQuickScope.addEventListener("change", (e) => {
        currentState.aiVerification.targetScope = e.target.value;
        saveAiConfigToStorage();
      });
    }

    document.getElementById("btnGoToAiLogsTab")?.addEventListener("click", () => {
      switchMainSection("ai_logs");
    });

    const btnStart = document.getElementById("btnStartAiVerification");
    const btnStartFromLogs = document.getElementById("btnRunAiVerificationFromLogs");
    const btnPause = document.getElementById("btnPauseAiVerification");
    const btnCancel = document.getElementById("btnCancelAiVerification");
    const wrapProgress = document.getElementById("aiVerificationProgressWrap");
    const barProgress = document.getElementById("aiVerificationProgressBar");
    const lblStatus = document.getElementById("aiVerificationStatusMsg");
    const lblPercent = document.getElementById("aiVerificationPercentLabel");

    const triggerVerification = async () => {
      if (!currentState.detections.length) {
        showToast("⚠️ لا توجد مقتبسات لفحصها. يرجى تفريغ محاضرة أولاً.");
        return;
      }

      if (btnStart) btnStart.classList.add("hidden");
      if (btnPause) {
        btnPause.classList.remove("hidden");
        btnPause.textContent = "⏸ إيقاف مؤقت";
      }
      if (btnCancel) btnCancel.classList.remove("hidden");
      if (wrapProgress) wrapProgress.classList.remove("hidden");

      try {
        await WahyAiVerifier.runBatchAiVerification((p) => {
          const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
          if (barProgress) barProgress.style.width = `${pct}%`;
          if (lblPercent) lblPercent.textContent = `${pct}% (${p.processed}/${p.total})`;
          if (lblStatus) lblStatus.textContent = p.message || "جاري الفحص...";
        });
        showToast("✅ اكتمل الفحص والتدقيق الذكي للمقتبسات بنجاح!");
      } catch (err) {
        showToast(`⚠️ تنبيه التدقيق: ${err.message}`);
      } finally {
        if (btnStart) btnStart.classList.remove("hidden");
        if (btnPause) btnPause.classList.add("hidden");
        if (btnCancel) btnCancel.classList.add("hidden");
        setTimeout(() => {
          if (wrapProgress) wrapProgress.classList.add("hidden");
        }, 4000);
      }
    };

    btnStart?.addEventListener("click", triggerVerification);
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

    btnOrJev?.addEventListener("click", () => setOpenRouterModeUI("jev"));
    btnOrChat?.addEventListener("click", () => {
      setOpenRouterModeUI("chat");
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
    const demoText = buildDynamicSampleLectureFromCorpus();
    const ta = document.getElementById("textareaFastPathInput");
    if (ta && !ta.value.trim()) {
      ta.value = demoText;
    }
    handleTextFastPathExecution(demoText, "محاضرة افتتاحية — استوديو الوحيين", false);
    switchMainSection("display");
  })();
});
