// =============================================================================
// Wahy Studio (Wahy-Transcriber v2.1) — Renderer, Section Router,
// Word Progress Indicator, Smart Editor Canvas & Datasets/Adhkar Studio
// File: js/render.js
// =============================================================================

function switchMainSection(sectionName) {
  const validSections = ["input", "display", "editor", "datasets", "ai_logs", "training_data"];
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
  } else if (target === "training_data") {
    renderTrainingDataHubTable();
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
      if (visFilter.showClippedOnly) {
        const isClipped = Boolean(det.aiVerification?.boundaryStatus && det.aiVerification.boundaryStatus !== "COMPLETE_SPAN" && v !== "FALSE");
        if (!isClipped) shouldRenderAsCitation = false;
      }
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

      // Module 7: Distinct Verification Badges & Visual Distinction
      const isVerifiedStatus = det.aiVerification && (det.aiVerification.verdict === "CORRECT" || det.userApproved);
      const isUnverifiedStatus = !det.aiVerification || det.aiVerification.status === "UNVERIFIED" || det.aiVerification.status === "IDLE";
      
      let verificationStyleClass = "";
      if (isVerifiedStatus) {
        verificationStyleClass = " border-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.25)]";
      } else if (isUnverifiedStatus) {
        verificationStyleClass = " border-dashed border-slate-600/70 opacity-90";
      }

      if (v === "FALSE") {
        catClass += " ai-marked-false";
      }

      const selectedClass = isSelected ? "citation-selected-ring" : "";
      const dimmedClass = (filterCat !== "ALL" && filterCat !== fType) ? "opacity-35" : "";

      // AI micro-badge & Module 7 Verification Badges
      let aiBadgeHtml = "";
      if (det.aiVerification && det.aiVerification.status === "VERIFIED") {
        const confPct = Math.round((det.aiVerification.confidence || 0.88) * 100);
        if (v === "CORRECT" || det.userApproved) {
          aiBadgeHtml = `<span class="ai-badge ai-badge-correct" title="🟢 اقتباس مدقق ومطابق (${confPct}%)">🟢 مدقق ${confPct}%</span>`;
        } else if (v === "NOT_SURE") {
          aiBadgeHtml = `<span class="ai-badge ai-badge-not-sure" title="🟡 شبه اقتباس غير مؤكد (${confPct}%)">🟡 ${confPct}%</span>`;
        } else if (v === "FALSE") {
          aiBadgeHtml = `<span class="ai-badge ai-badge-false" title="🔴 مستبعد / كلام عادي (${confPct}%)">🔴 كلام عادي</span>`;
        }
      } else if (det.aiVerification && det.aiVerification.status === "PENDING") {
        aiBadgeHtml = `<span class="ai-badge ai-badge-pending" title="جاري التدقيق بالذكاء الاصطناعي...">⏳ فحص...</span>`;
      } else {
        aiBadgeHtml = `<span class="ai-badge text-[10px] bg-slate-800/80 text-slate-400 border border-slate-700/60" title="⚪ غير مفحوص">⚪ غير مفحوص</span>`;
      }

      // Boundary status warning badge
      let boundaryBadgeHtml = "";
      if (det.aiVerification && det.aiVerification.boundaryStatus && det.aiVerification.boundaryStatus !== "COMPLETE_SPAN" && v !== "FALSE") {
        const bStatus = det.aiVerification.boundaryStatus;
        if (bStatus === "MISSING_START") {
          boundaryBadgeHtml = `<span class="px-1.5 py-0.5 rounded bg-orange-500/25 text-orange-200 border border-orange-400/50 text-[10px] font-bold inline-flex items-center gap-1" title="تنبيه الذكاء الاصطناعي: مقتبس ناقص من البداية">✂️ ناقص البداية</span>`;
        } else if (bStatus === "MISSING_END") {
          boundaryBadgeHtml = `<span class="px-1.5 py-0.5 rounded bg-orange-500/25 text-orange-200 border border-orange-400/50 text-[10px] font-bold inline-flex items-center gap-1" title="تنبيه الذكاء الاصطناعي: مقتبس ناقص من النهاية">✂️ ناقص النهاية</span>`;
        } else if (bStatus === "MISSING_BOTH") {
          boundaryBadgeHtml = `<span class="px-1.5 py-0.5 rounded bg-orange-500/25 text-orange-200 border border-orange-400/50 text-[10px] font-bold inline-flex items-center gap-1" title="تنبيه الذكاء الاصطناعي: مقتبس ناقص الطرفين">✂️ ناقص الطرفين</span>`;
        }
      }

      // Module 1.2: Rasm Qiyasi toggle in editor or display
      let innerWordsHtml = "";
      const shouldShowRasmQiyasi = (isEditorMode && currentState.editorViewRasmQiyasi) || (!isEditorMode && det.snappedToCanonical);
      if (shouldShowRasmQiyasi && det.canonicalText) {
        innerWordsHtml = `<span class="font-bold text-accent-ayah">${escapeHtml(det.canonicalText)}</span>`;
      } else {
        const spanWordHtmls = [];
        for (let k = i; k <= endW; k++) {
          const wObj = words[k];
          const tokCls = isEditorMode
            ? "lecture-word-token raw-tok-item editor-word-selectable"
            : "lecture-word-token";
          const tip = isEditorMode
            ? `كلمة #${k + 1} [${formatSecondsToShortTime(wObj.start)}] • انقر لتحديد المدى أو نقر مزدوج لتعديل الكلمة`
            : `انقر للانتقال إلى التوقيت [${formatSecondsToShortTime(wObj.start)}] • نقر مزدوج لتصحيح الكلمة`;
          spanWordHtmls.push(
            `<span class="${tokCls}" data-word-idx="${k}" data-raw-tok-idx="${k}" data-start-time="${wObj.start}" title="${tip}">${escapeHtml(wObj.word)}</span>`
          );
        }
        innerWordsHtml = spanWordHtmls.join(" ");
      }

      // Module 1.2: Full canonical unit preview block inside editor
      let fullMatnBlockHtml = "";
      if (isEditorMode && currentState.editorViewFullCanonicalSpan) {
        const unit = (activeMatcher?.units && det.unitId) ? activeMatcher.units.get(det.unitId) : null;
        const fullCanonical = unit ? (unit.vocalizedWords ? unit.vocalizedWords.join(" ") : unit.text) : (det.canonicalText || "");
        if (fullCanonical) {
          fullMatnBlockHtml = `
            <div class="block my-1 px-3 py-1.5 rounded-xl bg-bg-surface-sunken border border-accent-ayah/40 text-xs font-arabic-text text-text-primary">
              <span class="text-accent-ayah text-[10px] font-bold block mb-0.5">📜 المتن الكامل للمرجع من المصدر:</span>
              <div class="leading-relaxed select-text">${escapeHtml(fullCanonical)}</div>
            </div>
          `;
        }
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
        <span class="${catClass} ${selectedClass} ${dimmedClass} ${verificationStyleClass} inline-block my-1"
              data-finding-idx="${dIdx}"
              data-start-time="${det.startTime || words[i].start}"
              title="انقر لفحص وتعديل المقتبس [${escapeHtml(refText)}]">
          ${aiBadgeHtml}
          ${boundaryBadgeHtml}
          ${fullMatnBlockHtml}
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
 * Module 1.4: Interactive Reference Word-Chip Grid & Flexible Substitution
 */
function renderReferenceWordChips(det, containerEl) {
  if (!containerEl) return;
  const unit = (activeMatcher?.units && det.unitId) ? activeMatcher.units.get(det.unitId) : null;
  const words = unit ? (unit.vocalizedWords || unit.text.split(/\s+/)) : (det.canonicalText || "").split(/\s+/);

  if (!words.length) {
    containerEl.innerHTML = `<div class="text-text-muted text-xs p-3">لا يتوفر متن كامل لهذا المرجع.</div>`;
    return;
  }

  // Active selected indices in the canonical unit
  if (!det._selectedChipIndices) {
    det._selectedChipIndices = new Set();
    if (Array.isArray(det.qSegments) && det.qSegments.length) {
      det.qSegments.forEach(([qStart, qEnd]) => {
        for (let i = qStart; i < qEnd; i++) {
          if (i >= 0 && i < words.length) det._selectedChipIndices.add(i);
        }
      });
    }
    if (!det._selectedChipIndices.size) {
      const rawTokens = (det.matchedText || "").split(/\s+/).map(w => w.replace(/[^\u0621-\u064A]/g, ""));
      words.forEach((w, wIdx) => {
        const cleanW = w.replace(/[^\u0621-\u064A]/g, "");
        if (cleanW && rawTokens.includes(cleanW)) {
          det._selectedChipIndices.add(wIdx);
        }
      });
    }
    if (!det._selectedChipIndices.size) {
      words.forEach((_, wIdx) => det._selectedChipIndices.add(wIdx));
    }
  }

  const activeIndices = det._selectedChipIndices;

  let html = `
    <div class="rounded-xl bg-bg-surface-sunken p-3.5 border border-border-subtle space-y-2.5">
      <div class="flex items-center justify-between text-[11px] text-text-muted">
        <span class="font-semibold text-text-secondary">المتن الكامل للمرجع (حدد الكلمات المراد إدراجها بالدرس):</span>
        <div class="flex items-center gap-1.5">
          <span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[10px] font-bold">
            محدد: ${activeIndices.size} / ${words.length} كلمة
          </span>
          <button type="button" id="btnChipsSelectAll" class="text-[10px] text-sky-400 hover:underline">تحديد الكل</button>
          <span class="text-text-muted">|</span>
          <button type="button" id="btnChipsClearAll" class="text-[10px] text-rose-400 hover:underline">تفريغ</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5 leading-loose text-base font-arabic-text" dir="rtl" id="refChipsBox">
  `;

  words.forEach((word, wIdx) => {
    const isMatched = activeIndices.has(wIdx);
    const chipClass = isMatched
      ? "bg-emerald-600/30 text-emerald-200 border-emerald-500/60 font-bold shadow-sm"
      : "bg-bg-surface text-text-muted border-border-subtle hover:border-text-secondary opacity-75";

    html += `
      <span class="ref-word-chip px-2 py-0.5 rounded-lg border text-sm cursor-pointer transition select-none ${chipClass}"
            data-ref-word-idx="${wIdx}" title="انقر لتضمين/استبعاد هذه الكلمة">
        ${escapeHtml(word)}
      </span>
    `;
  });

  html += `
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <div class="text-[11px] text-text-muted">يمكنك اختيار أي كلمات من الحديث أو الآية حتى لو لم ينطقها الشيخ لإكمال المتن.</div>
        <button type="button" id="btnApplyCustomRefSpan" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition">
          ✓ تطبيق الكلمات المختارة على النص
        </button>
      </div>
    </div>
  `;

  containerEl.innerHTML = html;

  let lastClickedIdx = -1;
  containerEl.querySelectorAll(".ref-word-chip").forEach(chip => {
    chip.addEventListener("click", (e) => {
      const idx = parseInt(chip.getAttribute("data-ref-word-idx"), 10);
      if (e.shiftKey && lastClickedIdx >= 0) {
        const low = Math.min(lastClickedIdx, idx);
        const high = Math.max(lastClickedIdx, idx);
        for (let k = low; k <= high; k++) activeIndices.add(k);
      } else {
        if (activeIndices.has(idx)) activeIndices.delete(idx);
        else activeIndices.add(idx);
        lastClickedIdx = idx;
      }
      renderReferenceWordChips(det, containerEl);
    });
  });

  containerEl.querySelector("#btnChipsSelectAll")?.addEventListener("click", () => {
    words.forEach((_, idx) => activeIndices.add(idx));
    renderReferenceWordChips(det, containerEl);
  });

  containerEl.querySelector("#btnChipsClearAll")?.addEventListener("click", () => {
    activeIndices.clear();
    renderReferenceWordChips(det, containerEl);
  });

  containerEl.querySelector("#btnApplyCustomRefSpan")?.addEventListener("click", () => {
    applyReferenceWordsToTranscript(det, Array.from(activeIndices).sort((a, b) => a - b));
  });
}

function applyReferenceWordsToTranscript(det, selectedUnitWordIndices) {
  if (!det) return;
  const unit = (activeMatcher?.units && det.unitId) ? activeMatcher.units.get(det.unitId) : null;
  const canonicalWords = unit ? (unit.vocalizedWords || unit.text.split(/\s+/)) : (det.canonicalText || "").split(/\s+/);
  if (!canonicalWords || !canonicalWords.length) {
    showToast("⚠️ لا يتوفر متن كامل لهذا المرجع.");
    return;
  }
  if (!selectedUnitWordIndices || !selectedUnitWordIndices.length) {
    showToast("⚠️ يرجى اختيار كلمة واحدة على الأقل من المتن لإدراجها.");
    return;
  }

  const selectedWords = selectedUnitWordIndices.map(idx => canonicalWords[idx]).filter(Boolean);
  if (!selectedWords.length) return;

  const wStart = det.wordStartIdx;
  const wEnd = det.wordEndIdx;
  const origWordCount = Math.max(1, wEnd - wStart + 1);

  const startSec = Number(currentState.words[wStart]?.start ?? 0);
  const endSec = Number(currentState.words[wEnd]?.end ?? (startSec + selectedWords.length * 0.4));
  const dur = Math.max(0.2, endSec - startSec);
  const step = dur / selectedWords.length;

  const newWords = selectedWords.map((w, idx) => ({
    id: wStart + idx,
    word: w,
    start: +(startSec + idx * step).toFixed(2),
    end: +(startSec + (idx + 1) * step).toFixed(2),
    char_start: 0,
    char_end: 0
  }));

  currentState.words.splice(wStart, origWordCount, ...newWords);

  det.wordEndIdx = wStart + newWords.length - 1;
  det.matchedText = selectedWords.join(" ");
  det.canonicalText = selectedWords.join(" ");
  det.snappedToCanonical = true;

  const delta = newWords.length - origWordCount;
  if (delta !== 0) {
    currentState.detections.forEach(otherDet => {
      if (otherDet !== det) {
        if (otherDet.wordStartIdx > wStart) otherDet.wordStartIdx += delta;
        if (otherDet.wordEndIdx >= wStart) otherDet.wordEndIdx += delta;
      }
    });
  }

  syncRawTextFromWords();
  recalculateCaptionsFromCurrentFindings();
  renderAllViews();
  renderFindingInspector();
  showToast(`✨ تم إدراج ${newWords.length} كلمة من المتن وتحديث الكابشن!`);
}

/**
 * Module 1.11: Deletion Intent Dialog & Training Telemetry
 */
function openDeleteIntentModal(findingIdx) {
  const modal = document.getElementById("modalDeleteIntent");
  const det = currentState.detections[findingIdx];
  if (!modal || !det) {
    deleteFinding(findingIdx);
    return;
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");

  const closeFn = () => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  };

  const cancelBtn = document.getElementById("btnCancelDeleteIntent");
  if (cancelBtn) {
    cancelBtn.onclick = closeFn;
  }

  modal.querySelectorAll("[data-delete-intent]").forEach(btn => {
    btn.onclick = async () => {
      const intent = btn.getAttribute("data-delete-intent");
      closeFn();

      if (intent === "FALSE_POSITIVE") {
        det.humanGoldVerdict = "FALSE";
        det.userApproved = true;
        det.isHardNegative = true;
        if (typeof saveDecisionToTrainingDB === "function") {
          await saveDecisionToTrainingDB(det, "DELETE_INTENT_FALSE_POSITIVE");
        }
        deleteFinding(findingIdx);
        showToast("🗑️ تم حذف المقتبس وحفظه كعينة سلبية ذهبية لتدريب Laya!");
      } else if (intent === "BOUNDARY_RESELECT") {
        const s = det.wordStartIdx;
        const e = det.wordEndIdx;
        deleteFinding(findingIdx);
        switchEditorDockTab("fn");
        const startInp = document.getElementById("inpFnStartIdx");
        const endInp = document.getElementById("inpFnEndIdx");
        if (startInp) startInp.value = String(s);
        if (endInp) endInp.value = String(e + 1);
        currentState.fnClickStep = 0;
        if (typeof updateFnStudioSuggestions === "function") updateFnStudioSuggestions();
        if (typeof updateFnRangeVisualHighlight === "function") updateFnRangeVisualHighlight();
        showToast("🔄 تم حذف المقتبس لتعديل التظليل وإعادة إدراجه");
      } else {
        // TEST_SCRATCHPAD
        deleteFinding(findingIdx);
        showToast("🗑️ تم حذف الاقتباس الفحصي فوراً دون تسجيل.");
      }
    };
  });
}

/**
 * Module 1.8: AI Telemetry Deep Linking
 */
function highlightAndOpenAiRequestLog(reqId) {
  switchMainSection("ai_logs");
  const tbody = document.getElementById("tbodyAiRequestLogs");
  if (!tbody) return;

  const row = tbody.querySelector(`tr[data-req-id="${reqId}"]`) || tbody.querySelector("tr");
  if (row) {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("ring-2", "ring-sky-400", "bg-sky-950/60");
    setTimeout(() => {
      row.classList.remove("ring-2", "ring-sky-400", "bg-sky-950/60");
    }, 3000);

    const btnInspect = row.querySelector(".btnInspectPayload");
    if (btnInspect) {
      btnInspect.click();
    }
  }
}

/**
 * Module 1.10: Seamless Navigation to Adhkar Studio
 */
function jumpToAdhkarStudioWithFilter(dhikrText, dhikrRef) {
  switchMainSection("datasets");
  const dsTabBtn = document.getElementById("btnDsTab_ADHKAR");
  if (dsTabBtn) dsTabBtn.click();

  const searchInp = document.getElementById("inpDatasetBrowserSearch");
  if (searchInp && dhikrText) {
    searchInp.value = dhikrText.slice(0, 30).trim();
    if (typeof renderDatasetBrowserTable === "function") {
      renderDatasetBrowserTable();
    }
  }
  showToast(`📿 تم فتح استوديو الأذكار وتحديد: ${dhikrRef || "الذكر المختار"}`);
}

/**
 * Render Finding Inspector inside Citation & Editorial Studio Dock (Overhauled)
 */
function renderFindingInspector() {
  const panel = document.getElementById("findingInspectorBody");
  if (!panel) return;

  const idx = currentState.selectedPredIndex;
  const det = (idx >= 0 && idx < currentState.detections.length) ? currentState.detections[idx] : null;

  if (!det) {
    panel.innerHTML = `
      <div class="p-6 text-center text-xs text-text-muted space-y-2">
        <div class="text-2xl">🔍</div>
        <div class="font-bold text-text-secondary">لم يتم تحديد أي مقتبس للفحص</div>
        <div class="text-[11px] leading-relaxed">انقر على أي آية أو حديث أو ذكر ملون داخل نص المحاضرة لفحصه وتعديل حدوده أو متنه، أو استخدم «إضافة مقتبس يدوي» لإدراج مقتبس جديد.</div>
      </div>
    `;
    return;
  }

  const fType = det.type || sourceTypeToCategorySlug(det.sourceType);
  const startW = currentState.words[det.wordStartIdx]?.word || "";
  const endW = currentState.words[det.wordEndIdx]?.word || "";
  const prevWordBeforeStart = det.wordStartIdx > 0 ? (currentState.words[det.wordStartIdx - 1]?.word || "") : "لا يوجد";
  const nextWordAfterEnd = det.wordEndIdx < currentState.words.length - 1 ? (currentState.words[det.wordEndIdx + 1]?.word || "") : "لا يوجد";

  const candidates = Array.isArray(det.candidates) && det.candidates.length
    ? det.candidates
    : (Array.isArray(det.candidateRefs) && det.candidateRefs.length
        ? det.candidateRefs.map((r, i) => ({
            unitId: (det.candidateUnitIds && det.candidateUnitIds[i]) || det.unitId,
            displayRef: r,
            score: Math.round((det.confidence || 0.9) * 100),
            textPreview: det.matchedText || ""
          }))
        : [{
            unitId: det.unitId,
            displayRef: det.displayRef || det.reference,
            score: Math.round((det.confidence || 0.9) * 100),
            textPreview: det.matchedText || ""
          }]);

  panel.innerHTML = `
    <div class="space-y-4 text-xs font-arabic-ui">
      <!-- Top Action Bar -->
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border-subtle">
        <div class="flex items-center gap-1.5">
          <span class="text-text-muted font-semibold">التصنيف:</span>
          <button type="button" data-set-cat="ayah" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "ayah" ? "bg-emerald-600 text-white border-emerald-400" : "bg-bg-surface-elevated text-text-secondary border-border-subtle hover:text-text-primary"}">آية</button>
          <button type="button" data-set-cat="hadith" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "hadith" ? "bg-amber-600 text-white border-amber-400" : "bg-bg-surface-elevated text-text-secondary border-border-subtle hover:text-text-primary"}">حديث</button>
          <button type="button" data-set-cat="dhikr" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "dhikr" ? "bg-violet-600 text-white border-violet-400" : "bg-bg-surface-elevated text-text-secondary border-border-subtle hover:text-text-primary"}">ذكر</button>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" id="btnInspectorPlayQuote" class="px-3 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/35 text-sky-300 border border-sky-500/40 font-bold transition flex items-center gap-1" title="الاستماع لتوقيت هذا المقتبس">
            <span>▶</span>
            <span>استماع</span>
          </button>
          <button type="button" id="btnInspectorDeleteFinding" class="px-3 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-800 text-rose-200 border border-rose-500/40 font-bold transition flex items-center gap-1">
            <span>🗑️</span>
            <span>حذف</span>
          </button>
        </div>
      </div>

      <!-- Section 1: Raw Spoken Lecture Transcript Card (Prominent & Clear) -->
      <div class="rounded-2xl bg-bg-surface-elevated border border-border-subtle p-4 space-y-2">
        <div class="flex items-center justify-between text-text-muted text-[11px] font-semibold">
          <span>النص المنطوق في المحاضرة (Raw ASR):</span>
          <span class="font-mono text-text-secondary" dir="ltr">كلمات: #${det.wordStartIdx + 1} إلى #${det.wordEndIdx + 1} (${formatSecondsToShortTime(det.startTime)} → ${formatSecondsToShortTime(det.endTime)})</span>
        </div>
        <div class="text-base sm:text-lg font-arabic-text text-text-primary leading-relaxed bg-bg-surface-sunken p-3.5 rounded-xl border border-border-subtle select-text">
          "${escapeHtml(det.matchedText || "")}"
        </div>
      </div>

      <!-- Section 2: Reference Header, Candidates Carousel & Search -->
      <div class="rounded-2xl bg-bg-surface-elevated border border-border-subtle p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
          <div>
            <span class="text-text-muted text-[11px]">المرجع المعتمد:</span>
            <h4 class="text-sm sm:text-base font-bold text-accent-ayah mt-0.5">${escapeHtml(det.displayRef || det.reference || "غير محدد")}</h4>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <button type="button" id="btnToggleAllCandidates" class="px-3 py-1.5 rounded-xl bg-bg-surface border border-border-medium text-text-secondary hover:text-text-primary text-xs font-semibold transition flex items-center gap-1">
              <span>📚</span>
              <span>المراجع البديلة (${candidates.length})</span>
            </button>
            <button type="button" id="btnOpenSearchAddRef" class="px-3 py-1.5 rounded-xl bg-accent-matn/15 border border-accent-matn/40 text-accent-matn text-xs font-bold transition flex items-center gap-1">
              <span>🔍</span>
              <span>بحث في القاعدة</span>
            </button>
            ${(det.sourceType === "ADHKAR" || det.isOutsideCorpus) ? `
              <button type="button" id="btnInspectorOpenAdhkarStudio" class="px-3 py-1.5 rounded-xl bg-accent-dhikr/15 border border-accent-dhikr/40 text-accent-dhikr text-xs font-bold transition flex items-center gap-1">
                <span>📿</span>
                <span>فتح في استوديو الأذكار</span>
              </button>
            ` : ""}
          </div>
        </div>

        <!-- Section 3.5: Multi-Candidate Reference Accordion -->
        <div id="inspectorAllCandidatesAccordion" class="hidden rounded-xl bg-bg-surface-sunken border border-border-subtle p-3 space-y-2 mt-2">
          <div class="text-[11px] font-bold text-text-secondary mb-1">المراجع البديلة المقترحة في القاعدة:</div>
          <div class="space-y-1.5 max-h-52 overflow-y-auto">
            ${candidates.map((c, cIdx) => `
              <div class="p-2.5 rounded-lg bg-bg-surface border border-border-subtle hover:border-accent-ayah flex items-center justify-between gap-2 transition" data-candidate-idx="${cIdx}">
                <div class="truncate max-w-[220px] sm:max-w-xs">
                  <div class="font-bold text-xs text-text-primary">${escapeHtml(c.displayRef || c.reference || "")}</div>
                  <div class="text-[11px] text-text-muted truncate">${escapeHtml(c.textPreview || "")}</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[10px] font-bold">${c.score || 90}%</span>
                  <button type="button" class="btnSetAsActiveRef px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition" data-cand-unit-id="${c.unitId || ""}">اعتماد</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <!-- Section 3: Word-Chip Grid for the Reference -->
        <div id="inspectorWordChipGridContainer" class="space-y-2"></div>
      </div>

      <!-- Section 4: Boundary Shift Controls (+1W / -1W with Live Word Previews) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- Start Boundary Card -->
        <div class="rounded-xl bg-bg-surface-sunken border border-border-subtle p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-text-muted">بداية المقتبس:</span>
            <span class="font-mono text-emerald-400 font-bold truncate max-w-[130px]">#${det.wordStartIdx + 1} «${escapeHtml(startW)}»</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" id="btnStartWordMinus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-emerald-500 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-emerald-300">-1W (توسيع يمين)</span>
              <span class="text-[10px] text-text-muted truncate max-w-[110px]">+ «${escapeHtml(prevWordBeforeStart)}»</span>
            </button>
            <button type="button" id="btnStartWordPlus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-rose-500 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-rose-300">+1W (تقليص)</span>
              <span class="text-[10px] text-text-muted truncate max-w-[110px]">- «${escapeHtml(startW)}»</span>
            </button>
          </div>
        </div>

        <!-- End Boundary Card -->
        <div class="rounded-xl bg-bg-surface-sunken border border-border-subtle p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-text-muted">نهاية المقتبس:</span>
            <span class="font-mono text-emerald-400 font-bold truncate max-w-[130px]">#${det.wordEndIdx + 1} «${escapeHtml(endW)}»</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" id="btnEndWordMinus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-rose-500 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-rose-300">-1W (تقليص)</span>
              <span class="text-[10px] text-text-muted truncate max-w-[110px]">- «${escapeHtml(endW)}»</span>
            </button>
            <button type="button" id="btnEndWordPlus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-emerald-500 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-emerald-300">+1W (توسيع يسار)</span>
              <span class="text-[10px] text-text-muted truncate max-w-[110px]">+ «${escapeHtml(nextWordAfterEnd)}»</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Section 5: AI Verification, Telemetry Deep-Link & Dual-State Training Telemetry -->
      <div class="rounded-2xl bg-bg-surface-elevated border border-sky-500/30 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-sky-300 flex items-center gap-1.5">
            <span>🤖</span>
            <span>تدقيق الذكاء الاصطناعي وبيانات التدريب لـ Laya</span>
          </div>
          ${det.aiVerification?.status === "VERIFIED"
            ? (det.aiVerification.verdict === "CORRECT" || det.userApproved
                ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">🟢 مقبول / اقتباس مؤكد</span>'
                : (det.aiVerification.verdict === "FALSE"
                    ? '<span class="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">🔴 مستبعد / كلام عادي</span>'
                    : '<span class="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">🟡 غير متأكد</span>'))
            : (det.aiVerification?.status === "PENDING"
                ? '<span class="px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold animate-pulse">⏳ جاري الفحص...</span>'
                : '<span class="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">⚪ غير مفحوص بعد</span>')}
        </div>

        ${det.aiVerification?.status === "VERIFIED" ? `
          <div class="p-3 rounded-xl bg-bg-surface-sunken border border-border-subtle text-xs space-y-2">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-text-muted">النموذج: <strong class="text-text-primary font-mono">${escapeHtml(det.aiVerification.modelUsed || det.aiVerification.provider || "")}</strong></span>
              <span class="text-text-muted">نسبة الثقة: <strong class="text-emerald-400 font-mono">${Math.round((det.aiVerification.confidence || 0.88) * 100)}%</strong></span>
            </div>
            ${det.aiVerification.reason ? `
              <div class="text-[11px] text-text-secondary pt-1 text-justify border-t border-border-subtle leading-relaxed">
                ${escapeHtml(det.aiVerification.reason)}
              </div>
            ` : ""}
          </div>
        ` : ""}

        <!-- Module 1.8: AI Telemetry Deep-Link Button -->
        <button type="button" id="btnInspectorDeepLinkAiLogs" data-req-id="${det.aiVerification?.requestId || det.id}"
                class="w-full px-3 py-2 rounded-xl bg-sky-950/40 border border-sky-500/40 text-sky-300 hover:bg-sky-900/60 text-xs font-semibold flex items-center justify-center gap-2 transition">
          <span>📊</span>
          <span>عرض بيانات الطلب وسجل الاستجابة بالتفصيل في استوديو AI</span>
        </button>

        <!-- Module 1.9 & 3.9: Dual-State Training Telemetry Card -->
        <div class="rounded-xl bg-bg-surface-sunken border border-border-subtle p-3.5 space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-text-muted font-semibold">حالة التصنيف المعتمدة لتدريب Laya:</span>
            <span id="lblTrainingRecordStatusBadge" class="px-2.5 py-0.5 rounded-full text-xs font-bold ${det.userApproved ? (det.humanGoldVerdict === 'FALSE' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40') : 'bg-slate-800 text-text-muted'}">
              ${det.userApproved ? (det.humanGoldVerdict === 'FALSE' ? '🔴 كلام عادي (Human Gold)' : '🟢 مقتبس صحيح (Human Gold)') : '⚪ بانتظار الاعتماد'}
            </span>
          </div>
          <div class="text-[10px] text-text-muted leading-relaxed">
            تنبيه: يتم حفظ حكم الذكاء الاصطناعي الأولي وتصحيحك اليدوي معاً لإنتاج أمثلة سلبية وإيجابية عالية الدقة لتدريب النموذج.
          </div>
          <div class="grid grid-cols-2 gap-2 pt-1">
            <button type="button" id="btnMarkGoldCorrect" class="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 font-bold text-xs transition">
              🟢 اعتماد كاقتباس صحيح
            </button>
            <button type="button" id="btnMarkGoldFalse" class="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 border border-rose-500/40 font-bold text-xs transition">
              🔴 تصنيف كـ «كلام عادي»
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render Section 3 Word Chips
  const chipsContainer = panel.querySelector("#inspectorWordChipGridContainer");
  if (chipsContainer) {
    renderReferenceWordChips(det, chipsContainer);
  }

  // Bind Category Switchers
  panel.querySelectorAll("[data-set-cat]").forEach(btn => {
    btn.addEventListener("click", () => {
      changeFindingCategory(idx, btn.getAttribute("data-set-cat"));
    });
  });

  // Bind Actions
  panel.querySelector("#btnInspectorPlayQuote")?.addEventListener("click", () => {
    seekToMediaTimestamp(det.startTime || 0, true);
  });

  // Module 1.11: Delete Intent Modal
  panel.querySelector("#btnInspectorDeleteFinding")?.addEventListener("click", () => {
    openDeleteIntentModal(idx);
  });

  // Module 1.4 & 3.5: Toggle Candidates Accordion
  panel.querySelector("#btnToggleAllCandidates")?.addEventListener("click", () => {
    const acc = panel.querySelector("#inspectorAllCandidatesAccordion");
    if (acc) acc.classList.toggle("hidden");
  });

  panel.querySelectorAll(".btnSetAsActiveRef").forEach(btn => {
    btn.addEventListener("click", () => {
      const uId = btn.getAttribute("data-cand-unit-id");
      const cand = candidates.find(c => c.unitId === uId) || candidates[0];
      if (cand) {
        det.unitId = cand.unitId;
        det.displayRef = cand.displayRef;
        det.reference = cand.displayRef;
        if (cand.sourceType) {
          det.sourceType = cand.sourceType;
          det.type = sourceTypeToCategorySlug(cand.sourceType);
        }
        delete det._selectedChipIndices;
        recalculateCaptionsFromCurrentFindings();
        renderFindingInspector();
        renderAllViews();
        showToast(`✅ تم اعتماد المرجع: ${cand.displayRef}`);
      }
    });
  });

  // Module 1.6: Open Corpus Search Drawer
  panel.querySelector("#btnOpenSearchAddRef")?.addEventListener("click", () => {
    const drawer = document.getElementById("drawerCorpusSearch");
    if (drawer) {
      drawer.classList.remove("hidden");
      drawer.classList.add("flex");
      const inp = document.getElementById("inpDrawerCorpusSearch");
      if (inp) {
        inp.value = det.matchedText ? det.matchedText.slice(0, 25) : "";
        inp.focus();
        if (typeof runDrawerCorpusLiveSearch === "function") {
          runDrawerCorpusLiveSearch();
        }
      }
    }
  });

  // Module 1.10: Open Adhkar Studio
  panel.querySelector("#btnInspectorOpenAdhkarStudio")?.addEventListener("click", () => {
    jumpToAdhkarStudioWithFilter(det.matchedText || det.canonicalText, det.displayRef);
  });

  // Module 1.7: Word Boundary Controls
  panel.querySelector("#btnStartWordMinus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "start", -1));
  panel.querySelector("#btnStartWordPlus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "start", 1));
  panel.querySelector("#btnEndWordMinus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "end", -1));
  panel.querySelector("#btnEndWordPlus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "end", 1));

  // Module 1.8: AI Telemetry Deep Link
  panel.querySelector("#btnInspectorDeepLinkAiLogs")?.addEventListener("click", (e) => {
    const reqId = e.currentTarget.getAttribute("data-req-id");
    highlightAndOpenAiRequestLog(reqId);
  });

  // Module 1.9 & 3.9: Dual-State Gold Overrides
  panel.querySelector("#btnMarkGoldCorrect")?.addEventListener("click", async () => {
    det.userApproved = true;
    det.humanGoldVerdict = "CORRECT";
    if (typeof saveDecisionToTrainingDB === "function") {
      await saveDecisionToTrainingDB(det, "OVERRIDE_HUMAN_GOLD_CORRECT");
    }
    renderFindingInspector();
    recalculateCaptionsFromCurrentFindings();
    showToast("🟢 تم اعتماد المقتبس كصحيح وحفظه في بنك تدريب Laya!");
  });

  panel.querySelector("#btnMarkGoldFalse")?.addEventListener("click", async () => {
    det.userApproved = true;
    det.humanGoldVerdict = "FALSE";
    det.isHardNegative = true;
    if (typeof saveDecisionToTrainingDB === "function") {
      await saveDecisionToTrainingDB(det, "OVERRIDE_HUMAN_GOLD_FALSE");
    }
    renderFindingInspector();
    recalculateCaptionsFromCurrentFindings();
    showToast("🔴 تم تصنيف المقتبس كـ «كلام عادي» وحفظه كبيانات سلبية ذهبية لـ Laya!");
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
  if (currentState.activeSection === "training_data") {
    renderTrainingDataHubTable();
  }
  renderSavedLecturesList();
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

  const clippedCount = m.clippedCount || 0;
  setEl("lblFilterClippedCount", `(${clippedCount})`);
  const clippedBtn = document.getElementById("btnFilterOnlyClipped");
  if (clippedBtn) {
    if (currentState.aiVerification?.visibilityFilter?.showClippedOnly) {
      clippedBtn.classList.add("btn-filter-clipped-active");
    } else {
      clippedBtn.classList.remove("btn-filter-clipped-active");
    }
  }

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

function switchLectureStageTab(tab) {
  if (currentState && currentState.tafrigh) {
    currentState.tafrigh.viewMode = tab;
  }
  const syncBtn = document.getElementById("btnLectureTab_SYNC");
  const tafrighBtn = document.getElementById("btnLectureTab_TAFRIGH");
  const syncToolbar = document.getElementById("lectureSyncToolbar");
  const syncStage = document.getElementById("formattedLectureStage");
  const tafrighStage = document.getElementById("tafrighStage");
  const tafrighActions = document.getElementById("tafrighQuickActions");

  if (tab === "tafrigh") {
    if (syncBtn) {
      syncBtn.classList.remove("active");
      syncBtn.classList.add("inactive");
      syncBtn.setAttribute("aria-selected", "false");
    }
    if (tafrighBtn) {
      tafrighBtn.classList.add("active");
      tafrighBtn.classList.remove("inactive");
      tafrighBtn.setAttribute("aria-selected", "true");
    }
    if (syncToolbar) syncToolbar.classList.add("hidden");
    if (syncStage) syncStage.classList.add("hidden");
    if (tafrighStage) tafrighStage.classList.remove("hidden");
    if (tafrighActions && currentState.tafrigh && currentState.tafrigh.hasRun) {
      tafrighActions.classList.remove("hidden");
    }
  } else {
    if (syncBtn) {
      syncBtn.classList.add("active");
      syncBtn.classList.remove("inactive");
      syncBtn.setAttribute("aria-selected", "true");
    }
    if (tafrighBtn) {
      tafrighBtn.classList.remove("active");
      tafrighBtn.classList.add("inactive");
      tafrighBtn.setAttribute("aria-selected", "false");
    }
    if (syncToolbar) syncToolbar.classList.remove("hidden");
    if (syncStage) syncStage.classList.remove("hidden");
    if (tafrighStage) tafrighStage.classList.add("hidden");
    if (tafrighActions) tafrighActions.classList.add("hidden");
  }
}

function renderTafrighOutput(tafrighData) {
  if (!tafrighData) return;

  // Persist state
  if (currentState && currentState.tafrigh) {
    currentState.tafrigh.hasRun = true;
    currentState.tafrigh.data = tafrighData;
    currentState.tafrigh.viewMode = "tafrigh";
  }

  const emptyState = document.getElementById("tafrighEmptyState");
  const progressWrap = document.getElementById("tafrighProgressWrap");
  const errorWrap = document.getElementById("tafrighErrorWrap");
  const resultsView = document.getElementById("tafrighResultsView");
  const badgeStatus = document.getElementById("badgeTafrighStatus");
  const quickActions = document.getElementById("tafrighQuickActions");
  const tocBar = document.getElementById("tafrighTocBar");
  const reviewQueueWrap = document.getElementById("tafrighReviewQueueWrap");
  const renderedContent = document.getElementById("tafrighRenderedContent");

  // Ensure tafrigh tab is active and visible
  switchLectureStageTab("tafrigh");

  if (emptyState) emptyState.classList.add("hidden");
  if (progressWrap) progressWrap.classList.add("hidden");
  if (errorWrap) errorWrap.classList.add("hidden");
  if (resultsView) resultsView.classList.remove("hidden");
  if (badgeStatus) badgeStatus.classList.remove("hidden");
  if (quickActions) quickActions.classList.remove("hidden");

  const html = tafrighData.html || "";
  const reviewItems = tafrighData.review_items || [];
  const runId = tafrighData.run_id || (currentState.tafrigh?.data?.run_id) || "";

  // 1. Render TOC Bar from structured JSON headings
  if (tocBar) {
    const headings = tafrighData.structured_json?.headings || [];
    if (headings.length > 0) {
      tocBar.innerHTML = headings.map(h => {
        const title = h.canonical_title || h.title || "عنوان";
        const segId = h.segment_id || "";
        return `<a href="#${segId}" class="tafrigh-toc-pill" data-seg-id="${segId}">📌 ${escapeHtml(title)}</a>`;
      }).join("");
      tocBar.classList.remove("hidden");

      tocBar.querySelectorAll(".tafrigh-toc-pill").forEach(pill => {
        pill.addEventListener("click", (e) => {
          e.preventDefault();
          const targetId = pill.getAttribute("data-seg-id");
          const el = document.getElementById(targetId);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-amber-400", "rounded");
            setTimeout(() => el.classList.remove("ring-2", "ring-amber-400"), 1800);
          }
        });
      });
    } else {
      tocBar.innerHTML = "";
      tocBar.classList.add("hidden");
    }
  }

  // 2. Render Human Review Queue Banner
  if (reviewQueueWrap) {
    if (reviewItems.length > 0) {
      reviewQueueWrap.innerHTML = `
        <div class="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200">
          <div class="flex items-center justify-between mb-2">
            <strong class="text-sm font-bold flex items-center gap-2">
              <span>⚠️</span>
              <span>طابور المراجعة البشرية (${reviewItems.length} فقرة تتطلب التحقق):</span>
            </strong>
            <span class="text-[10px] text-amber-400/80">انقر تأكيد أو تراجع لتحديث الهيكل فوراً</span>
          </div>
          <div class="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
            ${reviewItems.map(item => `
              <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs" id="review_row_${item.segment_id}">
                <div class="flex-1">
                  <span class="font-mono text-sky-400 font-bold ml-1">${item.segment_id}</span>
                  <span class="text-slate-300">${escapeHtml(item.active_text || item.original_text || "")}</span>
                  <div class="text-[10px] text-amber-400 mt-1">${(item.review_flags || []).join(' • ')}</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button type="button" class="btn-tafrigh-confirm px-2.5 py-1 rounded-lg bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 font-bold transition" data-run-id="${runId}" data-seg-id="${item.segment_id}">تأكيد ✓</button>
                  <button type="button" class="btn-tafrigh-reject px-2.5 py-1 rounded-lg bg-rose-600/30 text-rose-300 hover:bg-rose-600/50 font-bold transition" data-run-id="${runId}" data-seg-id="${item.segment_id}">تراجع ✕</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      reviewQueueWrap.classList.remove("hidden");

      reviewQueueWrap.querySelectorAll(".btn-tafrigh-confirm").forEach(btn => {
        btn.addEventListener("click", async () => {
          const segId = btn.getAttribute("data-seg-id");
          const rId = btn.getAttribute("data-run-id");
          await executeTafrighReviewAction(rId, segId, "confirm");
        });
      });

      reviewQueueWrap.querySelectorAll(".btn-tafrigh-reject").forEach(btn => {
        btn.addEventListener("click", async () => {
          const segId = btn.getAttribute("data-seg-id");
          const rId = btn.getAttribute("data-run-id");
          await executeTafrighReviewAction(rId, segId, "reject");
        });
      });
    } else {
      reviewQueueWrap.innerHTML = "";
      reviewQueueWrap.classList.add("hidden");
    }
  }

  // 3. Render Semantic HTML Structure
  if (renderedContent) {
    renderedContent.innerHTML = html;
  }
}

async function executeTafrighReviewAction(runId, segmentId, action) {
  try {
    let apiBase = "";
    if (window.location.protocol === "file:" || window.location.port === "8089") {
      apiBase = "http://127.0.0.1:8000";
    }
    let url = `${apiBase}/api/tafrigh/review-action`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId, segment_id: segmentId, action })
      });
    } catch (netErr) {
      if (!apiBase) {
        url = `http://127.0.0.1:8000/api/tafrigh/review-action`;
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_id: runId, segment_id: segmentId, action })
        });
      } else {
        throw netErr;
      }
    }
    const data = await res.json();
    if (data.success) {
      renderTafrighOutput({
        run_id: runId,
        markdown: data.markdown,
        html: data.html,
        review_items: data.review_items,
        structured_json: currentState.tafrigh?.data?.structured_json
      });
      if (typeof showToast === "function") {
        showToast(action === "confirm" ? "✅ تم اعتماد القرار بنجاح" : "↩️ تم التراجع وتحديث الهيكل");
      }
    } else {
      if (typeof showToast === "function") {
        showToast("❌ تعذر تنفيذ إجراء المراجعة");
      }
    }
  } catch (err) {
    console.error("Tafrigh review action error:", err);
    if (typeof showToast === "function") {
      showToast("❌ خطأ في الاتصال بالخادم الخلفي");
    }
  }
}

// -----------------------------------------------------------------------------
// Training Data Hub & Laya Fine-Tuning Bank (#section_training_data, Module 2)
// -----------------------------------------------------------------------------

async function renderTrainingDataHubTable() {
  let records = currentState.aiVerification?.trainingDatasetRecords || [];
  if ((!records || records.length === 0) && typeof getAllVerificationRecordsFromDB === "function") {
    try {
      records = await getAllVerificationRecordsFromDB();
    } catch (_) {}
  }
  records = Array.isArray(records) ? records : [];

  // 1. Compute Top Stats
  const statTotal = records.length;
  let countCorrect = 0;
  let countFalse = 0;
  let countCompleteness = 0;
  let countSegmentation = 0;
  let countTypo = 0;

  records.forEach(rec => {
    const verdict = rec.answers?.verdict?.choice || rec.answers?.classification || "";
    const bStatus = rec.answers?.boundary_status?.choice || "";
    const taskType = rec.meta?.task_type || (bStatus && bStatus !== "COMPLETE_SPAN" ? "VERIFICATION_COMPLETENESS" : "VERIFICATION_CORRECTNESS");

    if (verdict === "CORRECT") countCorrect++;
    if (verdict === "FALSE") countFalse++;
    if (taskType === "VERIFICATION_COMPLETENESS" || (bStatus && bStatus !== "COMPLETE_SPAN")) countCompleteness++;
    if (taskType === "TAFRIGH_SEGMENTATION") countSegmentation++;
    if (taskType === "TAFRIGH_TYPO") countTypo++;
  });

  const setElText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(txt);
  };
  setElText("statTrainingTotal", statTotal);
  setElText("statTrainingCorrect", countCorrect);
  setElText("statTrainingFalse", countFalse);
  setElText("statTrainingCompleteness", countCompleteness);
  setElText("statTrainingSegmentation", countSegmentation);
  setElText("statTrainingTypo", countTypo);
  setElText("badgeTrainingRecordCount", statTotal);

  // 2. Apply Filters
  const taskFilter = document.getElementById("selTrainingTaskFilter")?.value || "ALL";
  const labelFilter = document.getElementById("selTrainingLabelFilter")?.value || "ALL";
  const searchQ = (document.getElementById("inpTrainingDataSearch")?.value || "").trim().toLowerCase();

  const filtered = records.filter(rec => {
    const verdict = rec.answers?.verdict?.choice || "";
    const bStatus = rec.answers?.boundary_status?.choice || "";
    const taskType = rec.meta?.task_type || (bStatus && bStatus !== "COMPLETE_SPAN" ? "VERIFICATION_COMPLETENESS" : "VERIFICATION_CORRECTNESS");

    if (taskFilter !== "ALL" && taskType !== taskFilter) {
      return false;
    }

    if (labelFilter === "CORRECT" && verdict !== "CORRECT") return false;
    if (labelFilter === "FALSE" && verdict !== "FALSE") return false;
    if (labelFilter === "TRUNCATED" && bStatus === "COMPLETE_SPAN") return false;

    if (searchQ) {
      const matchText = (rec.state?.matched_span_in_lecture || rec.state?.candidate_quote || "").toLowerCase();
      const refText = (rec.state?.candidate_reference || rec.meta?.lecture_title || "").toLowerCase();
      const canonText = (rec.state?.canonical_corpus_text || "").toLowerCase();
      if (!matchText.includes(searchQ) && !refText.includes(searchQ) && !canonText.includes(searchQ)) {
        return false;
      }
    }
    return true;
  });

  const tbody = document.getElementById("tbodyTrainingRecords");
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-8 text-text-muted">
          ${records.length === 0
            ? "لا توجد بيانات تدريب مسجلة بعد. استخدم استوديو التحرير أو التدقيق الذكي لتوليد بيانات التدريب الذهبية."
            : "لا توجد سجلات تدريب مطابقة لفلاتر البحث الحالية."}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((rec, idx) => {
    const verdict = rec.answers?.verdict?.choice || "NOT_SURE";
    const bStatus = rec.answers?.boundary_status?.choice || "COMPLETE_SPAN";
    const taskType = rec.meta?.task_type || (bStatus !== "COMPLETE_SPAN" ? "VERIFICATION_COMPLETENESS" : "VERIFICATION_CORRECTNESS");

    let taskBadge = `<span class="px-2 py-0.5 rounded-lg bg-sky-500/20 text-sky-300 font-bold text-[10px]">تدقيق: مطابقة</span>`;
    if (taskType === "VERIFICATION_COMPLETENESS") {
      taskBadge = `<span class="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 font-bold text-[10px]">تدقيق: حدود</span>`;
    } else if (taskType === "TAFRIGH_SEGMENTATION") {
      taskBadge = `<span class="px-2 py-0.5 rounded-lg bg-violet-500/20 text-violet-300 font-bold text-[10px]">تفريغ: تقطيع</span>`;
    } else if (taskType === "TAFRIGH_TYPO") {
      taskBadge = `<span class="px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 font-bold text-[10px]">تفريغ: إملاء</span>`;
    }

    let verdictBadge = `<span class="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">🟢 صحيح</span>`;
    if (verdict === "FALSE") {
      verdictBadge = `<span class="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 font-bold text-[10px]">🔴 كلام عادي</span>`;
    } else if (verdict === "NOT_SURE") {
      verdictBadge = `<span class="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 font-bold text-[10px]">🟡 غير متأكد</span>`;
    }

    const aiInitVerdict = rec.meta?.initial_ai_verdict || (rec.meta?.human_verified ? "تم الفحص" : verdict);
    const dateFormatted = rec.meta?.converted_at
      ? new Date(rec.meta.converted_at * 1000).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })
      : "-";

    const ref = escapeHtml(rec.state?.candidate_reference || rec.state?.source_type || "مرجع شرعي");
    const snippet = escapeHtml(rec.state?.matched_span_in_lecture || rec.state?.candidate_quote || rec.state?.canonical_corpus_text || "").slice(0, 75);

    return `
      <tr class="hover:bg-bg-surface-elevated transition border-b border-border-subtle" data-rec-id="${escapeHtml(rec.id)}">
        <td class="py-2.5 px-3 font-mono text-text-muted">${idx + 1}</td>
        <td class="py-2.5 px-3">${taskBadge}</td>
        <td class="py-2.5 px-3 font-bold text-text-primary text-[11px] max-w-[130px] truncate" title="${ref}">${ref}</td>
        <td class="py-2.5 px-4 text-text-secondary text-[11px] max-w-[220px] truncate" title="${snippet}">"${snippet}..."</td>
        <td class="py-2.5 px-3 font-mono text-[11px] text-text-muted">${escapeHtml(aiInitVerdict)}</td>
        <td class="py-2.5 px-3">${verdictBadge}</td>
        <td class="py-2.5 px-3 text-text-muted text-[10px] whitespace-nowrap">${dateFormatted}</td>
        <td class="py-2.5 px-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button type="button" class="btnViewTrainingRecordJson px-2 py-1 rounded bg-bg-surface-elevated hover:bg-bg-surface text-text-secondary hover:text-text-primary text-[10px] font-bold transition" data-rec-id="${escapeHtml(rec.id)}" title="فحص محتوى سجل التدريب بصيغة Laya JSON">
              👁️ JSON
            </button>
            <button type="button" class="btnDeleteTrainingRecord px-2 py-1 rounded bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 text-[10px] transition" data-rec-id="${escapeHtml(rec.id)}" title="حذف السجل">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btnViewTrainingRecordJson").forEach(btn => {
    btn.addEventListener("click", () => {
      const recId = btn.getAttribute("data-rec-id");
      const record = records.find(r => r.id === recId);
      if (record) {
        showTrainingRecordJsonDialog(record);
      }
    });
  });

  tbody.querySelectorAll(".btnDeleteTrainingRecord").forEach(btn => {
    btn.addEventListener("click", async () => {
      const recId = btn.getAttribute("data-rec-id");
      await deleteTrainingRecordById(recId);
    });
  });
}

async function deleteTrainingRecordById(recId) {
  if (!confirm("هل أنت متأكد من رغبتك في حذف سجل التدريب هذا؟")) return;
  try {
    const db = await openWahyLayaTrainingDB();
    const tx = db.transaction([IDB_AI_TRAINING_STORE_NAME], "readwrite");
    const store = tx.objectStore(IDB_AI_TRAINING_STORE_NAME);
    store.delete(recId);
    tx.oncomplete = () => {
      currentState.aiVerification.trainingDatasetRecords = (currentState.aiVerification.trainingDatasetRecords || []).filter(r => r.id !== recId);
      renderTrainingDataHubTable();
      if (typeof showToast === "function") {
        showToast("🗑️ تم حذف سجل التدريب بنجاح");
      }
    };
  } catch (err) {
    console.error("Failed to delete training record:", err);
  }
}

function showTrainingRecordJsonDialog(record) {
  let modal = document.getElementById("modalTrainingJsonViewer");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modalTrainingJsonViewer";
    modal.className = "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4";
    modal.innerHTML = `
      <div class="bg-bg-surface border border-border-medium rounded-2xl max-w-2xl w-full p-5 space-y-3 shadow-2xl flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between border-b border-border-subtle pb-2">
          <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
            <span>📊</span>
            <span>سجل تدريب Laya JSONL Canonical Record</span>
          </h3>
          <button type="button" class="btnClsTrainingJson text-text-muted hover:text-text-primary text-base">✕</button>
        </div>
        <div class="overflow-y-auto flex-1 p-2 bg-bg-surface-sunken rounded-xl border border-border-subtle">
          <pre id="preTrainingJsonContent" class="font-mono text-xs text-emerald-300 select-all whitespace-pre-wrap" dir="ltr"></pre>
        </div>
        <div class="flex items-center justify-between pt-2 border-t border-border-subtle">
          <button type="button" id="btnCopyTrainingJson" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5">
            <span>📋</span>
            <span>نسخ JSON</span>
          </button>
          <button type="button" class="btnClsTrainingJson px-4 py-1.5 rounded-xl bg-bg-surface-elevated text-text-secondary text-xs font-semibold">
            إغلاق
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll(".btnClsTrainingJson").forEach(b => {
      b.addEventListener("click", () => modal.classList.add("hidden"));
    });
    modal.addEventListener("click", (e) => {
      if (e.target.id === "modalTrainingJsonViewer") modal.classList.add("hidden");
    });
    modal.querySelector("#btnCopyTrainingJson")?.addEventListener("click", () => {
      const code = modal.querySelector("#preTrainingJsonContent")?.textContent || "";
      navigator.clipboard.writeText(code).then(() => {
        if (typeof showToast === "function") showToast("📋 تم نسخ سجل التدريب بنجاح!");
      });
    });
  }

  const pre = modal.querySelector("#preTrainingJsonContent");
  if (pre) {
    pre.textContent = JSON.stringify(record, null, 2);
  }
  modal.classList.remove("hidden");
}

// -----------------------------------------------------------------------------
// Lecture Session Manager & Persistence (Module 6 / Section 8.1)
// -----------------------------------------------------------------------------

async function renderSavedLecturesList() {
  const container = document.getElementById("savedLecturesContainer");
  if (!container) return;

  let lectures = [];
  if (typeof getAllSavedLecturesFromDB === "function") {
    try {
      lectures = await getAllSavedLecturesFromDB();
    } catch (_) {}
  }

  if (!lectures || lectures.length === 0) {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-bg-surface-sunken border border-border-subtle text-center text-text-muted text-xs col-span-full">
        لا توجد جلسات محفوظة بعد. انقر على «حفظ الجلسة الحالية» للاحتفاظ ببيانات المحاضرة والنتائج.
      </div>
    `;
    return;
  }

  container.innerHTML = lectures.map(lec => {
    const title = escapeHtml(lec.title || "محاضرة علمية");
    const dateStr = lec.updated_at
      ? new Date(lec.updated_at).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })
      : "-";
    const wordCount = (lec.words || []).length;
    const detCount = (lec.detections || []).length;

    return `
      <div class="p-3 rounded-xl bg-bg-surface border border-border-subtle hover:border-border-medium transition space-y-2 flex flex-col justify-between" data-lecture-id="${escapeHtml(lec.lecture_id)}">
        <div>
          <div class="flex items-center justify-between gap-1 mb-1">
            <h4 class="font-bold text-xs text-text-primary truncate" title="${title}">${title}</h4>
            <span class="text-[10px] text-text-muted font-mono whitespace-nowrap">${dateStr}</span>
          </div>
          <div class="flex items-center gap-2 text-[10px] text-text-secondary">
            <span>📝 ${wordCount} كلمة</span>
            <span>•</span>
            <span class="text-emerald-400 font-semibold">✨ ${detCount} مقتبس</span>
          </div>
        </div>
        <div class="flex items-center justify-between gap-1 pt-2 border-t border-border-subtle">
          <button type="button" class="btnLoadSavedLecture px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 font-bold text-[11px] transition flex items-center gap-1" data-lecture-id="${escapeHtml(lec.lecture_id)}">
            <span>📂</span>
            <span>فتح</span>
          </button>
          <div class="flex items-center gap-1">
            <button type="button" class="btnExportSavedLectureJson px-2 py-1 rounded-lg bg-bg-surface-elevated hover:bg-bg-surface text-text-secondary hover:text-text-primary text-[10px] font-semibold transition" data-lecture-id="${escapeHtml(lec.lecture_id)}" title="تصدير كملف JSON">
              📤
            </button>
            <button type="button" class="btnDeleteSavedLecture px-2 py-1 rounded-lg bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 text-[10px] transition" data-lecture-id="${escapeHtml(lec.lecture_id)}" title="حذف الجلسة">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".btnLoadSavedLecture").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-lecture-id");
      await loadLectureSessionIntoWorkspace(id);
    });
  });

  container.querySelectorAll(".btnExportSavedLectureJson").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-lecture-id");
      const lec = lectures.find(l => l.lecture_id === id);
      if (lec) {
        exportLectureSessionAsJson(lec);
      }
    });
  });

  container.querySelectorAll(".btnDeleteSavedLecture").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-lecture-id");
      if (confirm("هل تريد حذف هذه الجلسة المحفوظة؟")) {
        await deleteSavedLectureFromDB(id);
        renderSavedLecturesList();
        if (typeof showToast === "function") {
          showToast("🗑️ تم حذف المحاضرة من السجل المحلي");
        }
      }
    });
  });
}

async function loadLectureSessionIntoWorkspace(lectureId) {
  try {
    const session = await getLectureSessionFromDB(lectureId);
    if (!session) return;

    currentState.lectureTitle = session.title || "محاضرة علمية";
    currentState.rawTranscript = session.raw_transcript || "";
    currentState.words = session.words || [];
    currentState.detections = session.detections || [];
    currentState.captions = session.captions || [];
    if (session.tafrigh_result) {
      currentState.tafrigh = Object.assign({}, currentState.tafrigh, session.tafrigh_result);
    }
    currentState.activeFindingIndex = currentState.detections.length > 0 ? 0 : -1;

    recalculateCaptionsFromCurrentFindings();
    if (typeof window.renderAllViews === "function") {
      window.renderAllViews();
    }
    switchMainSection("display");
    if (typeof showToast === "function") {
      showToast(`📂 تم استرجاع جلسة «${currentState.lectureTitle}» بنجاح!`);
    }
  } catch (err) {
    console.error("Failed to load lecture session:", err);
    if (typeof showToast === "function") {
      showToast("❌ تعذر تحميل الجلسة المحفوظة");
    }
  }
}

function exportLectureSessionAsJson(session) {
  if (!session) return;
  const jsonStr = JSON.stringify(session, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeTitle = (session.title || "wahy_lecture").replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "_");
  a.download = `${safeTitle}.wahy.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// Pre-Flight Verification Estimator & Checklist (Module 5 / Section 7.2)
// -----------------------------------------------------------------------------

function renderPreFlightVerificationModal(selectedIdsSet = null) {
  const modal = document.getElementById("modalPreFlightVerification");
  const container = document.getElementById("preFlightChecklistContainer");
  if (!modal || !container) return;

  const detections = currentState.detections || [];
  if (!detections.length) {
    if (typeof showToast === "function") {
      showToast("⚠️ لا توجد مقتبسات لفحصها");
    }
    return;
  }

  const selectedSet = selectedIdsSet || new Set(detections.map(d => d.id || d._uniqueKey));

  container.innerHTML = detections.map((det, idx) => {
    const key = det.id || det._uniqueKey || `det_${idx}`;
    const isChecked = selectedSet.has(key);
    const scorePct = Math.round((det.totalScore || 0) * 100);
    const isQuran = det.sourceType === "QURAN";
    const sourceBadge = isQuran
      ? `<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">قرآن</span>`
      : `<span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">حديث</span>`;
    const ref = escapeHtml(det.displayRef || det.reference || "");
    const snippet = escapeHtml(det.matchedText || det.canonicalText || "").slice(0, 50);

    return `
      <label class="flex items-center justify-between p-2 rounded-lg bg-bg-surface border border-border-subtle hover:border-border-medium cursor-pointer transition">
        <div class="flex items-center gap-2">
          <input type="checkbox" class="chkPreFlightItem text-sky-600 rounded" data-det-key="${escapeHtml(key)}" ${isChecked ? "checked" : ""} />
          <span class="font-mono text-text-muted text-[10px]">#${idx + 1}</span>
          ${sourceBadge}
          <span class="font-bold text-text-primary text-xs truncate max-w-[140px]">${ref}</span>
          <span class="text-text-muted text-[11px] truncate max-w-[200px]">"${snippet}..."</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-mono text-[10px] font-bold ${scorePct >= 80 ? "text-emerald-400" : "text-amber-400"}">${scorePct}%</span>
        </div>
      </label>
    `;
  }).join("");

  updatePreFlightEstimatorKPIs();

  container.querySelectorAll(".chkPreFlightItem").forEach(chk => {
    chk.addEventListener("change", () => {
      updatePreFlightEstimatorKPIs();
    });
  });

  modal.classList.remove("hidden");
}

function updatePreFlightEstimatorKPIs() {
  const container = document.getElementById("preFlightChecklistContainer");
  if (!container) return;

  const totalDets = (currentState.detections || []).length;
  const checkedItems = container.querySelectorAll(".chkPreFlightItem:checked");
  const selectedCount = checkedItems.length;

  const tokensEst = selectedCount * 380;
  const isFreePlan = currentState.aiVerification?.geminiFreeTierMode !== false;
  const costEst = isFreePlan ? "$0.00 (Free)" : `$${((tokensEst / 1000000) * 0.042).toFixed(4)}`;
  const rpm = currentState.aiVerification?.geminiRpmLimit || 12;
  const timeEst = `~${Math.max(2, Math.ceil(selectedCount / rpm) * 60)}s`;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };
  setEl("kpiPreFlightTotalCandidates", totalDets);
  setEl("kpiPreFlightSelectedCount", selectedCount);
  setEl("kpiPreFlightTokensEst", tokensEst.toLocaleString());
  setEl("kpiPreFlightCostEst", costEst);
  setEl("kpiPreFlightTimeEst", timeEst);
}

// -----------------------------------------------------------------------------
// Validate All AI Decisions Action (Module 4 / Section 6.2)
// -----------------------------------------------------------------------------

async function executeValidateAllAiDecisions() {
  const verifiedList = (currentState.detections || []).filter(d => d.aiVerification?.status === "VERIFIED");
  if (!verifiedList.length) {
    if (typeof showToast === "function") {
      showToast("⚠️ لا توجد اقتباسات مفحوصة لاعتمادها دفعة واحدة.");
    }
    return;
  }

  let count = 0;
  for (const det of verifiedList) {
    if (!det.userApproved) {
      det.userApproved = true;
      det.humanGoldVerdict = det.aiVerification.verdict;
      if (typeof saveVerificationRecordToDB === "function") {
        const env = typeof buildCanonicalDecisionEnvelope === "function"
          ? buildCanonicalDecisionEnvelope(det, currentState.words)
          : null;
        if (typeof convertRecordToLayaTrainingEnvelope === "function") {
          const layaRec = convertRecordToLayaTrainingEnvelope(det, env, Math.floor(Date.now() / 1000) + count);
          layaRec.answers.verdict.choice = det.humanGoldVerdict;
          layaRec.meta.human_verified = true;
          layaRec.meta.task_type = "VERIFICATION_CORRECTNESS";
          await saveVerificationRecordToDB(layaRec);
        }
      }
      count++;
    }
  }

  if (typeof recalculateCaptionsFromCurrentFindings === "function") {
    recalculateCaptionsFromCurrentFindings();
  }
  if (typeof renderFormattedLectureView === "function") {
    renderFormattedLectureView();
  }
  if (typeof renderEditorLectureStage === "function") {
    renderEditorLectureStage();
  }
  if (typeof renderFindingInspector === "function") {
    renderFindingInspector();
  }
  if (typeof showToast === "function") {
    showToast(`✅ تم اعتماد جميع نتائج الذكاء الاصطناعي (${count} مقتبس) وحفظها كبيانات ذهبية!`);
  }
  document.getElementById("modalPreFlightVerification")?.classList.add("hidden");
}

window.renderTrainingDataHubTable = renderTrainingDataHubTable;
window.deleteTrainingRecordById = deleteTrainingRecordById;
window.showTrainingRecordJsonDialog = showTrainingRecordJsonDialog;
window.renderSavedLecturesList = renderSavedLecturesList;
window.loadLectureSessionIntoWorkspace = loadLectureSessionIntoWorkspace;
window.exportLectureSessionAsJson = exportLectureSessionAsJson;
window.renderPreFlightVerificationModal = renderPreFlightVerificationModal;
window.updatePreFlightEstimatorKPIs = updatePreFlightEstimatorKPIs;
window.executeValidateAllAiDecisions = executeValidateAllAiDecisions;

window.switchLectureStageTab = switchLectureStageTab;
window.renderTafrighOutput = renderTafrighOutput;
window.executeTafrighReviewAction = executeTafrighReviewAction;
window.updateAiMetricsUI = updateAiMetricsUI;

window.renderAiRequestLogsTable = renderAiRequestLogsTable;
window.renderLayaDatasetBankStats = renderLayaDatasetBankStats;
window.renderAiLogsSection = renderAiLogsSection;

window.renderReferenceWordChips = renderReferenceWordChips;
window.applyReferenceWordsToTranscript = applyReferenceWordsToTranscript;
window.openDeleteIntentModal = openDeleteIntentModal;
window.highlightAndOpenAiRequestLog = highlightAndOpenAiRequestLog;
window.jumpToAdhkarStudioWithFilter = jumpToAdhkarStudioWithFilter;

window.WahyRenderer = {
  switchLectureStageTab,
  renderTafrighOutput,
  executeTafrighReviewAction,
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
  renderReferenceWordChips,
  applyReferenceWordsToTranscript,
  openDeleteIntentModal,
  highlightAndOpenAiRequestLog,
  jumpToAdhkarStudioWithFilter,
  renderTrainingDataHubTable,
  deleteTrainingRecordById,
  showTrainingRecordJsonDialog,
  renderSavedLecturesList,
  loadLectureSessionIntoWorkspace,
  exportLectureSessionAsJson,
  renderPreFlightVerificationModal,
  updatePreFlightEstimatorKPIs,
  executeValidateAllAiDecisions,
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
