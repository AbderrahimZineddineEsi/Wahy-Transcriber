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
  ["input", "display", "editor", "datasets"].forEach(sec => {
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
  // Startup Sequence
  // ---------------------------------------------------------------------------
  (async () => {
    checkBackendHealthStatus();
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
