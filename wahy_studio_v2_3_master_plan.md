# Wahy Studio (Wahy-Transcriber v2.3) — Master Reconstruction Specification & Execution Architecture

> **Target Audience:** Autonomous Coding Agents (specifically optimized for high-throughput Flash models, such as Gemini 2.0 / 1.5 Flash, Claude 3.5 Haiku, and Antigravity AGY agents) and Senior Full-Stack Engineers.  
> **Repository:** `Wahy-Transcriber` (Branch: `tafrigh-pipeline` / v2.3 Target Baseline).  
> **Core Objective:** Complete architectural overhaul of UI/UX, Interactive Citation & Editorial Studio, Bidirectional Video-Editor Sync, Multi-Candidate Reference Matching, Ground-Truth Training Telemetry for Laya Fine-Tuning, Multi-Task Data Hub, Robust AI Tafrigh Engine, Context-Enriched Quran Verification, Local Persistence & Media Caching, and LLM-Powered Error Diagnostics.

---

## Table of Contents
1. [Executive Summary & Architectural Ground Truths](#1-executive-summary--architectural-ground-truths)
2. [Design System & UI/UX Overhaul (Anti-Cheap AI Standard)](#2-design-system--uiux-overhaul-anti-cheap-ai-standard)
3. [Module 1: The Citation & Editorial Studio (Replacing FN Studio)](#3-module-1-the-citation--editorial-studio-replacing-fn-studio)
   - [3.1 Bidirectional Video Playback Sync](#31-bidirectional-video-playback-sync)
   - [3.2 Dual Script & Span View Toggles](#32-dual-script--span-view-toggles)
   - [3.3 Fahs & Ta'deel (Finding Inspector) Overhaul](#33-fahs--tadeel-finding-inspector-overhaul)
   - [3.4 Interactive Reference Word-Chip Grid & Flexible Substitution](#34-interactive-reference-word-chip-grid--flexible-substitution)
   - [3.5 Multi-Candidate Reference Carousel](#35-multi-candidate-reference-carousel)
   - [3.6 In-Place Islamic Corpus Search & Add Reference](#36-in-place-islamic-corpus-search--add-reference)
   - [3.7 Boundary Shift Controls (+1W / -1W with Live Word Previews)](#37-boundary-shift-controls-1w---1w-with-live-word-previews)
   - [3.8 AI Request Telemetry Deep-Linking](#38-ai-request-telemetry-deep-linking)
   - [3.9 Ground Truth Training Data Generation & Dual-State Workflow](#39-ground-truth-training-data-generation--dual-state-workflow)
   - [3.10 Seamless Navigation to Adhkar Studio](#310-seamless-navigation-to-adhkar-studio)
   - [3.11 Deletion Intent Dialog & Training Telemetry](#311-deletion-intent-dialog--training-telemetry)
4. [Module 2: Training Data Hub (New Main Section `#section_training_data`)](#4-module-2-training-data-hub-new-main-section-section_training_data)
5. [Module 3: AI Tafrigh Execution Engine & Configuration Panel](#5-module-3-ai-tafrigh-execution-engine--configuration-panel)
6. [Module 4: AI Tadqeeq (Verification) Configuration, Prompt Inspector & Validate All](#6-module-4-ai-tadqeeq-verification-configuration-prompt-inspector--validate-all)
7. [Module 5: Quran Ayah Completeness Context Engine & Pre-Flight Estimator](#7-module-5-quran-ayah-completeness-context-engine--pre-flight-estimator)
8. [Module 6: Lecture & Run Session Manager (Persistence & Media Caching)](#8-module-6-lecture--run-session-manager-persistence--media-caching)
9. [Module 7: Output Text Visualization Customizer & Verification Badges](#9-module-7-output-text-visualization-customizer--verification-badges)
10. [Module 8: LLM-Powered Error Diagnostics & Troubleshooting](#10-module-8-llm-powered-error-diagnostics--troubleshooting)
11. [Module 9: Terminology Cleansing & Annoying Suggestion Removal](#11-module-9-terminology-cleansing--annoying-suggestion-removal)
12. [Step-by-Step Implementation Roadmap for Coding Agents](#12-step-by-step-implementation-roadmap-for-coding-agents)
13. [Verification Test Suites & Automated Quality Gates](#13-verification-test-suites--automated-quality-gates)

---

## 1. Executive Summary & Architectural Ground Truths

### 1.1 Root Causes of Existing Flaws
An in-depth audit of the codebase (`Wahy-Transcriber-tafrigh-pipeline`) reveals why the system previously felt disjointed, frustrating, and "cheap AI generated":
1. **Hostile Playback Decoupling:** In `index.html` line 627, playback synchronization was deliberately locked out (`التمرير التلقائي متوقف لراحة التحرير`), leaving clicking in the editor completely disconnected from media seeking.
2. **Cramped, Inflexible Finding Inspector:** While the legacy FN Studio provided a rudimentary word-level match view, the Finding Inspector (`#findingInspectorBody`) rendered only a single reference in a tiny box, stripping away the multi-candidate matches discovered by the linguistic matcher.
3. **Loss of Hard-Negative Training Data:** When a user deleted a false finding or corrected an erroneous AI label, the system either discarded the record or committed only the positive result. This starves the `Laya` model of hard negatives (ordinary speech mistaken for quotes).
4. **Hardcoded, Inflexible Tafrigh Pipeline:** The AI Tafrigh trigger in `js/events.js` (lines 696–702) sent a hardcoded JSON payload with zero user configuration, freezing processing to `per_sentence` with no options for models, sliding windows, or test scopes.
5. **Myopic Quran Completeness Checking:** Boundary verification tested Ayahs in complete isolation without neighboring ayah context. In Islamic recitation, speakers frequently recite across verse boundaries (the end of ayah $N-1$ or the beginning of ayah $N+1$), causing models to hallucinate boundary clipping.
6. **Aesthetic Clutter & Generic Dark Theme:** The visual presentation relied on generic dark backgrounds (`bg-slate-900`), unrefined neon borders, low-contrast Arabic text, and intrusive promotional banners (such as `هل فات المحرك آية أو حديث أو ذكر؟`).

### 1.2 Non-Negotiable Technical Constraints
Any coding agent implementing this plan must adhere strictly to these principles:
* **Zero Disruption of Original Audio Offsets:** The original Whisper/ASR timestamps and character offsets are strictly immutable. All canonical transformations, rasm substitutions, and word expansions must preserve original coordinate mappings.
* **Unified Canonical Decision Schema:** Parity between all AI backends (Gemini Flash-Lite, OpenRouter JEV Decisions API, OpenRouter Universal Chat, and Local Laya FP16) must be maintained via the Canonical Decision Envelope `{ state, questions }`.
* **Zero Hallucinated API Endpoints:** OpenRouter's JEV model (`typesafe/jev-1.14`) uses `/api/alpha/decisions`, whereas Chat LLMs use `/api/v1/chat/completions`. If JEV is executed without an active key, the coding agent must support user key injection or fallback to Local Laya FP16 / Mock Decision Provider.
* **Dual-State Training Telemetry:** Every user interaction (correction, validation, deletion) captures both the *system's initial state* and the *human gold resolution*.

---

## 2. Design System & UI/UX Overhaul (Anti-Cheap AI Standard)

### 2.1 Aesthetic Philosophy
Islamic scholarship software demands dignity, clarity, and visual serenity. We eliminate garish neon gradients, floating blur filters, and generic AI chatbot tropes. In their place, we establish a **Scholarly Digital Scriptorium** aesthetic:
- **Warm, Optical Surface Palettes:** Deep charcoal/obsidian surfaces with warm undertones for dark mode; crisp, warm-parchment/eggshell surfaces for light mode.
- **Classical Islamic Typography:** High-fidelity Arabic naskh and thuluth-compatible font stacks (`Amiri`, `Scheherazade New`, `Noto Naskh Arabic`) paired with clean geometric UI numerals.
- **Physical Depth & Micro-Elevation:** Subtle 1px borders with calibrated alpha channels (`rgba(255,255,255,0.08)` on dark, `rgba(0,0,0,0.08)` on light) instead of heavy box-shadows.

### 2.2 Semantic CSS Variables (`css/styles.css`)
Replace hardcoded Tailwind color utilities in key containers with CSS Custom Properties that toggle seamlessly between `:root` (Light Mode) and `[data-theme="dark"]` (Dark Mode):

```css
:root {
  /* Light Mode (Scholarly Daylight / Parchment) */
  --bg-app: #f8fafc;
  --bg-surface: #ffffff;
  --bg-surface-elevated: #f1f5f9;
  --bg-surface-sunken: #e2e8f0;
  
  --border-subtle: #e2e8f0;
  --border-medium: #cbd5e1;
  --border-strong: #94a3b8;
  
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #64748b;
  --text-inverse: #f8fafc;
  
  /* Semantic Category Accents */
  --accent-ayah: #059669;        /* Deep Emerald */
  --accent-ayah-bg: #ecfdf5;
  --accent-ayah-border: #a7f3d0;
  
  --accent-hadith: #d97706;      /* Rich Amber */
  --accent-hadith-bg: #fffbeb;
  --accent-hadith-border: #fde68a;
  
  --accent-dhikr: #7c3aed;       /* Imperial Violet */
  --accent-dhikr-bg: #f5f3ff;
  --accent-dhikr-border: #ddd6fe;

  --accent-matn: #0284c7;        /* Scholarly Sapphire */
  --accent-matn-bg: #f0f9ff;
  --accent-matn-border: #bae6fd;

  --status-correct: #10b981;
  --status-false: #ef4444;
  --status-unsure: #f59e0b;
  --status-unverified: #6b7280;

  --font-arabic-text: 'Amiri', 'Scheherazade New', 'Traditional Arabic', serif;
  --font-arabic-ui: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono-numbers: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
}

[data-theme="dark"] {
  /* Dark Mode (Scholarly Obsidian / Midnight) */
  --bg-app: #090d16;
  --bg-surface: #0f172a;
  --bg-surface-elevated: #1e293b;
  --bg-surface-sunken: #020617;
  
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-medium: rgba(255, 255, 255, 0.16);
  --border-strong: rgba(255, 255, 255, 0.28);
  
  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #64748b;
  --text-inverse: #0f172a;
  
  /* Semantic Category Accents (Luminous in Dark) */
  --accent-ayah: #10b981;
  --accent-ayah-bg: rgba(16, 185, 129, 0.12);
  --accent-ayah-border: rgba(16, 185, 129, 0.35);
  
  --accent-hadith: #f59e0b;
  --accent-hadith-bg: rgba(245, 158, 11, 0.12);
  --accent-hadith-border: rgba(245, 158, 11, 0.35);
  
  --accent-dhikr: #8b5cf6;
  --accent-dhikr-bg: rgba(139, 92, 246, 0.12);
  --accent-dhikr-border: rgba(139, 92, 246, 0.35);

  --accent-matn: #38bdf8;
  --accent-matn-bg: rgba(56, 189, 248, 0.12);
  --accent-matn-border: rgba(56, 189, 248, 0.35);

  --status-correct: #10b981;
  --status-false: #f43f5e;
  --status-unsure: #fbbf24;
  --status-unverified: #94a3b8;
}
```

### 2.3 Light/Dark Theme Switcher Implementation
In `index.html` navigation header, implement the theme toggle button:
```html
<button type="button" id="btnThemeToggle" class="px-2.5 py-1.5 rounded-xl border border-border-medium bg-bg-surface-elevated text-text-secondary hover:text-text-primary transition flex items-center gap-1.5 text-xs font-semibold" title="التبديل بين الوضع الليلي والنهاري">
  <span id="themeToggleIcon">🌙</span>
  <span id="themeToggleLabel">الوضع الداكن</span>
</button>
```
In `js/events.js`, attach handler:
```javascript
function initTheme() {
  const savedTheme = localStorage.getItem("wahy_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeUI(savedTheme);
}

function updateThemeUI(theme) {
  const icon = document.getElementById("themeToggleIcon");
  const label = document.getElementById("themeToggleLabel");
  if (theme === "dark") {
    if (icon) icon.textContent = "🌙";
    if (label) label.textContent = "المظهر الداكن";
  } else {
    if (icon) icon.textContent = "☀️";
    if (label) label.textContent = "المظهر الفاتح";
  }
}

document.getElementById("btnThemeToggle")?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("wahy_theme", next);
  updateThemeUI(next);
});
```

---

## 3. Module 1: The Citation & Editorial Studio (Replacing FN Studio)

### 3.1 Bidirectional Video Playback Sync
**User Requirement 1.1:** Jump into selected video section on click. If video is currently playing, jump and resume automatically. If paused, seek to frame and remain paused. Toggable behavior so user can edit without playback interruption.

#### State Schema Addition (`js/state.js`)
```javascript
currentState.editorPlaybackFollowsSelection = true; // default true
```

#### Toolbar Control in Editor Header (`index.html`)
```html
<button type="button" id="btnToggleEditorSyncPlayback" class="px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-950/40 text-emerald-300">
  <span id="editorSyncIcon">🔗</span>
  <span id="editorSyncLabel">مزامنة موضع الفيديو مع المؤشر: مفعّلة</span>
</button>
```

#### Event Handling Logic (`js/events.js` & `js/editor.js`)
```javascript
function handleEditorWordClick(wordIdx, e) {
  const word = currentState.words[wordIdx];
  if (!word) return;

  if (currentState.editorPlaybackFollowsSelection) {
    const targetTime = typeof word.start === "number" ? word.start : 0;
    const media = document.getElementById("mainMediaPlayer") || document.getElementById("mainAudioPlayer");
    
    if (media) {
      const wasPlaying = !media.paused && !media.ended;
      media.currentTime = targetTime;
      if (wasPlaying) {
        media.play().catch(() => {});
      }
    }
  }
  // Proceed with selection logic...
}
```

---

### 3.2 Dual Script & Span View Toggles
**User Requirement 1.2:** 
1. Rasm Qiyasi button from show tab must exist in editing tab so user can preview standard orthography.
2. Add toggle to show full canonical Hadith/Ayah text vs spoken portion only.

#### State Additions (`js/state.js`)
```javascript
currentState.editorViewRasmQiyasi = false; // Toggle canonical orthography inside editor
currentState.editorViewFullCanonicalSpan = false; // Toggle full canonical text vs matched snippet
```

#### UI Toolbar Controls in `#section_editor`
```html
<div class="flex items-center gap-2 flex-wrap">
  <button type="button" id="btnEditorToggleRasmQiyasi" class="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-700 bg-slate-900 text-slate-300 hover:text-white transition flex items-center gap-1">
    <span>✨</span>
    <span id="lblEditorRasmQiyasi">عرض بالرسم القياسي</span>
  </button>
  <button type="button" id="btnEditorToggleFullMatn" class="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-700 bg-slate-900 text-slate-300 hover:text-white transition flex items-center gap-1">
    <span>📜</span>
    <span id="lblEditorFullMatn">عرض المتن كاملاً (المصدر)</span>
  </button>
</div>
```

#### Rendering Transformation (`js/render.js` -> `renderLectureStageEditor()`)
When rendering words in the editor canvas:
- If `currentState.editorViewRasmQiyasi` is `true`, replace detected words with their canonical vocalized/normalized text (`det.canonicalText` or words mapped from `qSegments`).
- If `currentState.editorViewFullCanonicalSpan` is `true`, render the full canonical unit text inline inside a distinguished badge block with an indicator showing which words were spoken.

---

### 3.3 Fahs & Ta'deel (Finding Inspector) Overhaul
**User Requirement 1.3:** Display raw transcript text prominently (large, readable) and the found hadith with high optical clarity.

#### Layout Structure in `renderFindingInspector()` (`js/render.js`)
```html
<div class="space-y-4 text-xs font-arabic-ui">
  <!-- Section 1: Raw Lecture Transcript Card -->
  <div class="rounded-2xl bg-bg-surface-elevated border border-border-subtle p-4 space-y-2">
    <div class="flex items-center justify-between text-text-muted text-[11px] font-semibold">
      <span>النص المنطوق في المحاضرة (Raw ASR):</span>
      <span class="font-mono text-text-secondary" dir="ltr">كلمات: #${det.wordStartIdx + 1} إلى #${det.wordEndIdx + 1} (${formatSecondsToShortTime(det.startTime)} → ${formatSecondsToShortTime(det.endTime)})</span>
    </div>
    <div class="text-base sm:text-lg font-arabic-text text-text-primary leading-relaxed bg-bg-surface-sunken p-3.5 rounded-xl border border-border-subtle select-text">
      "${escapeHtml(det.matchedText || "")}"
    </div>
  </div>

  <!-- Section 2: Reference Header & Metadata -->
  <div class="rounded-2xl bg-bg-surface-elevated border border-border-subtle p-4 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
      <div>
        <span class="text-text-muted text-[11px]">المرجع المعتمد:</span>
        <h4 class="text-sm sm:text-base font-bold text-accent-ayah mt-0.5">${escapeHtml(det.displayRef || det.reference || "غير محدد")}</h4>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" id="btnToggleAllCandidates" class="px-3 py-1 rounded-lg bg-bg-surface border border-border-medium text-text-secondary hover:text-text-primary text-xs font-semibold transition">
          📚 عرض المراجع البديلة (${det.candidates?.length || 1})
        </button>
        <button type="button" id="btnOpenSearchAddRef" class="px-3 py-1 rounded-lg bg-accent-matn/15 border border-accent-matn/40 text-accent-matn text-xs font-bold transition">
          🔍 بحث وإضافة مرجع
        </button>
      </div>
    </div>

    <!-- Section 3: Word-Chip Grid for the Reference (Detail Below) -->
    <div id="inspectorWordChipGridContainer" class="space-y-2"></div>
  </div>
</div>
```

---

### 3.4 Interactive Reference Word-Chip Grid & Flexible Substitution
**User Requirement 1.3 & Attached Image Parity:**
Render an interactive chip grid of all words in the canonical reference text (exactly matching user upload `image_096977.png`).
- Display words as individual clickable chips.
- Words currently matched in raw text are highlighted (e.g. green/amber with border).
- User can click or drag-select any span of words in the canonical reference — **including words not uttered in the raw text** — to substitute them into the lecture transcript and captions.

#### Implementation Specification (`js/render.js` & `js/editor.js`)
```javascript
function renderReferenceWordChips(det, containerEl) {
  const unit = activeMatcher?.units?.get(det.unitId);
  const words = unit ? unit.vocalizedWords : (det.canonicalText || "").split(/\s+/);
  
  if (!words.length) {
    containerEl.innerHTML = `<div class="text-text-muted text-xs p-3">لا يتوفر متن كامل لهذا المرجع.</div>`;
    return;
  }

  // Active selected indices in the canonical unit
  const activeUnitIndices = new Set();
  if (Array.isArray(det.qSegments)) {
    det.qSegments.forEach(([qStart, qEnd]) => {
      for (let i = qStart; i < qEnd; i++) activeUnitIndices.add(i);
    });
  }

  let html = `
    <div class="rounded-xl bg-bg-surface-sunken p-3.5 border border-border-subtle space-y-2.5">
      <div class="flex items-center justify-between text-[11px] text-text-muted">
        <span class="font-semibold">المتن الكامل للمرجع (حدد الكلمات المراد إدراجها بالدرس):</span>
        <span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[10px] font-bold">
          تطابق: ${activeUnitIndices.size} / ${words.length} كلمة
        </span>
      </div>
      <div class="flex flex-wrap gap-1.5 leading-loose text-base font-arabic-text" dir="rtl" id="refChipsBox">
  `;

  words.forEach((word, wIdx) => {
    const isMatched = activeUnitIndices.has(wIdx);
    const chipClass = isMatched
      ? "bg-emerald-600/30 text-emerald-200 border-emerald-500/60 font-bold shadow-sm"
      : "bg-bg-surface text-text-muted border-border-subtle hover:border-text-secondary";

    html += `
      <span class="ref-word-chip px-2 py-0.5 rounded-lg border text-sm cursor-pointer transition select-none ${chipClass}"
            data-ref-word-idx="${wIdx}" title="انقر لتضمين/استبعاد هذه الكلمة">
        ${escapeHtml(word)}
      </span>
    `;
  });

  html += `
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-border-subtle">
        <div class="text-[11px] text-text-muted">يمكنك اختيار أي كلمات من الحديث حتى لو لم ينطقها الشيخ لإكمال المتن.</div>
        <button type="button" id="btnApplyCustomRefSpan" class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">
          ✓ تطبيق الكلمات المختارة على النص
        </button>
      </div>
    </div>
  `;

  containerEl.innerHTML = html;

  // Multi-selection range logic
  let selectionStart = -1;
  const chips = containerEl.querySelectorAll(".ref-word-chip");
  chips.forEach(chip => {
    chip.addEventListener("click", (e) => {
      const idx = parseInt(chip.getAttribute("data-ref-word-idx"), 10);
      if (e.shiftKey && selectionStart >= 0) {
        const [low, high] = [Math.min(selectionStart, idx), Math.max(selectionStart, idx)];
        for (let i = low; i <= high; i++) activeUnitIndices.add(i);
      } else {
        if (activeUnitIndices.has(idx)) activeUnitIndices.delete(idx);
        else activeUnitIndices.add(idx);
        selectionStart = idx;
      }
      renderReferenceWordChips(det, containerEl);
    });
  });

  containerEl.querySelector("#btnApplyCustomRefSpan")?.addEventListener("click", () => {
    applyReferenceWordsToTranscript(det, Array.from(activeUnitIndices).sort((a,b)=>a-b));
  });
}
```

---

### 3.5 Multi-Candidate Reference Carousel
**User Requirement 1.4:** Show all candidate references with an expand/collapse toggle.

#### Data Model Requirement
`engine.js` must populate `det.candidates = [...]` (top 5 matched units with match score, reference title, and text preview) during initial detection.

#### UI Component
```html
<div id="inspectorAllCandidatesAccordion" class="hidden rounded-xl bg-bg-surface-sunken border border-border-subtle p-3 space-y-2 mt-2">
  <div class="text-[11px] font-bold text-text-secondary mb-1">المراجع البديلة المحتملة في القاعدة:</div>
  <div class="space-y-1.5 max-h-48 overflow-y-auto">
    <!-- Repeat per candidate -->
    <div class="p-2.5 rounded-lg bg-bg-surface border border-border-subtle hover:border-accent-ayah flex items-center justify-between gap-2 transition cursor-pointer" data-candidate-unit-id="cand_123">
      <div>
        <div class="font-bold text-xs text-text-primary">صحيح البخاري (6542)</div>
        <div class="text-[11px] text-text-muted truncate max-w-sm">من عادى لي ولياً فقد آذنته بالحرب...</div>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px]">94%</span>
        <button type="button" class="btnSetAsActiveRef px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">اعتماد هذا المرجع</button>
      </div>
    </div>
  </div>
</div>
```

---

### 3.6 In-Place Islamic Corpus Search & Add Reference
**User Requirement 1.5 & 1.6:** Eliminate the cramped modal. Provide an embedded, spacious search drawer to find Hadiths, Verses, or Adhkar and link them as new references.

#### Drawer / Modal Component (`index.html`)
A wide, accessible drawer `#drawerCorpusSearch` with:
- Instant live search input (`#inpDrawerCorpusSearch`).
- Category pills: `الكل`, `القرآن الكريم`, `الحديث النبوي`, `الأذكار والأدعية`.
- Qira'ah selector for Quran.
- Fast virtualized results list showing full text, isnad chain, and reference book.
- Direct action: `[ربط كمرجع لهذا الموضع]` or `[إضافة كاقتباس جديد تماماً]`.

---

### 3.7 Boundary Shift Controls (+1W / -1W with Live Word Previews)
**User Requirement 1.7:** Make boundary buttons completely intuitive by showing the exact target words that will be added or dropped.

#### UI Specification in Finding Inspector
```html
<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
  <!-- Start Boundary Card -->
  <div class="rounded-xl bg-bg-surface-sunken border border-border-subtle p-3 space-y-2">
    <div class="flex items-center justify-between">
      <span class="text-[11px] text-text-muted">بداية المقتبس:</span>
      <span class="font-mono text-emerald-400 font-bold">#${det.wordStartIdx + 1} «${escapeHtml(startWord)}»</span>
    </div>
    <div class="grid grid-cols-2 gap-1.5">
      <button type="button" id="btnStartWordMinus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-emerald-500 text-xs transition flex flex-col items-center">
        <span class="font-mono font-bold text-emerald-300">-1W (توسيع لليمين)</span>
        <span class="text-[10px] text-text-muted truncate max-w-[120px]">+ «${escapeHtml(prevWordBeforeStart)}»</span>
      </button>
      <button type="button" id="btnStartWordPlus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-rose-500 text-xs transition flex flex-col items-center">
        <span class="font-mono font-bold text-rose-300">+1W (تقليص)</span>
        <span class="text-[10px] text-text-muted truncate max-w-[120px]">- «${escapeHtml(startWord)}»</span>
      </button>
    </div>
  </div>

  <!-- End Boundary Card -->
  <div class="rounded-xl bg-bg-surface-sunken border border-border-subtle p-3 space-y-2">
    <div class="flex items-center justify-between">
      <span class="text-[11px] text-text-muted">نهاية المقتبس:</span>
      <span class="font-mono text-emerald-400 font-bold">#${det.wordEndIdx + 1} «${escapeHtml(endWord)}»</span>
    </div>
    <div class="grid grid-cols-2 gap-1.5">
      <button type="button" id="btnEndWordMinus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-rose-500 text-xs transition flex flex-col items-center">
        <span class="font-mono font-bold text-rose-300">-1W (تقليص)</span>
        <span class="text-[10px] text-text-muted truncate max-w-[120px]">- «${escapeHtml(endWord)}»</span>
      </button>
      <button type="button" id="btnEndWordPlus" class="px-2 py-1.5 rounded-lg bg-bg-surface border border-border-medium hover:border-emerald-500 text-xs transition flex flex-col items-center">
        <span class="font-mono font-bold text-emerald-300">+1W (توسيع لليسار)</span>
        <span class="text-[10px] text-text-muted truncate max-w-[120px]">+ «${escapeHtml(nextWordAfterEnd)}»</span>
      </button>
    </div>
  </div>
</div>
```

---

### 3.8 AI Request Telemetry Deep-Linking
**User Requirement 1.8:** From the AI card inside Finding Inspector, provide a direct button that jumps to Tab 5 (AI & Logs), highlights the exact request row in the table, and opens the payload modal.

#### Implementation in `js/render.js` & `js/events.js`
```javascript
// Inside Finding Inspector rendering:
if (det.aiVerification?.requestId) {
  html += `
    <button type="button" id="btnInspectorDeepLinkAiLogs" data-req-id="${det.aiVerification.requestId}"
            class="px-3 py-1.5 rounded-xl bg-sky-950/40 border border-sky-500/40 text-sky-300 hover:bg-sky-900/60 text-xs font-semibold flex items-center justify-center gap-1.5 transition">
      <span>📊</span>
      <span>عرض بيانات الطلب وسجل الاستجابة بالتفصيل في استوديو AI</span>
    </button>
  `;
}

// In event handler:
document.getElementById("btnInspectorDeepLinkAiLogs")?.addEventListener("click", (e) => {
  const reqId = e.currentTarget.getAttribute("data-req-id");
  switchMainSection("ai_logs");
  highlightAndOpenAiRequestLog(reqId);
});
```

---

### 3.9 Ground Truth Training Data Generation & Dual-State Workflow
**User Requirement 1.9:** Preserving negative labels is critical for fine-tuning `Laya`. If user corrects a wrong AI label to right, or right to wrong, store both states (`initial_prediction` vs `human_gold_label`).

#### Canonical Decision Record Schema (`js/state.js` & `backend/tafrigh/training_store.py`)
```json
{
  "record_id": "rec_09ab82f13c",
  "task": "verification",
  "subtask": "correctness",
  "lecture_title": "شرح العقيدة الواسطية - الشريط 01",
  "source_type": "HADITH",
  "candidate_reference": "RiyadSalihin:871",
  "matched_span_in_lecture": "ألا أنبئكم بأكبر الكبائر الإشراك بالله",
  "context_before": "قال الشيخ رحمه الله وفي الحديث الصحيح المتفق عليه",
  "context_after": "وعقوق الوالدين وقول الزور وكان متكئا فجلس",
  "initial_system_prediction": {
    "provider": "gemini-3.5-flash-lite",
    "verdict": "FALSE",
    "confidence": 0.82,
    "boundary_status": "COMPLETE_SPAN",
    "timestamp": "2026-10-20T10:14:02Z"
  },
  "human_gold_resolution": {
    "verdict": "CORRECT",
    "user_action": "OVERRIDE_FALSE_TO_CORRECT",
    "boundary_status": "COMPLETE_SPAN",
    "verified_by_user": true,
    "timestamp": "2026-10-20T10:15:30Z"
  },
  "training_weights": {
    "is_hard_negative": false,
    "is_hard_positive": true,
    "loss_multiplier": 1.5
  }
}
```

#### Dual-State UI Label & Button Group
```html
<div class="rounded-xl bg-bg-surface-sunken border border-border-subtle p-3.5 space-y-2.5">
  <div class="flex items-center justify-between">
    <span class="text-[11px] text-text-muted">حالة التصنيف المعتمدة لتدريب Laya:</span>
    <span id="lblTrainingRecordStatusBadge" class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
      🟢 مقتبس صحيح (Human Gold)
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
      🔴 تصنيف كـ «كلام عادي / خطأ»
    </button>
  </div>
</div>
```

---

### 3.10 Seamless Navigation to Adhkar Studio
**User Requirement 1.10:** If a Dhikr or outside-corpus quote is detected, provide a 1-click button to open it in Tab 4 (Adhkar Studio) for editing or deletion.

#### Action Handler
```javascript
function jumpToAdhkarStudioWithFilter(dhikrText, dhikrRef) {
  switchMainSection("datasets"); // Tab 4
  const searchInp = document.getElementById("inpDhikrSearch");
  if (searchInp) {
    searchInp.value = dhikrText.slice(0, 30);
    renderAdhkarStudioTable();
  }
  showToast(`📿 تم فتح استوديو الأذكار وتحديد: ${dhikrRef || "الذكر المختار"}`);
}
```

---

### 3.11 Deletion Intent Dialog & Training Telemetry
**User Requirement 1.11:** Deleting quotes is valuable training data. Prompt the user for intention (False Positive vs Re-selection / Scratchpad) and offer an option to discard without saving.

#### Modal Dialog Component (`#modalDeleteIntent`)
```html
<div id="modalDeleteIntent" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
  <div class="bg-bg-surface border border-border-medium rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
    <div class="flex items-center gap-2 text-rose-400 font-bold text-sm">
      <span>🗑️</span>
      <span>حذف المقتبس — تحديد الغرض لبيانات التدريب</span>
    </div>
    <p class="text-xs text-text-secondary leading-relaxed">
      حذف هذا الاقتباس يفيد في ضبط نموذج Laya لمنع التعرف الخاطئ مستقبلاً. ما هو سبب الحذف؟
    </p>

    <div class="space-y-2">
      <button type="button" data-delete-intent="FALSE_POSITIVE" class="w-full text-right p-3 rounded-xl border border-border-subtle bg-bg-surface-elevated hover:border-rose-500/50 transition flex flex-col gap-1">
        <span class="text-xs font-bold text-rose-300">❌ كلام عادي للشيخ وليس اقتباساً (False Positive)</span>
        <span class="text-[10px] text-text-muted">سيتم حفظه كعينة سلبية ذهبية لتدريب Laya على عدم اعتباره اقتباساً.</span>
      </button>

      <button type="button" data-delete-intent="BOUNDARY_RESELECT" class="w-full text-right p-3 rounded-xl border border-border-subtle bg-bg-surface-elevated hover:border-amber-500/50 transition flex flex-col gap-1">
        <span class="text-xs font-bold text-amber-300">🔄 خطأ في التظليل / أريد إعادة التحديد فقط</span>
        <span class="text-[10px] text-text-muted">لا تحفظ كخطأ في المتن، سيتم مسحه فوراً لإعادة تظليله.</span>
      </button>

      <button type="button" data-delete-intent="TEST_SCRATCHPAD" class="w-full text-right p-3 rounded-xl border border-border-subtle bg-bg-surface-elevated hover:border-slate-500/50 transition flex flex-col gap-1">
        <span class="text-xs font-bold text-text-muted">🧪 مجرد تجربة فحص / لا تحفظ أي بيانات</span>
        <span class="text-[10px] text-text-muted">حذف فوري دون تسجيل في بنك التدريب.</span>
      </button>
    </div>

    <div class="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
      <button type="button" id="btnCancelDeleteIntent" class="px-4 py-1.5 rounded-xl bg-bg-surface-elevated text-text-secondary text-xs font-semibold">إلغاء</button>
    </div>
  </div>
</div>
```

---

## 4. Module 2: Training Data Hub (New Main Section `#section_training_data`)

**User Requirement 2:** Add a dedicated data management section to view and filter training data easily by task (`verification` with correctness and completeness, `tafrigh` with segmentation, classification, and typo correction).

### 4.1 Navigation Tab Addition (`index.html`)
Add a 6th main top-level tab:
```html
<button type="button" id="navBtn_training_data" class="nav-tab-btn px-4 py-2 rounded-xl text-xs font-bold text-text-secondary hover:text-text-primary transition flex items-center gap-2">
  <span>📊</span>
  <span>بيانات التدريب (Data Hub)</span>
  <span id="badgeTrainingRecordCount" class="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">0</span>
</button>
```

### 4.2 Data Section Layout
```html
<section id="section_training_data" class="hidden space-y-5">
  <!-- Top Stats Strip -->
  <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
    <!-- Stat Cards: Total Records, Verification Correct, Verification False, Completeness Flags, Tafrigh Splits, Typo Edits -->
  </div>

  <!-- Filter & Control Toolbar -->
  <div class="rounded-2xl bg-bg-surface border border-border-subtle p-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Task Filter Dropdown -->
      <select id="selTrainingTaskFilter" class="bg-bg-surface-elevated border border-border-medium rounded-xl px-3 py-1.5 text-xs font-bold text-text-primary">
        <option value="ALL">جميع المهام (All Tasks)</option>
        <option value="VERIFICATION_CORRECTNESS">التدقيق: الصحة والمطابقة (Correctness)</option>
        <option value="VERIFICATION_COMPLETENESS">التدقيق: اكتمال الحدود (Completeness)</option>
        <option value="TAFRIGH_SEGMENTATION">التفريغ: تقطيع الجمل (Segmentation)</option>
        <option value="TAFRIGH_CLASSIFICATION">التفريغ: تصنيف المتن والشرح (Classification)</option>
        <option value="TAFRIGH_TYPO">التفريغ: تصحيح الأخطاء (Typo Correction)</option>
      </select>

      <!-- Label Filter Dropdown -->
      <select id="selTrainingLabelFilter" class="bg-bg-surface-elevated border border-border-medium rounded-xl px-3 py-1.5 text-xs font-semibold text-text-secondary">
        <option value="ALL">جميع التصنيفات</option>
        <option value="CORRECT">صحيح (CORRECT)</option>
        <option value="FALSE">كلام عادي / خاطئ (FALSE)</option>
        <option value="TRUNCATED">حدود ناقصة (TRUNCATED)</option>
      </select>

      <!-- Search Input -->
      <input type="text" id="inpTrainingDataSearch" placeholder="بحث في النصوص والمراجع..." class="bg-bg-surface-elevated border border-border-medium rounded-xl px-3 py-1.5 text-xs text-text-primary w-48 sm:w-64" />
    </div>

    <!-- Export & Maintenance Actions -->
    <div class="flex items-center gap-2">
      <button type="button" id="btnExportLayaJsonl" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition flex items-center gap-1.5">
        <span>💾</span>
        <span>تصدير Laya JSONL</span>
      </button>
      <button type="button" id="btnClearTrainingDB" class="px-3 py-1.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 hover:bg-rose-900/60 font-semibold text-xs transition">
        مسح السجلات
      </button>
    </div>
  </div>

  <!-- Interactive Data Table -->
  <div class="rounded-2xl bg-bg-surface border border-border-subtle shadow-xl overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-right text-xs" id="tableTrainingData">
        <thead class="bg-bg-surface-elevated border-b border-border-subtle text-text-muted font-bold">
          <tr>
            <th class="py-3 px-3">#</th>
            <th class="py-3 px-3">المهمة</th>
            <th class="py-3 px-3">المرجع / المصدر</th>
            <th class="py-3 px-4">النص الأصلي</th>
            <th class="py-3 px-3">الحكم الأولي (AI)</th>
            <th class="py-3 px-3">الحكم المعتمد (Gold)</th>
            <th class="py-3 px-3">التاريخ</th>
            <th class="py-3 px-3 text-center">إجراءات</th>
          </tr>
        </thead>
        <tbody id="tbodyTrainingRecords" class="divide-y divide-border-subtle font-arabic-ui"></tbody>
      </table>
    </div>
  </div>
</section>
```

---

## 5. Module 3: AI Tafrigh Execution Engine & Configuration Panel

**User Requirement 3:** Provide full options for AI Tafrigh (choose `windowed` vs `per_sentence`, select models, configure thresholds and typo correction strategies, test on slice).

### 5.1 Tafrigh Configuration Modal / Drawer (`#modalTafrighConfig`)
```html
<div id="modalTafrighConfig" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
  <div class="bg-bg-surface border border-border-medium rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl">
    <div class="flex items-center justify-between border-b border-border-subtle pb-3">
      <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
        <span>📑</span>
        <span>إعدادات التفريغ الذكي وهيكلة المتن والشرح (AI Tafrigh Settings)</span>
      </h3>
      <button type="button" id="btnCloseTafrighConfig" class="text-text-muted hover:text-text-primary text-base">✕</button>
    </div>

    <!-- Processing Mode -->
    <div class="space-y-1.5">
      <label class="block text-xs font-bold text-text-primary">نمط المعالجة (Processing Mode):</label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex items-start gap-2 p-2.5 rounded-xl border border-border-subtle bg-bg-surface-elevated cursor-pointer">
          <input type="radio" name="tafrighMode" value="per_sentence" checked class="mt-0.5 text-emerald-600" />
          <div class="text-xs">
            <span class="font-bold text-text-primary block">جملة بجملة (Per-Sentence)</span>
            <span class="text-[10px] text-text-muted">أسرع وأوفر في التوكنز، مثالي للدروس المباشرة.</span>
          </div>
        </label>
        <label class="flex items-start gap-2 p-2.5 rounded-xl border border-border-subtle bg-bg-surface-elevated cursor-pointer">
          <input type="radio" name="tafrighMode" value="windowed" class="mt-0.5 text-emerald-600" />
          <div class="text-xs">
            <span class="font-bold text-text-primary block">نافذة سياقية (Windowed)</span>
            <span class="text-[10px] text-text-muted">أدق في فهم استطرادات الشرح وعزل المتن الطويل.</span>
          </div>
        </label>
      </div>
    </div>

    <!-- Model Candidate -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label class="block text-xs font-bold text-text-primary mb-1">النموذج المنفّذ:</label>
        <select id="selTafrighModel" class="w-full bg-bg-surface-elevated border border-border-medium rounded-xl px-3 py-2 text-xs font-bold text-text-primary">
          <option value="gemini-3.5-flash-lite">Google Gemini 3.5 Flash-Lite (Free/Fast)</option>
          <option value="gemini-3.1-flash-lite">Google Gemini 3.1 Flash-Lite</option>
          <option value="gemini-3.8-flash">Google Gemini 3.8 Flash</option>
          <option value="typesafe/jev-1.14">OpenRouter JEV 1.14 (Decisions API)</option>
          <option value="local-laya">Local Laya Engine (3GB VRAM)</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-bold text-text-primary mb-1">استراتيجية تصحيح الإملاء:</label>
        <select id="selTafrighTypoStrategy" class="w-full bg-bg-surface-elevated border border-border-medium rounded-xl px-3 py-2 text-xs font-bold text-text-primary">
          <option value="gated" selected>محافظة ومقيدة (Gated - عالية الثقة فقط)</option>
          <option value="always_correct">تصحيح تلقائي مرن (Always Correct)</option>
          <option value="off">إيقاف التصحيح الإملائي تماماً</option>
        </select>
      </div>
    </div>

    <!-- Execution Scope (Test vs Full) -->
    <div class="space-y-1.5">
      <label class="block text-xs font-bold text-text-primary">نطاق التشغيل (Scope):</label>
      <div class="flex items-center gap-3 text-xs">
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="tafrighScope" value="full" checked />
          <span>المحاضرة كاملة</span>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="tafrighScope" value="slice" />
          <span>عينة تجريبية أول 20 جملة فقط (توفير التوكنز)</span>
        </label>
      </div>
    </div>

    <!-- Launch Actions -->
    <div class="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
      <button type="button" id="btnCancelTafrighConfig" class="px-4 py-2 rounded-xl bg-bg-surface-elevated text-text-secondary text-xs font-semibold">إلغاء</button>
      <button type="button" id="btnConfirmLaunchTafrigh" class="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg transition">
        🚀 تشغيل التفريغ الآن
      </button>
    </div>
  </div>
</div>
```

---

## 6. Module 4: AI Tadqeeq (Verification) Configuration, Prompt Inspector & Validate All

**User Requirement 4 & 5:** Configure thresholds, preview prompts, and provide a single-click "Validate All" button.

### 6.1 Verification Settings Drawer (`#drawerVerificationSettings`)
- Confidence Acceptance Threshold slider (e.g. $0.50$ to $0.95$, default $0.75$).
- Ambiguity Window slider (below which verdict is `NOT_SURE`).
- Context window words slider ($15$ to $50$ words).
- Live Prompt Inspector: Displays the exact rendered JSON schema and prompt before firing.

### 6.2 "Validate All" Implementation (`js/events.js` & `js/ai-verifier.js`)
```javascript
async function executeValidateAllAiDecisions() {
  const verifiedList = currentState.detections.filter(d => d.aiVerification?.status === "VERIFIED");
  if (!verifiedList.length) {
    showToast("⚠️ لا توجد اقتباسات مفحوصة لاعتمادها دفعة واحدة.");
    return;
  }

  let count = 0;
  for (const det of verifiedList) {
    if (!det.userApproved) {
      det.userApproved = true;
      det.humanGoldVerdict = det.aiVerification.verdict;
      await saveDecisionToTrainingDB(det, "VALIDATE_ALL_ACTION");
      count++;
    }
  }

  recalculateCaptionsFromCurrentFindings();
  renderLectureStageDisplay();
  renderFindingInspector();
  showToast(`✅ تم اعتماد جميع نتائج الذكاء الاصطناعي (${count} مقتبس) وحفظها كبيانات ذهبية!`);
}
```

---

## 7. Module 5: Quran Ayah Completeness Context Engine & Pre-Flight Estimator

**User Requirement 6:**
1. Quran Ayah Completeness must include the preceding Ayah ($N-1$) and succeeding Ayah ($N+1$) in the prompt context so the model sees if words match surrounding verses.
2. Allow selecting/toggling specific candidate quotes in a checklist to avoid wasting credits.
3. Pre-flight cost & time estimation before launching.

### 7.1 Neighboring Ayah Context Injection (`js/ai-verifier.js`)
Update `buildCanonicalDecisionEnvelope()`:
```javascript
if (det.sourceType === "QURAN" && det.unitId) {
  // Extract Surah and Ayah Number from unitId e.g. "quran:2:255"
  const parts = String(det.unitId).split(":");
  if (parts.length >= 3) {
    const surahNum = parseInt(parts[1], 10);
    const ayahNum = parseInt(parts[2], 10);
    
    // Retrieve preceding ayah (ayahNum - 1) and next ayah (ayahNum + 1)
    const prevUnit = activeMatcher?.units?.get(`quran:${surahNum}:${ayahNum - 1}`);
    const nextUnit = activeMatcher?.units?.get(`quran:${surahNum}:${ayahNum + 1}`);
    
    canonicalState.quran_verse_context = {
      surah_number: surahNum,
      ayah_number: ayahNum,
      previous_ayah_text: prevUnit ? prevUnit.vocalizedWords.slice(-15).join(" ") : "", // last 15 words
      current_ayah_text: det.canonicalText || "",
      next_ayah_text: nextUnit ? nextUnit.vocalizedWords.slice(0, 15).join(" ") : "" // first 15 words
    };
  }
}
```

### 7.2 Selective Candidate Checklist & Pre-Flight Estimator Modal
Before verification launches, open `#modalPreFlightVerification`:
- List all detected quotes with individual checkboxes.
- Filter buttons: `تحديد الكل`, `القرآن فقط`, `الأحاديث فقط`, `نسبة ثقة أقل من 80%`.
- Live Calculator:
  $$	ext{Selected Quotes: } N \quad|\quad 	ext{Est. Tokens: } N 	imes 380 \quad|\quad 	ext{Est. Cost: } \$0.000 	ext{ (Free Plan) or } \$0.042/1	ext{M} \quad|\quad 	ext{Est. Time: } \lceil N / 	ext{RPM} ceil 	imes 60 	ext{s}$$

---

## 8. Module 6: Lecture & Run Session Manager (Persistence & Media Caching)

**User Requirement 7 & 11:** 
1. Save and manage lectures/runs locally so user doesn't have to re-do work.
2. Cache downloaded media files locally so YouTube/files are not re-downloaded.

### 8.1 Lecture Session Store (`WahyLecturesDB` in IndexedDB)
In `js/state.js`, create a dedicated store for full lecture workspaces:
- Fields: `lecture_id`, `title`, `created_at`, `updated_at`, `media_url`, `raw_transcript`, `words`, `detections`, `captions`, `tafrigh_result`.
- In Tab 1 (`#section_input`), add **«مدير المحاضرات والجلسات السابقة (Saved Lectures)»**:
  - Cards for saved runs with word count, quote count, and last edit timestamp.
  - Actions: `[📂 فتح]`, `[💾 حفظ الجلسة]`, `[📤 تصدير .wahy.json]`, `[🗑️ حذف]`.

### 8.2 Backend Media Cache (`backend/media_processor.py`)
```python
MEDIA_CACHE_DIR = Path("data/media_cache")
MEDIA_CACHE_DIR.mkdir(parents=True, exist_ok=True)

def get_cached_media_path(source_url: str) -> Optional[Path]:
    """Computes a deterministic hash of the URL and returns cached audio path if present."""
    url_hash = hashlib.sha256(source_url.strip().encode("utf-8")).hexdigest()[:16]
    candidate = MEDIA_CACHE_DIR / f"{url_hash}.mp3"
    if candidate.exists() and candidate.stat().st_size > 1024:
        return candidate
    return None
```
In `backend/app.py`, check `get_cached_media_path()` before invoking `yt-dlp`.

---

## 9. Module 7: Output Text Visualization Customizer & Verification Badges

**User Requirement 8 & 9:** 
1. Customize output: toggle Surah names/numbers, Hadith references, Adhkar brackets, custom colors.
2. Clearly distinguish verified vs unverified quotes in the output text.

### 9.1 Formatting Preferences Panel (`#panelDisplayTypography`)
- Checkbox: `عرض أسماء السور وأرقام الآيات [البقرة: 255]`.
- Checkbox: `عرض تخريج الأحاديث [متفق عليه]`.
- Radio group for Ayah brackets: `﴿ ... ﴾` | `« ... »` | `( ... )` | بلا أقواس.
- Radio group for Adhkar brackets: `〖 ... 〗` | `[ ... ]` | بلا أقواس.
- Verification visual style:
  - Verified: Solid subtle green border with `🟢 مدقق` badge and tooltip.
  - Unverified: Dashed slate border with `⚪ غير مفحوص` badge.

---

## 10. Module 8: LLM-Powered Error Diagnostics & Troubleshooting

**User Requirement 10:** In the error popup, add an AI button (configurable to free Gemini or OpenRouter) that concisely explains the error and provides immediate recovery actions.

### 10.1 Diagnostic Trigger in `js/error-handler.js`
In the error modal `#errorModal`, add:
```html
<button type="button" id="btnAiExplainError" class="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition flex items-center gap-1.5">
  <span>🤖</span>
  <span>تشخيص الخطأ واقتراح الحل بالذكاء الاصطناعي</span>
</button>
<div id="aiErrorDiagnosticOutput" class="hidden rounded-xl bg-bg-surface-sunken p-3.5 border border-border-subtle text-xs space-y-2 mt-3"></div>
```

### 10.2 Diagnostic Prompt Contract
```
أنت مهندس دعم فني خبير بنظام Wahy-Transcriber.
حدث الخطأ التالي أثناء تشغيل النظام:
{error_stack}
البيئة والإجراء الحالي: {current_action_context}

اشرح للمستخدم في 3 نقاط محددة وموجزة جداً:
1. سبب المشكلة باختصار غير تقني.
2. ما الذي يجب على المستخدم فعله فوراً (إعادة المحاولة، تعديل الإعدادات، فحص مفتاح API).
3. التعديل البرمجي المطلوب إن كان هناك خطأ برمجي (مع ذكر اسم الملف).
```

---

## 11. Module 9: Terminology Cleansing & Annoying Suggestion Removal

**User Requirement 1 & 13:**
1. **Completely eliminate** the suggestion banner:
   Remove line 594 in `index.html`:
   `<span>هل فات المحرك آية أو حديث أو ذكر؟ ظلّل النص بالماوس أو افتح <strong>استوديو FN</strong>.</span>`
2. **Rename "FN Studio" everywhere in user-facing UI** to:
   **«استوديو التحرير وتوثيق المقتبسات (Citation & Editorial Studio)»** or **«محرر المقتبسات»**.

---

## 12. Step-by-Step Implementation Roadmap for Coding Agents

### Phase 1: Foundation & Design System (Sprint 1)
- [ ] Implement CSS tokens in `css/styles.css` for Light and Dark themes.
- [ ] Connect `#btnThemeToggle` with `localStorage` persistence.
- [ ] Remove line 594 suggestion banner and rename "FN Studio" throughout `index.html`.
- [ ] Run `node --check js/*.js`.

### Phase 2: Editorial Studio & Bidirectional Sync (Sprint 2)
- [ ] Implement `currentState.editorPlaybackFollowsSelection` in `js/state.js`.
- [ ] Wire word clicks in `js/editor.js` to seek media player with play/pause state preservation.
- [ ] Add Rasm Qiyasi and Full Matn toggles in editor toolbar and render loop.
- [ ] Build the interactive reference word-chip grid (`#inspectorWordChipGridContainer`) matching `image_096977.png`.
- [ ] Implement live word previews on `+1W` and `-1W` boundary buttons.
- [ ] Replace cramped modal with the expansive corpus search and add reference drawer.

### Phase 3: Training Telemetry & Data Hub (Sprint 3)
- [ ] Implement Deletion Intent Modal with 3 distinct pathways.
- [ ] Update `saveVerificationRecordToDB()` to store both initial system prediction and human gold label.
- [ ] Build Tab 6: Training Data Hub (`#section_training_data`) with task and subtask filters.
- [ ] Implement Laya `.jsonl` dataset exporter.

### Phase 4: Tafrigh & Tadqeeq Overhaul (Sprint 4)
- [ ] Build the Tafrigh Configuration Modal (`#modalTafrighConfig`) and connect to `/api/tafrigh/run`.
- [ ] Add Quran Ayah context ($N-1$, $N$, $N+1$) in `buildCanonicalDecisionEnvelope()`.
- [ ] Implement the Pre-Flight Verification Estimator and Selective Candidate checklist.
- [ ] Implement the "Validate All" command.

### Phase 5: Persistence, Caching & Error Diagnostics (Sprint 5)
- [ ] Implement `WahyLecturesDB` for saving/loading lecture sessions.
- [ ] Implement `MEDIA_CACHE_DIR` in `backend/media_processor.py`.
- [ ] Implement Display formatting options (brackets, Surah/Hadith numbers, verified badges).
- [ ] Implement AI Error Diagnostic in `js/error-handler.js`.

---

## 13. Verification Test Suites & Automated Quality Gates

### Automated Quality Gate 1: Codebase Syntax Integrity
```bash
node --check js/state.js
node --check js/corpus-loader.js
node --check js/engine.js
node --check js/caption-builder.js
node --check js/ai-verifier.js
node --check js/editor.js
node --check js/render.js
node --check js/events.js
node --check js/error-handler.js
python3 -m py_compile backend/*.py backend/tafrigh/*.py
```

### Automated Quality Gate 2: DOM Element ID Parity
Verify every required element ID exists across `index.html` and `js/*.js`:
- `#btnToggleEditorSyncPlayback`
- `#btnEditorToggleRasmQiyasi`
- `#btnEditorToggleFullMatn`
- `#modalDeleteIntent`
- `#navBtn_training_data`
- `#section_training_data`
- `#selTrainingTaskFilter`
- `#modalTafrighConfig`
- `#btnValidateAllAiDecisions`
- `#btnAiExplainError`

### Manual Verification Checklist
1. **Playback Sync:** Click word 15 while playing; verify media jumps and resumes. Click while paused; verify media jumps and stays paused.
2. **Word-Chip Grid:** Open finding inspector; verify full Hadith appears as clickable chips with matches in emerald. Click unselected word; click Apply; verify transcript updates.
3. **Dual-State Training:** Run verification; override a verdict; open Data Hub; verify record shows both initial AI prediction and human gold label.
4. **Tafrigh Configuration:** Click Tafrigh button; verify settings modal appears; choose windowed mode; run; verify backend receives correct parameters.
5. **Quran Context:** Verify Ayah completeness prompt contains preceding and succeeding Ayah text.
