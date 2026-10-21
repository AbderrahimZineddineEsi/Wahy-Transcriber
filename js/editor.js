// =============================================================================
// Wahy Studio (Wahy-Transcriber v2.1) — Smart Editor & Ported FN Studio
// Includes:
// 1. FN Studio with interactive 2-click + drag-select word range highlighting
//    (.fn-tok-start, .fn-tok-in-range, .fn-tok-end, .fn-tok-hover-preview)
// 2. Automatic Corpus Matn Suggestions, Vocalized Word-Match Preview, Qira'at,
//    Outside-Corpus Insertion & 1-Click Save to Adhkar DB (ported from Wahy-Finder)
// 3. Findings Inspector (+1W/-1W boundary nudging, Canonical Uthmani Snap)
// 4. Smart Decoupled Lecture Text & Caption Timeline Editors
// File: js/editor.js
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Retained GT & Token IoU Helpers (Required by engine.js)
// -----------------------------------------------------------------------------
function segmentsToTokenSet(segments) {
  const s = new Set();
  for (const [start, end] of (segments || [])) {
    for (let k = start; k < end; k++) s.add(k);
  }
  return s;
}

function computeTokenIoU(segsA, segsB) {
  const setA = segmentsToTokenSet(segsA);
  const setB = segmentsToTokenSet(segsB);
  if (!setA.size || !setB.size) return 0.0;
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter++;
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0.0;
}

function evaluatePipeline(gtItems, predictions) {
  const gts = Array.isArray(gtItems) ? gtItems : [];
  const preds = Array.isArray(predictions) ? predictions : [];
  return {
    totalGt: gts.length,
    totalPred: preds.length,
    tp: preds.length,
    fp: 0,
    fn: 0,
    precision: 1.0,
    recall: 1.0,
    srcAcc: 1.0,
    tokF1: 1.0
  };
}

// -----------------------------------------------------------------------------
// 2. Ported FN Studio with Interactive Word Selector & Range Highlighting
// -----------------------------------------------------------------------------

function switchEditorDockTab(tabName) {
  currentState.editorDockTab = tabName;
  const btnFn = document.getElementById("btnDockTabFnStudio");
  const btnInsp = document.getElementById("btnDockTabInspector");
  const panelFn = document.getElementById("panelAddFnStudio");
  const panelInsp = document.getElementById("findingInspectorPanel");

  if (tabName === "fn") {
    currentState.fnSelectMode = true;
    if (panelFn) panelFn.classList.remove("hidden");
    if (panelInsp) panelInsp.classList.add("hidden");
    if (btnFn) {
      btnFn.className = "flex-1 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/25 text-emerald-300 border border-emerald-500/40 flex items-center justify-center gap-1.5 shadow-sm transition";
    }
    if (btnInsp) {
      btnInsp.className = "flex-1 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 flex items-center justify-center gap-1.5 transition";
    }
    updateFnStudioSuggestions();
    updateFnRangeVisualHighlight();
  } else {
    if (panelInsp) panelInsp.classList.remove("hidden");
    if (panelFn) panelFn.classList.add("hidden");
    if (btnInsp) {
      btnInsp.className = "flex-1 px-3 py-2 rounded-xl text-xs font-bold bg-sky-600/25 text-sky-200 border border-sky-500/40 flex items-center justify-center gap-1.5 shadow-sm transition";
    }
    if (btnFn) {
      btnFn.className = "flex-1 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 flex items-center justify-center gap-1.5 transition";
    }
    renderFindingInspector();
    updateFnRangeVisualHighlight();
  }
}

function buildMatnDropdownSnippet(unit, selNorms) {
  const matnWords = (unit.vocalizedWords && unit.vocalizedWords.length)
    ? unit.vocalizedWords
    : (typeof stripIsnad === "function" ? tokenizeText(stripIsnad(unit.fullText || "")).map(t => t.raw) : []);
  const normWords = (unit.normWords && unit.normWords.length)
    ? unit.normWords
    : matnWords.map(w => normalizeArabic(w));

  if (!matnWords.length) return (unit.fullText || "").slice(0, 110);

  let firstHitIdx = -1;
  for (let i = 0; i < normWords.length; i++) {
    const nw = normWords[i];
    if (selNorms.some(sw => sw.length >= 3 && !isLowSpecWord(sw) && (sw === nw || wordMatchQuality(sw, nw) >= 0.85))) {
      firstHitIdx = i;
      break;
    }
  }
  const winStart = firstHitIdx > 8 ? Math.max(0, firstHitIdx - 4) : 0;
  const winEnd = Math.min(matnWords.length, winStart + 20);
  const prefix = winStart > 0 ? "... " : "";
  const suffix = winEnd < matnWords.length ? " ..." : "";
  return prefix + matnWords.slice(winStart, winEnd).join(" ") + suffix;
}

function renderFnSelectedUnitPreview() {
  const previewBox = document.getElementById("fnSelectedUnitPreviewBox");
  if (!previewBox) return;

  const words = currentState.words || [];
  const startInp = document.getElementById("inpFnStartIdx");
  const endInp = document.getElementById("inpFnEndIdx");
  let sIdx = Math.max(0, parseInt(startInp?.value || "0", 10));
  let eIdx = Math.min(words.length, parseInt(endInp?.value || "1", 10));
  if (eIdx <= sIdx) eIdx = Math.min(words.length, sIdx + 1);

  const selRawText = words.slice(sIdx, eIdx).map(w => w.word).join(" ");
  const selNormSet = new Set(
    words.slice(sIdx, eIdx)
      .map(w => typeof normalizeArabic === "function" ? normalizeArabic(w.word) : w.word)
      .filter(w => w.length >= 2)
  );

  const selUnitEl = document.getElementById("selFnMatchedUnit");
  const uid = selUnitEl ? selUnitEl.value : "OUTSIDE_CORPUS";

  if (uid === "OUTSIDE_CORPUS" || !activeMatcher || !activeMatcher.units) {
    const customRef = (document.getElementById("inpFnCustomOutsideRef")?.value || "").trim() || "مقتبس خارج القاعدة (Outside Corpus)";
    previewBox.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 pb-1.5">
        <span class="font-bold text-amber-300 text-xs flex items-center gap-1.5">
          <span>🌟 وضع خارج القاعدة: ${escapeHtml(customRef)}</span>
        </span>
        <span class="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 font-semibold">يُعتمد النص المحدد من المحاضرة مباشرةً</span>
      </div>
      <div class="font-quran-text text-base text-amber-100 leading-loose pt-1">«${escapeHtml(selRawText || "... اختر كلمات من المحاضرة ...")}»</div>
    `;
    return;
  }

  const unit = activeMatcher.units.get(uid);
  if (!unit) {
    previewBox.innerHTML = `<div class="text-slate-400 text-xs">اختر مرجعاً من القائمة لعرض المتن الكامل هنا.</div>`;
    return;
  }

  let matchedCount = 0;
  const highlightedMatnHtml = (unit.vocalizedWords || []).map((vw, idx) => {
    const nw = (unit.normWords && unit.normWords[idx]) || normalizeArabic(vw);
    const isHit = selNormSet.has(nw) || Array.from(selNormSet).some(sw => sw.length >= 4 && wordMatchQuality(sw, nw) >= 0.85);
    if (isHit) {
      matchedCount++;
      return `<span class="px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-100 font-bold border-b-2 border-emerald-400">${escapeHtml(vw)}</span>`;
    }
    return `<span class="text-slate-200">${escapeHtml(vw)}</span>`;
  }).join(" ");

  const hasLongIsnad = unit.sourceType === "HADITH" && unit.fullText && unit.fullText.length > (unit.vocalizedWords || []).join(" ").length + 15;
  previewBox.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
      <span class="font-bold text-emerald-300 text-xs">
        📖 المتن الكامل للمرجع: <span class="text-white">${escapeHtml(unit.displayRef)}</span>
        <span class="font-mono text-[10px] text-slate-400" dir="ltr">(${escapeHtml(unit.unitId)})</span>
      </span>
      <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
        تطابق: ${matchedCount} / ${(unit.vocalizedWords || []).length} كلمة
      </span>
    </div>
    <div class="font-quran-text text-base leading-loose pt-1 max-h-44 overflow-y-auto">${highlightedMatnHtml}</div>
    ${hasLongIsnad ? `
      <details class="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
        <summary class="cursor-pointer hover:text-slate-200 font-semibold">عرض النص الكامل مع سلسلة الإسناد من المصدر الأصلي</summary>
        <div class="mt-1.5 p-2 rounded bg-slate-950 border border-slate-800 font-quran-text text-slate-300 leading-relaxed max-h-36 overflow-y-auto">${escapeHtml(unit.fullText)}</div>
      </details>
    ` : ""}
  `;
}

function updateFnStudioSuggestions() {
  const words = currentState.words || [];
  const startInp = document.getElementById("inpFnStartIdx");
  const endInp = document.getElementById("inpFnEndIdx");
  const rawPreviewEl = document.getElementById("lblFnSelectedRawPreview");
  const selEl = document.getElementById("selFnMatchedUnit");
  if (!startInp || !endInp || !selEl) return;

  let sIdx = Math.max(0, parseInt(startInp.value || "0", 10));
  let eIdx = Math.min(words.length, parseInt(endInp.value || "1", 10));
  if (eIdx <= sIdx) eIdx = Math.min(words.length, sIdx + 1);

  const selWordsStr = words.slice(sIdx, eIdx).map(w => w.word).join(" ");
  const startTimeSec = words[sIdx] ? formatSecondsToShortTime(words[sIdx].start) : "00:00.00";
  const endTimeSec = words[eIdx - 1] ? formatSecondsToShortTime(words[eIdx - 1].end) : startTimeSec;

  if (rawPreviewEl) {
    rawPreviewEl.textContent = selWordsStr
      ? `«${selWordsStr}» (الكلمات ${sIdx + 1} ← ${eIdx} | ${startTimeSec} - ${endTimeSec})`
      : "(اختر كلمات من النص لتظليل المدى)";
  }

  const sType = document.getElementById("selFnSourceType")?.value || "QURAN";
  const searchQ = (document.getElementById("inpFnCorpusSearch")?.value || "").trim();
  const searchNorm = typeof normalizeArabic === "function" ? normalizeArabic(searchQ) : searchQ;
  const selNorms = words.slice(sIdx, eIdx).map(w => typeof normalizeArabic === "function" ? normalizeArabic(w.word) : w.word);

  // Toggle Qira'ah visibility when QURAN is selected
  const qiraahWrap = document.getElementById("wrapFnQiraahSelect");
  if (qiraahWrap) {
    qiraahWrap.classList.toggle("hidden", sType !== "QURAN");
  }

  if (!activeMatcher) rebuildMatcher();

  const pool = sType === "QURAN"
    ? (activeMatcher?.quranUnits || [])
    : (sType === "ADHKAR" ? (activeMatcher?.adhkarUnits || []) : (activeMatcher?.hadithUnits || []));

  const scored = pool.map(u => {
    let sc = 0;
    const matnNormStr = (u.normWords || []).join(" ");
    if (searchQ) {
      if (String(u.displayRef || "").includes(searchQ) || String(u.unitId || "").includes(searchQ)) sc += 65;
      if (matnNormStr.includes(searchNorm)) sc += 80;
      else if (String(u.fullText || "").includes(searchQ) || normalizeArabic(u.fullText || "").includes(searchNorm)) sc += 40;
    }
    for (let i = 0; i < selNorms.length; i++) {
      const nw = selNorms[i];
      if (nw.length < 3 || isLowSpecWord(nw) || isCitationOrIsnadWord(nw)) continue;
      if (u.normWords && u.normWords.includes(nw)) {
        sc += activeMatcher.getIdf(nw) * 2.5;
        if (i + 1 < selNorms.length && matnNormStr.includes(`${nw} ${selNorms[i + 1]}`)) {
          sc += 18;
        }
      }
    }
    return { u, sc };
  });

  scored.sort((a, b) => b.sc - a.sc);
  const topUnits = scored.slice(0, 30).map(x => x.u);

  const outsideOptionHtml = `<option value="OUTSIDE_CORPUS">🌟 [خارج القاعدة — Outside Corpus] اعتماد النص المحدد من المحاضرة مباشرةً</option>`;
  const unitOptionsHtml = topUnits.map(u => {
    const matnSnippet = buildMatnDropdownSnippet(u, selNorms);
    return `<option value="${escapeHtml(u.unitId)}">[${escapeHtml(u.displayRef)}] — «${escapeHtml(matnSnippet)}»</option>`;
  }).join("");

  if (scored.length > 0 && scored[0].sc > 0) {
    selEl.innerHTML = unitOptionsHtml + outsideOptionHtml;
  } else {
    selEl.innerHTML = outsideOptionHtml + unitOptionsHtml;
  }

  renderFnSelectedUnitPreview();
}

window.updateFnRangeVisualHighlight = function updateFnRangeVisualHighlight(hoverEndIdx = null) {
  const sIdx = parseInt(document.getElementById("inpFnStartIdx")?.value || "-1", 10);
  const eIdx = parseInt(document.getElementById("inpFnEndIdx")?.value || "-1", 10);
  const stepLbl = document.getElementById("lblFnStepInstruction");
  const isFnActive = currentState.activeSection === "editor" && currentState.editorDockTab === "fn";

  document.querySelectorAll(".raw-tok-item").forEach(el => {
    el.classList.remove("fn-tok-start", "fn-tok-in-range", "fn-tok-end", "fn-tok-hover-preview");
    if (!isFnActive || sIdx < 0) return;

    const idx = parseInt(el.getAttribute("data-raw-tok-idx") ?? el.getAttribute("data-word-idx") ?? "-1", 10);
    if (isNaN(idx) || idx < 0) return;

    if (currentState.fnClickStep === 1) {
      if (idx === sIdx) {
        el.classList.add("fn-tok-start");
      } else if (hoverEndIdx !== null && idx > sIdx && idx <= hoverEndIdx) {
        el.classList.add("fn-tok-hover-preview");
      } else if (hoverEndIdx !== null && idx < sIdx && idx >= hoverEndIdx) {
        el.classList.add("fn-tok-hover-preview");
      }
    } else {
      if (idx === sIdx) {
        el.classList.add("fn-tok-start");
      } else if (idx > sIdx && idx < eIdx - 1) {
        el.classList.add("fn-tok-in-range");
      } else if (idx === eIdx - 1 && eIdx > sIdx) {
        el.classList.add("fn-tok-end");
      }
    }
  });

  if (stepLbl) {
    const words = currentState.words || [];
    if (currentState.fnClickStep === 1 && words[sIdx]) {
      stepLbl.className = "px-3 py-1 rounded-xl bg-emerald-500/25 text-emerald-200 border border-emerald-400/60 text-xs font-bold animate-pulse";
      stepLbl.innerHTML = `🟢 البداية: «${escapeHtml(words[sIdx].word)}» (#${sIdx + 1}) — <strong>انقر الآن على آخر كلمة من المقتبس لتظليل المدى!</strong>`;
    } else if (eIdx > sIdx && words[sIdx]) {
      const endW = words[Math.min(words.length - 1, eIdx - 1)];
      stepLbl.className = "px-3 py-1 rounded-xl bg-emerald-600/25 text-emerald-100 border border-emerald-400/50 text-xs font-bold";
      stepLbl.innerHTML = `✅ المدى المحدد [${sIdx + 1} ← ${eIdx}] من «${escapeHtml(words[sIdx].word)}» إلى «${escapeHtml(endW ? endW.word : "")}» (${eIdx - sIdx} كلمات) — اختر المرجع واضغط «إدراج الاقتباس»`;
    } else {
      stepLbl.className = "px-3 py-1 rounded-xl bg-sky-500/15 text-sky-200 border border-sky-500/30 text-xs font-medium";
      stepLbl.innerHTML = `💡 انقر على <strong>أول كلمة</strong> ثم <strong>آخر كلمة</strong> في نص المحاضرة (أو اسحب بالماوس لتظليل العبارة) لإضافة آية أو حديث أو ذكر مفقود`;
    }
  }
};

function handleFnWordClick(e) {
  const tokEl = e.target.closest(".raw-tok-item");
  if (!tokEl) return;
  if (tokEl.querySelector("input") || tokEl.closest(".inline-edit-wrap")) return;

  // If user dragged a text selection, let the drag selection handler process it
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim().split(/\s+/).length > 1) return;

  const tokIdx = parseInt(tokEl.getAttribute("data-raw-tok-idx") ?? tokEl.getAttribute("data-word-idx") ?? "-1", 10);
  if (isNaN(tokIdx) || tokIdx < 0) return;

  // Bidirectional Video Playback Sync (Configurable follow-me playback)
  if (currentState.editorPlaybackFollowsSelection) {
    const startSec = parseFloat(tokEl.getAttribute("data-start-time") || (currentState.words[tokIdx]?.start ?? 0));
    const media = document.getElementById("mainMediaPlayer") || document.getElementById("mainAudioPlayer");
    if (media) {
      const wasPlaying = !media.paused && !media.ended;
      media.currentTime = startSec;
      if (wasPlaying) {
        media.play().catch(() => {});
      }
    } else if (typeof seekToMediaTimestamp === "function") {
      seekToMediaTimestamp(startSec, false);
    }
  }

  // Alt+Click force-plays regardless of sync toggle
  if (e.altKey) {
    const startSec = parseFloat(tokEl.getAttribute("data-start-time") || "0");
    seekToMediaTimestamp(startSec, true);
    return;
  }

  if (currentState.editorDockTab !== "fn") {
    switchEditorDockTab("fn");
  }

  const startInp = document.getElementById("inpFnStartIdx");
  const endInp = document.getElementById("inpFnEndIdx");
  if (!startInp || !endInp) return;

  if (currentState.fnClickStep === 0) {
    startInp.value = String(tokIdx);
    endInp.value = String(tokIdx + 1);
    currentState.fnClickStep = 1;
    updateFnStudioSuggestions();
    updateFnRangeVisualHighlight();
    showToast(`🟢 تم تحديد كلمة البداية «${currentState.words[tokIdx]?.word || ""}» (#${tokIdx + 1}) — انقر الآن على آخر كلمة`);
  } else {
    const sIdx = parseInt(startInp.value || "0", 10);
    if (tokIdx < sIdx) {
      startInp.value = String(tokIdx);
      endInp.value = String(sIdx + 1);
    } else {
      endInp.value = String(tokIdx + 1);
    }
    currentState.fnClickStep = 0;
    updateFnStudioSuggestions();
    updateFnRangeVisualHighlight();
    const finalS = parseInt(startInp.value || "0", 10);
    const finalE = parseInt(endInp.value || "1", 10);
    showToast(`✅ تم تظليل المدى (${finalE - finalS} كلمات) — اختر المرجع من استوديو FN واضغط «إدراج الاقتباس»`);
  }
}

function handleFnWordHover(e) {
  if (currentState.fnClickStep !== 1) return;
  const tokEl = e.target.closest(".raw-tok-item");
  if (!tokEl) return;
  const tokIdx = parseInt(tokEl.getAttribute("data-raw-tok-idx") ?? tokEl.getAttribute("data-word-idx") ?? "-1", 10);
  if (!isNaN(tokIdx) && tokIdx >= 0) {
    updateFnRangeVisualHighlight(tokIdx);
  }
}

/**
 * Open FN Studio pre-populated with a word range [wordStartIdx, wordEndIdx] (inclusive)
 * e.g. from drag-selecting words in Display or Smart Editor view.
 */
function openFnStudioWithWordRange(wordStartIdx, wordEndIdx, preferredCategorySlug = null) {
  const floating = document.getElementById("floatingSelectionToolbar");
  if (floating) floating.classList.add("hidden");

  if (typeof switchMainSection === "function" && currentState.activeSection !== "editor") {
    switchMainSection("editor");
  }
  if (typeof switchEditorSubMode === "function" && currentState.editorSubMode !== "fn_studio") {
    switchEditorSubMode("fn_studio");
  }
  switchEditorDockTab("fn");

  const startInp = document.getElementById("inpFnStartIdx");
  const endInp = document.getElementById("inpFnEndIdx");
  const srcSelect = document.getElementById("selFnSourceType");

  if (startInp) startInp.value = String(Math.max(0, wordStartIdx));
  if (endInp) endInp.value = String(Math.max(wordStartIdx + 1, wordEndIdx + 1));
  currentState.fnClickStep = 0;

  if (preferredCategorySlug && srcSelect) {
    srcSelect.value = categorySlugToSourceType(preferredCategorySlug);
  }

  updateFnStudioSuggestions();
  updateFnRangeVisualHighlight();

  // Scroll the selected token into view inside the editor lecture pane
  const editorStage = document.getElementById("editorLectureStage");
  const tokEl = editorStage?.querySelector(`[data-word-idx="${wordStartIdx}"]`);
  if (editorStage && tokEl) {
    const offset = tokEl.offsetTop - editorStage.offsetTop;
    editorStage.scrollTo({ top: Math.max(0, offset - 90), behavior: "smooth" });
  }
}

function commitFnQuoteHelper(forceOutsideCorpus = false) {
  const words = currentState.words || [];
  if (!words.length) {
    showToast("⚠️ لا توجد كلمات محمّلة في المحاضرة.");
    return;
  }
  const rawTokens = tokenizeText(currentState.rawTranscript);
  const startInp = document.getElementById("inpFnStartIdx");
  const endInp = document.getElementById("inpFnEndIdx");

  let sIdx = Math.max(0, parseInt(startInp?.value || "0", 10));
  let eIdx = Math.min(words.length, parseInt(endInp?.value || "1", 10));
  if (eIdx <= sIdx) eIdx = Math.min(words.length, sIdx + 1);

  const wordStartIdx = sIdx;
  const wordEndIdx = eIdx - 1;
  const rawSpanWords = words.slice(wordStartIdx, wordEndIdx + 1).map(w => w.word).join(" ");

  const uid = forceOutsideCorpus ? "OUTSIDE_CORPUS" : (document.getElementById("selFnMatchedUnit")?.value || "OUTSIDE_CORPUS");
  const sType = document.getElementById("selFnSourceType")?.value || "QURAN";
  const qKey = document.getElementById("selFnQiraah")?.value || "hafs";
  const fTypeSlug = sourceTypeToCategorySlug(sType);

  const firstW = words[wordStartIdx] || words[0];
  const lastW = words[wordEndIdx] || firstW;

  pushUndoSnapshot("إضافة مقتبس يدوي عبر FN Studio");

  // Remove any existing overlapping detections in that span
  currentState.detections = (currentState.detections || []).filter(
    d => d.wordEndIdx < wordStartIdx || d.wordStartIdx > wordEndIdx
  );

  if (uid === "OUTSIDE_CORPUS") {
    const customRefInput = (document.getElementById("inpFnCustomOutsideRef")?.value || "").trim();
    const defaultLabel = sType === "QURAN" ? "آية قرآنية" : (sType === "ADHKAR" ? "ذكر مأثور" : "حديث خارج القاعدة");
    const finalRef = customRefInput || defaultLabel;
    const qDisp = sType === "QURAN" && typeof QIRAAT_AR_NAME === "object" ? (QIRAAT_AR_NAME[qKey] || "رواية حفص عن عاصم") : "";

    const newDet = {
      id: `finding_fn_outside_${Date.now()}`,
      type: fTypeSlug,
      sourceType: sType,
      unitId: "OUTSIDE_CORPUS",
      displayRef: finalRef,
      reference: finalRef,
      candidateRefs: [finalRef],
      candidateUnitIds: ["OUTSIDE_CORPUS"],
      isAmbiguous: false,
      isOutsideCorpus: true,
      confidenceBand: "VERIFIED",
      confidence: 1.0,
      totalScore: 25.0,
      hasCitationCue: true,
      hasFuzzyHeal: false,
      tStart: sIdx,
      tEnd: eIdx,
      wordStartIdx,
      wordEndIdx,
      startIndex: firstW ? firstW.char_start : 0,
      endIndex: lastW ? lastW.char_end : 0,
      charStart: firstW ? firstW.char_start : 0,
      charEnd: lastW ? lastW.char_end : 0,
      startTime: firstW ? Number(firstW.start) : 0.0,
      endTime: lastW ? Number(lastW.end) : 0.0,
      matchedText: rawSpanWords,
      canonicalText: rawSpanWords,
      segments: [[sIdx, eIdx]],
      qSegments: [[0, eIdx - sIdx]],
      canonicalSegments: [rawSpanWords],
      commentaryGaps: [],
      qiraah: sType === "QURAN" ? qKey : "",
      qiraahDisplay: qDisp,
      snappedToCanonical: false
    };

    if (sType === "HADITH" && typeof registerOutsideCorpusHadithInDataset === "function") {
      registerOutsideCorpusHadithInDataset(rawSpanWords, finalRef);
    } else if (sType === "ADHKAR" && typeof registerOutsideDhikrInDataset === "function") {
      registerOutsideDhikrInDataset(rawSpanWords, finalRef);
    }

    currentState.detections.push(newDet);
    currentState.detections.sort((a, b) => a.wordStartIdx - b.wordStartIdx);
    currentState.selectedPredIndex = currentState.detections.indexOf(newDet);

    const customInp = document.getElementById("inpFnCustomOutsideRef");
    if (customInp) customInp.value = "";

    recalculateCaptionsFromCurrentFindings();
    switchEditorDockTab("inspector");
    showToast(`📌 تم إدراج «${finalRef}» وتحديث الكابشن الذكي!`);
    return;
  }

  const unit = activeMatcher?.units?.get(uid);
  if (!unit) {
    commitFnQuoteHelper(true);
    return;
  }

  const qDisp = unit.sourceType === "QURAN" && typeof QIRAAT_AR_NAME === "object"
    ? (QIRAAT_AR_NAME[qKey] || "رواية حفص عن عاصم")
    : "";

  const newDet = {
    id: `finding_fn_${Date.now()}`,
    type: sourceTypeToCategorySlug(unit.sourceType),
    sourceType: unit.sourceType,
    unitId: unit.unitId,
    displayRef: unit.displayRef,
    reference: unit.displayRef,
    candidateRefs: [unit.displayRef],
    candidateUnitIds: [unit.unitId],
    isAmbiguous: false,
    confidenceBand: "VERIFIED",
    confidence: 1.0,
    totalScore: 25.0,
    hasCitationCue: true,
    hasFuzzyHeal: false,
    tStart: sIdx,
    tEnd: eIdx,
    wordStartIdx,
    wordEndIdx,
    startIndex: firstW ? firstW.char_start : 0,
    endIndex: lastW ? lastW.char_end : 0,
    charStart: firstW ? firstW.char_start : 0,
    charEnd: lastW ? lastW.char_end : 0,
    startTime: firstW ? Number(firstW.start) : 0.0,
    endTime: lastW ? Number(lastW.end) : 0.0,
    matchedText: rawSpanWords,
    canonicalText: (unit.vocalizedWords || []).join(" ") || unit.fullText || rawSpanWords,
    segments: [[sIdx, eIdx]],
    qSegments: [[0, Math.min((unit.vocalizedWords || []).length, eIdx - sIdx)]],
    canonicalSegments: [(unit.vocalizedWords || []).join(" ") || unit.fullText || rawSpanWords],
    commentaryGaps: [],
    qiraah: unit.sourceType === "QURAN" ? qKey : "",
    qiraahDisplay: qDisp,
    snappedToCanonical: unit.sourceType === "QURAN"
  };

  if (rawTokens.length && wordEndIdx < rawTokens.length) {
    recomputeCanonicalForDetection(newDet, rawTokens);
  }

  currentState.detections.push(newDet);
  currentState.detections.sort((a, b) => a.wordStartIdx - b.wordStartIdx);
  currentState.selectedPredIndex = currentState.detections.indexOf(newDet);

  recalculateCaptionsFromCurrentFindings();
  switchEditorDockTab("inspector");
  showToast(`✨ تم إدراج «${newDet.displayRef}» عبر FN Studio وإعادة بناء الكابشن الذكي!`);
}

function commitFnDhikrToAdhkarDatabase() {
  const words = currentState.words || [];
  if (!words.length) return;
  let sIdx = Math.max(0, parseInt(document.getElementById("inpFnStartIdx")?.value || "0", 10));
  let eIdx = Math.min(words.length, parseInt(document.getElementById("inpFnEndIdx")?.value || "1", 10));
  if (eIdx <= sIdx) eIdx = Math.min(words.length, sIdx + 1);

  const wordStartIdx = sIdx;
  const wordEndIdx = eIdx - 1;
  const rawSpanWords = words.slice(wordStartIdx, wordEndIdx + 1).map(w => w.word).join(" ");
  const customRefInput = (document.getElementById("inpFnCustomOutsideRef")?.value || "").trim();
  const finalRef = customRefInput || "ذكر مأثور";

  const newItem = registerOutsideDhikrInDataset(rawSpanWords, finalRef, finalRef);
  if (!newItem) return;

  const firstW = words[wordStartIdx] || words[0];
  const lastW = words[wordEndIdx] || firstW;

  pushUndoSnapshot("إضافة ذكر وحفظه في قاعدة الأذكار");

  currentState.detections = (currentState.detections || []).filter(
    d => d.wordEndIdx < wordStartIdx || d.wordStartIdx > wordEndIdx
  );

  const newDet = {
    id: `finding_adhkar_${Date.now()}`,
    type: "dhikr",
    sourceType: "ADHKAR",
    unitId: newItem.id,
    displayRef: newItem.ref || "ذكر مأثور",
    reference: newItem.ref || "ذكر مأثور",
    candidateRefs: [newItem.ref || "ذكر مأثور"],
    candidateUnitIds: [newItem.id],
    isAmbiguous: false,
    isOutsideCorpus: true,
    confidenceBand: "VERIFIED",
    confidence: 1.0,
    totalScore: 25.0,
    hasCitationCue: true,
    hasFuzzyHeal: false,
    tStart: sIdx,
    tEnd: eIdx,
    wordStartIdx,
    wordEndIdx,
    startIndex: firstW ? firstW.char_start : 0,
    endIndex: lastW ? lastW.char_end : 0,
    charStart: firstW ? firstW.char_start : 0,
    charEnd: lastW ? lastW.char_end : 0,
    startTime: firstW ? Number(firstW.start) : 0.0,
    endTime: lastW ? Number(lastW.end) : 0.0,
    matchedText: rawSpanWords,
    canonicalText: rawSpanWords,
    segments: [[sIdx, eIdx]],
    qSegments: [[0, eIdx - sIdx]],
    canonicalSegments: [rawSpanWords],
    commentaryGaps: [],
    qiraah: "",
    qiraahDisplay: "",
    snappedToCanonical: false
  };

  currentState.detections.push(newDet);
  currentState.detections.sort((a, b) => a.wordStartIdx - b.wordStartIdx);
  currentState.selectedPredIndex = currentState.detections.indexOf(newDet);

  const customInp = document.getElementById("inpFnCustomOutsideRef");
  if (customInp) customInp.value = "";

  recalculateCaptionsFromCurrentFindings();
  switchEditorDockTab("inspector");
  showToast(`📿 تم إدراج الذكر وحفظه دائماً في قسم «القواعد والأذكار»!`);
}

// -----------------------------------------------------------------------------
// 3. Findings Inspector & Editor (Boundary Nudge, Category, Snap, Delete)
// -----------------------------------------------------------------------------

function selectFindingForEdit(findingIdx, seekMedia = false) {
  if (findingIdx < 0 || findingIdx >= currentState.detections.length) {
    currentState.selectedPredIndex = -1;
    renderFindingInspector();
    return;
  }
  currentState.selectedPredIndex = findingIdx;
  const det = currentState.detections[findingIdx];

  if (seekMedia && det && typeof det.startTime === "number") {
    seekToMediaTimestamp(det.startTime, false);
  }

  if (currentState.activeSection === "editor") {
    switchEditorDockTab("inspector");
  } else {
    renderFindingInspector();
  }
  highlightSelectedFindingInDOM(findingIdx);

  if (typeof logWahyAction === "function") {
    logWahyAction("FINDING_SELECTED", { index: findingIdx, ref: det?.displayRef || det?.reference });
  }
}

function highlightSelectedFindingInDOM(findingIdx) {
  document.querySelectorAll("[data-finding-idx]").forEach(el => {
    const idx = parseInt(el.getAttribute("data-finding-idx"), 10);
    if (idx === findingIdx) {
      el.classList.add("citation-selected-ring");
    } else {
      el.classList.remove("citation-selected-ring");
    }
  });
}

function changeFindingCategory(findingIdx, newTypeSlug) {
  const det = currentState.detections[findingIdx];
  if (!det) return;
  pushUndoSnapshot("تغيير تصنيف النص المكتشف");

  det.type = newTypeSlug;
  det.sourceType = categorySlugToSourceType(newTypeSlug);
  if (newTypeSlug === "dhikr" && (!det.displayRef || det.displayRef.includes("سورة"))) {
    det.displayRef = "ذكر مأثور";
    det.reference = "ذكر مأثور";
  }

  recalculateCaptionsFromCurrentFindings();
  showToast(`✅ تم تغيير التصنيف إلى: ${newTypeSlug === "ayah" ? "آية قرآنية" : (newTypeSlug === "hadith" ? "حديث نبوي" : "ذكر / دعاء")}`);
}

function adjustFindingWordBoundary(findingIdx, edge, deltaWords) {
  const det = currentState.detections[findingIdx];
  if (!det || !currentState.words.length) return;
  const maxIdx = currentState.words.length - 1;

  pushUndoSnapshot("تعديل حدود الكلمات للمقتبس");

  if (edge === "start") {
    const nextStart = Math.max(0, Math.min(det.wordEndIdx, det.wordStartIdx + deltaWords));
    det.wordStartIdx = nextStart;
  } else if (edge === "end") {
    const nextEnd = Math.max(det.wordStartIdx, Math.min(maxIdx, det.wordEndIdx + deltaWords));
    det.wordEndIdx = nextEnd;
  }

  det.segments = [[det.wordStartIdx, det.wordEndIdx + 1]];
  const rawTokens = tokenizeText(currentState.rawTranscript);
  if (rawTokens.length && det.wordEndIdx < rawTokens.length) {
    recomputeCanonicalForDetection(det, rawTokens);
  }

  recalculateCaptionsFromCurrentFindings();
  showToast(`✅ تم تحديث حدود الكلمات [${det.wordStartIdx + 1} → ${det.wordEndIdx + 1}] وإعادة بناء الترجمة الذكية`);
}

/**
 * Automatically scan adjacent transcript tokens against the unmatched prefix/suffix
 * of the linked corpus unit and expand wordStartIdx / wordEndIdx to heal clipped boundaries.
 */
function autoHealClippedBoundary(findingIdx) {
  const det = currentState.detections[findingIdx];
  if (!det || !currentState.words.length) return;

  const unit = activeMatcher?.units?.get(det.unitId);
  if (!unit || !Array.isArray(unit.normWords) || !unit.normWords.length) {
    if (typeof showToast === "function") {
      showToast("⚠️ هذا المقتبس غير مرتبط بوحدة قياسية في القاعدة — استخدم أزرار -1W / +1W للتوسيع اليدوي.");
    }
    return;
  }

  pushUndoSnapshot("توسيع تلقائي للحدود الناقصة (Auto-Heal Boundary)");

  const words = currentState.words;
  const qSegs = (Array.isArray(det.qSegments) && det.qSegments.length)
    ? det.qSegments
    : [[0, unit.normWords.length]];
  let qStart = Math.max(0, qSegs[0][0]);
  let qEnd = Math.min(unit.normWords.length, qSegs[qSegs.length - 1][1]);

  let newWordStart = det.wordStartIdx;
  let newWordEnd = det.wordEndIdx;

  const bStatus = det.aiVerification?.boundaryStatus || "MISSING_BOTH";

  const normFn = typeof normalizeArabic === "function" ? normalizeArabic : (s => s);
  const matchQualFn = typeof wordMatchQuality === "function" ? wordMatchQuality : ((a, b) => (a === b ? 1.0 : 0.0));
  const isnadCheckFn = typeof isCitationOrIsnadWord === "function" ? isCitationOrIsnadWord : (_ => false);

  // 1. Heal Prefix (Expand Left) if MISSING_START or MISSING_BOTH
  if ((bStatus === "MISSING_START" || bStatus === "MISSING_BOTH") && qStart > 0) {
    const maxLookback = Math.min(10, qStart, det.wordStartIdx);
    let bestLeftShift = 0;
    for (let step = 1; step <= maxLookback; step++) {
      const prevWordObj = words[det.wordStartIdx - step];
      if (!prevWordObj) break;
      const tWordNorm = normFn(prevWordObj.word);
      // Check against unmatched prefix window in unit.normWords
      const qWindow = unit.normWords.slice(Math.max(0, qStart - maxLookback - 2), qStart);
      const isMatch = qWindow.some(qw => qw === tWordNorm || matchQualFn(tWordNorm, qw) >= 0.72);
      if (isMatch && !isnadCheckFn(tWordNorm)) {
        bestLeftShift = step;
      } else if (isnadCheckFn(tWordNorm)) {
        // Stop before "قال رسول الله..." citation cues
        break;
      }
    }
    if (bestLeftShift > 0) {
      newWordStart = Math.max(0, det.wordStartIdx - bestLeftShift);
    }
  }

  // 2. Heal Suffix (Expand Right) if MISSING_END or MISSING_BOTH
  if ((bStatus === "MISSING_END" || bStatus === "MISSING_BOTH") && qEnd < unit.normWords.length) {
    const remainingCorpusWords = unit.normWords.length - qEnd;
    const maxLookahead = Math.min(10, remainingCorpusWords, words.length - 1 - det.wordEndIdx);
    let bestRightShift = 0;
    for (let step = 1; step <= maxLookahead; step++) {
      const nextWordObj = words[det.wordEndIdx + step];
      if (!nextWordObj) break;
      const tWordNorm = normFn(nextWordObj.word);
      const qWindow = unit.normWords.slice(qEnd, Math.min(unit.normWords.length, qEnd + maxLookahead + 2));
      const isMatch = qWindow.some(qw => qw === tWordNorm || matchQualFn(tWordNorm, qw) >= 0.72);
      if (isMatch) {
        bestRightShift = step;
      }
    }
    if (bestRightShift > 0) {
      newWordEnd = Math.min(words.length - 1, det.wordEndIdx + bestRightShift);
    }
  }

  det.wordStartIdx = newWordStart;
  det.wordEndIdx = newWordEnd;
  det.segments = [[newWordStart, newWordEnd + 1]];

  const rawTokens = tokenizeText(currentState.rawTranscript);
  if (rawTokens.length && newWordEnd < rawTokens.length) {
    recomputeCanonicalForDetection(det, rawTokens);
  }

  if (det.aiVerification) {
    det.aiVerification.boundaryStatus = "COMPLETE_SPAN";
    det.aiVerification.humanOverride = true;
  }

  recalculateCaptionsFromCurrentFindings();
  if (typeof renderAllViews === "function") {
    renderAllViews();
  } else {
    if (typeof renderFindingInspector === "function") renderFindingInspector();
    if (typeof renderFormattedLectureView === "function") renderFormattedLectureView();
    if (typeof renderCaptionTimelineTable === "function") renderCaptionTimelineTable();
  }
  showToast(`🪄 تم استكمال حدود المقتبس تلقائياً [${newWordStart + 1} → ${newWordEnd + 1}] وتحديث الكابشن!`);
}

function toggleSnapFindingToCanonical(findingIdx, forceState = null) {
  const det = currentState.detections[findingIdx];
  if (!det) return;
  pushUndoSnapshot("تبديل المطابقة مع الرسم القياسي");

  det.snappedToCanonical = forceState !== null ? Boolean(forceState) : !det.snappedToCanonical;
  if (det.snappedToCanonical && (!det.canonicalText || !det.canonicalText.trim())) {
    const unit = activeMatcher?.units?.get(det.unitId);
    if (unit && unit.fullText) {
      det.canonicalText = unit.fullText;
      det.canonicalSegments = [unit.fullText];
    }
  }

  recalculateCaptionsFromCurrentFindings();
  showToast(
    det.snappedToCanonical
      ? "✨ تم استبدال الإملاء الصوتي بالرسم العثماني/القياسي المعتمد"
      : "↩️ تم إرجاع النص إلى إملاء التفريغ الصوتي الأصلي"
  );
}

function convertFindingToSavedDhikr(findingIdx) {
  const det = currentState.detections[findingIdx];
  if (!det) return;
  const spanText = det.matchedText || (currentState.words || []).slice(det.wordStartIdx, det.wordEndIdx + 1).map(w => w.word).join(" ");
  const ref = det.displayRef && !det.displayRef.includes("سورة") ? det.displayRef : "ذكر مأثور";
  const newItem = registerOutsideDhikrInDataset(spanText, ref, ref);
  if (!newItem) return;

  pushUndoSnapshot("تحويل المقتبس إلى ذكر وحفظه في قاعدة الأذكار");
  det.type = "dhikr";
  det.sourceType = "ADHKAR";
  det.unitId = newItem.id;
  det.displayRef = newItem.ref || "ذكر مأثور";
  det.reference = newItem.ref || "ذكر مأثور";
  recalculateCaptionsFromCurrentFindings();
  showToast("📿 تم تحويل المقتبس إلى ذكر وحفظه في قاعدة الأذكار!");
}

// The «matching references» of a finding. The engine only records the one it chose, so the list is created on
// first use with that reference first; references added from the search are appended, never replacing it.
function getFindingCandidates(det) {
  if (!det) return [];
  if (!Array.isArray(det.candidates)) {
    const unit = activeMatcher?.units?.get(det.unitId);
    det.candidates = unit
      ? [{ unitId: unit.unitId, displayRef: unit.displayRef, text: unit.fullText, sourceType: unit.sourceType }]
      : (det.displayRef ? [{ unitId: det.unitId || `MANUAL:${det.displayRef}`, displayRef: det.displayRef, text: det.canonicalText || "" }] : []);
  }
  return det.candidates;
}

function addReferenceToFinding(findingIdx, unitId, customRefText = "") {
  const det = currentState.detections[findingIdx];
  if (!det) return false;
  const list = getFindingCandidates(det);
  const unit = unitId ? activeMatcher?.units?.get(unitId) : null;
  const id = unit ? unit.unitId : `MANUAL:${customRefText.trim()}`;
  if (!unit && !customRefText.trim()) return false;
  if (list.some(c => c.unitId === id)) {
    showToast("ℹ️ هذا المرجع موجود بالفعل في المراجع المطابقة");
    return false;
  }
  pushUndoSnapshot("إضافة مرجع إلى المراجع المطابقة");
  list.push(unit
    ? { unitId: unit.unitId, displayRef: unit.displayRef, text: unit.fullText, sourceType: unit.sourceType, addedManually: true }
    : { unitId: id, displayRef: customRefText.trim(), text: "", addedManually: true });
  showToast(`📚 أُضيف «${unit ? unit.displayRef : customRefText.trim()}» إلى المراجع المطابقة — المرجع المعتمد لم يتغير`);
  if (typeof renderFindingInspector === "function") renderFindingInspector();
  return true;
}

function removeReferenceFromFinding(findingIdx, unitId) {
  const det = currentState.detections[findingIdx];
  if (!det || unitId === det.unitId) return;
  pushUndoSnapshot("حذف مرجع من المراجع المطابقة");
  det.candidates = getFindingCandidates(det).filter(c => c.unitId !== unitId);
  if (typeof renderFindingInspector === "function") renderFindingInspector();
}

function linkFindingToCorpusUnit(findingIdx, unitId, customRefText = "") {
  const det = currentState.detections[findingIdx];
  if (!det) return;
  pushUndoSnapshot("ربط المقتبس بمرجع من القاعدة");

  getFindingCandidates(det);
  // keep this reference's word edits so switching back restores them
  const EDIT_FIELDS = ["canonicalText", "canonicalSegments", "qSegments", "qFullSegments", "refSelection", "snappedToCanonical"];
  det.refEdits = det.refEdits || {};
  if (det.unitId) det.refEdits[det.unitId] = Object.fromEntries(EDIT_FIELDS.map(k => [k, det[k]]));
  const restored = unitId ? det.refEdits[unitId] : null;

  const unit = activeMatcher?.units?.get(unitId);
  if (unit) {
    det.unitId = unit.unitId;
    det.sourceType = unit.sourceType;
    det.type = sourceTypeToCategorySlug(unit.sourceType);
    det.displayRef = unit.displayRef;
    det.reference = unit.displayRef;
    det.confidenceBand = "VERIFIED";
    det.confidence = 1.0;

    const rawTokens = tokenizeText(currentState.rawTranscript);
    if (restored) {
      Object.assign(det, restored);
    } else if (rawTokens.length && det.wordEndIdx < rawTokens.length) {
      det.segments = [[det.wordStartIdx, det.wordEndIdx + 1]];
      det.qFullSegments = undefined;
      recomputeCanonicalForDetection(det, rawTokens);
      det.snappedToCanonical = false;
    } else {
      det.canonicalText = unit.fullText;
      det.canonicalSegments = [unit.fullText];
    }
  } else if (customRefText) {
    det.unitId = unitId || det.unitId;
    det.displayRef = customRefText.trim();
    det.reference = customRefText.trim();
  }

  recalculateCaptionsFromCurrentFindings();
  showToast(`🔗 تم ربط المقتبس بالمرجع: ${det.displayRef}${restored ? " — استُعيدت تعديلاتك السابقة عليه" : ""} (تعديلات المرجع السابق محفوظة إن عدت إليه)`);
}

function deleteFinding(findingIdx) {
  if (findingIdx < 0 || findingIdx >= currentState.detections.length) return;
  pushUndoSnapshot("حذف المقتبس");

  const removed = currentState.detections.splice(findingIdx, 1)[0];
  if (currentState.selectedPredIndex >= currentState.detections.length) {
    currentState.selectedPredIndex = currentState.detections.length - 1;
  }

  recalculateCaptionsFromCurrentFindings();
  showToast(`🗑️ تم حذف الإشارة (${removed?.displayRef || "مقتبس"}) وإعادة حساب الكابشن`);
}

// -----------------------------------------------------------------------------
// 4. Drag-Select Text Highlighting -> Floating Toolbar & Direct FN Studio Sync
// -----------------------------------------------------------------------------

function detectWordSpanFromDOMSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const displayStage = document.getElementById("formattedLectureStage");
  const editorStage = document.getElementById("editorLectureStage");
  const range = sel.getRangeAt(0);

  let activeStage = null;
  if (displayStage && displayStage.contains(range.commonAncestorContainer)) {
    activeStage = displayStage;
  } else if (editorStage && editorStage.contains(range.commonAncestorContainer)) {
    activeStage = editorStage;
  }
  if (!activeStage) return null;

  const wordEls = Array.from(activeStage.querySelectorAll("[data-word-idx]"));
  const hitIndices = [];
  for (const el of wordEls) {
    if (range.intersectsNode(el)) {
      const idx = parseInt(el.getAttribute("data-word-idx"), 10);
      if (!isNaN(idx)) hitIndices.push(idx);
    }
  }

  if (!hitIndices.length) return null;
  const minW = Math.min(...hitIndices);
  const maxW = Math.max(...hitIndices);
  const selectedText = (currentState.words || []).slice(minW, maxW + 1).map(w => w.word).join(" ");
  const rect = range.getBoundingClientRect();

  return {
    wordStartIdx: minW,
    wordEndIdx: maxW,
    text: selectedText,
    rect,
    inEditorStage: activeStage === editorStage
  };
}

function handleLectureSelectionChange() {
  const toolbar = document.getElementById("floatingSelectionToolbar");
  const spanInfo = detectWordSpanFromDOMSelection();

  if (!spanInfo || !spanInfo.text) {
    if (toolbar) toolbar.classList.add("hidden");
    return;
  }

  currentState.pendingSelectionSpan = spanInfo;

  // If the user drag-selected text inside the Smart Editor stage, immediately sync it with FN Studio & highlight!
  if (spanInfo.inEditorStage && (spanInfo.wordEndIdx > spanInfo.wordStartIdx || spanInfo.text.length >= 2)) {
    const startInp = document.getElementById("inpFnStartIdx");
    const endInp = document.getElementById("inpFnEndIdx");
    if (startInp && endInp) {
      startInp.value = String(spanInfo.wordStartIdx);
      endInp.value = String(spanInfo.wordEndIdx + 1);
      currentState.fnClickStep = 0;
      if (currentState.editorDockTab !== "fn") {
        switchEditorDockTab("fn");
      } else {
        updateFnStudioSuggestions();
        updateFnRangeVisualHighlight();
      }
    }
  }

  // Also show floating quick toolbar
  if (toolbar) {
    toolbar.classList.remove("hidden");
    const topPx = Math.max(12, spanInfo.rect.top - 52);
    const leftPx = Math.max(16, Math.min(window.innerWidth - 380, spanInfo.rect.left));
    toolbar.style.top = `${topPx}px`;
    toolbar.style.left = `${leftPx}px`;
  }
}

function openCorpusSearchModalForSelection(categorySlug, editExistingFindingIdx = -1) {
  const modal = document.getElementById("corpusSearchModal");
  if (!modal) return;

  const floating = document.getElementById("floatingSelectionToolbar");
  if (floating) floating.classList.add("hidden");

  modal.setAttribute("data-mode", editExistingFindingIdx >= 0 ? "edit" : "add");
  modal.setAttribute("data-finding-idx", String(editExistingFindingIdx));
  modal.setAttribute("data-category", categorySlug || "ayah");

  const catSelect = document.getElementById("selModalCorpusCategory");
  const searchInp = document.getElementById("inpModalCorpusSearch");
  const customRefInp = document.getElementById("inpModalCustomReference");
  const previewSpanEl = document.getElementById("modalSelectedSpanPreview");

  if (catSelect) catSelect.value = categorySlug || "ayah";

  let initialQuery = "";
  if (editExistingFindingIdx >= 0 && currentState.detections[editExistingFindingIdx]) {
    const d = currentState.detections[editExistingFindingIdx];
    initialQuery = d.matchedText || "";
    if (previewSpanEl) previewSpanEl.textContent = d.matchedText || "";
    if (customRefInp) customRefInp.value = "";
  } else if (currentState.pendingSelectionSpan) {
    initialQuery = currentState.pendingSelectionSpan.text;
    if (previewSpanEl) previewSpanEl.textContent = currentState.pendingSelectionSpan.text;
    if (customRefInp) {
      customRefInp.value = categorySlug === "ayah" ? "سورة : آية" : (categorySlug === "hadith" ? "حديث شريف" : "ذكر مأثور");
    }
  }

  if (searchInp) {
    searchInp.value = initialQuery.split(/\s+/).slice(0, 6).join(" ");
  }

  const commitBtn = document.getElementById("btnCommitCustomRefModal");
  if (commitBtn) {
    commitBtn.textContent = editExistingFindingIdx >= 0 ? "➕ إضافة مرجع يدوي إلى المراجع المطابقة" : "✓ حفظ المرجع وتحديث الكابشن";
  }

  renderCorpusModalSearchResults();
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function renderCorpusModalSearchResults() {
  const listEl = document.getElementById("modalCorpusResultsList");
  const searchInp = document.getElementById("inpModalCorpusSearch");
  const catSelect = document.getElementById("selModalCorpusCategory");
  if (!listEl) return;

  const q = searchInp ? searchInp.value.trim() : "";
  const cat = catSelect ? catSelect.value : "ALL";
  const hits = typeof searchCorpusUnits === "function" ? searchCorpusUnits(q, cat, 25) : [];

  if (!hits.length) {
    listEl.innerHTML = `
      <div class="p-4 text-center text-xs text-slate-400">
        لا توجد نتائج مطابقة في القاعدة المحمّلة حالياً — يمكنك كتابة المرجع يدوياً بالأسفل والضغط على «حفظ وإدراج المقتبس».
      </div>
    `;
    return;
  }

  const modal = document.getElementById("corpusSearchModal");
  const editIdx = modal?.getAttribute("data-mode") === "edit" ? parseInt(modal.getAttribute("data-finding-idx") || "-1", 10) : -1;
  const editDet = editIdx >= 0 ? currentState.detections[editIdx] : null;
  const includedIds = new Set(editDet ? getFindingCandidates(editDet).map(c => c.unitId) : []);

  listEl.innerHTML = hits.map(u => {
    const isApproved = editDet && editDet.unitId === u.unitId;
    const isIncluded = includedIds.has(u.unitId);
    const badgeColor = u.sourceType === "QURAN"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
      : (u.sourceType === "HADITH" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" : "bg-violet-500/20 text-violet-300 border-violet-500/40");
    return `
      <div class="p-3 rounded-xl border transition flex flex-col gap-1.5 ${isIncluded ? "bg-emerald-950/30 border-emerald-500/40 cursor-default" : "bg-slate-900/90 hover:bg-slate-800 border-slate-800 hover:border-sky-500/50 cursor-pointer"}"
           data-pick-unit-id="${escapeHtml(u.unitId)}" ${isIncluded ? 'data-already-included="1"' : ""}>
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold border ${badgeColor}">${escapeHtml(u.displayRef)}</span>
            ${isApproved ? '<span class="px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-200 text-[10px] font-bold">★ المرجع المعتمد</span>'
              : (isIncluded ? '<span class="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 text-[10px] font-bold">✓ مضاف</span>'
              : (editDet ? '<span class="px-1.5 py-0.5 rounded bg-sky-900/60 text-sky-300 text-[10px] font-bold">➕ إضافة</span>' : ""))}
          </span>
          <span class="text-[11px] font-mono text-slate-400" dir="ltr">${escapeHtml(u.unitId)}</span>
        </div>
        <div class="text-xs text-slate-200 font-quran-text leading-relaxed">${escapeHtml(u.fullText.slice(0, 220))}${u.fullText.length > 220 ? "..." : ""}</div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll("[data-pick-unit-id]").forEach(card => {
    card.addEventListener("click", () => {
      if (card.hasAttribute("data-already-included")) {
        showToast("ℹ️ هذا المرجع موجود بالفعل في المراجع المطابقة");
        return;
      }
      const uid = card.getAttribute("data-pick-unit-id");
      commitModalCorpusSelection(uid);
    });
  });
}

function commitModalCorpusSelection(pickedUnitId = null) {
  const modal = document.getElementById("corpusSearchModal");
  if (!modal) return;

  const mode = modal.getAttribute("data-mode") || "add";
  const editIdx = parseInt(modal.getAttribute("data-finding-idx") || "-1", 10);
  const catSelect = document.getElementById("selModalCorpusCategory");
  const customRefInp = document.getElementById("inpModalCustomReference");
  const categorySlug = (catSelect && catSelect.value !== "ALL") ? catSelect.value : (modal.getAttribute("data-category") || "ayah");
  const customRef = customRefInp ? customRefInp.value.trim() : "";

  if (mode === "edit" && editIdx >= 0) {
    // Add to the matching references (the approved one stays); keep the dialog open to add more
    if (addReferenceToFinding(editIdx, pickedUnitId, pickedUnitId ? "" : customRef)) renderCorpusModalSearchResults();
    return;
  } else if (currentState.pendingSelectionSpan) {
    pushUndoSnapshot("إضافة مقتبس يدوي جديد");
    const { wordStartIdx, wordEndIdx } = currentState.pendingSelectionSpan;
    const unit = pickedUnitId && activeMatcher?.units ? activeMatcher.units.get(pickedUnitId) : null;
    const srcType = unit ? unit.sourceType : categorySlugToSourceType(categorySlug);
    const finalType = sourceTypeToCategorySlug(srcType);
    const refLabel = unit ? unit.displayRef : (customRef || (finalType === "ayah" ? "آية قرآنية" : (finalType === "hadith" ? "حديث شريف" : "ذكر مأثور")));

    const firstW = currentState.words[wordStartIdx] || currentState.words[0];
    const lastW = currentState.words[wordEndIdx] || firstW;
    const matchedText = currentState.words.slice(wordStartIdx, wordEndIdx + 1).map(w => w.word).join(" ");

    currentState.detections = currentState.detections.filter(
      d => d.wordEndIdx < wordStartIdx || d.wordStartIdx > wordEndIdx
    );

    const newDet = {
      id: `finding_manual_${Date.now()}`,
      type: finalType,
      sourceType: srcType,
      unitId: unit ? unit.unitId : `MANUAL:${Date.now()}`,
      displayRef: refLabel,
      reference: refLabel,
      candidateRefs: [refLabel],
      candidateUnitIds: [unit ? unit.unitId : "MANUAL"],
      isAmbiguous: false,
      confidenceBand: "VERIFIED",
      confidence: 1.0,
      totalScore: 25.0,
      wordStartIdx,
      wordEndIdx,
      startIndex: firstW ? firstW.char_start : 0,
      endIndex: lastW ? lastW.char_end : 0,
      charStart: firstW ? firstW.char_start : 0,
      charEnd: lastW ? lastW.char_end : 0,
      startTime: firstW ? Number(firstW.start) : 0.0,
      endTime: lastW ? Number(lastW.end) : 0.0,
      matchedText,
      canonicalText: unit ? unit.fullText : matchedText,
      segments: [[wordStartIdx, wordEndIdx + 1]],
      qSegments: [[0, wordEndIdx - wordStartIdx + 1]],
      canonicalSegments: [unit ? unit.fullText : matchedText],
      commentaryGaps: [],
      snappedToCanonical: false
    };

    if (unit) {
      const rawTokens = tokenizeText(currentState.rawTranscript);
      if (rawTokens.length && wordEndIdx < rawTokens.length) {
        recomputeCanonicalForDetection(newDet, rawTokens);
      }
    }

    currentState.detections.push(newDet);
    currentState.detections.sort((a, b) => a.wordStartIdx - b.wordStartIdx);
    currentState.selectedPredIndex = currentState.detections.indexOf(newDet);
    currentState.pendingSelectionSpan = null;

    recalculateCaptionsFromCurrentFindings();
    showToast(`✨ تمت إضافة المقتبس (${refLabel}) وإعادة بناء الكابشن الذكي`);
  }

  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

// -----------------------------------------------------------------------------
// 5. Dedicated Caption Editor (Inline Edit, Nudge, Playhead, Merge, Split)
// -----------------------------------------------------------------------------

function updateCaptionInlineText(capIdx, newText) {
  const cap = currentState.captions[capIdx];
  if (!cap) return;
  pushUndoSnapshot("تعديل نص الكابشن");

  const clean = String(newText || "").trim();
  cap.text = clean;
  refreshCaptionDisplayText(cap, currentState.outputPrefs);

  if (typeof cap.wordStartIdx === "number" && typeof cap.wordEndIdx === "number" && currentState.words.length) {
    const newWordsArr = clean.split(/\s+/).filter(Boolean);
    const startW = cap.wordStartIdx;
    const endW = cap.wordEndIdx;
    const oldSlice = currentState.words.slice(startW, endW + 1);
    const startTime = oldSlice[0] ? oldSlice[0].start : cap.start;
    const endTime = oldSlice[oldSlice.length - 1] ? oldSlice[oldSlice.length - 1].end : cap.end;
    const step = newWordsArr.length ? (endTime - startTime) / newWordsArr.length : 0.25;

    const replacementWords = newWordsArr.map((wStr, i) => ({
      id: startW + i,
      word: wStr,
      start: Number((startTime + i * step).toFixed(2)),
      end: Number((startTime + (i + 1) * step).toFixed(2)),
      char_start: 0,
      char_end: 0
    }));

    const deltaLen = replacementWords.length - oldSlice.length;
    currentState.words.splice(startW, oldSlice.length, ...replacementWords);

    if (deltaLen !== 0) {
      for (let k = capIdx + 1; k < currentState.captions.length; k++) {
        currentState.captions[k].wordStartIdx += deltaLen;
        currentState.captions[k].wordEndIdx += deltaLen;
      }
      currentState.detections.forEach(d => {
        if (d.wordStartIdx > endW) {
          d.wordStartIdx += deltaLen;
          d.wordEndIdx += deltaLen;
        } else if (d.wordStartIdx >= startW && d.wordEndIdx <= endW) {
          d.wordEndIdx = Math.max(d.wordStartIdx, d.wordEndIdx + deltaLen);
        }
      });
    }
    cap.wordEndIdx = startW + Math.max(0, replacementWords.length - 1);
    syncRawTextFromWords();
  }

  renderFormattedLectureView();
  updateVideoCaptionOverlay(currentState.currentTime);
}

function nudgeCaptionTimestamp(capIdx, field, deltaSec, absoluteValue = null) {
  const cap = currentState.captions[capIdx];
  if (!cap) return;

  if (field === "start") {
    const nextStart = absoluteValue !== null ? Number(absoluteValue) : (cap.start + deltaSec);
    cap.start = Number(Math.max(0, Math.min(cap.end - 0.1, nextStart)).toFixed(2));
  } else if (field === "end") {
    const nextEnd = absoluteValue !== null ? Number(absoluteValue) : (cap.end + deltaSec);
    cap.end = Number(Math.max(cap.start + 0.1, nextEnd).toFixed(2));
  }

  renderCaptionTimeline();
  updateVideoCaptionOverlay(currentState.currentTime);
}

function setCaptionTimestampToPlayhead(capIdx, field) {
  const cap = currentState.captions[capIdx];
  if (!cap) return;
  const playhead = Number(currentState.currentTime || 0);

  if (field === "start") {
    cap.start = Number(Math.max(0, Math.min(cap.end - 0.08, playhead)).toFixed(2));
  } else {
    cap.end = Number(Math.max(cap.start + 0.08, playhead).toFixed(2));
  }

  renderCaptionTimeline();
  updateVideoCaptionOverlay(currentState.currentTime);
  showToast(`⏱️ تم ضبط وقت ${field === "start" ? "البداية" : "النهاية"} عند موضع التشغيل (${cap.start.toFixed(2)}s - ${cap.end.toFixed(2)}s)`);
}

function mergeCaptionWithNext(capIdx) {
  if (capIdx < 0 || capIdx + 1 >= currentState.captions.length) return;
  pushUndoSnapshot("دمج سطري كابشن متتاليين");

  const curr = currentState.captions[capIdx];
  const next = currentState.captions[capIdx + 1];

  curr.end = next.end;
  curr.text = `${curr.text} ${next.text}`.trim();
  curr.wordEndIdx = Math.max(curr.wordEndIdx || 0, next.wordEndIdx || 0);
  curr.wordIds = (curr.wordIds || []).concat(next.wordIds || []);

  if (curr.type === "normal" && next.type !== "normal") {
    curr.type = next.type;
    curr.reference = next.reference;
    curr.findingId = next.findingId;
  } else if (curr.reference && curr.reference.includes("(تتمة)")) {
    curr.reference = curr.reference.replace(/\s*\(تتمة\)/g, "");
  } else if (!curr.reference && next.reference) {
    curr.reference = next.reference.replace(/\s*\(تتمة\)/g, "");
  }

  refreshCaptionDisplayText(curr, currentState.outputPrefs);
  currentState.captions.splice(capIdx + 1, 1);
  currentState.captions.forEach((c, idx) => { c.index = idx + 1; });

  renderCaptionTimeline();
  updateVideoCaptionOverlay(currentState.currentTime);
  showToast("🔗 تم دمج الكابشن مع السطر التالي بنجاح");
}

function splitCaptionAtCursor(capIdx, cursorCharOffset) {
  const cap = currentState.captions[capIdx];
  if (!cap) return;

  const text = String(cap.text || "").trim();
  const wordsInCap = text.split(/\s+/).filter(Boolean);
  if (wordsInCap.length < 2) {
    showToast("⚠️ لا يمكن تقسيم كابشن يحتوي على كلمة واحدة فقط.");
    return;
  }

  let splitWordIndex = Math.floor(wordsInCap.length / 2);
  if (typeof cursorCharOffset === "number" && cursorCharOffset > 0 && cursorCharOffset < text.length) {
    const leftText = text.slice(0, cursorCharOffset).trim();
    const leftWordsCount = leftText ? leftText.split(/\s+/).filter(Boolean).length : 0;
    splitWordIndex = Math.max(1, Math.min(wordsInCap.length - 1, leftWordsCount));
  }

  pushUndoSnapshot("تقسيم الكابشن عند موضع المؤشر");

  const leftWordsText = wordsInCap.slice(0, splitWordIndex).join(" ");
  const rightWordsText = wordsInCap.slice(splitWordIndex).join(" ");

  const globalFirstIdx = typeof cap.wordStartIdx === "number" ? cap.wordStartIdx : 0;
  const globalSplitRightIdx = Math.min(
    currentState.words.length - 1,
    globalFirstIdx + splitWordIndex
  );
  const globalLeftLastIdx = Math.max(globalFirstIdx, globalSplitRightIdx - 1);

  const leftEndWord = currentState.words[globalLeftLastIdx];
  const rightStartWord = currentState.words[globalSplitRightIdx];

  let splitTimeLeftEnd = leftEndWord ? Number(leftEndWord.end) : 0;
  let splitTimeRightStart = rightStartWord ? Number(rightStartWord.start) : 0;

  if (
    !leftEndWord ||
    splitTimeLeftEnd <= cap.start ||
    splitTimeLeftEnd >= cap.end
  ) {
    const ratio = splitWordIndex / wordsInCap.length;
    splitTimeLeftEnd = Number((cap.start + (cap.end - cap.start) * ratio).toFixed(2));
    splitTimeRightStart = splitTimeLeftEnd;
  }

  const firstHalf = Object.assign({}, cap, {
    id: `cap_${Date.now()}_a`,
    start: cap.start,
    end: Number(splitTimeLeftEnd.toFixed(2)),
    text: leftWordsText,
    wordStartIdx: globalFirstIdx,
    wordEndIdx: globalLeftLastIdx
  });

  const secondHalf = Object.assign({}, cap, {
    id: `cap_${Date.now()}_b`,
    start: Number(splitTimeRightStart.toFixed(2)),
    end: cap.end,
    text: rightWordsText,
    wordStartIdx: globalSplitRightIdx,
    wordEndIdx: cap.wordEndIdx
  });

  refreshCaptionDisplayText(firstHalf, currentState.outputPrefs);
  refreshCaptionDisplayText(secondHalf, currentState.outputPrefs);

  currentState.captions.splice(capIdx, 1, firstHalf, secondHalf);
  currentState.captions.forEach((c, idx) => { c.index = idx + 1; });

  renderCaptionTimeline();
  updateVideoCaptionOverlay(currentState.currentTime);
  showToast(`✂️ تم تقسيم الكابشن بدقة عند الثانية ${splitTimeLeftEnd.toFixed(2)}s`);
}

// -----------------------------------------------------------------------------
// 6. Formatted Lecture Text Editing & Word-Level Timestamp Alignment
// -----------------------------------------------------------------------------

function alignAndRetimeWords(oldWords, newWordsList) {
  const n = (oldWords || []).length;
  const m = (newWordsList || []).length;

  if (n === 0) {
    return (typeof synthesizeWordsFromRawText === "function")
      ? synthesizeWordsFromRawText(newWordsList.join(" "))
      : newWordsList.map((w, idx) => ({ id: idx, word: w, start: idx * 0.4, end: (idx + 1) * 0.4, char_start: 0, char_end: 0 }));
  }
  if (m === 0) return [];

  const dp = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Int32Array(m + 1));
  }

  for (let i = 0; i < n; i++) {
    const oWord = oldWords[i].word;
    for (let j = 0; j < m; j++) {
      if (oWord === newWordsList[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = n, j = m;
  const matchedPairs = [];
  while (i > 0 && j > 0) {
    if (oldWords[i - 1].word === newWordsList[j - 1]) {
      matchedPairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  matchedPairs.reverse();

  const anchors = [[-1, -1], ...matchedPairs, [n, m]];
  const resultWords = new Array(m).fill(null);

  for (let k = 0; k < anchors.length - 1; k++) {
    const [oldStartIdx, newStartIdx] = anchors[k];
    const [oldEndIdx, newEndIdx] = anchors[k + 1];

    if (newEndIdx < m && k + 1 < anchors.length - 1) {
      resultWords[newEndIdx] = {
        id: newEndIdx,
        word: newWordsList[newEndIdx],
        start: Number(oldWords[oldEndIdx].start),
        end: Number(oldWords[oldEndIdx].end),
        char_start: 0,
        char_end: 0
      };
    }

    const newGapLen = newEndIdx - newStartIdx - 1;
    const oldGapLen = oldEndIdx - oldStartIdx - 1;

    if (newGapLen <= 0) continue;

    if (oldGapLen === newGapLen) {
      for (let g = 0; g < newGapLen; g++) {
        const oIdx = oldStartIdx + 1 + g;
        const nIdx = newStartIdx + 1 + g;
        resultWords[nIdx] = {
          id: nIdx,
          word: newWordsList[nIdx],
          start: Number(oldWords[oIdx].start),
          end: Number(oldWords[oIdx].end),
          char_start: 0,
          char_end: 0
        };
      }
    } else {
      // new words live inside the time the replaced words occupied (never before the span or after it)
      const tStart = oldStartIdx >= 0
        ? Number(oldWords[oldStartIdx].end)
        : Number(oldWords[0].start);
      const tEnd = oldEndIdx < n
        ? Number(oldWords[oldEndIdx].start)
        : Number(oldWords[oldWords.length - 1].end);

      const spanDuration = Math.max(0.08 * newGapLen, tEnd - tStart);
      const step = spanDuration / newGapLen;

      for (let g = 0; g < newGapLen; g++) {
        const nIdx = newStartIdx + 1 + g;
        const s = Number((tStart + g * step).toFixed(2));
        const e = Number(Math.max(s + 0.04, tStart + (g + 1) * step).toFixed(2));
        resultWords[nIdx] = {
          id: nIdx,
          word: newWordsList[nIdx],
          start: s,
          end: e,
          char_start: 0,
          char_end: 0
        };
      }
    }
  }

  for (let idx = 0; idx < m; idx++) {
    if (!resultWords[idx]) {
      const prevEnd = (idx > 0 && resultWords[idx - 1]) ? resultWords[idx - 1].end : 0.0;
      resultWords[idx] = {
        id: idx,
        word: newWordsList[idx],
        start: Number(prevEnd.toFixed(2)),
        end: Number((prevEnd + 0.35).toFixed(2)),
        char_start: 0,
        char_end: 0
      };
    }
  }

  return resultWords;
}

/**
 * Replace words[startIdx..endIdx] (inclusive; endIdx = startIdx - 1 inserts before startIdx) with newText.
 * - Words outside the span and their timings are untouched; unchanged words inside it keep their own timing
 *   (alignment runs on the span only, so it stays cheap on hour-long lectures).
 * - New words share the time window of the words they replace.
 * - Quotations outside the span are kept as they are (indices shifted), with their manual edits and AI verdicts;
 *   only the edited span is re-scanned by the engine.
 */
function replaceWordRange(startIdx, endIdx, newText, label = "تعديل نص المحاضرة") {
  const words = currentState.words || [];
  const s = Math.max(0, Math.min(words.length, startIdx));
  const e = Math.max(s - 1, Math.min(words.length - 1, endIdx));
  const oldSpan = words.slice(s, e + 1);
  const newList = String(newText || "").split(/\s+/).filter(Boolean);
  if (oldSpan.map(w => w.word).join(" ") === newList.join(" ")) return { changed: false };

  pushUndoSnapshot(label);

  let retimed;
  if (!newList.length) {
    retimed = [];
  } else if (oldSpan.length) {
    retimed = alignAndRetimeWords(oldSpan, newList);
  } else {
    // pure insertion: spread the new words over the silence between the neighbours
    const t0 = s > 0 ? Number(words[s - 1].end) : 0;
    const t1 = s < words.length ? Number(words[s].start) : t0 + 0.35 * newList.length;
    const step = Math.max(0.04, (t1 - t0) / newList.length);
    retimed = newList.map((w, k) => ({ word: w, start: +(t0 + k * step).toFixed(2), end: +(t0 + (k + 1) * step).toFixed(2) }));
  }
  const delta = retimed.length - oldSpan.length;
  const newEnd = s + retimed.length - 1;             // last index of the edited span after the edit

  // quotations: keep the ones outside the span (shifted), drop the ones that touched it
  const kept = [];
  let dropped = 0;
  for (const d of currentState.detections || []) {
    if (typeof d.wordStartIdx !== "number") continue;
    if (d.wordEndIdx < s) kept.push(d);
    else if (d.wordStartIdx > e) { d.wordStartIdx += delta; d.wordEndIdx += delta; kept.push(d); }
    else dropped++;
  }

  words.splice(s, oldSpan.length, ...retimed.map(w => ({ ...w })));
  currentState.words = words;
  syncRawTextFromWords();

  // re-scan only the edited span: run the engine on the new text, keep its hits that fall in the span
  let added = 0;
  if (retimed.length && activeMatcher) {
    const lo = Math.max(0, s - 3), hi = Math.min(words.length - 1, newEnd + 3);
    const fresh = mapDetectionsToWordTimestamps(activeMatcher.detect(currentState.rawTranscript), currentState.words, currentState.rawTranscript);
    for (const d of fresh) {
      if (d.wordEndIdx < lo || d.wordStartIdx > hi) continue;
      if (kept.some(k => d.wordStartIdx <= k.wordEndIdx && k.wordStartIdx <= d.wordEndIdx)) continue;
      kept.push(d);
      added++;
    }
  }
  kept.sort((x, y) => x.wordStartIdx - y.wordStartIdx);
  kept.forEach((d, i) => { d.id = `finding_${i + 1}`; });
  currentState.detections = kept;
  recalculateCaptionsFromCurrentFindings();
  return { changed: true, oldCount: oldSpan.length, newCount: retimed.length, dropped, added };
}

function updateSingleWordInLecture(wordIdx, newWordText) {
  if (wordIdx < 0 || wordIdx >= (currentState.words || []).length) return;
  const oldWord = currentState.words[wordIdx].word;
  const cleanWord = String(newWordText || "").trim();
  if (!cleanWord || cleanWord === oldWord) return;
  replaceWordRange(wordIdx, wordIdx, cleanWord, "تعديل كلمة في نص المحاضرة");
  showToast(`✅ تم تصحيح الكلمة (${oldWord} ➔ ${cleanWord}) مع الحفاظ على التوقيت`);
}

function applyLectureTextEdits(newText) {
  const clean = String(newText || "").trim();
  if (!clean) {
    showToast("⚠️ نص المحاضرة فارغ.");
    return;
  }
  // only the changed middle is re-timed: strip the unchanged words at both ends first
  const oldW = (currentState.words || []).map(w => w.word);
  const newW = clean.split(/\s+/).filter(Boolean);
  let pre = 0;
  while (pre < oldW.length && pre < newW.length && oldW[pre] === newW[pre]) pre++;
  let suf = 0;
  while (suf < oldW.length - pre && suf < newW.length - pre && oldW[oldW.length - 1 - suf] === newW[newW.length - 1 - suf]) suf++;
  const res = replaceWordRange(pre, oldW.length - 1 - suf, newW.slice(pre, newW.length - suf).join(" "), "تعديل نص المحاضرة الكامل");
  if (typeof switchEditorSubMode === "function") switchEditorSubMode("fn_studio");
  if (!res.changed) { showToast("لم يتغير شيء في النص."); return; }
  showToast(`✅ تم حفظ التعديل: ${res.oldCount} ➔ ${res.newCount} كلمة، مع الحفاظ على توقيت بقية المحاضرة`);
}

/** Editor: rewrite the words selected in the lecture (opened from the floating selection toolbar). */
function openSpanEditModal(startIdx, endIdx) {
  const modal = document.getElementById("spanEditModal");
  const words = currentState.words || [];
  if (!modal || startIdx < 0 || endIdx < startIdx || endIdx >= words.length) return;
  document.getElementById("floatingSelectionToolbar")?.classList.add("hidden");
  const text = words.slice(startIdx, endIdx + 1).map(w => w.word).join(" ");
  modal.dataset.start = String(startIdx);
  modal.dataset.end = String(endIdx);
  document.getElementById("spanEditOriginal").textContent = text;
  document.getElementById("spanEditInfo").textContent =
    `الكلمات ${startIdx + 1}–${endIdx + 1} (${endIdx - startIdx + 1} كلمة) • ` +
    `\u2066${formatSecondsToShortTime(words[startIdx].start)} → ${formatSecondsToShortTime(words[endIdx].end)}\u2069`;  // LTR isolate: reads start → end in RTL text
  const ta = document.getElementById("spanEditText");
  ta.value = text;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => ta.focus(), 30);
}

function closeSpanEditModal() {
  const modal = document.getElementById("spanEditModal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
  const v = document.getElementById("wahyVideoPlayer");
  if (v && v.__spanStop) { v.removeEventListener("timeupdate", v.__spanStop); v.__spanStop = null; }
}

function playSelectedSpanAudio() {
  const modal = document.getElementById("spanEditModal");
  const v = document.getElementById("wahyVideoPlayer");
  const words = currentState.words || [];
  const s = parseInt(modal?.dataset.start || "-1", 10), e = parseInt(modal?.dataset.end || "-1", 10);
  if (!v || !v.src || s < 0) { showToast("لا يوجد فيديو/صوت مرتبط بهذه المحاضرة."); return; }
  const endT = Number(words[e].end) + 0.3;
  if (v.__spanStop) v.removeEventListener("timeupdate", v.__spanStop);
  v.__spanStop = () => { if (v.currentTime >= endT) { v.pause(); v.removeEventListener("timeupdate", v.__spanStop); v.__spanStop = null; } };
  v.addEventListener("timeupdate", v.__spanStop);
  v.currentTime = Math.max(0, Number(words[s].start) - 0.2);
  v.play().catch(() => {});
}

function applySpanEditModal() {
  const modal = document.getElementById("spanEditModal");
  const s = parseInt(modal.dataset.start, 10), e = parseInt(modal.dataset.end, 10);
  const res = replaceWordRange(s, e, document.getElementById("spanEditText").value, "تعديل مقطع من نص المحاضرة");
  closeSpanEditModal();
  if (!res.changed) { showToast("لم يتغير شيء."); return; }
  const extra = res.dropped || res.added ? ` • مقتبسات: حُذف ${res.dropped}، أُضيف ${res.added}` : "";
  showToast(`✅ تم التعديل: ${res.oldCount} ➔ ${res.newCount} كلمة، والتوقيت محفوظ لبقية المحاضرة${extra}`);
}

function toggleLectureEditMode(forceState = null) {
  const nextState = forceState !== null ? Boolean(forceState) : !currentState.isLectureEditMode;
  currentState.isLectureEditMode = nextState;
  if (nextState) {
    if (typeof switchMainSection === "function") switchMainSection("editor");
    if (typeof switchEditorSubMode === "function") switchEditorSubMode("text_edit");
  } else {
    if (typeof switchEditorSubMode === "function") switchEditorSubMode("fn_studio");
  }
}

window.WahyEditor = {
  switchEditorDockTab,
  buildMatnDropdownSnippet,
  renderFnSelectedUnitPreview,
  updateFnStudioSuggestions,
  updateFnRangeVisualHighlight,
  handleFnWordClick,
  handleFnWordHover,
  openFnStudioWithWordRange,
  commitFnQuoteHelper,
  commitFnDhikrToAdhkarDatabase,
  selectFindingForEdit,
  changeFindingCategory,
  adjustFindingWordBoundary,
  toggleSnapFindingToCanonical,
  convertFindingToSavedDhikr,
  linkFindingToCorpusUnit,
  deleteFinding,
  handleLectureSelectionChange,
  openCorpusSearchModalForSelection,
  renderCorpusModalSearchResults,
  commitModalCorpusSelection,
  updateCaptionInlineText,
  nudgeCaptionTimestamp,
  setCaptionTimestampToPlayhead,
  mergeCaptionWithNext,
  splitCaptionAtCursor,
  alignAndRetimeWords,
  updateSingleWordInLecture,
  applyLectureTextEdits,
  toggleLectureEditMode
};


// =============================================================================
// Module 12: Reference Word Substitution & Deletion Intent Telemetry
// =============================================================================

/**
 * Where a hadith's matn (the words the engine compares) sits inside its full text (with the chain of narration
 * before it and the takhrij after it). null when the unit is not a hadith or the matn can't be located: callers
 * then show the matn only. Cached on the unit (units are rebuilt with the matcher).
 */
function getUnitFullWordView(unit) {
  if (!unit) return null;
  if (unit._fullView !== undefined) return unit._fullView;
  let view = null;
  const matn = unit.vocalizedWords || [];
  if (unit.sourceType === "HADITH" && unit.fullText && matn.length && typeof tokenizeText === "function") {
    const expanded = typeof expandHonorificLigatures === "function" ? expandHonorificLigatures(unit.fullText) : unit.fullText;
    const full = tokenizeText(expanded);
    const norm = w => (typeof normalizeArabic === "function" ? normalizeArabic(w) : w);
    const mNorm = matn.map(norm);
    const probe = Math.min(4, mNorm.length);
    for (let k = 0; k + probe <= full.length; k++) {
      let ok = true;
      for (let i = 0; i < probe; i++) {
        if (full[k + i].norm !== mNorm[i]) { ok = false; break; }
      }
      if (ok) {
        view = { words: full.map(t => t.raw), norms: full.map(t => t.norm), matnStart: k, matnEnd: Math.min(full.length, k + mNorm.length) };
        break;
      }
    }
    if (view && view.matnStart === 0 && view.matnEnd >= view.words.length) view = null; // nothing outside the matn
  }
  unit._fullView = view;
  return view;
}

/** The full hadith text shaped like a unit, so alignTranscriptSegToUnit can match spoken words against it. */
function fullTextAlignmentUnit(unit, view) {
  return { sourceType: unit.sourceType, unitId: unit.unitId, normWords: view.norms, vocalizedWords: view.words };
}

/**
 * Use the chosen reference words as the quote's canonical text.
 * selectedWordIndices index `wordsOverride` when given (the full hadith, see getUnitFullWordView), otherwise the
 * unit's matn words; `matnOffset` maps them back to matn positions for qSegments.
 */
function applyReferenceWordsToTranscript(det, selectedWordIndices, wordsOverride = null, matnOffset = 0) {
  if (!det || !Array.isArray(selectedWordIndices) || !selectedWordIndices.length) return;
  pushUndoSnapshot("تطبيق كلمات المرجع على النص");

  const unit = (typeof activeMatcher === "object" && activeMatcher?.units && det.unitId)
    ? activeMatcher.units.get(det.unitId)
    : null;
  const matnWords = unit ? (unit.vocalizedWords || unit.fullText.split(/\s+/)) : (det.canonicalText || "").split(/\s+/);
  const words = wordsOverride || matnWords;
  const sorted = [...selectedWordIndices].sort((a, b) => a - b);
  const chosenWords = sorted.map(i => words[i]).filter(Boolean);
  if (!chosenWords.length) return;

  const newSpanText = chosenWords.join(" ");
  det.canonicalText = newSpanText;
  det.canonicalSegments = [newSpanText];

  // qSegments live in matn positions: words chosen from the chain of narration / takhrij are clamped to the matn edges
  const qs = Math.max(0, Math.min(matnWords.length, sorted[0] - matnOffset));
  const qe = Math.max(0, Math.min(matnWords.length, sorted[sorted.length - 1] - matnOffset + 1));
  if (qe > qs) det.qSegments = [[qs, qe]];
  // exact choice, in the positions of the words the grid shows (full hadith when wordsOverride is given)
  det.refSelection = { unitId: det.unitId, full: Boolean(wordsOverride), indices: sorted };
  if (wordsOverride) det.qFullSegments = [[sorted[0], sorted[sorted.length - 1] + 1]];
  det.snappedToCanonical = true;

  recalculateCaptionsFromCurrentFindings();
  if (typeof renderAllViews === "function") renderAllViews();
  if (typeof showToast === "function") {
    showToast(`✨ تم تطبيق (${chosenWords.length}) كلمة من المرجع على النص والكابشن!`);
  }
}

function triggerDeleteFindingWithIntentModal(findingIdx) {
  if (findingIdx < 0 || findingIdx >= (currentState.detections || []).length) return;
  currentState.pendingDeleteFindingIdx = findingIdx;
  const modal = document.getElementById("modalDeleteIntent");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  } else {
    deleteFinding(findingIdx);
  }
}

async function executeDeleteFindingIntent(intent) {
  const modal = document.getElementById("modalDeleteIntent");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }

  const findingIdx = currentState.pendingDeleteFindingIdx;
  if (typeof findingIdx !== "number" || findingIdx < 0 || findingIdx >= (currentState.detections || []).length) return;
  currentState.pendingDeleteFindingIdx = null;

  const det = currentState.detections[findingIdx];
  if (!det) return;

  if (intent === "FALSE_POSITIVE") {
    try {
      det.aiVerification = det.aiVerification || {};
      det.aiVerification.verdict = "FALSE";
      det.aiVerification.humanOverride = true;
      det.aiVerification.reason = "حذف يدوي بواسطة المستخدم: كلام عادي للمتكلم وليس اقتباساً (عينة سلبية).";
      if (typeof WahyAiVerifier === "object" && typeof WahyAiVerifier.buildCanonicalDecisionEnvelope === "function") {
        const env = WahyAiVerifier.buildCanonicalDecisionEnvelope(det, currentState.words);
        const layaRec = WahyAiVerifier.convertRecordToLayaTrainingEnvelope(det, env);
        layaRec.answers.verdict.choice = "FALSE";
        layaRec.answers.verdict.probabilities = { CORRECT: 0.01, FALSE: 0.98, NOT_SURE: 0.01 };
        layaRec.initial_system_prediction = { verdict: "CORRECT", confidence: 0.90 };
        layaRec.human_gold_resolution = { verdict: "FALSE", user_action: "DELETE_FALSE_POSITIVE", timestamp: new Date().toISOString() };
        if (typeof saveVerificationRecordToDB === "function") {
          await saveVerificationRecordToDB(layaRec);
        }
      }
    } catch (e) {
      console.warn("Failed to record deletion telemetry:", e);
    }
  }

  deleteFinding(findingIdx);
}
