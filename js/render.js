// =============================================================================
// Wahy Studio (Wahy-Transcriber v2.1) — Renderer, Section Router,
// Word Progress Indicator, Smart Editor Canvas & Datasets/Adhkar Studio
// File: js/render.js
// =============================================================================

function switchMainSection(sectionName) {
  const validSections = ["input", "display", "editor", "datasets", "ai_logs"];
  const target = validSections.includes(sectionName) ? sectionName : "display";
  currentState.activeSection = target;

  validSections.forEach(sec => {
    const secEl = document.getElementById(`section_${sec}`);
    const navBtn = document.getElementById(`navBtn_${sec}`);
    if (secEl) {
      if (sec === target) secEl.classList.remove("hidden");
      else secEl.classList.add("hidden");
    }
    if (navBtn) {
      if (sec === target) {
        navBtn.classList.add("nav-active");
        navBtn.classList.remove("nav-inactive");
      } else {
        navBtn.classList.remove("nav-active");
        navBtn.classList.add("nav-inactive");
      }
    }
  });

  // Hide floating selection toolbar when switching sections
  document.getElementById("floatingSelectionToolbar")?.classList.add("hidden");

  if (target === "editor") {
    renderEditorLectureStage();
    if (currentState.editorDockTab === "fn") {
      updateFnStudioSuggestions();
      updateFnRangeVisualHighlight();
    } else {
      renderFindingInspector();
    }
  } else if (target === "datasets") {
    renderDatasetsSection();
  } else if (target === "display") {
    renderFormattedLectureView();
    updateVideoCaptionOverlay(currentState.currentTime);
  } else if (target === "ai_logs") {
    renderAiLogsSection();
  }
}

function switchEditorSubMode(subMode) {
  const validModes = ["fn_studio", "text_edit", "captions_edit"];
  const target = validModes.includes(subMode) ? subMode : "fn_studio";
  currentState.editorSubMode = target;

  validModes.forEach(m => {
    const btn = document.getElementById(`btnEditorSubMode_${m}`);
    const pane = document.getElementById(`editorPane_${m}`);
    if (pane) {
      if (m === target) pane.classList.remove("hidden");
      else pane.classList.add("hidden");
    }
    if (btn) {
      if (m === target) {
        btn.className = "px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white shadow-sm border border-emerald-400/60 transition flex items-center gap-1.5";
      } else {
        btn.className = "px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition flex items-center gap-1.5";
      }
    }
  });

  if (target === "text_edit") {
    const ta = document.getElementById("inpLectureFullEditor");
    const countBadge = document.getElementById("lectureEditorWordCount");
    if (ta) {
      ta.value = currentState.rawTranscript || (currentState.words || []).map(w => w.word).join(" ");
      if (countBadge) countBadge.textContent = `${(currentState.words || []).length} كلمة`;
      setTimeout(() => ta.focus(), 50);
    }
  } else if (target === "captions_edit") {
    renderCaptionTimeline();
  } else if (target === "fn_studio") {
    renderEditorLectureStage();
    updateFnStudioSuggestions();
    updateFnRangeVisualHighlight();
  }
}

function renderKpiSummaryBar() {
  const wordsCnt = currentState.words ? currentState.words.length : 0;
  const dets = currentState.detections || [];
  const ayatCnt = dets.filter(d => d.type === "ayah" || d.sourceType === "QURAN").length;
  const hadithCnt = dets.filter(d => d.type === "hadith" || d.sourceType === "HADITH").length;
  const dhikrCnt = dets.filter(d => d.type === "dhikr" || d.sourceType === "ADHKAR").length;
  const capsCnt = currentState.captions ? currentState.captions.length : 0;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  setEl("kpiTotalWords", wordsCnt);
  setEl("kpiAyatCount", ayatCnt);
  setEl("kpiHadithCount", hadithCnt);
  setEl("kpiDhikrCount", dhikrCnt);
  setEl("kpiCaptionsCount", capsCnt);
  setEl("kpiEngineTimeMs", `${currentState.lastElapsedMs || "1.2"} ms`);
  setEl("navBadgeFindingsCount", dets.length);
  setEl("navBadgeAdhkarCount", (typeof RAW_ADHKAR_DATA !== "undefined" && Array.isArray(RAW_ADHKAR_DATA)) ? RAW_ADHKAR_DATA.length : 0);
  const verifiedCnt = dets.filter(d => d.aiVerification && d.aiVerification.status === "VERIFIED").length;
  setEl("navBadgeAiVerifiedCount", verifiedCnt);

  const titleEl = document.getElementById("displayLectureTitleLabel");
  if (titleEl) titleEl.textContent = currentState.lectureTitle || "محاضرة علمية";
}

/**
 * Shared HTML builder for both Display Lecture View (#formattedLectureStage)
 * and Smart Editor Interactive Canvas (#editorLectureStage).
 */
function buildLectureHtmlContent(isEditorMode = false) {
  const words = currentState.words || [];
  if (!words.length) {
    return `
      <div class="p-10 text-center text-slate-400 text-sm space-y-3">
        <div class="text-2xl">📝</div>
        <div>لا يوجد نص محمّل حالياً. انتقل إلى قسم «الإدخال» لإدخال نص أو رابط يوتيوب أو ملف صوتي/مرئي.</div>
      </div>
    `;
  }

  const filterCat = isEditorMode ? "ALL" : (currentState.lectureFilterCategory || "ALL");
  const searchQ = (currentState.lectureSearchQuery || "").trim();
  const prefs = getOutputDisplayPrefs();

  const findingStartMap = new Map();
  (currentState.detections || []).forEach((det, dIdx) => {
    if (typeof det.wordStartIdx === "number") {
      findingStartMap.set(det.wordStartIdx, { det, dIdx });
    }
  });

  const htmlParagraphs = [];
  let currentParaParts = [];
  let i = 0;

  while (i < words.length) {
    if (findingStartMap.has(i)) {
      const { det, dIdx } = findingStartMap.get(i);
      const endW = Math.min(words.length - 1, Math.max(i, det.wordEndIdx));

      // AI Verdict Filter check (freely toggleable by user)
      const visFilter = (typeof currentState === "object" && currentState.aiVerification && currentState.aiVerification.visibilityFilter)
        ? currentState.aiVerification.visibilityFilter
        : { showCorrect: true, showNotSure: true, showFalse: false, showUnverified: true };

      const v = det.aiVerification?.verdict;
      let shouldRenderAsCitation = true;
      if (v === "CORRECT" && visFilter.showCorrect === false) shouldRenderAsCitation = false;
      else if (v === "NOT_SURE" && visFilter.showNotSure === false) shouldRenderAsCitation = false;
      else if (v === "FALSE" && !visFilter.showFalse) shouldRenderAsCitation = false;
      else if (!v && visFilter.showUnverified === false) shouldRenderAsCitation = false;

      // In Display view, if excluded by AI filter, demote to normal speech tokens
      if (!shouldRenderAsCitation && !isEditorMode) {
        for (let k = i; k <= endW; k++) {
          const wObj = words[k];
          const isHitSearch = searchQ && wObj.word.includes(searchQ);
          const searchHighlight = isHitSearch ? "bg-sky-500/30 text-sky-200 ring-1 ring-sky-400" : "";
          const tokCls = `lecture-word-token ${searchHighlight}`;
          const tip = `انقر للانتقال إلى التوقيت [${formatSecondsToShortTime(wObj.start)}]`;
          currentParaParts.push(
            `<span class="${tokCls}" data-word-idx="${k}" data-raw-tok-idx="${k}" data-start-time="${wObj.start}" title="${tip}">${escapeHtml(wObj.word)}</span>`
          );
        }
        i = endW + 1;
        continue;
      }

      const fType = det.type || sourceTypeToCategorySlug(det.sourceType);
      const brackets = getBracketsForCategory(fType, prefs);
      const isSelected = currentState.selectedPredIndex === dIdx;

      let catClass = fType === "ayah"
        ? "citation-ayah"
        : (fType === "hadith" ? "citation-hadith" : "citation-dhikr");

      if (v === "FALSE") {
        catClass += " ai-marked-false";
      }

      const selectedClass = isSelected ? "citation-selected-ring" : "";
      const dimmedClass = (filterCat !== "ALL" && filterCat !== fType) ? "opacity-35" : "";

      // AI micro-badge
      let aiBadgeHtml = "";
      if (det.aiVerification && det.aiVerification.status === "VERIFIED") {
        const confPct = Math.round((det.aiVerification.confidence || 0.88) * 100);
        if (v === "CORRECT") {
          aiBadgeHtml = `<span class="ai-badge ai-badge-correct" title="تدقيق الذكاء الاصطناعي: اقتباس مؤكد (${confPct}%)">🟢 ${confPct}%</span>`;
        } else if (v === "NOT_SURE") {
          aiBadgeHtml = `<span class="ai-badge ai-badge-not-sure" title="تدقيق الذكاء الاصطناعي: شبه اقتباس غير مؤكد (${confPct}%)">🟡 ${confPct}%</span>`;
        } else if (v === "FALSE") {
          aiBadgeHtml = `<span class="ai-badge ai-badge-false" title="تدقيق الذكاء الاصطناعي: مستبعد / كلام عادي (${confPct}%)">🔴 كلام عادي</span>`;
        }
      } else if (det.aiVerification && det.aiVerification.status === "PENDING") {
        aiBadgeHtml = `<span class="ai-badge ai-badge-pending" title="جاري التدقيق بالذكاء الاصطناعي...">⏳ فحص...</span>`;
      }

      let innerWordsHtml = "";
      if (!isEditorMode && det.snappedToCanonical && det.canonicalText) {
        innerWordsHtml = `<span class="font-bold">${escapeHtml(det.canonicalText)}</span>`;
      } else {
        const spanWordHtmls = [];
        for (let k = i; k <= endW; k++) {
          const wObj = words[k];
          const tokCls = isEditorMode
            ? "lecture-word-token raw-tok-item editor-word-selectable"
            : "lecture-word-token";
          const tip = isEditorMode
            ? `كلمة #${k + 1} [${formatSecondsToShortTime(wObj.start)}] • انقر لتحديد مدى FN أو نقر مزدوج لتعديل الكلمة`
            : `انقر للانتقال إلى التوقيت [${formatSecondsToShortTime(wObj.start)}] • نقر مزدوج لتصحيح الكلمة`;
          spanWordHtmls.push(
            `<span class="${tokCls}" data-word-idx="${k}" data-raw-tok-idx="${k}" data-start-time="${wObj.start}" title="${tip}">${escapeHtml(wObj.word)}</span>`
          );
        }
        innerWordsHtml = spanWordHtmls.join(" ");
      }

      const refText = det.displayRef || det.reference || "";
      const showBadge = (fType === "ayah" && prefs.showQuranSource !== false) ||
                        (fType === "hadith" && prefs.showHadithSource !== false) ||
                        (fType === "dhikr" && prefs.showAdhkarTag !== false);

      const badgeColor = fType === "ayah"
        ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/50"
        : (fType === "hadith" ? "bg-amber-950/90 text-amber-300 border-amber-500/50" : "bg-violet-950/90 text-violet-300 border-violet-500/50");

      const timeTag = formatSecondsToShortTime(det.startTime || words[i].start);

      const citationHtml = `
        <span class="${catClass} ${selectedClass} ${dimmedClass} inline-block my-1"
              data-finding-idx="${dIdx}"
              data-start-time="${det.startTime || words[i].start}"
              title="انقر لفحص وتعديل المقتبس [${escapeHtml(refText)}]">
          ${aiBadgeHtml}
          <span class="opacity-85 select-none">${escapeHtml(brackets.open)}</span>${innerWordsHtml}<span class="opacity-85 select-none">${escapeHtml(brackets.close)}</span>
          ${(refText && showBadge) ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded-md text-[11px] font-sans font-bold border ${badgeColor}">📖 ${escapeHtml(refText)} <span class="font-mono text-[10px] opacity-75" dir="ltr">${timeTag}</span></span>` : ""}
        </span>
      `;
      currentParaParts.push(citationHtml);
      i = endW + 1;
      continue;
    }

    const wObj = words[i];
    const isHitSearch = searchQ && wObj.word.includes(searchQ);
    const searchHighlight = isHitSearch ? "bg-sky-500/30 text-sky-200 ring-1 ring-sky-400" : "";
    const tokCls = isEditorMode
      ? `lecture-word-token raw-tok-item editor-word-selectable ${searchHighlight}`
      : `lecture-word-token ${searchHighlight}`;
    const tip = isEditorMode
      ? `كلمة #${i + 1} [${formatSecondsToShortTime(wObj.start)}] • انقر لتحديد بداية/نهاية مقتبس مفقود (FN Studio) • نقر مزدوج لتعديل الكلمة • Alt+Click للاستماع`
      : `انقر للانتقال للتوقيت [${formatSecondsToShortTime(wObj.start)}] • نقر مزدوج لتصحيح الكلمة`;

    currentParaParts.push(
      `<span class="${tokCls}" data-word-idx="${i}" data-raw-tok-idx="${i}" data-start-time="${wObj.start}" title="${tip}">${escapeHtml(wObj.word)}</span>`
    );

    if (currentParaParts.length >= 38 && /[.؟!؛]/.test(wObj.word)) {
      htmlParagraphs.push(`<p class="mb-4 leading-loose text-justify">${currentParaParts.join(" ")}</p>`);
      currentParaParts = [];
    }
    i++;
  }

  if (currentParaParts.length) {
    htmlParagraphs.push(`<p class="mb-4 leading-loose text-justify">${currentParaParts.join(" ")}</p>`);
  }

  return htmlParagraphs.join("");
}

/**
 * Render Display Section's Formatted Lecture View (optimized for watching & word progress tracking)
 */
function renderFormattedLectureView() {
  const container = document.getElementById("formattedLectureStage");
  if (!container) return;

  container.innerHTML = buildLectureHtmlContent(false);

  // Citations click -> open in Smart Editor's Inspector or select finding
  container.querySelectorAll("[data-finding-idx]").forEach(citEl => {
    citEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const fIdx = parseInt(citEl.getAttribute("data-finding-idx"), 10);
      const det = currentState.detections[fIdx];
      if (det && typeof det.startTime === "number") {
        seekToMediaTimestamp(det.startTime, false);
      }
      selectFindingForEdit(fIdx, false);
    });
  });

  // Word click -> seek video/audio to exact word timestamp
  container.querySelectorAll("[data-word-idx]").forEach(wordEl => {
    wordEl.addEventListener("click", () => {
      if (wordEl.querySelector("input") || wordEl.closest(".inline-edit-wrap")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const t = parseFloat(wordEl.getAttribute("data-start-time") || "0");
      seekToMediaTimestamp(t, true);
    });

    wordEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      startInlineWordEdit(wordEl);
    });
  });

  // Also keep Editor stage in sync if open
  if (currentState.activeSection === "editor") {
    renderEditorLectureStage();
  }
}

/**
 * Render Smart Editor's Interactive Lecture Stage (#editorLectureStage)
 * Decoupled from playback auto-scroll so the text never jumps while selecting/editing!
 * Clicking plain words triggers FN Studio 2-click range selection with highlighting.
 */
function renderEditorLectureStage() {
  const stage = document.getElementById("editorLectureStage");
  if (!stage) return;

  stage.innerHTML = buildLectureHtmlContent(true);

  // Clicking an existing citation in Editor opens the Finding Inspector
  stage.querySelectorAll("[data-finding-idx]").forEach(citEl => {
    citEl.addEventListener("click", (e) => {
      // Allow clicking individual words inside citation if FN select step 1 is active
      if (currentState.fnClickStep === 1) return;
      e.stopPropagation();
      const fIdx = parseInt(citEl.getAttribute("data-finding-idx"), 10);
      selectFindingForEdit(fIdx, false);
    });
  });

  // Double-clicking any word opens inline word editor
  stage.querySelectorAll("[data-word-idx]").forEach(wordEl => {
    wordEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      startInlineWordEdit(wordEl);
    });
  });

  if (typeof updateFnRangeVisualHighlight === "function") {
    updateFnRangeVisualHighlight();
  }
}

function startInlineWordEdit(wordEl) {
  if (wordEl.querySelector("input") || wordEl.closest(".inline-edit-wrap")) return;
  const wIdx = parseInt(wordEl.getAttribute("data-word-idx"), 10);
  const origWord = currentState.words[wIdx]?.word || wordEl.textContent.trim();

  const editWrap = document.createElement("span");
  editWrap.className = "inline-edit-wrap inline-flex items-center gap-1 bg-slate-900 border-2 border-amber-400 rounded-lg px-1.5 py-0.5 shadow-xl shadow-black/90 z-30 mx-0.5";
  editWrap.innerHTML = `
    <input type="text" class="inp-inline-word bg-slate-950 text-white font-bold text-xs sm:text-sm px-2 py-0.5 rounded border border-slate-700 focus:outline-none focus:border-emerald-400 w-24 text-center" dir="rtl" value="${escapeHtml(origWord)}" />
    <button type="button" class="btn-save-inline-word px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold" title="حفظ التعديل (Enter)">✓</button>
    <button type="button" class="btn-cancel-inline-word px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold" title="إلغاء (Esc)">✕</button>
  `;

  wordEl.style.display = "none";
  wordEl.parentNode.insertBefore(editWrap, wordEl);

  const inp = editWrap.querySelector(".inp-inline-word");
  const btnSave = editWrap.querySelector(".btn-save-inline-word");
  const btnCancel = editWrap.querySelector(".btn-cancel-inline-word");

  const commitSave = () => {
    const newVal = inp.value.trim();
    editWrap.remove();
    wordEl.style.display = "";
    if (newVal && newVal !== origWord) {
      if (typeof updateSingleWordInLecture === "function") {
        updateSingleWordInLecture(wIdx, newVal);
      }
    }
  };

  const cancelEdit = () => {
    editWrap.remove();
    wordEl.style.display = "";
  };

  btnSave.addEventListener("click", commitSave);
  btnCancel.addEventListener("click", cancelEdit);

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  });

  setTimeout(() => {
    inp.focus();
    inp.select();
  }, 25);
}

/**
 * Render Finding Inspector inside Smart Editor Dock
 */
function renderFindingInspector() {
  const panel = document.getElementById("findingInspectorBody");
  if (!panel) return;

  const idx = currentState.selectedPredIndex;
  const det = (idx >= 0 && idx < currentState.detections.length) ? currentState.detections[idx] : null;

  if (!det) {
    panel.innerHTML = `
      <div class="p-6 text-center text-xs text-slate-400 space-y-2">
        <div class="text-lg">🔍</div>
        <div>انقر على أي آية أو حديث أو ذكر ملون داخل نص المحاضرة لفحصه أو تعديل حدوده، أو انتقل إلى تبويب <strong>«إضافة مفقود (FN Studio)»</strong> لإدراج مقتبس جديد.</div>
      </div>
    `;
    return;
  }

  const fType = det.type || sourceTypeToCategorySlug(det.sourceType);
  const startW = currentState.words[det.wordStartIdx]?.word || "";
  const endW = currentState.words[det.wordEndIdx]?.word || "";

  panel.innerHTML = `
    <div class="space-y-3 text-xs">
      <!-- Top Row: Navigation, Category Switcher & Delete -->
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400 font-semibold">التصنيف:</span>
          <button type="button" data-set-cat="ayah" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "ayah" ? "bg-emerald-600 text-white border-emerald-400" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}">آية</button>
          <button type="button" data-set-cat="hadith" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "hadith" ? "bg-amber-600 text-white border-amber-400" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}">حديث</button>
          <button type="button" data-set-cat="dhikr" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "dhikr" ? "bg-violet-600 text-white border-violet-400" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}">ذكر</button>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" id="btnInspectorPlayQuote" class="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/35 text-sky-300 border border-sky-500/40 font-bold transition" title="الاستماع لتوقيت هذا المقتبس">
            ▶ استماع
          </button>
          <button type="button" id="btnInspectorDeleteFinding" class="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-800 text-rose-200 border border-rose-500/40 font-bold transition">
            🗑️ حذف
          </button>
        </div>
      </div>

      <!-- Reference & Corpus Linker -->
      <div class="rounded-xl bg-slate-950/80 border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span class="text-slate-400">المرجع:</span>
          <span class="font-bold text-emerald-300 mr-1">${escapeHtml(det.displayRef || det.reference || "غير محدد")}</span>
          <span class="text-[11px] font-mono text-slate-500 mr-1" dir="ltr">(${formatSecondsToShortTime(det.startTime)} → ${formatSecondsToShortTime(det.endTime)})</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" id="btnInspectorConvertToAdhkar" class="px-2.5 py-1 rounded-lg bg-violet-600/20 hover:bg-violet-600/35 text-violet-300 border border-violet-500/40 font-bold transition" title="تحويل إلى ذكر وحفظه في قاعدة الأذكار">
            📿 حفظ كذكر
          </button>
          <button type="button" id="btnInspectorSearchCorpusRef" class="px-2.5 py-1 rounded-lg bg-sky-600/25 hover:bg-sky-600/40 text-sky-300 border border-sky-500/40 font-bold transition">
            🔍 تغيير المرجع
          </button>
        </div>
      </div>

      <!-- Word Boundary Controls (+1 / -1 word) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div class="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5 flex items-center justify-between">
          <div>
            <div class="text-[10px] text-slate-400">بداية المقتبس (#${det.wordStartIdx + 1})</div>
            <div class="font-bold text-slate-200 truncate max-w-[120px]">«${escapeHtml(startW)}»</div>
          </div>
          <div class="flex items-center gap-1" dir="ltr">
            <button type="button" id="btnStartWordMinus" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono font-bold" title="توسيع كلمة لليمين">-1W</button>
            <button type="button" id="btnStartWordPlus" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono font-bold" title="تقليص كلمة من البداية">+1W</button>
          </div>
        </div>

        <div class="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5 flex items-center justify-between">
          <div>
            <div class="text-[10px] text-slate-400">نهاية المقتبس (#${det.wordEndIdx + 1})</div>
            <div class="font-bold text-slate-200 truncate max-w-[120px]">«${escapeHtml(endW)}»</div>
          </div>
          <div class="flex items-center gap-1" dir="ltr">
            <button type="button" id="btnEndWordMinus" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono font-bold" title="تقليص كلمة من النهاية">-1W</button>
            <button type="button" id="btnEndWordPlus" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono font-bold" title="توسيع كلمة لليسار">+1W</button>
          </div>
        </div>
      </div>

      <!-- Snap to Canonical Text Toggle -->
      <div class="rounded-xl bg-emerald-950/25 border border-emerald-500/30 p-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-emerald-300">✨ المطابقة مع الرسم العثماني / القياسي</div>
          <button type="button" id="btnInspectorSnapCanonical" class="px-3 py-1 rounded-xl font-bold text-xs border transition ${det.snappedToCanonical ? "bg-emerald-600 text-white border-emerald-400" : "bg-slate-800 hover:bg-slate-700 text-emerald-300 border-emerald-500/40"}">
            ${det.snappedToCanonical ? "✓ مفعّل (الرسم القياسي)" : "تبديل للرسم القياسي"}
          </button>
        </div>
        <div class="text-xs font-quran-text text-slate-200 bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 leading-relaxed">${escapeHtml(det.canonicalText || det.matchedText || "")}</div>
      </div>

      <!-- AI Verification & Human Gold Override Card -->
      <div class="rounded-xl bg-slate-950/90 border border-sky-500/30 p-3.5 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-sky-300 flex items-center gap-1.5">
            <span>🤖</span>
            <span>تدقيق الذكاء الاصطناعي والتصحيح البشري اليدوي</span>
          </div>
          ${det.aiVerification?.status === "VERIFIED"
            ? (det.aiVerification.verdict === "CORRECT"
                ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">🟢 مقبول / اقتباس مؤكد</span>'
                : (det.aiVerification.verdict === "FALSE"
                    ? '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">🔴 مستبعد / كلام عادي</span>'
                    : '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">🟡 غير متأكد</span>'))
            : (det.aiVerification?.status === "PENDING"
                ? '<span class="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold animate-pulse">⏳ جاري الفحص...</span>'
                : '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">⚪ غير مفحوص بعد</span>')}
        </div>

        ${det.aiVerification?.status === "VERIFIED" ? `
          <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1.5">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-400">النموذج: <strong class="text-slate-200 font-mono">${escapeHtml(det.aiVerification.modelUsed || det.aiVerification.provider || "")}</strong></span>
              <span class="text-slate-400">نسبة الثقة: <strong class="text-emerald-400 font-mono">${Math.round((det.aiVerification.confidence || 0.88) * 100)}%</strong></span>
            </div>
            ${det.aiVerification.probabilities ? `
              <div class="text-[10px] font-mono text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/80">
                <span>P(صحيح): ${(det.aiVerification.probabilities.CORRECT || 0).toFixed(2)}</span>
                <span>P(خاطئ): ${(det.aiVerification.probabilities.FALSE || 0).toFixed(2)}</span>
                <span>P(غير متأكد): ${(det.aiVerification.probabilities.NOT_SURE || 0).toFixed(2)}</span>
              </div>
            ` : ""}
            ${det.aiVerification.reason ? `
              <div class="text-[11px] text-slate-300 pt-1 text-justify border-t border-slate-800/60 leading-relaxed">
                ${escapeHtml(det.aiVerification.reason)}
              </div>
            ` : ""}
          </div>
        ` : ""}

        <!-- 1-Click Human Override Buttons -->
        <div class="space-y-1.5 pt-1">
          <div class="text-[11px] text-slate-400 font-medium">تصحيح / تأكيد الحكم يدوياً (حفظ كبيانات تدريب ذهبية لـ Laya):</div>
          <div class="grid grid-cols-3 gap-1.5">
            <button type="button" id="btnOverrideCorrect" class="px-2 py-1.5 rounded-lg font-bold text-xs bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 transition">
              🟢 صحيح
            </button>
            <button type="button" id="btnOverrideFalse" class="px-2 py-1.5 rounded-lg font-bold text-xs bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 border border-rose-500/40 transition">
              🔴 كلام عادي
            </button>
            <button type="button" id="btnOverrideNotSure" class="px-2 py-1.5 rounded-lg font-bold text-xs bg-amber-600/20 hover:bg-amber-600/35 text-amber-300 border border-amber-500/40 transition">
              🟡 غير متأكد
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  panel.querySelectorAll("[data-set-cat]").forEach(btn => {
    btn.addEventListener("click", () => {
      changeFindingCategory(idx, btn.getAttribute("data-set-cat"));
    });
  });

  panel.querySelector("#btnInspectorPlayQuote")?.addEventListener("click", () => {
    seekToMediaTimestamp(det.startTime || 0, true);
  });
  panel.querySelector("#btnInspectorDeleteFinding")?.addEventListener("click", () => deleteFinding(idx));
  panel.querySelector("#btnInspectorConvertToAdhkar")?.addEventListener("click", () => convertFindingToSavedDhikr(idx));
  panel.querySelector("#btnInspectorSearchCorpusRef")?.addEventListener("click", () => openCorpusSearchModalForSelection(fType, idx));
  panel.querySelector("#btnStartWordMinus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "start", -1));
  panel.querySelector("#btnStartWordPlus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "start", 1));
  panel.querySelector("#btnEndWordMinus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "end", -1));
  panel.querySelector("#btnEndWordPlus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "end", 1));
  panel.querySelector("#btnInspectorSnapCanonical")?.addEventListener("click", () => toggleSnapFindingToCanonical(idx));

  panel.querySelector("#btnOverrideCorrect")?.addEventListener("click", () => {
    if (typeof WahyAiVerifier === "object" && typeof WahyAiVerifier.setHumanOverrideVerdict === "function") {
      WahyAiVerifier.setHumanOverrideVerdict(det.id, "CORRECT");
    }
  });
  panel.querySelector("#btnOverrideFalse")?.addEventListener("click", () => {
    if (typeof WahyAiVerifier === "object" && typeof WahyAiVerifier.setHumanOverrideVerdict === "function") {
      WahyAiVerifier.setHumanOverrideVerdict(det.id, "FALSE");
    }
  });
  panel.querySelector("#btnOverrideNotSure")?.addEventListener("click", () => {
    if (typeof WahyAiVerifier === "object" && typeof WahyAiVerifier.setHumanOverrideVerdict === "function") {
      WahyAiVerifier.setHumanOverrideVerdict(det.id, "NOT_SURE");
    }
  });
}

/**
 * Render Caption Timeline inside Smart Editor (Tab 3: Captions Editor)
 */
function renderCaptionTimeline() {
  const container = document.getElementById("captionTimelineContainer");
  if (!container) return;

  const captions = currentState.captions || [];
  if (!captions.length) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400 text-xs">
        لا توجد مقاطع ترجمة (Captions) حالياً.
      </div>
    `;
    return;
  }

  const rowsHtml = [];

  captions.forEach((cap, idx) => {
    const isCitation = cap.type && cap.type !== "normal";
    let badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">كلام عادي</span>`;
    let borderClass = "border-slate-800 bg-slate-900/80";

    if (cap.type === "ayah") {
      badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">﴿ آية قرآنية ﴾ ${escapeHtml(cap.reference || "")}</span>`;
      borderClass = "border-emerald-500/40 bg-emerald-950/20";
    } else if (cap.type === "hadith") {
      badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">« حديث نبوي » ${escapeHtml(cap.reference || "")}</span>`;
      borderClass = "border-amber-500/40 bg-amber-950/20";
    } else if (cap.type === "dhikr") {
      badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/40">〖 ذكر 〗 ${escapeHtml(cap.reference || "")}</span>`;
      borderClass = "border-violet-500/40 bg-violet-950/20";
    }

    const atomicBadge = cap.isAtomicCitation
      ? `<span class="px-1.5 py-0.5 rounded text-[10px] bg-teal-500/15 text-teal-300 border border-teal-500/30" title="مقتبس موحّد غير مقسم">🔒 وحدة متصلة</span>`
      : "";

    rowsHtml.push(`
      <div class="caption-row-card rounded-xl border ${borderClass} p-3.5 space-y-2" data-caption-row="${idx}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" data-cap-seek="${cap.start}" class="px-2.5 py-0.5 rounded-md bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-mono text-[11px] font-bold flex items-center gap-1" dir="ltr" title="تشغيل من هذا المقطع">
              ▶ #${cap.index} [${formatSecondsToShortTime(cap.start)} → ${formatSecondsToShortTime(cap.end)}]
            </button>
            ${badgeHtml}
            ${atomicBadge}
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" data-cap-split="${idx}" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px] font-bold transition" title="ضع المؤشر بين أي كلمتين ثم اضغط لتقسيم الكابشن بالتوقيت الدقيق للكلمات">
              ✂️ تقسيم عند المؤشر
            </button>
          </div>
        </div>

        <div>
          <textarea data-cap-input="${idx}" rows="2"
            class="w-full rounded-lg bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none px-3 py-1.5 text-sm text-slate-100 leading-relaxed resize-none ${cap.type === "ayah" ? "font-quran-text text-base text-emerald-200" : ""}"
            placeholder="نص الكابشن...">${escapeHtml(cap.text)}</textarea>
          ${isCitation ? `<div class="text-[11px] text-slate-400 mt-1">العرض على الفيديو: <span class="text-slate-200 font-semibold">${escapeHtml(cap.displayText)}</span></div>` : ""}
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/70 text-[11px]" dir="ltr">
          <div class="flex items-center gap-1">
            <span class="text-slate-400 font-sans mr-1">Start:</span>
            <button type="button" data-cap-nudge="${idx}|start|-0.1" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono">-0.1s</button>
            <input type="number" step="0.1" value="${cap.start.toFixed(2)}" data-cap-time-inp="${idx}|start" class="w-16 text-center rounded bg-slate-950 border border-slate-800 text-sky-300 font-mono py-0.5" />
            <button type="button" data-cap-nudge="${idx}|start|0.1" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono">+0.1s</button>
            <button type="button" data-cap-playhead="${idx}|start" class="px-2 py-0.5 rounded bg-slate-800/90 hover:bg-sky-900/60 text-sky-300 border border-sky-500/30 font-sans text-[10px]">⏱ Playhead</button>
          </div>

          <div class="flex items-center gap-1">
            <span class="text-slate-400 font-sans mr-1">End:</span>
            <button type="button" data-cap-nudge="${idx}|end|-0.1" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono">-0.1s</button>
            <input type="number" step="0.1" value="${cap.end.toFixed(2)}" data-cap-time-inp="${idx}|end" class="w-16 text-center rounded bg-slate-950 border border-slate-800 text-emerald-300 font-mono py-0.5" />
            <button type="button" data-cap-nudge="${idx}|end|0.1" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono">+0.1s</button>
            <button type="button" data-cap-playhead="${idx}|end" class="px-2 py-0.5 rounded bg-slate-800/90 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 font-sans text-[10px]">⏱ Playhead</button>
          </div>
        </div>
      </div>
    `);

    if (idx < captions.length - 1) {
      rowsHtml.push(`
        <div class="flex items-center justify-center -my-1">
          <button type="button" data-cap-merge="${idx}" class="px-3 py-0.5 rounded-full bg-slate-900 hover:bg-indigo-950 text-slate-400 hover:text-indigo-300 border border-slate-800 hover:border-indigo-500/40 text-[10px] font-bold transition shadow">
            🔗 دمج مع السطر التالي (#${idx + 1} + #${idx + 2})
          </button>
        </div>
      `);
    }
  });

  container.innerHTML = rowsHtml.join("");

  container.querySelectorAll("[data-cap-seek]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = parseFloat(btn.getAttribute("data-cap-seek") || "0");
      seekToMediaTimestamp(t, true);
    });
  });

  container.querySelectorAll("[data-cap-input]").forEach(ta => {
    ta.addEventListener("change", () => {
      const cIdx = parseInt(ta.getAttribute("data-cap-input"), 10);
      updateCaptionInlineText(cIdx, ta.value);
    });
  });

  container.querySelectorAll("[data-cap-split]").forEach(btn => {
    btn.addEventListener("click", () => {
      const cIdx = parseInt(btn.getAttribute("data-cap-split"), 10);
      const ta = container.querySelector(`[data-cap-input="${cIdx}"]`);
      const cursorOffset = ta ? ta.selectionStart : null;
      splitCaptionAtCursor(cIdx, cursorOffset);
    });
  });

  container.querySelectorAll("[data-cap-merge]").forEach(btn => {
    btn.addEventListener("click", () => {
      const cIdx = parseInt(btn.getAttribute("data-cap-merge"), 10);
      mergeCaptionWithNext(cIdx);
    });
  });

  container.querySelectorAll("[data-cap-nudge]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [cIdxStr, field, deltaStr] = btn.getAttribute("data-cap-nudge").split("|");
      nudgeCaptionTimestamp(parseInt(cIdxStr, 10), field, parseFloat(deltaStr));
    });
  });

  container.querySelectorAll("[data-cap-time-inp]").forEach(inp => {
    inp.addEventListener("change", () => {
      const [cIdxStr, field] = inp.getAttribute("data-cap-time-inp").split("|");
      nudgeCaptionTimestamp(parseInt(cIdxStr, 10), field, 0, parseFloat(inp.value || "0"));
    });
  });

  container.querySelectorAll("[data-cap-playhead]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [cIdxStr, field] = btn.getAttribute("data-cap-playhead").split("|");
      setCaptionTimestampToPlayhead(parseInt(cIdxStr, 10), field);
    });
  });
}

/**
 * Synchronize Video/Audio Playhead with:
 * 1. Custom Styled Caption Overlay over the video player
 * 2. Lecture Word Progress Indicator Bar & Active Word Highlight in Display View
 * 3. Editor Mini Transport Time Label (WITHOUT auto-scrolling the Editor stage!)
 */
function updateVideoCaptionOverlay(currentTimeSec) {
  currentState.currentTime = Number(currentTimeSec || 0);
  const formattedCur = `${formatSecondsToShortTime(currentState.currentTime)} / ${formatSecondsToShortTime(currentState.duration || 0)}`;

  const timeLbl = document.getElementById("playerCurrentTimeLabel");
  if (timeLbl) timeLbl.textContent = formattedCur;

  const editorTimeLbl = document.getElementById("editorMiniTimeLabel");
  if (editorTimeLbl) editorTimeLbl.textContent = formattedCur;

  const seekSlider = document.getElementById("playerTimelineSlider");
  if (seekSlider && currentState.duration > 0) {
    seekSlider.max = String(currentState.duration);
    seekSlider.value = String(currentState.currentTime);
  }

  // 1. Find active caption
  const captions = currentState.captions || [];
  let activeCapIdx = -1;
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i];
    if (currentState.currentTime >= c.start && currentState.currentTime <= c.end + 0.15) {
      activeCapIdx = i;
      break;
    }
  }

  const overlayBox = document.getElementById("videoCaptionOverlayBox");
  if (overlayBox) {
    if (activeCapIdx >= 0) {
      const cap = captions[activeCapIdx];
      let typeClass = "";
      if (cap.type === "ayah") typeClass = "overlay-ayah";
      else if (cap.type === "hadith") typeClass = "overlay-hadith";
      else if (cap.type === "dhikr") typeClass = "overlay-dhikr";

      overlayBox.className = `overlay-caption-box ${typeClass}`;
      overlayBox.textContent = cap.displayText || cap.text || "";
      overlayBox.classList.remove("opacity-0");
    } else {
      overlayBox.classList.add("opacity-0");
    }
  }

  // Update active caption card border (never auto-scrolls unless user explicitly enabled it)
  if (activeCapIdx !== currentState.selectedCaptionIndex) {
    currentState.selectedCaptionIndex = activeCapIdx;
    const timeline = document.getElementById("captionTimelineContainer");
    if (timeline) {
      timeline.querySelectorAll("[data-caption-row]").forEach(row => {
        const rIdx = parseInt(row.getAttribute("data-caption-row"), 10);
        if (rIdx === activeCapIdx) {
          row.classList.add("caption-row-active");
        } else {
          row.classList.remove("caption-row-active");
        }
      });
    }
  }

  // 2. Find active word & update Lecture Word Progress Indicator
  const words = currentState.words || [];
  let activeWIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (currentState.currentTime >= words[i].start && currentState.currentTime <= words[i].end + 0.12) {
      activeWIdx = i;
      break;
    }
  }

  // Update visual Word Progress Bar in Display Lecture Header
  const wordProgBar = document.getElementById("lectureWordProgressBar");
  const wordProgLabel = document.getElementById("lectureWordProgressLabel");
  if (words.length > 0) {
    const dispIdx = activeWIdx >= 0 ? activeWIdx + 1 : (currentState.currentTime > 0 ? Math.min(words.length, Math.max(1, currentState.activeWordIndex + 1)) : 0);
    const pct = Math.min(100, Math.round((dispIdx / words.length) * 100));
    if (wordProgBar) wordProgBar.style.width = `${pct}%`;
    if (wordProgLabel) wordProgLabel.textContent = `الكلمة ${dispIdx} / ${words.length} (${pct}%)`;
  } else {
    if (wordProgBar) wordProgBar.style.width = "0%";
    if (wordProgLabel) wordProgLabel.textContent = "0 / 0";
  }

  if (activeWIdx !== currentState.activeWordIndex) {
    currentState.activeWordIndex = activeWIdx;
    const stage = document.getElementById("formattedLectureStage");
    if (stage) {
      stage.querySelectorAll(".lecture-word-active").forEach(el => el.classList.remove("lecture-word-active"));
      if (activeWIdx >= 0) {
        const activeEl = stage.querySelector(`[data-word-idx="${activeWIdx}"]`);
        if (activeEl) {
          activeEl.classList.add("lecture-word-active");
          // Smart Auto-Follow ONLY in Display section, and ONLY when user is not selecting text or inline-editing
          const hasActiveSelection = window.getSelection && !window.getSelection().isCollapsed;
          const hasInlineInput = Boolean(stage.querySelector(".inline-edit-wrap"));
          if (
            currentState.activeSection === "display" &&
            currentState.autoFollowLectureWord &&
            !hasActiveSelection &&
            !hasInlineInput
          ) {
            const wordOffsetTop = activeEl.offsetTop - stage.offsetTop;
            if (wordOffsetTop < stage.scrollTop + 35 || wordOffsetTop > stage.scrollTop + stage.clientHeight - 85) {
              stage.scrollTo({ top: Math.max(0, wordOffsetTop - 85), behavior: "smooth" });
            }
          }
        }
      }
    }
  }
}

function seekToMediaTimestamp(targetSec, autoPlay = false) {
  const sec = Math.max(0, Math.min(currentState.duration || 99999, Number(targetSec) || 0));
  const videoEl = document.getElementById("wahyVideoPlayer");

  if (videoEl && currentState.mediaUrl && !videoEl.classList.contains("hidden")) {
    videoEl.currentTime = sec;
    if (autoPlay) {
      videoEl.play().catch(() => {});
    }
    updateVideoCaptionOverlay(sec);
    return;
  }

  currentState.currentTime = sec;
  updateVideoCaptionOverlay(sec);
  if (autoPlay && !currentState.isPlaying) {
    toggleSimulatedPlayback(true);
  }
}

function syncPlayPauseButtonsUI(isPlaying) {
  const playBtnLbl = document.getElementById("btnSimulatedPlayLabel");
  const editorPlayLbl = document.getElementById("btnEditorMiniPlayLabel");
  if (playBtnLbl) {
    playBtnLbl.textContent = isPlaying ? "⏸ إيقاف مؤقت" : "▶ تشغيل المتابعة";
  }
  if (editorPlayLbl) {
    editorPlayLbl.textContent = isPlaying ? "⏸ إيقاف الصوت" : "▶ استماع";
  }
}

function toggleSimulatedPlayback(forcePlay = null) {
  const videoEl = document.getElementById("wahyVideoPlayer");
  if (videoEl && currentState.mediaUrl && !videoEl.classList.contains("hidden")) {
    if (videoEl.paused || forcePlay === true) {
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
    return;
  }

  const nextPlay = forcePlay !== null ? forcePlay : !currentState.isPlaying;
  currentState.isPlaying = nextPlay;
  syncPlayPauseButtonsUI(currentState.isPlaying);

  if (demoPlaybackTimer) {
    clearInterval(demoPlaybackTimer);
    demoPlaybackTimer = null;
  }

  if (currentState.isPlaying) {
    demoPlaybackTimer = setInterval(() => {
      const nextT = currentState.currentTime + 0.1;
      if (nextT >= (currentState.duration || 10)) {
        currentState.currentTime = 0;
        toggleSimulatedPlayback(false);
        return;
      }
      updateVideoCaptionOverlay(nextT);
    }, 100);
  }
}

function setWorkspaceLayoutMode(mode) {
  currentState.workspaceLayout = mode;
  const grid = document.getElementById("dualWorkspaceGrid");
  const rightCol = document.getElementById("rightLectureColumn");
  const leftCol = document.getElementById("displayVideoColumn");

  if (!grid || !rightCol || !leftCol) return;

  rightCol.classList.remove("hidden");
  leftCol.classList.remove("hidden");

  if (mode === "LECTURE_ONLY") {
    grid.className = "grid grid-cols-1 gap-5";
    leftCol.classList.add("hidden");
    rightCol.className = "w-full flex flex-col gap-4";
  } else if (mode === "CAPTIONS_ONLY") {
    grid.className = "grid grid-cols-1 gap-5";
    rightCol.classList.add("hidden");
    leftCol.className = "w-full max-w-4xl mx-auto flex flex-col gap-4";
  } else {
    grid.className = "grid grid-cols-1 lg:grid-cols-12 gap-5 items-start";
    rightCol.className = "lg:col-span-7 flex flex-col gap-4";
    leftCol.className = "lg:col-span-5 flex flex-col gap-4 lg:sticky lg:top-16";
  }

  ["SPLIT", "LECTURE_ONLY", "CAPTIONS_ONLY"].forEach(m => {
    const btn = document.getElementById(`btnLayout_${m}`);
    if (!btn) return;
    if (m === mode) {
      btn.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white shadow-sm border border-emerald-400/50 transition";
    } else {
      btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition";
    }
  });
}

// -----------------------------------------------------------------------------
// Datasets & Adhkar Management Studio Renderer (#section_datasets)
// -----------------------------------------------------------------------------

function populateDatasetFilterSelects() {
  const surahSel = document.getElementById("selDatasetBrowserSurah");
  if (surahSel && surahSel.options.length <= 1) {
    const opts = ['<option value="ALL">كل السور (114 سورة)</option>'];
    Object.entries(SURAH_NAMES_AR).forEach(([num, name]) => {
      opts.push(`<option value="${num}">${num}. سورة ${name}</option>`);
    });
    surahSel.innerHTML = opts.join("");
  }

  const bookSel = document.getElementById("selDatasetBrowserBook");
  if (bookSel && bookSel.options.length <= 1) {
    const opts = ['<option value="ALL">جميع كتب الحديث المحمّلة</option>'];
    DATASET_CATALOG.forEach(d => {
      opts.push(`<option value="${d.key}">${escapeHtml(d.title)}</option>`);
    });
    bookSel.innerHTML = opts.join("");
  }
}

function renderDatasetsSection() {
  populateDatasetFilterSelects();

  const bState = currentState.datasetBrowser || {
    activeTab: "ADHKAR",
    searchQuery: "",
    adhkarFilter: "ALL",
    surahFilter: "ALL",
    bookFilter: "ALL",
    page: 1,
    pageSize: 25
  };

  const builtinIds = new Set((typeof BUILTIN_ADHKAR_DATA !== "undefined" ? BUILTIN_ADHKAR_DATA : []).map(b => b.id));
  const customAdhkarCount = (RAW_ADHKAR_DATA || []).filter(x => x.isCustom || !builtinIds.has(x.id)).length;

  // Update dataset counts & badges
  const setBadge = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };
  setBadge("badgeDsAdhkarTotal", RAW_ADHKAR_DATA.length);
  setBadge("badgeDsAdhkarCustom", customAdhkarCount);
  setBadge("badgeDsOutsideTotal", RAW_OUTSIDE_HADITH_DATA.length);
  setBadge("badgeDsQuranTotal", RAW_QURAN_DATA.length);
  setBadge("badgeDsHadithTotal", RAW_HADITH_DATA.length);
  setBadge("navBadgeAdhkarCount", RAW_ADHKAR_DATA.length);

  const chkAdhkarEnabled = document.getElementById("chkToggleAdhkarEngine");
  if (chkAdhkarEnabled) chkAdhkarEnabled.checked = currentState.adhkarEnabled !== false;

  // Style Dataset Sub-Tabs
  ["ADHKAR", "OUTSIDE_CORPUS", "QURAN", "HADITH"].forEach(tabKey => {
    const btn = document.getElementById(`btnDsTab_${tabKey}`);
    if (!btn) return;
    const isActive = bState.activeTab === tabKey;
    if (tabKey === "ADHKAR") {
      btn.className = isActive
        ? "px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 text-white shadow border border-violet-400/60 flex items-center gap-2 transition"
        : "px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-violet-300 border border-slate-800 flex items-center gap-2 transition";
    } else if (tabKey === "OUTSIDE_CORPUS") {
      btn.className = isActive
        ? "px-4 py-2 rounded-xl text-xs font-bold bg-cyan-600 text-white shadow border border-cyan-400/60 flex items-center gap-2 transition"
        : "px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 flex items-center gap-2 transition";
    } else if (tabKey === "QURAN") {
      btn.className = isActive
        ? "px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white shadow border border-emerald-400/60 flex items-center gap-2 transition"
        : "px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-800 flex items-center gap-2 transition";
    } else {
      btn.className = isActive
        ? "px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white shadow border border-amber-400/60 flex items-center gap-2 transition"
        : "px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-800 flex items-center gap-2 transition";
    }
  });

  // Toggle CRUD toolbars & filter dropdowns per active dataset tab
  document.getElementById("dsAdhkarManagerPanel")?.classList.toggle("hidden", bState.activeTab !== "ADHKAR");
  document.getElementById("dsOutsideManagerPanel")?.classList.toggle("hidden", bState.activeTab !== "OUTSIDE_CORPUS");
  document.getElementById("dsReadOnlyNotice")?.classList.toggle("hidden", bState.activeTab === "ADHKAR" || bState.activeTab === "OUTSIDE_CORPUS");
  document.getElementById("wrapDsAdhkarFilter")?.classList.toggle("hidden", bState.activeTab !== "ADHKAR");
  document.getElementById("wrapDsSurahFilter")?.classList.toggle("hidden", bState.activeTab !== "QURAN");
  document.getElementById("wrapDsBookFilter")?.classList.toggle("hidden", bState.activeTab !== "HADITH");

  const q = (bState.searchQuery || "").trim();
  const qNorm = typeof normalizeArabic === "function" ? normalizeArabic(q) : q;

  let items = [];
  if (bState.activeTab === "ADHKAR") {
    items = (RAW_ADHKAR_DATA || []).map((x, idx) => ({
      idx,
      id: x.id,
      ref: x.ref || x.category || "ذكر مأثور",
      category: x.category || x.ref || "ذكر",
      text: x.t,
      isCustom: Boolean(x.isCustom || !builtinIds.has(x.id))
    }));
    if (bState.adhkarFilter === "CUSTOM") {
      items = items.filter(it => it.isCustom);
    } else if (bState.adhkarFilter === "BUILTIN") {
      items = items.filter(it => !it.isCustom);
    }
  } else if (bState.activeTab === "OUTSIDE_CORPUS") {
    items = (RAW_OUTSIDE_HADITH_DATA || []).map((x, idx) => ({
      idx,
      id: x.id,
      ref: x.ref || "حديث خارج القاعدة",
      text: x.t,
      isCustom: true
    }));
  } else if (bState.activeTab === "QURAN") {
    const sFilter = bState.surahFilter || "ALL";
    items = (RAW_QURAN_DATA || [])
      .filter(x => sFilter === "ALL" || String(x.s) === String(sFilter))
      .map((x, idx) => ({
        idx,
        id: `${x.s}:${x.a}`,
        ref: `سورة ${SURAH_NAMES_AR[x.s] || x.s}: آية ${x.a}`,
        text: x.t,
        isCustom: false
      }));
  } else if (bState.activeTab === "HADITH") {
    const bFilter = bState.bookFilter || "ALL";
    items = (RAW_HADITH_DATA || [])
      .filter(x => bFilter === "ALL" || String(x.book || "") === String(bFilter))
      .map((x, idx) => ({
        idx,
        id: x.id,
        ref: x.ref || x.id,
        text: x.t,
        isCustom: false
      }));
  }

  if (q) {
    items = items.filter(it => {
      const hay = `${it.id} ${it.ref} ${it.category || ""} ${it.text}`;
      const hayNorm = typeof normalizeArabic === "function" ? normalizeArabic(hay) : hay;
      return hay.includes(q) || hayNorm.includes(qNorm);
    });
  }

  const totalItems = items.length;
  const pageSize = bState.pageSize || 25;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (bState.page > totalPages) bState.page = totalPages;
  if (bState.page < 1) bState.page = 1;

  const startIdx = (bState.page - 1) * pageSize;
  const pageSlice = items.slice(startIdx, startIdx + pageSize);

  const pageLbl = document.getElementById("lblDatasetPageInfo");
  if (pageLbl) pageLbl.textContent = `صفحة ${bState.page} من ${totalPages} (${totalItems} عنصر)`;

  const tbody = document.getElementById("tbodyDatasetBrowserRows");
  if (!tbody) return;

  if (!pageSlice.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-10 text-center text-slate-400 text-xs">
          ${bState.activeTab === "OUTSIDE_CORPUS"
            ? "لا توجد مقتبسات خارج القاعدة مضافة بعد. يمكنك إضافتها من الحقل أعلاه أو عبر FN Studio أثناء التحرير."
            : "لا توجد عناصر مطابقة للبحث أو التصفية الحالية."}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pageSlice.map((it, rowI) => {
    const seq = startIdx + rowI + 1;
    if (bState.activeTab === "ADHKAR") {
      const badgeHtml = it.isCustom
        ? `<span class="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold">مضاف / مخصص</span>`
        : `<span class="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/40 text-[10px] font-bold">مأثور أساسي</span>`;
      return `
        <tr class="hover:bg-slate-900/70 transition">
          <td class="py-2.5 px-3 font-mono text-slate-400 text-center w-12">${seq}</td>
          <td class="py-2.5 px-3 w-52">
            <div class="space-y-1">
              <input type="text" data-adhkar-ref-id="${escapeHtml(it.id)}" value="${escapeHtml(it.ref)}"
                class="inp-adhkar-row-ref w-full bg-slate-950/90 border border-slate-800 focus:border-violet-400 rounded-lg px-2.5 py-1 text-xs font-bold text-violet-200 focus:outline-none"
                placeholder="التصنيف أو المصدر..." />
              <div class="flex items-center justify-between px-0.5">
                ${badgeHtml}
                <span class="font-mono text-[10px] text-slate-500" dir="ltr">${escapeHtml(it.id)}</span>
              </div>
            </div>
          </td>
          <td class="py-2.5 px-3">
            <input type="text" data-adhkar-edit-id="${escapeHtml(it.id)}" value="${escapeHtml(it.text)}"
              class="inp-adhkar-row-text w-full bg-slate-950/90 border border-slate-800 hover:border-violet-500/40 focus:border-violet-400 rounded-xl px-3 py-2 text-violet-100 font-quran-text text-base focus:outline-none transition" />
          </td>
          <td class="py-2.5 px-3 w-44 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button type="button" data-save-adhkar-id="${escapeHtml(it.id)}" class="btn-save-adhkar-row px-2.5 py-1.5 rounded-xl bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/40 font-bold text-xs transition" title="حفظ التعديل">
                💾 حفظ
              </button>
              <button type="button" data-copy-corpus-text="${escapeHtml(it.text)}" class="btn-copy-corpus-row px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs transition" title="نسخ الذكر">
                📋
              </button>
              <button type="button" data-del-adhkar-id="${escapeHtml(it.id)}" class="btn-del-adhkar-row px-2 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-800 text-rose-200 border border-rose-500/40 text-xs transition" title="حذف الذكر">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    if (bState.activeTab === "OUTSIDE_CORPUS") {
      return `
        <tr class="hover:bg-slate-900/70 transition">
          <td class="py-2.5 px-3 font-mono text-slate-400 text-center w-12">${seq}</td>
          <td class="py-2.5 px-3 w-52">
            <input type="text" data-outside-ref-id="${escapeHtml(it.id)}" value="${escapeHtml(it.ref)}"
              class="inp-outside-row-ref w-full bg-slate-950/90 border border-cyan-500/30 focus:border-cyan-400 rounded-lg px-2.5 py-1 text-xs font-bold text-cyan-200 focus:outline-none" />
          </td>
          <td class="py-2.5 px-3">
            <input type="text" data-outside-text-id="${escapeHtml(it.id)}" value="${escapeHtml(it.text)}"
              class="inp-outside-row-text w-full bg-slate-950/90 border border-slate-800 focus:border-cyan-400 rounded-xl px-3 py-2 text-cyan-100 font-quran-text text-base focus:outline-none" />
          </td>
          <td class="py-2.5 px-3 w-44 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button type="button" data-save-outside-id="${escapeHtml(it.id)}" class="btn-save-outside-row px-2.5 py-1.5 rounded-xl bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/40 font-bold text-xs">
                💾 حفظ
              </button>
              <button type="button" data-copy-corpus-text="${escapeHtml(it.text)}" class="btn-copy-corpus-row px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs">
                📋
              </button>
              <button type="button" data-del-outside-id="${escapeHtml(it.id)}" class="btn-del-outside-row px-2 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-800 text-rose-200 border border-rose-500/40 text-xs">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    const badgeCls = bState.activeTab === "QURAN"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : "bg-amber-500/15 text-amber-300 border-amber-500/30";

    return `
      <tr class="hover:bg-slate-900/70 transition">
        <td class="py-2.5 px-3 font-mono text-slate-400 text-center w-12">${seq}</td>
        <td class="py-2.5 px-3 w-52">
          <div class="px-2.5 py-0.5 rounded-lg border ${badgeCls} font-bold inline-block text-xs">${escapeHtml(it.ref)}</div>
          <div class="text-[10px] font-mono text-slate-500 mt-0.5" dir="ltr">${escapeHtml(it.id)}</div>
        </td>
        <td class="py-2.5 px-3 font-quran-text text-base text-slate-100 leading-loose">${escapeHtml(it.text)}</td>
        <td class="py-2.5 px-3 w-36 text-center">
          <button type="button" data-copy-corpus-text="${escapeHtml(it.text)}" class="btn-copy-corpus-row px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold">
            📋 نسخ
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderAllViews() {
  renderKpiSummaryBar();
  renderFormattedLectureView();
  renderEditorLectureStage();
  renderFindingInspector();
  renderCaptionTimeline();
  if (currentState.activeSection === "datasets") {
    renderDatasetsSection();
  }
  if (currentState.activeSection === "editor" && currentState.editorDockTab === "fn") {
    updateFnStudioSuggestions();
    updateFnRangeVisualHighlight();
  }
  updateVideoCaptionOverlay(currentState.currentTime);
}

// -----------------------------------------------------------------------------
// Exporters (Formatted HTML, PDF/Print, Markdown, JSON, SRT, VTT, ASS)
// -----------------------------------------------------------------------------

function triggerFileDownload(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 250);
}

function buildFormattedPlainOrMarkdownLecture(format = "markdown") {
  const words = currentState.words || [];
  const prefs = getOutputDisplayPrefs();
  const findingStartMap = new Map();
  (currentState.detections || []).forEach(d => {
    if (typeof d.wordStartIdx === "number") findingStartMap.set(d.wordStartIdx, d);
  });

  const outTokens = [];
  let i = 0;
  while (i < words.length) {
    if (findingStartMap.has(i)) {
      const det = findingStartMap.get(i);
      const endW = Math.min(words.length - 1, Math.max(i, det.wordEndIdx));
      const fType = det.type || sourceTypeToCategorySlug(det.sourceType);
      const brackets = getBracketsForCategory(fType, prefs);
      const textBody = (det.snappedToCanonical && det.canonicalText)
        ? det.canonicalText
        : words.slice(i, endW + 1).map(w => w.word).join(" ");
      const refBadge = det.displayRef || det.reference ? ` [${det.displayRef || det.reference}]` : "";
      if (format === "markdown") {
        outTokens.push(`**${brackets.open}${textBody}${brackets.close}** *${refBadge}*`);
      } else {
        outTokens.push(`${brackets.open}${textBody}${brackets.close}${refBadge}`);
      }
      i = endW + 1;
    } else {
      outTokens.push(words[i].word);
      i++;
    }
  }
  return outTokens.join(" ");
}

function exportLectureAsStyledHTML() {
  const stageHtml = document.getElementById("formattedLectureStage")?.innerHTML || "";
  const docHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(currentState.lectureTitle || "محاضرة منسقة — Wahy Studio")}</title>
  <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'IBM Plex Sans Arabic', sans-serif; background: #0f172a; color: #f1f5f9; max-width: 900px; margin: 2rem auto; padding: 2rem; line-height: 2.1; }
    h1 { color: #34d399; border-bottom: 1px solid #334155; padding-bottom: 0.75rem; }
    .citation-ayah { background: rgba(16,185,129,0.18); border: 1px solid rgba(16,185,129,0.45); color: #6ee7b7; font-family: 'Amiri', serif; font-size: 1.2rem; padding: 0.1rem 0.45rem; border-radius: 0.4rem; }
    .citation-hadith { background: rgba(245,158,11,0.18); border: 1px solid rgba(245,158,11,0.45); color: #fcd34d; padding: 0.1rem 0.45rem; border-radius: 0.4rem; }
    .citation-dhikr { background: rgba(139,92,246,0.2); border: 1px solid rgba(139,92,246,0.48); color: #c4b5fd; padding: 0.1rem 0.45rem; border-radius: 0.4rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(currentState.lectureTitle || "محاضرة منسقة — Wahy Studio")}</h1>
  <div>${stageHtml}</div>
</body>
</html>`;
  triggerFileDownload("wahy-lecture-formatted.html", docHtml, "text/html;charset=utf-8");
  showToast("📄 تم تصدير المحاضرة المنسقة بصيغة Styled HTML");
}

function exportLectureAsMarkdown() {
  const mdBody = buildFormattedPlainOrMarkdownLecture("markdown");
  const md = `# ${currentState.lectureTitle || "محاضرة علمية — Wahy Studio"}\n\n${mdBody}\n`;
  triggerFileDownload("wahy-lecture.md", md, "text/markdown;charset=utf-8");
  showToast("📝 تم تصدير المحاضرة بصيغة Markdown (.md)");
}

function exportLectureAsPlainText() {
  const txtBody = buildFormattedPlainOrMarkdownLecture("plain");
  triggerFileDownload("wahy-lecture.txt", txtBody, "text/plain;charset=utf-8");
  showToast("📄 تم تصدير المحاضرة بصيغة نصية (.txt)");
}

function exportLectureAsJSON() {
  const payload = {
    version: "2.1.0",
    title: currentState.lectureTitle,
    exportedAt: new Date().toISOString(),
    full_text: currentState.rawTranscript,
    words: currentState.words,
    findings: currentState.detections,
    captions: currentState.captions
  };
  triggerFileDownload("wahy-lecture-data.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  showToast("📦 تم تصدير بيانات المحاضرة والمقتبسات والكابشن بصيغة JSON");
}

function exportLectureAsPrintSheet() {
  if (currentState.activeSection !== "display") {
    switchMainSection("display");
  }
  setTimeout(() => window.print(), 150);
}

// =============================================================================
// AI Verification, Request Telemetry & Laya Studio Renderers
// =============================================================================

function updateAiMetricsUI() {
  const m = currentState.aiVerification.metrics || {};
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  setEl("aiMetricEngineTime", `${m.engineDetectionTimeMs || 0} ms`);
  setEl("aiMetricTotalReq", `${m.successfulRequests || 0} / ${m.totalRequests || 0} طلب`);
  setEl("aiMetricFullTime", `${((m.requestsFullTimeMs || 0) / 1000).toFixed(2)} s`);
  setEl("aiMetricAvgTime", `${m.avgRequestTimeMs || 0} ms`);
  setEl("aiMetricTotalTokens", `${(m.totalContextTokens || 0).toLocaleString()} توكن (${(m.totalContextChars || 0).toLocaleString()} حرف)`);
  setEl("aiMetricAvgContext", `${m.avgContextTokensPerRequest || 0} توكن/طلب`);
  setEl("aiMetricVerdicts", `🟢 ${m.verdictCounts?.CORRECT || 0} | 🔴 ${m.verdictCounts?.FALSE || 0} | 🟡 ${m.verdictCounts?.NOT_SURE || 0}`);
  setEl("aiMetricCost", `$${Number(m.estimatedTotalCostUsd || 0).toFixed(5)}`);

  const badgeCount = document.getElementById("navBadgeAiVerifiedCount");
  if (badgeCount) {
    const verifiedDets = (currentState.detections || []).filter(d => d.aiVerification && d.aiVerification.status === "VERIFIED").length;
    badgeCount.textContent = String(verifiedDets);
  }
}

function renderLayaDatasetBankStats() {
  const records = currentState.aiVerification.trainingDatasetRecords || [];
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  let cCorrect = 0;
  let cFalse = 0;
  let cNotSure = 0;
  let cHuman = 0;
  let cAi = 0;

  records.forEach(r => {
    const v = r.answers?.verdict?.choice || r.verdict;
    if (v === "CORRECT") cCorrect++;
    else if (v === "FALSE") cFalse++;
    else if (v === "NOT_SURE") cNotSure++;

    if (r.meta?.human_verified || r.humanOverride) cHuman++;
    else cAi++;
  });

  setEl("lblLayaTotalRecords", records.length);
  setEl("lblLayaCorrectCount", cCorrect);
  setEl("lblLayaFalseCount", cFalse);
  setEl("lblLayaNotSureCount", cNotSure);
  setEl("lblLayaHumanCount", cHuman);
  setEl("lblLayaAiCount", cAi);
}

async function checkAndUpdateLayaBackendStatus() {
  const statusBadge = document.getElementById("lblLayaEngineStatus");
  const vramLabel = document.getElementById("lblGpuVramSummary");

  try {
    const res = await fetch("/api/laya/status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentState.aiVerification.layaBackendReady = true;

    if (statusBadge) {
      if (data.loaded) {
        statusBadge.textContent = data.device === "cuda" ? "⚡ مُحمّل على CUDA (FP16)" : "💻 مُحمّل على CPU";
        statusBadge.className = "px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold";
      } else {
        statusBadge.textContent = "جاهز في الخادم (غير محمل)";
        statusBadge.className = "px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px]";
      }
    }

    if (vramLabel) {
      if (data.vram?.cuda_available) {
        vramLabel.textContent = `${data.vram.free_mb} MB متاح / ${data.vram.total_mb} MB (${data.vram.gpu_name || "GTX 1050"})`;
      } else {
        vramLabel.textContent = "معالج مركزي CPU فقط";
      }
    }
  } catch (_) {
    currentState.aiVerification.layaBackendReady = false;
    if (statusBadge) {
      statusBadge.textContent = "الخادم الخلفي غير متصل";
      statusBadge.className = "px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px]";
    }
    if (vramLabel) {
      vramLabel.textContent = "يتطلب تشغيل backend/app.py";
    }
  }
}

function renderAiRequestLogsTable() {
  const tbody = document.getElementById("tbodyAiRequestLogs");
  if (!tbody) return;

  const logs = currentState.aiVerification.requestLogs || [];
  if (!logs.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-8 text-slate-500">لا توجد طلبات تدقيق مسجلة حتى الآن. انقر على «بدء التدقيق الذكي» لبدء الفحص.</td>
      </tr>
    `;
    return;
  }

  const rowsHtml = logs.map((log, idx) => {
    const provBadge = log.provider === "gemini"
      ? '<span class="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold">✨ Gemini</span>'
      : (log.provider === "openrouter_jev"
        ? '<span class="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">🎯 JEV</span>'
        : (log.provider === "local_laya"
          ? '<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">🖥️ Laya</span>'
          : '<span class="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">💬 OpenRouter</span>'));

    const isSuccess = log.status === "SUCCESS";
    const statusDot = isSuccess ? "🟢" : "🔴";

    // Verdict badges & overrides
    const verdictsHtml = (log.verdicts || []).map((v, vIdx) => {
      const vColor = v === "CORRECT"
        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
        : (v === "FALSE" ? "bg-rose-500/20 text-rose-300 border-rose-500/40" : "bg-amber-500/20 text-amber-300 border-amber-500/40");
      const vLabel = v === "CORRECT" ? "صحيح ✓" : (v === "FALSE" ? "خاطئ ✕" : "غير متأكد ؟");
      return `<span class="px-2 py-0.5 rounded border text-[10px] font-bold ${vColor}">${vLabel}</span>`;
    }).join(" ");

    return `
      <tr class="hover:bg-slate-900/60 transition">
        <td class="py-2.5 px-3 text-center font-mono text-slate-400">${idx + 1}</td>
        <td class="py-2.5 px-3">
          <div class="flex items-center gap-1.5">
            <span>${statusDot}</span>
            <span class="font-mono text-slate-300">${escapeHtml(log.timestamp || "")}</span>
          </div>
          <div class="mt-0.5">${provBadge} <span class="font-mono text-[10px] text-slate-400">${escapeHtml(log.model || "")}</span></div>
        </td>
        <td class="py-2.5 px-3">
          <div class="font-semibold text-slate-200 line-clamp-2" title="${escapeHtml(log.findingsSummary || "")}">
            ${escapeHtml(log.findingsSummary || "—")}
          </div>
          <span class="text-[10px] text-slate-400">${log.findingsCount || 1} مقتبس</span>
        </td>
        <td class="py-2.5 px-3 text-center">
          <div class="flex items-center justify-center gap-1 flex-wrap">
            ${verdictsHtml}
          </div>
        </td>
        <td class="py-2.5 px-3 text-center font-mono text-slate-300 text-[11px]">
          <div>In: ${log.inputTokens || 0}</div>
          <div class="text-[10px] text-slate-400">Out: ${log.outputTokens || 0}</div>
        </td>
        <td class="py-2.5 px-3 text-center font-mono text-slate-300">
          ${log.latencyMs ? `${log.latencyMs} ms` : "—"}
        </td>
        <td class="py-2.5 px-3 text-center font-mono text-emerald-400">
          $${Number(log.costUsd || 0).toFixed(6)}
        </td>
        <td class="py-2.5 px-3 text-center">
          <button type="button" class="btn-inspect-payload px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-[10px] font-bold" data-log-idx="${idx}">
            🔍 عرض
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rowsHtml;

  // Bind inspector payload buttons
  tbody.querySelectorAll(".btn-inspect-payload").forEach(btn => {
    btn.addEventListener("click", () => {
      const logIdx = parseInt(btn.getAttribute("data-log-idx"), 10);
      const logItem = logs[logIdx];
      if (!logItem) return;

      const modal = document.getElementById("aiPayloadModal");
      const summaryEl = document.getElementById("aiPayloadSummaryText");
      const reqPre = document.getElementById("preAiPayloadRequest");
      const respPre = document.getElementById("preAiPayloadResponse");

      if (summaryEl) {
        summaryEl.textContent = `${logItem.model} • ${logItem.provider} • زمن: ${logItem.latencyMs || 0}ms • تكلفة: $${Number(logItem.costUsd || 0).toFixed(6)}`;
      }
      if (reqPre) {
        reqPre.textContent = JSON.stringify(logItem.requestPayload || {}, null, 2);
      }
      if (respPre) {
        respPre.textContent = JSON.stringify(logItem.rawResponse || {}, null, 2);
      }
      if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
      }
    });
  });
}

function renderAiLogsSection() {
  updateAiMetricsUI();
  renderAiRequestLogsTable();
  renderLayaDatasetBankStats();
  checkAndUpdateLayaBackendStatus();

  // Populate config inputs from state
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal("inpGeminiApiKey", currentState.aiVerification.geminiApiKey || "");
  setVal("selGeminiModel", currentState.aiVerification.geminiModel || "gemini-3.5-flash-lite");
  const chkFree = document.getElementById("chkGeminiFreeTierMode");
  if (chkFree) chkFree.checked = Boolean(currentState.aiVerification.geminiFreeTierMode);
  setVal("inpGeminiRpmLimit", currentState.aiVerification.geminiRpmLimit || 12);
  setVal("inpGeminiBatchSize", currentState.aiVerification.geminiBatchSize || 5);

  setVal("inpOpenRouterApiKey", currentState.aiVerification.openRouterApiKey || "");
  setVal("selOpenRouterJevModel", currentState.aiVerification.openRouterJevModel || "typesafe/jev-1.14");
  const selectedModelLabel = document.getElementById("lblOpenRouterSelectedModelDisplay");
  if (selectedModelLabel) {
    selectedModelLabel.textContent = currentState.aiVerification.openRouterSelectedModel || "deepseek/deepseek-chat";
  }

  // Pre-fetch catalog in background if empty
  if (typeof WahyAiVerifier === "object" && typeof WahyAiVerifier.fetchOpenRouterModelsCatalog === "function") {
    WahyAiVerifier.fetchOpenRouterModelsCatalog().catch(() => {});
  }
}

window.updateAiMetricsUI = updateAiMetricsUI;
window.renderAiRequestLogsTable = renderAiRequestLogsTable;
window.renderLayaDatasetBankStats = renderLayaDatasetBankStats;
window.renderAiLogsSection = renderAiLogsSection;

window.WahyRenderer = {
  switchMainSection,
  switchEditorSubMode,
  renderAllViews,
  renderFormattedLectureView,
  renderEditorLectureStage,
  renderFindingInspector,
  renderCaptionTimeline,
  renderDatasetsSection,
  renderAiLogsSection,
  renderAiRequestLogsTable,
  updateAiMetricsUI,
  renderLayaDatasetBankStats,
  updateVideoCaptionOverlay,
  seekToMediaTimestamp,
  toggleSimulatedPlayback,
  setWorkspaceLayoutMode,
  exportLectureAsStyledHTML,
  exportLectureAsMarkdown,
  exportLectureAsPlainText,
  exportLectureAsJSON,
  exportLectureAsPrintSheet,
  startInlineWordEdit,
  triggerFileDownload
};
