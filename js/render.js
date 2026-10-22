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
        btn.className = "seg-btn is-active";
      } else {
        btn.className = "seg-btn";
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

  const groupRefMap = typeof buildAyahGroupRefMap === "function" ? buildAyahGroupRefMap(currentState.detections, prefs) : new Map();
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

      // AI merge suggestion badge (one quote the engine split in two)
      const mergeOpts = typeof getFindingMergeOptions === "function" ? getFindingMergeOptions(dIdx) : {};
      const mergePrev = Boolean(mergeOpts.previous?.suggestion);
      const mergeNext = Boolean(mergeOpts.next?.suggestion);
      const mergeBadgeHtml = (mergePrev || mergeNext)
        ? `<span class="px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-200 border border-violet-400/50 text-[10px] font-bold inline-flex items-center gap-1" title="اقتراح الذكاء الاصطناعي: هذا المقتبس جزء من نفس النص مع المقتبس المجاور — افتح المقتبس للدمج">🔗 ${mergePrev && mergeNext ? "دمج مع الطرفين" : (mergePrev ? "دمج مع السابق" : "دمج مع التالي")}</span>`
        : "";

      // Which text a quote shows. Display: the reference text once snapped to it. Editor: the spoken words, unless
      // a toggle asks for the reference text («الرسم القياسي») or the whole source («المتن كاملاً»), or the user
      // applied reference words to this quote (shown, so the edit is visible where it was made).
      let shownText = null;
      let shownTitle = "";
      if (isEditorMode) {
        const unitForFull = currentState.editorViewFullCanonicalSpan && activeMatcher?.units ? activeMatcher.units.get(det.unitId) : null;
        if (currentState.editorViewFullCanonicalSpan && (unitForFull?.fullText || det.canonicalText)) {
          shownText = unitForFull?.fullText || det.canonicalText;
          shownTitle = "المتن كاملاً من المصدر";
        } else if ((currentState.editorViewRasmQiyasi || det.snappedToCanonical) && det.canonicalText) {
          shownText = det.canonicalText;
          shownTitle = det.snappedToCanonical ? "نص المرجع المطبَّق على هذا المقتبس" : "الرسم القياسي";
        }
      } else if (det.snappedToCanonical && det.canonicalText) {
        shownText = det.canonicalText;
      }

      let innerWordsHtml = "";
      if (shownText) {
        innerWordsHtml = `<span class="font-bold${isEditorMode ? " editor-canonical-text" : ""}"${shownTitle ? ` title="${escapeHtml(shownTitle)}"` : ""}>${escapeHtml(shownText)}</span>`
          + (isEditorMode && det.snappedToCanonical && !currentState.editorViewFullCanonicalSpan ? ' <span class="text-[10px] align-super text-sky-300" title="نص المرجع المطبَّق على هذا المقتبس">✨</span>' : "");
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

      const refText = groupRefMap.has(det) ? groupRefMap.get(det) : (det.displayRef || det.reference || "");
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
          ${boundaryBadgeHtml}
          ${mergeBadgeHtml}
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
      showDisplayFindingPopover(fIdx, citEl);
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
 * Floating popover shown when clicking a finding in the Display section.
 * Lives on <body> so lecture re-renders don't destroy it.
 */
function showDisplayFindingPopover(findingIdx, anchorEl) {
  const det = currentState.detections[findingIdx];
  if (!det || !anchorEl) return;

  let pop = document.getElementById("displayFindingPopover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "displayFindingPopover";
    pop.className = "fixed z-40 w-72 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl p-3 space-y-2 text-xs font-arabic-ui";
    pop.setAttribute("dir", "rtl");
    document.body.appendChild(pop);

    document.addEventListener("click", (e) => {
      if (!pop.contains(e.target) && !e.target.closest("[data-finding-idx]")) pop.classList.add("hidden");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") pop.classList.add("hidden");
    });
    window.addEventListener("scroll", () => pop.classList.add("hidden"), true);
  }

  const ai = det.aiVerification || {};
  let aiBadge = '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">⚪ غير مفحوص</span>';
  if (ai.status === "VERIFIED") {
    aiBadge = ai.verdict === "CORRECT"
      ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">🟢 مقبول</span>'
      : (ai.verdict === "FALSE"
          ? '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">🔴 مستبعد</span>'
          : '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">🟡 غير متأكد</span>');
  } else if (ai.status === "PENDING") {
    aiBadge = '<span class="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold animate-pulse">⏳ قيد الفحص</span>';
  } else if (ai.status === "ERROR") {
    aiBadge = '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">⚠️ خطأ</span>';
  }

  pop.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="overflow-hidden">
        <div class="font-bold text-emerald-300 truncate">${escapeHtml(det.displayRef || det.reference || "مقتبس")}</div>
        <div class="font-mono text-[10px] text-slate-500" dir="ltr">${formatSecondsToShortTime(det.startTime)} → ${formatSecondsToShortTime(det.endTime)}</div>
      </div>
      ${aiBadge}
    </div>
    <div class="grid grid-cols-2 gap-1.5 pt-1">
      <button type="button" data-pop-action="play" class="px-2 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/35 text-sky-300 border border-sky-500/40 font-bold transition">▶ استماع</button>
      <button type="button" data-pop-action="edit" class="px-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition">✏️ فتح في المحرر</button>
    </div>
  `;

  pop.querySelector('[data-pop-action="play"]').addEventListener("click", () => {
    seekToMediaTimestamp(det.startTime || 0, true);
  });
  pop.querySelector('[data-pop-action="edit"]').addEventListener("click", () => {
    pop.classList.add("hidden");
    openFindingInEditor(findingIdx);
  });

  // Position below the citation, clamped to viewport
  pop.classList.remove("hidden");
  const r = anchorEl.getBoundingClientRect();
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let left = r.left + r.width / 2 - popW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
  let top = r.bottom + 6;
  if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

/**
 * Jump to the Display screen at the given finding: synced-text tab, scrolled to it, highlighted, media at its time.
 */
function openFindingInDisplay(findingIdx) {
  const det = currentState.detections[findingIdx];
  switchMainSection("display");
  if (typeof switchLectureStageTab === "function") switchLectureStageTab("sync");
  if (!det) return;
  currentState.selectedPredIndex = findingIdx;
  if (typeof det.startTime === "number") seekToMediaTimestamp(det.startTime, false);
  const el = document.querySelector(`#formattedLectureStage [data-finding-idx="${findingIdx}"]`);
  if (!el) return;
  highlightSelectedFindingInDOM(findingIdx);
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-sky-400");
  setTimeout(() => el.classList.remove("ring-2", "ring-sky-400"), 2200);
}

/**
 * Jump to the Smart Editor (FN Studio pane) with the given finding open in the Inspector.
 */
function openFindingInEditor(findingIdx) {
  switchMainSection("editor");
  switchEditorSubMode("fn_studio");
  selectFindingForEdit(findingIdx, false);
  const citEl = document.querySelector(`#editorLectureStage [data-finding-idx="${findingIdx}"]`);
  if (citEl) citEl.scrollIntoView({ behavior: "smooth", block: "center" });
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
        <div class="text-2xl">🔍</div>
        <div>انقر على أي آية أو حديث أو ذكر ملون داخل نص المحاضرة لفحصه أو تعديل حدوده، أو أضف مقتبساً جديداً.</div>
      </div>
    `;
    return;
  }

  const fType = det.type || sourceTypeToCategorySlug(det.sourceType);
  const startW = currentState.words[det.wordStartIdx]?.word || "";
  const endW = currentState.words[det.wordEndIdx]?.word || "";
  const prevWordBeforeStart = (det.wordStartIdx > 0 && currentState.words[det.wordStartIdx - 1]) ? currentState.words[det.wordStartIdx - 1].word : "—";
  const nextWordAfterEnd = (det.wordEndIdx + 1 < (currentState.words || []).length && currentState.words[det.wordEndIdx + 1]) ? currentState.words[det.wordEndIdx + 1].word : "—";

  // Compute matched words for the unit
  const unit = (typeof activeMatcher === "object" && activeMatcher?.units && det.unitId)
    ? activeMatcher.units.get(det.unitId)
    : null;
  const unitWords = unit ? (unit.vocalizedWords || unit.fullText.split(/\s+/)) : (det.canonicalText || "").split(/\s+/);

  // Merge with a neighbouring finding (AI-suggested pairs are highlighted, others offered manually)
  const mergeOpts = typeof getFindingMergeOptions === "function" ? getFindingMergeOptions(idx) : { previous: null, next: null };
  const mergeSideHtml = (dir) => {
    const o = mergeOpts[dir];
    if (!o) return "";
    const label = dir === "previous" ? "السابق" : "التالي";
    const sug = o.suggestion;
    const gapInfo = o.gapWords
      ? `فاصل ${o.gapWords} كلمة: «<span class="text-slate-300">${escapeHtml(o.gapText)}</span>»`
      : "متلاصقان بلا فاصل";
    const btn = (gapType, text, primary) => `
      <button type="button" data-merge-dir="${dir}" data-merge-gap="${gapType}" class="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition ${primary
        ? "bg-violet-600/30 hover:bg-violet-600/45 text-violet-100 border-violet-500/50"
        : "bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700"}">${text}</button>`;
    const preferred = sug?.gapType || "PART_OF_QUOTE";
    const buttons = o.gapWords
      ? btn("PART_OF_QUOTE", "🔗 دمج وضمّ الفاصل (خطأ تفريغ)", preferred === "PART_OF_QUOTE") +
        btn("COMMENTARY", "🔗 دمج والفاصل تعليق", preferred === "COMMENTARY")
      : btn("PART_OF_QUOTE", "🔗 دمج", true);
    return `
      <div class="p-2.5 rounded-lg space-y-1.5 border ${sug ? "bg-violet-950/40 border-violet-500/40" : "bg-slate-900/60 border-slate-800"}">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-bold ${sug ? "text-violet-200" : "text-slate-300"}">${sug
            ? `🤖 يقترح الذكاء الاصطناعي الدمج مع ${label} (${Math.round((sug.confidence || 0) * 100)}%)`
            : `المقتبس ${label}`}</span>
          ${sug ? `<button type="button" data-merge-dismiss="${dir}" class="text-[10px] text-slate-400 hover:text-slate-200 underline">تجاهل</button>` : ""}
        </div>
        <div class="text-[10px] text-slate-400 leading-relaxed">📖 ${escapeHtml(o.det.displayRef || o.det.reference || "مقتبس")} • ${gapInfo}</div>
        <div class="flex gap-1.5">${buttons}</div>
      </div>`;
  };
  const mergeBlockHtml = (mergeOpts.previous || mergeOpts.next) ? `
      <div class="rounded-xl bg-slate-950/90 border ${(mergeOpts.previous?.suggestion || mergeOpts.next?.suggestion) ? "border-violet-500/40" : "border-slate-800"} p-3 space-y-2">
        <div class="text-[11px] font-bold text-slate-300">🔗 دمج مع مقتبس مجاور <span class="font-normal text-slate-500">— حين قسّم المحرك نصاً واحداً بسبب خطأ تفريغ أو تعليق</span></div>
        ${mergeSideHtml("previous")}
        ${mergeSideHtml("next")}
      </div>` : "";

  const activeUnitIndices = new Set();
  if (Array.isArray(det.qSegments)) {
    det.qSegments.forEach(([qStart, qEnd]) => {
      for (let i = qStart; i < qEnd; i++) activeUnitIndices.add(i);
    });
  }

  // Hadith: show the whole text (chain of narration + matn + takhrij); the engine only compares the matn,
  // so the words around it are dimmed but still selectable. Chip indices are positions in `chipWords`.
  const fullView = typeof getUnitFullWordView === "function" ? getUnitFullWordView(unit) : null;
  const chipWords = fullView ? fullView.words : unitWords;
  const matnOffset = fullView ? fullView.matnStart : 0;
  // what is selected: the exact words applied by hand, else the aligned span in the full text, else the matn span
  let selectedChips;
  if (det.refSelection && det.refSelection.unitId === det.unitId && det.refSelection.full === Boolean(fullView)) {
    selectedChips = new Set(det.refSelection.indices);
  } else if (fullView && Array.isArray(det.qFullSegments)) {
    selectedChips = new Set();
    det.qFullSegments.forEach(([a, b]) => { for (let i = a; i < b; i++) selectedChips.add(i); });
  } else {
    selectedChips = new Set([...activeUnitIndices].map(i => i + matnOffset));
  }

  let chipHtml = "";
  if (chipWords && chipWords.length) {
    chipHtml = chipWords.map((word, wIdx) => {
      const outside = fullView && (wIdx < fullView.matnStart || wIdx >= fullView.matnEnd);
      const chipClass = (selectedChips.has(wIdx) ? "matched" : "unmatched") + (outside ? " outside-matn" : "");
      const title = outside ? "خارج المتن (سند أو تخريج): لا يقارنه المحرك حالياً، ويمكنك اختياره يدوياً" : "انقر لتحديد أو استبعاد هذه الكلمة";
      return `<span class="ref-word-chip ${chipClass}" data-ref-word-idx="${wIdx}" title="${title}">${escapeHtml(word)}</span>`;
    }).join("");
  }

  // Multi-candidates accordion items: the approved reference first, then the ones added from the search
  const candidates = typeof getFindingCandidates === "function" ? getFindingCandidates(det)
    : (unit ? [{ unitId: unit.unitId, displayRef: unit.displayRef, text: unit.fullText }] : []);
  let candidatesHtml = "";
  if (candidates.length > 0) {
    candidatesHtml = candidates.map(c => {
      const approved = c.unitId === det.unitId;
      return `
      <div class="p-2.5 rounded-xl border flex items-center justify-between gap-2 transition ${approved ? "bg-emerald-950/30 border-emerald-500/40" : "bg-slate-900/90 border-slate-800 hover:border-sky-500/50"}" data-set-cand-id="${escapeHtml(c.unitId)}">
        <div class="overflow-hidden flex-1 min-w-0">
          <div class="font-bold text-xs text-sky-200">${escapeHtml(c.displayRef || c.reference || "مرجع بديل")}${c.addedManually ? ' <span class="text-[10px] text-slate-400 font-normal">(أضفته يدوياً)</span>' : ""}${det.refEdits?.[c.unitId] && c.unitId !== det.unitId ? ' <span class="text-[10px] text-sky-300 font-normal" title="لديك تعديلات محفوظة على هذا المرجع">✨ له تعديلات محفوظة</span>' : ""}</div>
          <div class="cand-text text-[11px] text-slate-400 font-quran-text truncate max-w-xs">${escapeHtml(c.text || c.fullText || "")}</div>
          ${(c.text || c.fullText) ? '<button type="button" class="btnExpandCandidateRef text-[10px] text-sky-300 hover:text-sky-200 underline">👁 عرض النص كاملاً</button>' : ""}
        </div>
        ${approved
          ? '<span class="px-2.5 py-1 rounded-lg bg-emerald-600/30 text-emerald-200 text-[11px] font-bold shrink-0">★ المرجع المعتمد</span>'
          : `<span class="flex items-center gap-1 shrink-0">
               <button type="button" class="btnPickCandidateRef px-2.5 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 border border-emerald-500/40 text-[11px] font-bold transition" data-unit-id="${escapeHtml(c.unitId)}" data-ref-label="${escapeHtml(c.displayRef || "")}">✓ اعتماد هذا المرجع</button>
               ${c.addedManually ? `<button type="button" class="btnRemoveCandidateRef px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-200 text-[11px]" data-unit-id="${escapeHtml(c.unitId)}" title="إزالة من المراجع المطابقة">✕</button>` : ""}
             </span>`}
      </div>`;
    }).join("");
  }

  panel.innerHTML = `
    <div class="space-y-4 text-xs font-arabic-ui">
      <!-- Top Row: Navigation, Category Switcher & Delete -->
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400 font-semibold">التصنيف:</span>
          <button type="button" data-set-cat="ayah" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "ayah" ? "bg-emerald-600 text-white border-emerald-400 shadow-sm" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}">آية</button>
          <button type="button" data-set-cat="hadith" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "hadith" ? "bg-amber-600 text-white border-amber-400 shadow-sm" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}">حديث</button>
          <button type="button" data-set-cat="dhikr" class="px-2.5 py-1 rounded-lg font-bold border transition ${fType === "dhikr" ? "bg-violet-600 text-white border-violet-400 shadow-sm" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}">ذكر</button>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" id="btnInspectorShowInDisplay" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold transition flex items-center gap-1" title="الانتقال إلى شاشة العرض عند هذا المقتبس">
            🎬 عرض في شاشة العرض
          </button>
          <button type="button" id="btnInspectorPlayQuote" class="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/35 text-sky-300 border border-sky-500/40 font-bold transition flex items-center gap-1" title="الاستماع لتوقيت هذا المقتبس">
            ▶ استماع
          </button>
          <button type="button" id="btnInspectorDeleteFinding" class="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-800 text-rose-200 border border-rose-500/40 font-bold transition flex items-center gap-1" title="حذف المقتبس وتحديد نية الحذف">
            🗑️ حذف
          </button>
        </div>
      </div>

      <!-- Section 1: Raw Lecture Transcript Card -->
      <div class="rounded-2xl bg-slate-950/90 border border-slate-800 p-3.5 space-y-1.5 shadow-sm">
        <div class="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
          <span>النص المنطوق في المحاضرة (Raw ASR):</span>
          <span class="font-mono text-slate-400" dir="ltr">#${det.wordStartIdx + 1} → #${det.wordEndIdx + 1} (${formatSecondsToShortTime(det.startTime)} → ${formatSecondsToShortTime(det.endTime)})</span>
        </div>
        <div class="text-sm sm:text-base font-arabic-text text-amber-200 leading-relaxed bg-slate-900/90 p-3 rounded-xl border border-slate-800 select-text">
          «${escapeHtml(det.matchedText || "")}»
        </div>
      </div>

      <!-- Section 2: Reference Header & Metadata -->
      <div class="rounded-2xl bg-slate-950/90 border border-slate-800 p-3.5 space-y-2.5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
          <div>
            <span class="text-[10px] text-slate-400 block">المرجع المعتمد:</span>
            <h4 class="text-sm font-bold text-emerald-300">${escapeHtml(det.displayRef || det.reference || "غير محدد")}</h4>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <button type="button" id="btnToggleAllCandidates" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition">
              📚 المراجع المطابقة (${candidates.length})
            </button>
            <button type="button" id="btnInspectorSearchCorpusRef" class="px-2.5 py-1 rounded-lg bg-sky-600/25 hover:bg-sky-600/40 text-sky-300 border border-sky-500/40 font-bold transition">
              🔍 بحث وإضافة مرجع
            </button>
            ${(fType === "dhikr" || det.sourceType === "ADHKAR" || det.isOutsideCorpus) ? `
              <button type="button" id="btnInspectorJumpToAdhkarStudio" class="px-2.5 py-1 rounded-lg bg-violet-600/25 hover:bg-violet-600/40 text-violet-300 border border-violet-500/40 font-bold transition" title="الانتقال إلى استوديو الأذكار وتعديل أو حذف هذا الذكر">
                📿 فتح في استوديو الأذكار
              </button>
            ` : ""}
          </div>
        </div>

        <!-- Collapsible Candidate References Accordion -->
        <div id="inspectorAllCandidatesAccordion" class="hidden rounded-xl bg-slate-900 border border-slate-800 p-2.5 space-y-2">
          <div class="text-[11px] font-bold text-slate-300">المراجع البديلة المكتشفة في القاعدة:</div>
          <div class="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            ${candidatesHtml || '<div class="text-slate-500 text-center py-2">لا توجد مراجع بديلة مسجلة لهذا الموضع.</div>'}
          </div>
        </div>

        <!-- Section 3: Interactive Reference Word-Chip Grid (Matching image_096977.png specification) -->
        <div id="inspectorWordChipGridContainer" class="rounded-xl bg-slate-900/90 border border-emerald-500/30 p-3 space-y-2">
          <div class="flex items-center justify-between text-[11px] text-slate-300">
            <span class="font-bold flex items-center gap-1">
              <span>📖</span>
              <span>${fullView ? "النص الكامل للحديث مع السند (حدد الكلمات المراد تضمينها بالدرس):" : "المتن الكامل للمرجع (حدد الكلمات المراد استبدالها أو تضمينها بالدرس):"}</span>
            </span>
            <span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[10px] font-bold">
              تطابق: ${selectedChips.size} / ${chipWords.length} كلمة
            </span>
          </div>

          <div class="flex flex-wrap gap-1 leading-loose text-base font-arabic-text max-h-48 overflow-y-auto p-1 bg-slate-950/60 rounded-xl border border-slate-800" dir="rtl" id="refChipsBox">
            ${chipHtml || '<div class="text-slate-400 p-2">لا يتوفر متن كامل مسجل لهذا المرجع.</div>'}
          </div>

          ${fullView ? `<div class="text-[10px] text-slate-400"><span class="ref-word-chip unmatched outside-matn">…</span> <span>الكلمات الباهتة سند أو تخريج خارج المتن الذي يقارنه المحرك؛ يمكنك اختيارها يدوياً.</span></div>` : ""}
          <div class="flex items-center justify-between pt-2 border-t border-slate-800/80">
            <div class="text-[10px] text-slate-400">يمكنك اختيار أي كلمات من المتن حتى لو لم تكن في النص المنطوق.</div>
            <button type="button" id="btnApplyCustomRefSpan" class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition">
              ✓ تطبيق الكلمات المختارة على النص
            </button>
          </div>
        </div>
      </div>

      <!-- Word Boundary Controls with Live Target Word Previews -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div class="rounded-xl bg-slate-950/90 border border-slate-800 p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-400">بداية المقتبس:</span>
            <span class="font-mono text-emerald-400 font-bold text-xs">#${det.wordStartIdx + 1} «${escapeHtml(startW)}»</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" id="btnStartWordMinus" class="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-emerald-300">-1W توسيع</span>
              <span class="text-[10px] text-slate-400 truncate max-w-[110px]">+ «${escapeHtml(prevWordBeforeStart)}»</span>
            </button>
            <button type="button" id="btnStartWordPlus" class="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-rose-300">+1W تقليص</span>
              <span class="text-[10px] text-slate-400 truncate max-w-[110px]">- «${escapeHtml(startW)}»</span>
            </button>
          </div>
        </div>

        <div class="rounded-xl bg-slate-950/90 border border-slate-800 p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-400">نهاية المقتبس:</span>
            <span class="font-mono text-emerald-400 font-bold text-xs">#${det.wordEndIdx + 1} «${escapeHtml(endW)}»</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" id="btnEndWordMinus" class="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-rose-300">-1W تقليص</span>
              <span class="text-[10px] text-slate-400 truncate max-w-[110px]">- «${escapeHtml(endW)}»</span>
            </button>
            <button type="button" id="btnEndWordPlus" class="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs transition flex flex-col items-center">
              <span class="font-mono font-bold text-emerald-300">+1W توسيع</span>
              <span class="text-[10px] text-slate-400 truncate max-w-[110px]">+ «${escapeHtml(nextWordAfterEnd)}»</span>
            </button>
          </div>
        </div>
      </div>

      ${mergeBlockHtml}

      <!-- AI Verification & Dual-State Training Telemetry Card -->
      <div class="rounded-xl bg-slate-950/90 border border-sky-500/30 p-3.5 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-sky-300 flex items-center gap-1.5">
            <span>🤖</span>
            <span>تدقيق الذكاء الاصطناعي وهندسة بيانات التدريب (Laya)</span>
          </div>
          ${det.aiVerification?.status === "VERIFIED"
            ? (det.aiVerification.verdict === "CORRECT"
                ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">🟢 مقبول / اقتباس مؤكد</span>'
                : (det.aiVerification.verdict === "FALSE"
                    ? '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">🔴 مستبعد / كلام عادي</span>'
                    : '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">🟡 غير متأكد</span>'))
            : (det.aiVerification?.status === "PENDING"
                ? '<span class="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold animate-pulse">⏳ قيد الفحص...</span>'
                : (det.aiVerification?.status === "ERROR"
                    ? '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">⚠️ فشل الفحص</span>'
                    : '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">⚪ غير مفحوص بعد</span>'))}
        </div>

        ${det.aiVerification?.status === "ERROR" && det.aiVerification.reason ? `
          <div class="p-2 rounded-lg bg-rose-950/40 border border-rose-500/30 text-[11px] text-rose-200 leading-relaxed">
            ${escapeHtml(det.aiVerification.reason)}
          </div>
        ` : ""}

        ${det.aiVerification?.status === "VERIFIED" ? `
          <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1.5">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-400">النموذج: <strong class="text-slate-200 font-mono">${escapeHtml(det.aiVerification.modelUsed || det.aiVerification.provider || "")}</strong></span>
              <span class="text-slate-400">نسبة الثقة: <strong class="text-emerald-400 font-mono">${Math.round((det.aiVerification.confidence || 0.88) * 100)}%</strong></span>
            </div>
            ${det.aiVerification.reason ? `
              <div class="text-[11px] text-slate-300 pt-1 text-justify border-t border-slate-800/60 leading-relaxed">
                ${escapeHtml(det.aiVerification.reason)}
              </div>
            ` : ""}
          </div>
        ` : ""}

        <!-- Run / Re-run AI verification on this finding only, ⚙️ opens model & prompt options -->
        <div class="flex items-stretch gap-1.5">
        <button type="button" id="btnInspectorRunAiVerification" ${det.aiVerification?.status === "PENDING" ? "disabled" : ""} class="flex-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
          ${det.aiVerification?.status === "PENDING"
            ? "<span>⏳</span><span>جاري التدقيق...</span>"
            : (det.aiVerification?.status === "VERIFIED" || det.aiVerification?.status === "ERROR"
                ? "<span>🔁</span><span>إعادة التدقيق الذكي لهذا المقتبس</span>"
                : "<span>🤖</span><span>تطبيق التدقيق الذكي على هذا المقتبس</span>")}
        </button>
        <button type="button" id="btnInspectorAiOptions" class="px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm transition" title="خيارات الطلب: النموذج والموجّه">⚙️</button>
        </div>

        <!-- Deep Link to Tab 5 (AI & Logs) -->
        <div class="flex items-center justify-between gap-2 pt-1">
          <button type="button" id="btnInspectorDeepLinkAiLogs" class="w-full px-3 py-1.5 rounded-xl bg-sky-950/40 border border-sky-500/40 text-sky-300 hover:bg-sky-900/60 text-xs font-semibold flex items-center justify-center gap-1.5 transition">
            <span>📊</span>
            <span>عرض تفاصيل الطلب وسجل الاستجابة الكامل في استوديو AI</span>
          </button>
        </div>

        <!-- Dual-State Training Label & Override Buttons -->
        <div class="space-y-1.5 pt-2 border-t border-slate-800/80">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-slate-400 font-medium">التصنيف المحفوظ لتدريب Laya:</span>
            <span id="lblTrainingRecordStatusBadge" class="px-2 py-0.5 rounded-full text-[10px] font-bold ${det.humanOverride ? (det.aiVerification?.verdict === "CORRECT" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-rose-500/20 text-rose-300 border border-rose-500/40") : "bg-slate-800 text-slate-300"}">
              ${det.humanOverride ? (det.aiVerification?.verdict === "CORRECT" ? "🟢 صحيح (Gold)" : "🔴 كلام عادي (Gold)") : "⚪ آلي"}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-1.5 pt-1">
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

  // Wire Event Listeners in Finding Inspector
  panel.querySelectorAll("[data-set-cat]").forEach(btn => {
    btn.addEventListener("click", () => {
      changeFindingCategory(idx, btn.getAttribute("data-set-cat"));
    });
  });

  panel.querySelector("#btnInspectorShowInDisplay")?.addEventListener("click", () => openFindingInDisplay(idx));
  panel.querySelector("#btnInspectorPlayQuote")?.addEventListener("click", () => {
    seekToMediaTimestamp(det.startTime || 0, true);
  });
  panel.querySelector("#btnInspectorDeleteFinding")?.addEventListener("click", () => {
    if (typeof triggerDeleteFindingWithIntentModal === "function") {
      triggerDeleteFindingWithIntentModal(idx);
    } else {
      deleteFinding(idx);
    }
  });
  panel.querySelector("#btnInspectorSearchCorpusRef")?.addEventListener("click", () => openCorpusSearchModalForSelection(fType, idx));
  panel.querySelector("#btnInspectorJumpToAdhkarStudio")?.addEventListener("click", () => {
    switchMainSection("datasets");
  });

  // Candidate References Accordion
  panel.querySelector("#btnToggleAllCandidates")?.addEventListener("click", () => {
    const acc = panel.querySelector("#inspectorAllCandidatesAccordion");
    if (acc) acc.classList.toggle("hidden");
  });

  panel.querySelectorAll(".btnPickCandidateRef").forEach(btn => {
    btn.addEventListener("click", () => {
      const uId = btn.getAttribute("data-unit-id");
      if (uId && typeof linkFindingToCorpusUnit === "function") {
        linkFindingToCorpusUnit(idx, uId, btn.getAttribute("data-ref-label") || "");
      }
    });
  });
  panel.querySelectorAll(".btnExpandCandidateRef").forEach(btn => {
    btn.addEventListener("click", () => {
      const txt = btn.parentElement.querySelector(".cand-text");
      const open = txt.classList.toggle("truncate");
      txt.classList.toggle("max-w-xs", open);
      txt.classList.toggle("whitespace-normal", !open);
      txt.classList.toggle("leading-loose", !open);
      txt.classList.toggle("text-slate-200", !open);
      btn.textContent = open ? "👁 عرض النص كاملاً" : "▲ طي النص";
    });
  });
  panel.querySelectorAll(".btnRemoveCandidateRef").forEach(btn => {
    btn.addEventListener("click", () => removeReferenceFromFinding(idx, btn.getAttribute("data-unit-id")));
  });

  // Boundary Shift Controls
  panel.querySelector("#btnStartWordMinus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "start", -1));
  panel.querySelector("#btnStartWordPlus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "start", 1));
  panel.querySelector("#btnEndWordMinus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "end", -1));
  panel.querySelector("#btnEndWordPlus")?.addEventListener("click", () => adjustFindingWordBoundary(idx, "end", 1));

  // Merge with neighbour
  panel.querySelectorAll("[data-merge-dir]").forEach(btn => {
    btn.addEventListener("click", () => mergeFindingWithNeighbor(idx, btn.getAttribute("data-merge-dir"), btn.getAttribute("data-merge-gap")));
  });
  panel.querySelectorAll("[data-merge-dismiss]").forEach(btn => {
    btn.addEventListener("click", () => dismissFindingMergeSuggestion(idx, btn.getAttribute("data-merge-dismiss")));
  });

  // Word Chip Selection & Apply
  const chips = panel.querySelectorAll(".ref-word-chip");
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      const wIdx = parseInt(chip.getAttribute("data-ref-word-idx"), 10);
      if (selectedChips.has(wIdx)) {
        selectedChips.delete(wIdx);
        chip.classList.remove("matched");
        chip.classList.add("unmatched");
      } else {
        selectedChips.add(wIdx);
        chip.classList.add("matched");
        chip.classList.remove("unmatched");
      }
    });
  });

  panel.querySelector("#btnApplyCustomRefSpan")?.addEventListener("click", () => {
    if (typeof applyReferenceWordsToTranscript === "function") {
      applyReferenceWordsToTranscript(det, Array.from(selectedChips).sort((a, b) => a - b), fullView ? chipWords : null, matnOffset);
    }
  });

  panel.querySelector("#btnInspectorAiOptions")?.addEventListener("click", () => {
    if (typeof openAiRequestOptions === "function") openAiRequestOptions({ mode: "single", findingIdx: idx });
  });

  panel.querySelector("#btnInspectorRunAiVerification")?.addEventListener("click", () => {
    if (typeof window.triggerAiVerification === "function") {
      window.triggerAiVerification([idx]);
    }
  });

  // Deep Link to AI Logs Tab
  panel.querySelector("#btnInspectorDeepLinkAiLogs")?.addEventListener("click", () => {
    switchMainSection("ai_logs");
  });

  // Human Override Buttons
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
      btn.className = "seg-btn is-active";
    } else {
      btn.className = "seg-btn";
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
  if (typeof updateAiLaunchButtonLabel === "function") updateAiLaunchButtonLabel();
  if (typeof scheduleSessionAutosave === "function") scheduleSessionAutosave();
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
  setEl("aiMetricTotalTokens", `${(m.totalContextTokens || 0).toLocaleString("en")} توكن (${(m.totalContextChars || 0).toLocaleString("en")} حرف)`);
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

  // 2. Review happens inline in the formatted text; above it only a one-line status bar
  if (reviewQueueWrap) {
    reviewQueueWrap.innerHTML = reviewItems.length
      ? `<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs">
           <span><strong>⚠️ ${reviewItems.length} جمل تحتاج مراجعة</strong> — <span>مظلَّلة في النص أدناه. انقر أي جملة لمراجعتها أو تغيير وسمها.</span></span>
           <button type="button" id="btnTafrighStartReview" class="px-3 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 font-bold">▶ ابدأ المراجعة</button>
         </div>`
      : `<div class="px-3 py-1.5 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-400 text-[11px]">✓ <span>لا توجد جمل بحاجة لمراجعة. انقر أي جملة في النص لتغيير وسمها.</span></div>`;
    reviewQueueWrap.classList.remove("hidden");
    reviewQueueWrap.querySelector("#btnTafrighStartReview")?.addEventListener("click", () => {
      setTafrighResultsView("text");
      const first = reviewItems[0]?.segment_id;
      if (first) openTafrighInlineReview(first);
    });
  }

  // 3. Render Semantic HTML Structure, then make every sentence reviewable in place
  if (renderedContent) {
    renderedContent.innerHTML = html;
    decorateTafrighReviewInline(tafrighData);
  }

  // 4. Run summary + per-sentence decisions
  updateTafrighSavedBadge();
  renderTafrighRunSummary(tafrighData);
  renderTafrighDetails(tafrighData);
  // stay on the details tab when re-rendering after a review action
  setTafrighResultsView(document.getElementById("tafrighDetailsView")?.classList.contains("hidden") === false ? "details" : "text");
}

// value = tag[:heading level], as sent to /api/tafrigh/review-action
const TAFRIGH_TAG_OPTIONS = [
  ["paragraph", "فقرة"], ["continuation", "تكملة لما قبلها"], ["heading:1", "عنوان رئيسي"], ["heading:2", "عنوان فرعي"],
  ["heading:3", "عنوان مستوى 3"], ["list_intro", "تمهيد قائمة"], ["list_item", "عنصر قائمة"], ["comment", "تعليق عارض"], ["matn_section", "متن"]
];
const TAFRIGH_REASON_AR = {
  low_confidence: "ثقة النموذج منخفضة",
  EDIT_REJECTED: "رُفض تصحيح اقترحه النموذج",
  EDIT_CAP_EXCEEDED: "تصحيح يغير النص أكثر من المسموح",
  SPLIT_VALIDATION_FAILED: "تعذر تقسيم الجملة",
  INVALID_TRANSITION_FALLBACK: "وسم غير صالح في هذا الموضع (حُوِّل إلى فقرة)",
  MODEL_ERROR: "فشل طلب النموذج لهذه الجملة",
  WINDOW_FALLBACK_USED: "أُعيدت معالجتها جملةً جملة",
  OUTLINE_REPAIR_REVIEW: "عدّلها إصلاح الفهرس",
  FROM_SPLIT: null
};
const TAFRIGH_SOURCE_BADGE = {
  human_corrected: '<span class="px-1.5 py-0.5 rounded bg-sky-900/70 text-sky-200 border border-sky-500/30">✏️ مصحَّح</span>',
  human_confirmed: '<span class="px-1.5 py-0.5 rounded bg-emerald-900/70 text-emerald-200 border border-emerald-500/30">✓ مؤكَّد</span>',
  model: '<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">🤖 النموذج</span>'
};

function tafrighLabelSource(sg) {
  const action = sg.trace?.review?.action;
  return action === "confirm" ? "human_confirmed" : (action === "correct" || action === "revert_edits") ? "human_corrected" : "model";
}

function tafrighModelConfidence(sg) {
  const dec = sg.trace?.decision || sg.trace?.split_from?.decision || {};
  const c = dec.answers?.tag?.confidence;
  return typeof c === "number" ? c : null;
}

const TAFRIGH_TAG_AR = {
  paragraph: "فقرة", heading: "عنوان", list_intro: "تمهيد قائمة", list_item: "عنصر قائمة",
  matn_section: "متن", continuation: "تكملة", comment: "تعليق عارض"
};
const TAFRIGH_REJECT_AR = {
  char_offsets_without_quoted_original: "مواضع بالحروف دون ذكر الكلمة الأصلية (غير موثوق)",
  quoted_original_does_not_match_text: "الكلمة التي ذكرها النموذج غير موجودة في هذا الموضع",
  inside_detected_quotation: "داخل آية/حديث مكتشف (يُعرض من المصدر)",
  word_index_out_of_range: "رقم كلمة خارج الجملة",
  bad_word_index: "رقم كلمة غير صالح",
  out_of_bounds: "خارج حدود الجملة",
  no_change: "لا تغيير",
  replacement_too_different: "الاستبدال يختلف كثيراً عن الأصل",
  overlaps_another_edit: "يتداخل مع تصحيح آخر"
};
const TAFRIGH_CUT_AR = { punctuation: "ترقيم", comma: "فاصلة", pause: "سكتة", length: "طول", detection: "اقتباس", end: "نهاية النص" };

// --- Split visibility: when the classifier asked for a split, what happened, and who did what ---
const TAFRIGH_SPLIT_SKIP_AR = {
  too_short: "الجملة قصيرة (أقل من 6 كلمات) فلا تُقسَّم",
  from_split: "هي جزء من تقسيم سابق، والأجزاء لا يُعاد تقسيمها",
  no_points: "لم يُرجع Gemini أي نقطة قطع",
  inside_quote: "كل نقاط القطع المقترحة كانت داخل آية أو حديث فحُذفت",
  invalid: "نقاط القطع المقترحة غير صالحة"
};

function tafrighProviderName(p) {
  return { jev: "JEV", gemini: "Gemini", laya: "Laya" }[String(p || "").toLowerCase()] || (p ? String(p) : "");
}

function tafrighPointsByLabel(v) {
  if (!v || v === "model_decision") return "قرار النموذج المصنِّف نفسه";
  if (v.startsWith("openrouter:")) return `Gemini عبر OpenRouter (${v.slice("openrouter:google/".length) || v.slice(11)})`;
  if (v === "gemini") return "Gemini";   // runs from before the route was recorded
  if (v.startsWith("gemini:")) return `Gemini مباشرة عبر Google (${v.slice(7)})`;
  return v;
}

function tafrighSplitProb(decision) {
  const ns = decision?.answers?.needsSplitting;
  const p = ns?.probabilities?.true ?? (ns?.choice === "true" ? ns?.confidence : null);
  return typeof p === "number" ? Math.round(p * 100) : null;
}

// "split asked but not applied" or "piece k/n of a split" — null when the sentence has nothing to do with splitting
function tafrighSplitInfo(sg) {
  const tr = sg.trace || {};
  if (tr.split_from) return { kind: "piece", ...tr.split_from };
  const out = tr.split_outcome;
  if (out && out.status !== "applied") return { kind: "skipped", ...out, decision: tr.decision };
  return null;
}

function tafrighSplitCardHtml(sg) {
  const info = tafrighSplitInfo(sg);
  if (!info) return "";
  if (info.kind === "piece") {
    const asker = tafrighProviderName(info.decision?.provider) || "النموذج";
    const prob = tafrighSplitProb(info.decision);
    const used = new Set(info.split?.used || []);
    const words = String(info.text || "").split(/\s+/).filter(Boolean);
    const marked = words.map((w, i) => (used.has(i) ? '<b class="text-violet-300"> ✂ </b>' : "") + escapeHtml(w)).join(" ");
    return `
      <div class="p-2 rounded-lg bg-violet-950/40 border border-violet-500/30 text-[11px] space-y-1">
        <div class="font-bold text-violet-200">✂️ <span>جزء</span> ${info.piece ? `<span class="font-mono">${info.piece}/${info.pieces}</span>` : ""} <span>من جملة قُسِّمت</span></div>
        <div class="text-slate-300"><span>طلب التقسيم:</span> <b>${escapeHtml(asker)}</b>${prob !== null ? ` <span class="font-mono text-slate-400">(${prob}%)</span>` : ""} • <span>نقاط القطع من:</span> <b>${escapeHtml(tafrighPointsByLabel(info.split?.points_by || (info.split?.source === "gemini_split_request" ? "gemini" : "model_decision")))}</b></div>
        <div class="text-slate-400"><span>الجملة الأصلية:</span> <span data-no-i18n class="text-slate-200">${marked}</span></div>
        <div class="text-slate-400"><span>وسم هذا الجزء أعطاه:</span> <b class="text-slate-200">${escapeHtml(tafrighProviderName(sg.trace?.decision?.provider) || "—")}</b> <span>(أُعيد تصنيف كل جزء وحده بعد التقسيم)</span></div>
      </div>`;
  }
  const asker = tafrighProviderName(info.decision?.provider) || "النموذج";
  const prob = tafrighSplitProb(info.decision);
  return `
    <div class="p-2 rounded-lg bg-violet-950/30 border border-violet-500/25 text-[11px] space-y-1">
      <div class="font-bold text-violet-200">✂️ <b>${escapeHtml(asker)}</b> <span>طلب تقسيم هذه الجملة</span>${prob !== null ? ` <span class="font-mono text-slate-400">(${prob}%)</span>` : ""} <span>— لكنها لم تُقسَّم</span></div>
      <div class="text-slate-300"><span>السبب:</span> ${escapeHtml(TAFRIGH_SPLIT_SKIP_AR[info.why] || info.why || "—")}${(info.proposed || []).length ? ` <span class="text-slate-500">(<span>نقاط مقترحة:</span> <span class="font-mono">${info.proposed.join(", ")}</span>)</span>` : ""}</div>
      <div class="text-slate-400">بقي الوسم الذي أعطاه المصنِّف للجملة كاملة.</div>
    </div>`;
}

// After a review action the output is re-rendered; this says which sentence's card to open next
let tafrighPendingReviewAfter = null;

function decorateTafrighReviewInline(data) {
  const box = document.getElementById("tafrighRenderedContent");
  if (!box) return;
  const segs = data.structured_json?.segments || [];
  const review = new Set((data.review_items || []).map(i => i.segment_id));
  segs.forEach(sg => {
    const el = document.getElementById(sg.id);
    if (!el || !box.contains(el)) return;
    el.classList.add("tfg-seg");
    el.dataset.tfgSeg = sg.id;
    el.classList.toggle("tfg-needs-review", review.has(sg.id));
    el.classList.toggle("tfg-reviewed", tafrighLabelSource(sg) !== "model");
    const split = tafrighSplitInfo(sg);
    el.classList.toggle("tfg-split-piece", split?.kind === "piece");
    el.classList.toggle("tfg-split-cut", split?.kind === "piece" && (split.piece || 1) > 1);
    el.classList.toggle("tfg-split-skipped", split?.kind === "skipped");
  });
  box.onclick = (e) => {
    if (e.target.closest(".tfg-review-card")) return;
    const el = e.target.closest(".tfg-seg");
    if (el) openTafrighInlineReview(el.dataset.tfgSeg);
  };
  if (tafrighPendingReviewAfter) {
    const after = tafrighPendingReviewAfter;
    tafrighPendingReviewAfter = null;
    const order = segs.map(sg => sg.id);
    const from = order.indexOf(after);
    const next = order.slice(from + 1).concat(order.slice(0, Math.max(0, from))).find(id => review.has(id));
    if (next) openTafrighInlineReview(next);
    else showToast("✅ تمت مراجعة كل الجمل المحتاجة للمراجعة");
  }
}

function openTafrighInlineReview(segId) {
  const data = currentState.tafrigh?.data;
  const box = document.getElementById("tafrighRenderedContent");
  const el = document.getElementById(segId);
  if (!data || !box || !el || !box.contains(el)) return;
  box.querySelectorAll(".tfg-review-card").forEach(c => c.remove());
  box.querySelectorAll(".tfg-active").forEach(c => c.classList.remove("tfg-active"));

  const segs = data.structured_json?.segments || [];
  const k = segs.findIndex(sg => sg.id === segId);
  const sg = segs[k];
  if (!sg) return;
  const runId = data.run_id || "";
  const reviewItems = data.review_items || [];
  const item = reviewItems.find(i => i.segment_id === segId);
  const src = tafrighLabelSource(sg);
  const cur = sg.tag === "heading" ? `heading:${sg.level || 1}` : sg.tag;
  const tagLabel = (TAFRIGH_TAG_AR[sg.tag] || sg.tag) + (sg.level ? ` ${sg.level}` : "");
  const opts = TAFRIGH_TAG_OPTIONS.some(([v]) => v === cur) ? TAFRIGH_TAG_OPTIONS : [...TAFRIGH_TAG_OPTIONS, [cur, tagLabel]];
  const tagAnswer = (sg.trace?.decision || sg.trace?.split_from?.decision || {}).answers?.tag || {};
  const probs = Object.entries(tagAnswer.probabilities || {}).filter(([, v]) => v >= 0.02).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([key, v]) => {
      const label = key.startsWith("heading_") ? `${TAFRIGH_TAG_AR.heading} ${key.split("_")[1] || ""}` : (TAFRIGH_TAG_AR[key] || key);
      return `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300"><span>${escapeHtml(label)}</span> <span class="font-mono">${Math.round(v * 100)}%</span></span>`;
    }).join(" ");
  const reasons = (item?.reasons || []).map(r => TAFRIGH_REASON_AR[r]).filter(Boolean);
  const remaining = reviewItems.filter(i => i.segment_id !== segId).length;

  const card = document.createElement("div");
  card.className = "tfg-review-card";
  card.setAttribute("data-i18n-ui", "");
  card.innerHTML = `
    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span class="font-mono text-slate-500">#${k + 1}</span>
      <span class="px-2 py-0.5 rounded-lg bg-amber-600/20 text-amber-200 font-bold">${escapeHtml(tagLabel)}</span>
      ${TAFRIGH_SOURCE_BADGE[src]}
      ${sg.trace?.decision?.provider ? `<span class="text-slate-500"><span>صنّفها:</span> ${escapeHtml(tafrighProviderName(sg.trace.decision.provider))}</span>` : ""}
      ${item ? '<span class="text-amber-300">⚠️ للمراجعة</span>' : ""}
      <button type="button" data-tfg-close class="ms-auto px-1.5 text-slate-400 hover:text-white" title="إغلاق">✕</button>
    </div>
    ${reasons.length ? `<div class="text-[11px] text-amber-300">${reasons.map(r => `<span>${escapeHtml(r)}</span>`).join(" • ")}</div>` : ""}
    ${tafrighSplitCardHtml(sg)}
    ${probs ? `<div class="flex flex-wrap items-center gap-1 text-[10px]"><span class="text-slate-400">احتمالات النموذج:</span> ${probs}</div>` : ""}
    ${sg.corrected_text ? `<div class="text-[11px] text-slate-400"><span>الأصل قبل التصحيح الإملائي:</span> <span data-no-i18n class="text-slate-300">${escapeHtml(sg.original_text.trim())}</span></div>` : ""}
    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span class="text-slate-400">الوسم:</span>
      <select data-tfg-relabel class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-200">
        ${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      ${src === "model" || item ? '<button type="button" data-tfg-confirm class="px-2.5 py-1 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/45 text-emerald-200 border border-emerald-500/40 font-bold">✓ الوسم صحيح</button>' : ""}
      ${item?.has_typo_versions ? '<button type="button" data-tfg-revert class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-200 border border-rose-500/40 font-bold">↩️ إلغاء التصحيح الإملائي</button>' : ""}
      ${remaining ? `<button type="button" data-tfg-next class="ms-auto px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"><span>التالي للمراجعة</span> <span class="font-mono">(${remaining})</span></button>` : ""}
    </div>`;

  // A card is a block: put it after the sentence's block (a continuation is an inline span inside a paragraph)
  const block = el.closest("p, li, h1, h2, h3, h4, h5, h6, aside, .tafrigh-matn-block") || el;
  block.insertAdjacentElement("afterend", card);
  el.classList.add("tfg-active");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const advance = () => { tafrighPendingReviewAfter = segId; };
  card.querySelector("[data-tfg-close]")?.addEventListener("click", () => { card.remove(); el.classList.remove("tfg-active"); });
  card.querySelector("[data-tfg-relabel]")?.addEventListener("change", (e) => {
    const [tag, level] = e.target.value.split(":");
    advance();
    executeTafrighReviewAction(runId, segId, "correct", { corrected_tag: tag, corrected_level: level ? parseInt(level, 10) : null });
  });
  card.querySelector("[data-tfg-confirm]")?.addEventListener("click", () => { advance(); executeTafrighReviewAction(runId, segId, "confirm"); });
  card.querySelector("[data-tfg-revert]")?.addEventListener("click", () => executeTafrighReviewAction(runId, segId, "reject"));
  card.querySelector("[data-tfg-next]")?.addEventListener("click", () => {
    const order = segs.map(x => x.id);
    const flagged = new Set(reviewItems.map(i => i.segment_id));
    const next = order.slice(k + 1).concat(order.slice(0, k)).find(id => flagged.has(id));
    if (next) openTafrighInlineReview(next);
  });
}

function setTafrighResultsView(view) {
  document.getElementById("tafrighRenderedContent")?.classList.toggle("hidden", view !== "text");
  document.getElementById("tafrighDetailsView")?.classList.toggle("hidden", view !== "details");
  document.querySelectorAll(".tafrigh-view-tab").forEach(b => {
    const on = b.getAttribute("data-tafrigh-view") === view;
    b.className = "tafrigh-view-tab seg-btn" + (on ? " is-active" : "");
  });
}

function renderTafrighRunSummary(data) {
  const box = document.getElementById("tafrighRunSummary");
  if (!box) return;
  const segs = data.structured_json?.segments || [];
  const rep = data.report || {};
  const tags = {};
  let acc = 0, rej = 0, covered = 0, quotes = 0;
  segs.forEach(sg => {
    tags[sg.tag] = (tags[sg.tag] || 0) + 1;
    acc += (sg.trace?.edits?.accepted || []).length;
    (sg.trace?.edits?.rejected || []).forEach(r => { if (r.why === "inside_detected_quotation") covered++; else rej++; });
    quotes += (sg.quotes || []).length;
  });
  const chip = (t, cls = "bg-slate-800 text-slate-200") => `<span class="px-2 py-0.5 rounded-lg ${cls}">${t}</span>`;
  box.innerHTML = [
    chip(`${segs.length} جملة`, "bg-amber-600/20 text-amber-200"),
    ...Object.entries(tags).map(([k, v]) => chip(`${TAFRIGH_TAG_AR[k] || k}: ${v}`)),
    chip(`اقتباسات: ${quotes}`, "bg-emerald-900/60 text-emerald-200"),
    ...(() => {
      const parents = new Set(segs.filter(sg => sg.trace?.split_from).map(sg => sg.trace.split_from.id));
      const pieces = segs.filter(sg => sg.trace?.split_from).length;
      const skipped = segs.filter(sg => tafrighSplitInfo(sg)?.kind === "skipped").length;
      return parents.size || skipped
        ? [chip(`✂️ قُسِّمت ${parents.size} جملة إلى ${pieces} جزء${skipped ? ` • طُلب ولم يُطبَّق: ${skipped}` : ""}`, "bg-violet-900/60 text-violet-200")]
        : [];
    })(),
    chip(`تصحيحات مقبولة: ${acc}`, "bg-sky-900/60 text-sky-200"),
    chip(`مرفوضة: ${rej}`, rej ? "bg-rose-900/60 text-rose-200" : "bg-slate-800 text-slate-300"),
    ...(covered ? [chip(`تصحيحات داخل اقتباس (معروض من المصدر): ${covered}`, "bg-slate-800 text-slate-400")] : []),
    chip(`طلبات: ${rep.total_requests ?? "—"}`),
    chip(`التكلفة: $${(rep.total_cost_usd || 0).toFixed(5)}`),
    chip(`الزمن: ${rep.wall_clock_seconds ?? "—"}ث`)
  ].join("");
}

function renderTafrighDetails(data) {
  const box = document.getElementById("tafrighDetailsView");
  if (!box) return;
  const segs = data.structured_json?.segments || [];
  const runId = data.run_id || "";
  const pct = c => (typeof c === "number" ? ` <span class="text-slate-500">${Math.round(c * 100)}%</span>` : "");
  const LABEL = v => {
    v = String(v);
    if (v.startsWith("heading_")) return `عنوان ${v.split("_")[1] || ""}`.trim();
    return TAFRIGH_TAG_AR[v] || (v === "true" ? "نعم" : v === "false" ? "لا" : v);
  };
  const dist = a => {
    const p = a && a.probabilities ? Object.entries(a.probabilities).filter(([, v]) => v >= 0.01).sort((x, y) => y[1] - x[1]) : [];
    return p.length > 1 ? ` <span class="text-slate-500">(${p.map(([k, v]) => `${escapeHtml(LABEL(k))} ${Math.round(v * 100)}%`).join(" / ")})</span>` : pct(a && a.confidence);
  };
  const yesNo = v => (v === "true" ? "نعم" : v === "false" ? "لا" : escapeHtml(String(v ?? "—")));
  box.innerHTML = segs.map((sg, k) => {
    const tr = sg.trace || {};
    const dec = tr.decision || tr.split_from?.decision || {};
    const ans = dec.answers || {};
    const t = typeof sg.start_time === "number" ? formatSecondsToShortTime(sg.start_time) : "";
    const tagLabel = (TAFRIGH_TAG_AR[sg.tag] || sg.tag) + (sg.level ? ` ${sg.level}` : "");
    const answers = Object.keys(ans).length
      ? `<div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
           ${ans.tag ? `<span>الوسم المقترح: <b>${escapeHtml(LABEL(ans.tag.choice))}</b>${dist(ans.tag)}</span>` : ""}
           ${ans.needsSplitting ? `<span>يحتاج تقسيماً: <b>${yesNo(ans.needsSplitting.choice)}</b>${dist(ans.needsSplitting)}</span>` : ""}
           ${ans.hasTypo ? `<span>فيه خطأ تفريغ: <b>${yesNo(ans.hasTypo.choice)}</b>${dist(ans.hasTypo)}</span>` : ""}
           ${dec.latency_ms ? `<span class="text-slate-500">${Math.round(dec.latency_ms)}ms</span>` : ""}
         </div>`
      : (dec.raw ? `<div class="text-[11px] text-slate-400 font-mono" dir="ltr">${escapeHtml(JSON.stringify(dec.raw).slice(0, 300))}</div>` : "");
    const split = tafrighSplitCardHtml(sg);
    const ed = tr.edits || {};
    const edits = [
      ...(ed.accepted || []).map(e => `<div class="text-[11px] text-sky-200">✔ تصحيح: <s class="text-slate-500">${escapeHtml(e.original || "")}</s> ← <b>${escapeHtml(e.replacement)}</b>${e.reason ? ` <span class="text-slate-500">(${escapeHtml(e.reason)})</span>` : ""}</div>`),
      ...(ed.rejected || []).map(e => e.why === "inside_detected_quotation"
        ? `<div class="text-[11px] text-slate-400">◌ لم يُطبَّق: ${escapeHtml(e.original || e.span || "")} ← ${escapeHtml(e.replacement || "")} — ${escapeHtml(TAFRIGH_REJECT_AR[e.why])}</div>`
        : `<div class="text-[11px] text-rose-300">✘ رُفض: ${escapeHtml(e.original || e.span || "")} ← ${escapeHtml(e.replacement || "")} — ${escapeHtml(TAFRIGH_REJECT_AR[e.why] || e.why)}</div>`)
    ].join("");
    const quotes = (sg.quotes || []).map(q =>
      `<span class="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30">${q.kind === "quran" ? "آية" : q.kind === "hadith" ? "حديث" : "ذكر"}: ${escapeHtml(q.ref)}${q.band === "CANDIDATE" ? "؟" : ""}</span>`).join(" ");
    const flags = (sg.review_flags || []).map(f => `<span class="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/30">${escapeHtml(f)}</span>`).join(" ");
    return `
      <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1.5" id="detail_${escapeHtml(sg.id)}">
        <div class="flex flex-wrap items-center gap-2 text-[11px]">
          <span class="font-mono text-slate-500">#${k + 1}</span>
          <span class="px-2 py-0.5 rounded-lg bg-amber-600/20 text-amber-200 font-bold">${escapeHtml(tagLabel)}</span>
          ${sg.comment_kind ? `<span class="text-slate-400">(${escapeHtml(sg.comment_kind)})</span>` : ""}
          <span class="text-slate-500">${escapeHtml(dec.provider || "")}</span>
          <span class="text-slate-500">نهاية الجملة: ${escapeHtml(TAFRIGH_CUT_AR[sg.cut_reason] || sg.cut_reason || "—")}</span>
          <span class="font-mono text-slate-600 mr-auto" dir="ltr">${t}</span>
        </div>
        <div class="text-sm text-slate-100 leading-loose" data-no-i18n>${escapeHtml(sg.display_text || sg.text || "")}</div>
        ${sg.corrected_text ? `<div class="text-[11px] text-slate-500"><span>الأصل:</span> <span data-no-i18n>${escapeHtml(sg.original_text.trim())}</span></div>` : ""}
        <div class="flex flex-wrap items-center gap-1.5 text-[11px] pt-1 border-t border-slate-800/70">
          <span class="text-slate-400">الوسم:</span>
          <select class="sel-tafrigh-relabel bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200" data-seg-id="${escapeHtml(sg.id)}">
            ${(() => {
              const cur = sg.tag === "heading" ? `heading:${sg.level || 1}` : sg.tag;
              const opts = TAFRIGH_TAG_OPTIONS.some(([v]) => v === cur) ? TAFRIGH_TAG_OPTIONS : [...TAFRIGH_TAG_OPTIONS, [cur, tagLabel]];
              return opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("");
            })()}
          </select>
          ${tafrighLabelSource(sg) === "model" ? `<button type="button" class="btn-tafrigh-confirm-label px-2 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 font-bold" data-seg-id="${escapeHtml(sg.id)}" title="الوسم صحيح كما هو">✓ تأكيد</button>` : ""}
          ${TAFRIGH_SOURCE_BADGE[tafrighLabelSource(sg)]}
        </div>
        ${answers}${split}${edits}
        ${quotes || flags ? `<div class="flex flex-wrap gap-1 text-[10px]">${quotes} ${flags}</div>` : ""}
      </div>`;
  }).join("") || `<div class="p-4 text-center text-slate-400 text-xs">لا توجد جمل.</div>`;

  box.querySelectorAll(".sel-tafrigh-relabel").forEach(sel => sel.addEventListener("change", () => {
    const [tag, level] = sel.value.split(":");
    executeTafrighReviewAction(runId, sel.getAttribute("data-seg-id"), "correct",
      { corrected_tag: tag, corrected_level: level ? parseInt(level, 10) : null });
  }));
  box.querySelectorAll(".btn-tafrigh-confirm-label").forEach(btn => btn.addEventListener("click", () => {
    executeTafrighReviewAction(runId, btn.getAttribute("data-seg-id"), "confirm");
  }));
}

// -----------------------------------------------------------------------------
// Save run → Laya fine-tuning examples (only the sentences the user picks)
// -----------------------------------------------------------------------------

function updateTafrighSavedBadge() {
  const badge = document.getElementById("lblTafrighSavedBadge");
  if (!badge) return;
  const runId = currentState.tafrigh?.data?.run_id;
  const saved = runId && currentState.tafrigh?.savedRuns?.[runId];
  badge.classList.toggle("hidden", !saved);
  if (saved) badge.textContent = `✓ ${saved.sentences}`;
}

function openSaveTafrighRunModal() {
  const data = currentState.tafrigh?.data;
  const segs = data?.structured_json?.segments || [];
  if (!data?.run_id || !segs.length) {
    showToast("⚠️ لا يوجد تفريغ لحفظه بعد.");
    return;
  }
  const runId = data.run_id;
  const needsReview = new Set((data.review_items || []).map(i => i.segment_id));
  const prevSaved = currentState.tafrigh.savedRuns?.[runId];
  // Default: everything except sentences still waiting for review (uncertain labels make poor training data)
  let picked = new Set(prevSaved ? prevSaved.segmentIds : segs.filter(sg => !needsReview.has(sg.id)).map(sg => sg.id));

  let modal = document.getElementById("modalSaveTafrighRun");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modalSaveTafrighRun";
    modal.className = "hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm items-center justify-center p-4";
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) closeSaveTafrighRunModal(); });
  }

  const sourceCount = list => list.reduce((acc, sg) => { const k = tafrighLabelSource(sg); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const quick = [
    ["all", "الكل"], ["none", "لا شيء"], ["invert", "عكس التحديد"], ["human", "راجعتها أنت فقط"],
    ["corrected", "المصحَّحة فقط"], ["confident", "ثقة النموذج ≥ 85%"], ["no_review", "استبعاد ما يحتاج مراجعة"]
  ];

  const render = () => {
    const chosen = segs.filter(sg => picked.has(sg.id));
    const counts = sourceCount(chosen);
    modal.innerHTML = `
      <div class="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full shadow-2xl flex flex-col max-h-[90vh] text-xs">
        <div class="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <div>
            <h3 class="text-sm font-bold text-white">💾 حفظ التشغيل لتدريب Laya</h3>
            <p class="text-[11px] text-slate-400 mt-0.5">اختر الجمل التي تُحفظ كأمثلة تدريب. تُحفظ بوسمها الحالي (بعد تعديلاتك) مع ما رآه النموذج بالضبط من سياق وخيارات.</p>
          </div>
          <button type="button" data-save-close class="text-slate-400 hover:text-white text-base">✕</button>
        </div>
        <div class="px-5 pt-3 space-y-2">
          <div class="flex flex-wrap gap-1.5">
            ${quick.map(([id, l]) => `<button type="button" data-save-quick="${id}" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">${l}</button>`).join("")}
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>محدد <strong class="text-sky-300 font-mono">${chosen.length}</strong> من ${segs.length}</span>
            <span>•</span>${TAFRIGH_SOURCE_BADGE.human_corrected}<span class="font-mono">${counts.human_corrected || 0}</span>
            ${TAFRIGH_SOURCE_BADGE.human_confirmed}<span class="font-mono">${counts.human_confirmed || 0}</span>
            ${TAFRIGH_SOURCE_BADGE.model}<span class="font-mono">${counts.model || 0}</span>
          </div>
          ${prevSaved ? `<div class="p-2 rounded-lg bg-sky-950/40 border border-sky-500/30 text-sky-200 text-[11px]">ℹ️ هذا التشغيل محفوظ مسبقاً؛ الحفظ مجدداً يستبدل الحفظ السابق ولا يكرر الأمثلة.</div>` : ""}
        </div>
        <div class="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          ${segs.map((sg, k) => {
            const conf = tafrighModelConfidence(sg);
            const tagLabel = (TAFRIGH_TAG_AR[sg.tag] || sg.tag) + (sg.level ? ` ${sg.level}` : "");
            return `
            <label class="flex items-start gap-2 p-2 rounded-xl border cursor-pointer ${picked.has(sg.id) ? "bg-slate-950 border-slate-700" : "bg-slate-950/40 border-slate-800 opacity-60"}">
              <input type="checkbox" data-save-seg="${escapeHtml(sg.id)}" ${picked.has(sg.id) ? "checked" : ""} class="mt-1 accent-emerald-500" />
              <span class="font-mono text-[10px] text-slate-500 w-6 shrink-0 pt-0.5">${k + 1}</span>
              <span class="flex-1 min-w-0 space-y-1">
                <span class="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span class="px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-200 font-bold">${escapeHtml(tagLabel)}</span>
                  ${TAFRIGH_SOURCE_BADGE[tafrighLabelSource(sg)]}
                  ${conf !== null ? `<span class="font-mono ${conf < 0.7 ? "text-rose-300" : "text-slate-500"}">${Math.round(conf * 100)}%</span>` : ""}
                  ${needsReview.has(sg.id) ? '<span class="text-amber-400">⚠️ للمراجعة</span>' : ""}
                </span>
                <span class="block text-slate-300 leading-relaxed line-clamp-2" data-no-i18n>${escapeHtml(sg.display_text || sg.text || "")}</span>
              </span>
            </label>`;
          }).join("")}
        </div>
        <div class="border-t border-slate-800 px-5 py-3 space-y-2">
          <input type="text" id="inpSaveTafrighNote" placeholder="ملاحظة على هذا الحفظ (اختياري)..." class="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500" />
          <div class="flex items-center justify-end gap-2">
            <button type="button" data-save-close class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold">إلغاء</button>
            <button type="button" id="btnConfirmSaveTafrighRun" ${chosen.length ? "" : "disabled"} class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed">💾 حفظ ${chosen.length} جملة</button>
          </div>
        </div>
      </div>`;

    const note = modal.querySelector("#inpSaveTafrighNote");
    if (note) note.value = modal.__note || "";
    note?.addEventListener("input", () => { modal.__note = note.value; });
    modal.querySelectorAll("[data-save-close]").forEach(b => b.addEventListener("click", closeSaveTafrighRunModal));
    modal.querySelectorAll("[data-save-seg]").forEach(cb => cb.addEventListener("change", () => {
      const id = cb.getAttribute("data-save-seg");
      if (cb.checked) picked.add(id); else picked.delete(id);
      const scroll = modal.querySelector(".overflow-y-auto")?.scrollTop;
      render();
      const list = modal.querySelector(".overflow-y-auto");
      if (list && scroll != null) list.scrollTop = scroll;
    }));
    modal.querySelectorAll("[data-save-quick]").forEach(b => b.addEventListener("click", () => {
      const kind = b.getAttribute("data-save-quick");
      const by = {
        all: () => segs.map(sg => sg.id),
        none: () => [],
        invert: () => segs.filter(sg => !picked.has(sg.id)).map(sg => sg.id),
        human: () => segs.filter(sg => tafrighLabelSource(sg) !== "model").map(sg => sg.id),
        corrected: () => segs.filter(sg => tafrighLabelSource(sg) === "human_corrected").map(sg => sg.id),
        confident: () => segs.filter(sg => tafrighLabelSource(sg) !== "model" || (tafrighModelConfidence(sg) ?? 0) >= 0.85).map(sg => sg.id),
        no_review: () => [...picked].filter(id => !needsReview.has(id))
      }[kind];
      if (by) picked = new Set(by());
      render();
    }));
    modal.querySelector("#btnConfirmSaveTafrighRun")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      const ids = segs.filter(sg => picked.has(sg.id)).map(sg => sg.id);
      try {
        const res = await fetch("/api/tafrigh/save-run", {
          method: "POST", headers: { "Content-Type": "application/json" }, trapError: false,
          body: JSON.stringify({ run_id: runId, segment_ids: ids, note: modal.__note || "", lecture_title: currentState.lectureTitle || "" })
        });
        const out = await res.json();
        if (!out.success) {
          showToast(`❌ ${out.message || "تعذر حفظ التشغيل"}`);
          e.target.disabled = false;
          return;
        }
        currentState.tafrigh.savedRuns = currentState.tafrigh.savedRuns || {};
        currentState.tafrigh.savedRuns[runId] = { segmentIds: ids, sentences: out.sentences, count: out.count, path: out.path };
        updateTafrighSavedBadge();
        closeSaveTafrighRunModal();
        showToast(`💾 تم حفظ ${out.count} مثال تدريب في ${out.path}`);
      } catch (err) {
        console.error("Save tafrigh run error:", err);
        showToast("❌ تعذر الاتصال بالخادم");
        e.target.disabled = false;
      }
    });
  };

  modal.__note = prevSaved?.note || "";
  render();
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeSaveTafrighRunModal() {
  const modal = document.getElementById("modalSaveTafrighRun");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

async function executeTafrighReviewAction(runId, segmentId, action, extra = {}) {
  try {
    const res = await fetch("/api/tafrigh/review-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, segment_id: segmentId, action, ...extra }),
      trapError: false
    });
    const data = await res.json();
    if (!data.success) {
      showToast(`❌ ${data.message || "تعذر تنفيذ إجراء المراجعة"}`);
      return;
    }
    const prev = currentState.tafrigh?.data || {};
    renderTafrighOutput({
      ...prev,
      run_id: runId,
      markdown: data.markdown,
      html: data.html,
      review_items: data.review_items,
      structured_json: data.structured_json || prev.structured_json
    });
    const msg = { confirm: "✅ تم اعتماد الوسم", correct: "✏️ تم تصحيح الوسم وتحديث النص", reject: "↩️ أُلغي التصحيح الإملائي" }[action];
    showToast(`${msg} • متبقٍ للمراجعة: ${(data.review_items || []).length}`);
  } catch (err) {
    console.error("Tafrigh review action error:", err);
    showToast("❌ تعذر الاتصال بالخادم");
  }
}

window.switchLectureStageTab = switchLectureStageTab;
window.renderTafrighOutput = renderTafrighOutput;
window.executeTafrighReviewAction = executeTafrighReviewAction;
window.openSaveTafrighRunModal = openSaveTafrighRunModal;
window.openTafrighInlineReview = openTafrighInlineReview;
window.updateAiMetricsUI = updateAiMetricsUI;

window.renderAiRequestLogsTable = renderAiRequestLogsTable;
window.renderLayaDatasetBankStats = renderLayaDatasetBankStats;
window.renderAiLogsSection = renderAiLogsSection;

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


// =============================================================================
// Module 11: Training Data Hub Renderer (Tab 6: #section_training_data)
// =============================================================================

async function renderTrainingDataHub() {
  const tbody = document.getElementById("tbodyTrainingRecords");
  if (!tbody) return;

  let records = currentState.aiVerification.trainingDatasetRecords || [];
  if (typeof getAllVerificationRecordsFromDB === "function" && (!records || !records.length)) {
    try {
      records = await getAllVerificationRecordsFromDB();
    } catch (_) {}
  }

  // Update KPI counters
  let totalCount = records.length;
  let correctCount = 0;
  let falseCount = 0;
  let truncatedCount = 0;
  let segCount = 0;
  let typoCount = 0;

  records.forEach(r => {
    const v = r.answers?.verdict?.choice || r.initial_system_prediction?.verdict;
    if (v === "CORRECT") correctCount++;
    if (v === "FALSE") falseCount++;
    const b = r.answers?.boundary_status?.choice;
    if (b && b !== "COMPLETE_SPAN") truncatedCount++;
    if (r.task === "tafrigh") {
      if (r.subtask === "segmentation") segCount++;
      if (r.subtask === "typo") typoCount++;
    }
  });

  const elTotal = document.getElementById("kpiTotalTrainingRecords");
  const elCorr = document.getElementById("kpiCorrectTrainingRecords");
  const elFalse = document.getElementById("kpiFalseTrainingRecords");
  const elTrunc = document.getElementById("kpiTruncatedTrainingRecords");
  const elSeg = document.getElementById("kpiSegmentationTrainingRecords");
  const elTypo = document.getElementById("kpiTypoTrainingRecords");

  if (elTotal) elTotal.textContent = totalCount;
  if (elCorr) elCorr.textContent = correctCount;
  if (elFalse) elFalse.textContent = falseCount;
  if (elTrunc) elTrunc.textContent = truncatedCount;
  if (elSeg) elSeg.textContent = segCount;
  if (elTypo) elTypo.textContent = typoCount;

  // Filter records
  const taskFilter = document.getElementById("selTrainingTaskFilter")?.value || "ALL";
  const labelFilter = document.getElementById("selTrainingLabelFilter")?.value || "ALL";
  const searchQ = (document.getElementById("inpTrainingDataSearch")?.value || "").trim().toLowerCase();

  let filtered = records.filter(r => {
    if (taskFilter === "VERIFICATION_CORRECTNESS" && (r.task !== "verification" || r.subtask !== "correctness")) return false;
    if (taskFilter === "VERIFICATION_COMPLETENESS" && (r.task !== "verification" || r.subtask !== "completeness")) return false;
    if (taskFilter === "TAFRIGH_SEGMENTATION" && (r.task !== "tafrigh" || r.subtask !== "segmentation")) return false;
    if (taskFilter === "TAFRIGH_CLASSIFICATION" && (r.task !== "tafrigh" || r.subtask !== "classification")) return false;
    if (taskFilter === "TAFRIGH_TYPO" && (r.task !== "tafrigh" || r.subtask !== "typo")) return false;

    const v = r.answers?.verdict?.choice || r.human_gold_resolution?.verdict || r.initial_system_prediction?.verdict;
    if (labelFilter === "CORRECT" && v !== "CORRECT") return false;
    if (labelFilter === "FALSE" && v !== "FALSE") return false;
    if (labelFilter === "TRUNCATED" && r.answers?.boundary_status?.choice === "COMPLETE_SPAN") return false;

    if (searchQ) {
      const matchText = (r.state?.matched_span_in_lecture || r.state?.canonical_corpus_text || "").toLowerCase();
      const refText = (r.state?.candidate_reference || "").toLowerCase();
      if (!matchText.includes(searchQ) && !refText.includes(searchQ)) return false;
    }

    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-8 text-slate-500">لا توجد سجلات مطابقة لمعايير التصفية الحالية.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((rec, i) => {
    const taskLabel = rec.task === "tafrigh" ? `تفريغ (${rec.subtask || ""})` : `تدقيق (${rec.subtask || "صحة"})`;
    const ref = rec.state?.candidate_reference || rec.meta?.source_type || "غير محدد";
    const text = rec.state?.matched_span_in_lecture || rec.state?.canonical_corpus_text || "";
    const aiChoice = rec.initial_system_prediction?.verdict || rec.answers?.verdict?.choice || "—";
    const goldChoice = rec.human_gold_resolution?.verdict || (rec.meta?.human_verified ? rec.answers?.verdict?.choice : "—");
    const dateStr = rec.meta?.converted_at ? new Date(rec.meta.converted_at * 1000).toLocaleTimeString((typeof WahyI18n === "object" ? WahyI18n.dateLocale() : "ar-u-nu-latn")) : "الآن";

    return `
      <tr class="hover:bg-slate-900/60 transition">
        <td class="py-3 px-3 font-mono text-slate-500">${i + 1}</td>
        <td class="py-3 px-3"><span class="px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-300 font-bold text-[10px]">${escapeHtml(taskLabel)}</span></td>
        <td class="py-3 px-3 font-bold text-slate-200">${escapeHtml(ref)}</td>
        <td class="py-3 px-4 font-arabic-text text-slate-300 max-w-sm truncate" title="${escapeHtml(text)}">${escapeHtml(text)}</td>
        <td class="py-3 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${aiChoice === "CORRECT" ? "bg-emerald-500/20 text-emerald-300" : (aiChoice === "FALSE" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300")}">${aiChoice}</span></td>
        <td class="py-3 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${goldChoice === "CORRECT" ? "bg-emerald-600 text-white" : (goldChoice === "FALSE" ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-400")}">${goldChoice}</span></td>
        <td class="py-3 px-3 text-slate-400 font-mono text-[11px]">${escapeHtml(dateStr)}</td>
        <td class="py-3 px-3 text-center">
          <button type="button" class="btnInspectTrainingRecord px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] transition" data-rec-id="${escapeHtml(rec.id)}">JSON</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btnInspectTrainingRecord").forEach(btn => {
    btn.addEventListener("click", () => {
      const recId = btn.getAttribute("data-rec-id");
      const targetRec = records.find(r => r.id === recId);
      if (targetRec && typeof window.showAiPayloadModal === "function") {
        window.showAiPayloadModal(targetRec);
      }
    });
  });
}

window.renderTrainingDataHub = renderTrainingDataHub;
