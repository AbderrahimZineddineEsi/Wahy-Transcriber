# Agy Feature Specification — Boundary-Truncation Flagging (`boundary_status`) & 1-Click Smart Boundary Heal

## 1. Feature Goal & Core Engineering Principles

Sometimes `engine.js` correctly detects a Quranic Ayah, Prophetic Hadith, or Dhikr (`verdict === "CORRECT"`), but **clips words from the beginning (`wordStartIdx` too late) or from the end (`wordEndIdx` too early)** of what the speaker actually recited.

**`Agy` must implement Boundary-Truncation Flagging & Smart Auto-Heal following these 4 strict rules:**

1. **Zero Extra API Requests (Orthogonal 2nd Question in the Same Call):**

   * Do **not** make a separate API call to check boundaries, and do **not** pollute the primary 3-way `verdict` (`CORRECT | FALSE | NOT_SURE`) question with boundary labels.

   * Instead, add a second question `boundary_status` (`COMPLETE_SPAN | MISSING_START | MISSING_END | MISSING_BOTH`) to the `questions` object in the **exact same request**.

   * OpenRouter's JEV Decisions API (`POST /api/alpha/decisions`), Local `Laya` (`agent.predict(state, questions)`), and Gemini/OpenRouter structured JSON schemas all answer multiple questions in a single request at **zero extra API calls**.

2. **Crucial Distinction — *Intentional Partial Quote* vs. *Engine Boundary Clipping*:**

   * In Arabic Islamic lectures, speakers very often quote only a short portion of a long Ayah or Hadith on purpose (الاقتباس الجزئي / موضع الشاهد) and then resume their own explanation. **That is `COMPLETE_SPAN`, NOT truncation!**

   * A finding must **only** be flagged as `MISSING_START`, `MISSING_END`, or `MISSING_BOTH` when the speaker **actually uttered** the missing canonical words in the immediately adjacent lecture transcript (`immediate_transcript_before` or `immediate_transcript_after`, even with minor Whisper ASR spelling errors), and the engine failed to include them inside `matched_span_in_lecture`.

3. **Deterministic Pre-Check When 100% of the Corpus Unit is Already Matched:**

   * If the engine's `det.qSegments` already starts at word `0` of the canonical corpus unit (`unmatched_corpus_prefix_words === ""`) AND ends at the final word of the canonical corpus unit (`unmatched_corpus_suffix_words === ""`), the quote cannot be missing canonical words from the corpus unit — automatically set `boundaryStatus = "COMPLETE_SPAN"` without any ambiguity.

4. **Flag First, Then Offer 1-Click Smart Boundary Heal in the UI:**

   * Flag clipped quotes visually on the lecture canvas (`[✂️ ناقص من البداية]`, `[✂️ ناقص من النهاية]`, `[✂️ ناقص الطرفين]`), add a dedicated filter pill in the toolbar (`[✂️ ناقص الحدود فقط 🟠]`), and provide a 1-click **`[🪄 توسيع تلقائي للحدود الناقصة (Auto-Heal Boundary)]`** button inside the Finding Inspector alongside the manual `-1W / +1W` buttons.

## 2. Step-by-Step Code Changes for `Agy`

### Step 1: Enrich `buildCanonicalDecisionEnvelope()` in `js/ai-verifier.js`

Update `buildCanonicalDecisionEnvelope(det, words, contextWindowWords = 25)` so it extracts the exact unmatched prefix and suffix words from the matched corpus unit (`activeMatcher.units.get(det.unitId)`) and adds the second question `boundary_status`:

```
function buildCanonicalDecisionEnvelope(det, words, contextWindowWords = 25) {
  const sIdx = Math.max(0, det.wordStartIdx);
  const eIdx = Math.min(words.length - 1, det.wordEndIdx);

  const beforeStart = Math.max(0, sIdx - contextWindowWords);
  const afterEnd = Math.min(words.length, eIdx + 1 + contextWindowWords);

  const contextBefore = words.slice(beforeStart, sIdx).map(w => w.word).join(" ");
  const matchedTranscriptSpan = words.slice(sIdx, eIdx + 1).map(w => w.word).join(" ");
  const contextAfter = words.slice(eIdx + 1, afterEnd).map(w => w.word).join(" ");

  // 8 words immediately before and after the detection boundary in the transcript
  const immediateBefore = words.slice(Math.max(0, sIdx - 8), sIdx).map(w => w.word).join(" ");
  const immediateAfter = words.slice(eIdx + 1, Math.min(words.length, eIdx + 9)).map(w => w.word).join(" ");

  // Extract unmatched canonical prefix & suffix from the corpus unit
  let unmatchedPrefix = "";
  let unmatchedSuffix = "";
  const unit = (typeof activeMatcher === "object" && activeMatcher?.units && det.unitId)
    ? activeMatcher.units.get(det.unitId)
    : null;

  if (unit && Array.isArray(unit.vocalizedWords) && unit.vocalizedWords.length) {
    const qSegs = (Array.isArray(det.qSegments) && det.qSegments.length)
      ? det.qSegments
      : [[0, unit.vocalizedWords.length]];
    const qStart = Math.max(0, qSegs[0][0]);
    const qEnd = Math.min(unit.vocalizedWords.length, qSegs[qSegs.length - 1][1]);

    if (qStart > 0) {
      unmatchedPrefix = unit.vocalizedWords.slice(Math.max(0, qStart - 10), qStart).join(" ");
    }
    if (qEnd < unit.vocalizedWords.length) {
      unmatchedSuffix = unit.vocalizedWords.slice(qEnd, Math.min(unit.vocalizedWords.length, qEnd + 10)).join(" ");
    }
  }

  const canonicalState = {
    source_type: det.sourceType || "HADITH",
    candidate_reference: det.displayRef || det.reference || "",
    canonical_corpus_text: det.canonicalText || matchedTranscriptSpan,
    context_before: contextBefore,
    matched_span_in_lecture: matchedTranscriptSpan,
    context_after: contextAfter,
    unmatched_corpus_prefix_words: unmatchedPrefix,
    immediate_transcript_before: immediateBefore,
    unmatched_corpus_suffix_words: unmatchedSuffix,
    immediate_transcript_after: immediateAfter,
    engine_confidence_band: det.confidenceBand || "CANDIDATE",
    engine_score: Number((det.totalScore || 0).toFixed(2)),
    has_citation_cue: Boolean(det.hasCitationCue)
  };

  const canonicalQuestions = {
    verdict: {
      type: "choice",
      instructions:
        "In this Arabic Islamic lecture transcript, determine whether `matched_span_in_lecture` (surrounded by `context_before` and `context_after`) is an actual quotation/citation of `canonical_corpus_text` (`source_type`), or if it is merely ordinary speaker prose/explanation that happens to share words with the corpus text.",
      criteria: {
        CORRECT:
          "The speaker is genuinely quoting, reciting, or invoking this Quranic Ayah, Prophetic Hadith, or Dhikr (verbatim or as a direct religious citation in context).",
        FALSE:
          "False positive: the words are ordinary conversational speech, fiqh explanation, or narrator/person names that coincidentally overlap with corpus vocabulary without quoting the text.",
        NOT_SURE:
          "Ambiguous or partial paraphrase/meaning-only allusion where it is borderline whether the speaker intended a direct quotation."
      }
    },
    boundary_status: {
      type: "choice",
      instructions:
        "Compare `immediate_transcript_before` against `unmatched_corpus_prefix_words`, and `immediate_transcript_after` against `unmatched_corpus_suffix_words`. Determine whether the speaker actually uttered additional words of this quote at the beginning or end (even with minor ASR spelling errors) that were accidentally cut off from `matched_span_in_lecture`. If the speaker intentionally stopped quoting and resumed normal commentary, select COMPLETE_SPAN.",
      criteria: {
        COMPLETE_SPAN:
          "The detected span captures all words of the quote that the speaker actually uttered in this segment (no words of the quote were cut off in the adjacent transcript).",
        MISSING_START:
          "Words from `unmatched_corpus_prefix_words` appear inside `immediate_transcript_before` and were cut off from the beginning of the detection.",
        MISSING_END:
          "Words from `unmatched_corpus_suffix_words` appear inside `immediate_transcript_after` and were cut off from the end of the detection.",
        MISSING_BOTH:
          "Words of the quote were cut off from BOTH the beginning (`immediate_transcript_before`) and the end (`immediate_transcript_after`)."
      }
    }
  };

  return { state: canonicalState, questions: canonicalQuestions };
}

```

### Step 2: Update Provider Response Parsers (`js/ai-verifier.js`)

1. **Detection AI State (`det.aiVerification`):** Add these fields to `det.aiVerification`:

   ```
   boundaryStatus: "COMPLETE_SPAN", // "COMPLETE_SPAN" | "MISSING_START" | "MISSING_END" | "MISSING_BOTH"
   boundaryConfidence: 1.0,
   boundaryProbabilities: { COMPLETE_SPAN: 1.0, MISSING_START: 0.0, MISSING_END: 0.0, MISSING_BOTH: 0.0 },
   unmatchedPrefixPreview: "",
   unmatchedSuffixPreview: ""
   
   ```

2. **Gemini 3.5 Flash-Lite (`responseSchema`) & OpenRouter Chat Mode:** Add `boundary_status` and `boundary_confidence` to each item in Gemini's `responseSchema` (and OpenRouter Chat's system prompt):

   ```
   "boundary_status": {
     "type": "STRING",
     "enum": ["COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"]
   },
   "boundary_confidence": { "type": "NUMBER" }
   
   ```

3. **OpenRouter JEV Decisions Mode (`/api/alpha/decisions`) & Local Laya (`/api/laya/predict`):** Read `res.answers.boundary_status` directly from the returned `answers` object:

   ```
   const bAns = res.answers?.boundary_status || {};
   let bStatus = bAns.choice || "COMPLETE_SPAN";
   let bConf = typeof bAns.confidence === "number" ? bAns.confidence : 0.85;
   let bProbs = bAns.probabilities || null;
   
   ```

4. **Deterministic Post-Processing Guard (`normalizeBoundaryVerdict`):** After receiving the response from any provider:

   * If `verdict === "FALSE"`, force `boundaryStatus = "COMPLETE_SPAN"`.

   * If `state.unmatched_corpus_prefix_words === ""` and `(bStatus === "MISSING_START" || bStatus === "MISSING_BOTH")`:

     * Downgrade `MISSING_START -> COMPLETE_SPAN` and `MISSING_BOTH -> MISSING_END` (since word 0 of the corpus unit is already included).

   * If `state.unmatched_corpus_suffix_words === ""` and `(bStatus === "MISSING_END" || bStatus === "MISSING_BOTH")`:

     * Downgrade `MISSING_END -> COMPLETE_SPAN` and `MISSING_BOTH -> MISSING_START` (since the final word of the corpus unit is already included).

### Step 3: Add Local Algorithmic Boundary Auto-Heal (`js/editor.js`)

Implement `autoHealClippedBoundary(findingIdx)` in `js/editor.js` so the user can fix a flagged boundary with **1 click** (or continue using `-1W / +1W` manually):

```
/**
 * Automatically scan adjacent transcript tokens against the unmatched prefix/suffix
 * of the linked corpus unit and expand wordStartIdx / wordEndIdx to heal clipped boundaries.
 */
function autoHealClippedBoundary(findingIdx) {
  const det = currentState.detections[findingIdx];
  if (!det || !currentState.words.length) return;

  const unit = activeMatcher?.units?.get(det.unitId);
  if (!unit || !Array.isArray(unit.normWords) || !unit.normWords.length) {
    showToast("⚠️ هذا المقتبس غير مرتبط بوحدة قياسية في القاعدة — استخدم أزرار -1W / +1W للتوسيع اليدوي.");
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

  // 1. Heal Prefix (Expand Left) if MISSING_START or MISSING_BOTH
  if ((bStatus === "MISSING_START" || bStatus === "MISSING_BOTH") && qStart > 0) {
    const maxLookback = Math.min(10, qStart, det.wordStartIdx);
    let bestLeftShift = 0;
    let matchedLeft = 0;
    for (let step = 1; step <= maxLookback; step++) {
      const tWordNorm = normalizeArabic(words[det.wordStartIdx - step].word);
      // Check against unmatched prefix window in unit.normWords
      const qWindow = unit.normWords.slice(Math.max(0, qStart - maxLookback - 2), qStart);
      const isMatch = qWindow.some(qw => qw === tWordNorm || wordMatchQuality(tWordNorm, qw) >= 0.72);
      if (isMatch && !isCitationOrIsnadWord(tWordNorm)) {
        matchedLeft++;
        bestLeftShift = step;
      } else if (isCitationOrIsnadWord(tWordNorm)) {
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
      const tWordNorm = normalizeArabic(words[det.wordEndIdx + step].word);
      const qWindow = unit.normWords.slice(qEnd, Math.min(unit.normWords.length, qEnd + maxLookahead + 2));
      const isMatch = qWindow.some(qw => qw === tWordNorm || wordMatchQuality(tWordNorm, qw) >= 0.72);
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
  showToast(`🪄 تم استكمال حدود المقتبس تلقائياً [${newWordStart + 1} → ${newWordEnd + 1}] وتحديث الكابشن!`);
}

```

### Step 4: UI Updates (`index.html`, `js/render.js`, `js/editor.js`, `js/events.js`)

1. **Citation Pill Warning Badge (`js/render.js`):**

   * In `buildLectureHtmlContent()`, when `det.aiVerification?.boundaryStatus` is not `"COMPLETE_SPAN"` and `det.aiVerification?.verdict !== "FALSE"`:

     * Render an orange pill badge next to the reference tag:

       * `MISSING_START`: `<span class="px-1.5 py-0.5 rounded bg-orange-500/25 text-orange-200 border border-orange-400/50 text-[10px] font-bold">✂️ ناقص البداية</span>`

       * `MISSING_END`: `<span class="px-1.5 py-0.5 rounded bg-orange-500/25 text-orange-200 border border-orange-400/50 text-[10px] font-bold">✂️ ناقص النهاية</span>`

       * `MISSING_BOTH`: `<span class="px-1.5 py-0.5 rounded bg-orange-500/25 text-orange-200 border border-orange-400/50 text-[10px] font-bold">✂️ ناقص الطرفين</span>`

2. **Display & Editor Filter Bar (`index.html` & `js/render.js`):**

   * Add `showClippedOnly: false` to `currentState.aiVerification.visibilityFilter`.

   * Add a toggle button `#btnFilterOnlyClipped` (`✂️ ناقص الحدود (0)`) in `#aiVerdictFilterGroup` that filters/highlights citations where `boundaryStatus !== "COMPLETE_SPAN"`.

   * Also add a counter `clippedCount` to the 8-card AI Metrics Ribbon (`✂️ حدود ناقصة: X`).

3. **Finding Inspector Alert & 1-Click Button (`js/render.js` -> `renderFindingInspector()`):**

   * When the selected finding has `det.aiVerification?.boundaryStatus && det.aiVerification.boundaryStatus !== "COMPLETE_SPAN"`, render this card at the top of `#findingInspectorBody`:

     ```
     <div class="rounded-xl bg-orange-950/40 border border-orange-500/50 p-3 space-y-2 text-xs">
       <div class="flex flex-wrap items-center justify-between gap-2">
         <span class="font-bold text-orange-300 flex items-center gap-1.5">
           ✂️ تنبيه الذكاء الاصطناعي: المقتبس ناقص الكلمات من
           ${det.aiVerification.boundaryStatus === "MISSING_START" ? "البداية" : (det.aiVerification.boundaryStatus === "MISSING_END" ? "النهاية" : "البداية والنهاية")}
         </span>
         <button type="button" id="btnInspectorAutoHealBoundary" class="px-3 py-1 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold text-xs shadow transition">
           🪄 توسيع تلقائي للحدود الناقصة
         </button>
       </div>
       <div class="text-[11px] text-slate-300 leading-relaxed">
         الكلمات التكميلية في المصدر: <span class="font-quran-text text-orange-200">${escapeHtml(det.aiVerification.unmatchedPrefixPreview || "")} ... ${escapeHtml(det.aiVerification.unmatchedSuffixPreview || "")}</span>
       </div>
     </div>
     
     ```

   * Bind `#btnInspectorAutoHealBoundary` to `autoHealClippedBoundary(idx)`.

4. **Universal Laya Converter (`js/ai-verifier.js` & `backend/laya_converter.py`):**

   * Include `boundary_status` in both `questions` and `answers` inside every exported `.jsonl` line so `convaiinnovations/laya-multilingual` learns to predict both `verdict` and `boundary_status` in a single forward pass!