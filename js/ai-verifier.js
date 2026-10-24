// =============================================================================
// Wahy Studio (Wahy-Transcriber v2.2) — AI Verification & Laya Master Orchestrator
// File: js/ai-verifier.js
// Providers:
//   1. Google Gemini (gemini-3.5-flash-lite, 3.1-flash-lite, 3.8-flash) with Free-Tier RPM pacer
//   2. OpenRouter JEV Decisions API (typesafe/jev-1.14, ~typesafe/jev-latest, typesafe/jev-1.13)
//   3. OpenRouter Universal Search & Chat Completions (DeepSeek, Qwen, Gemini, Claude, Llama, Free)
//   4. Local Laya-Multilingual (GTX 1050 3GB VRAM FP16 / CPU Fallback)
// Telemetry, Metrics Aggregator, and Universal Laya Dataset Converter
// =============================================================================

(function (window) {
  "use strict";

  // Rate Limiting Sliding Window for Gemini Free Tier
  const geminiRequestTimestamps = [];
  let isVerificationPaused = false;
  let isVerificationCancelled = false;
  let activeVerificationPromise = null;

  // OpenRouter Catalog Cache
  let isFetchingCatalog = false;

  // ---------------------------------------------------------------------------
  // 1. Canonical Schema Builder (Parity Across JEV, Laya, Gemini, & Chat LLMs)
  // ---------------------------------------------------------------------------

  /**
   * Build the canonical System-1 state and questions envelope for an engine finding.
   * @param {Object} det - Detection object from currentState.detections
   * @param {Array} words - currentState.words array
   * @param {number} contextWindowWords - Context window around the span (default: 25)
   */
  function buildCanonicalDecisionEnvelope(det, words, contextWindowWords = 25) {
    const sIdx = Math.max(0, typeof det.wordStartIdx === "number" ? det.wordStartIdx : 0);
    const maxIdx = Math.max(0, (words || []).length - 1);
    const eIdx = Math.max(sIdx, Math.min(maxIdx, typeof det.wordEndIdx === "number" ? det.wordEndIdx : sIdx));

    const beforeStart = Math.max(0, sIdx - contextWindowWords);
    const afterEnd = Math.min((words || []).length, eIdx + 1 + contextWindowWords);

    const contextBefore = words && words.length ? words.slice(beforeStart, sIdx).map(w => w.word).join(" ") : "";
    const matchedTranscriptSpan = words && words.length
      ? words.slice(sIdx, eIdx + 1).map(w => w.word).join(" ")
      : (det.matchedText || det.canonicalText || "");
    const contextAfter = words && words.length ? words.slice(eIdx + 1, afterEnd).map(w => w.word).join(" ") : "";

    // 8 words immediately before and after the detection boundary in the transcript
    const immediateBefore = words && words.length ? words.slice(Math.max(0, sIdx - 8), sIdx).map(w => w.word).join(" ") : "";
    const immediateAfter = words && words.length ? words.slice(eIdx + 1, Math.min(words.length, eIdx + 9)).map(w => w.word).join(" ") : "";

    // Extract unmatched canonical prefix & suffix from the linked corpus unit
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

    // Quran neighboring verses context (preceding ayah and succeeding ayah)
    let quranNeighbors = null;
    if ((det.sourceType === "QURAN" || det.type === "ayah") && typeof RAW_QURAN_DATA !== "undefined" && Array.isArray(RAW_QURAN_DATA)) {
      let surahNum = 0;
      let ayahNum = 0;
      if (det.unitId && String(det.unitId).includes(":")) {
        const parts = String(det.unitId).split(":");
        surahNum = parseInt(parts[parts.length - 2], 10);
        ayahNum = parseInt(parts[parts.length - 1], 10);
      } else if (unit && typeof unit.s === "number") {
        surahNum = unit.s;
        ayahNum = unit.a;
      }
      if (surahNum > 0 && ayahNum > 0) {
        const prevAyah = RAW_QURAN_DATA.find(q => Number(q.s) === surahNum && Number(q.a) === ayahNum - 1);
        const nextAyah = RAW_QURAN_DATA.find(q => Number(q.s) === surahNum && Number(q.a) === ayahNum + 1);
        quranNeighbors = {
          surah: surahNum,
          ayah: ayahNum,
          previous_ayah_text: prevAyah ? prevAyah.t.split(/\s+/).slice(-15).join(" ") : "",
          current_ayah_text: det.canonicalText || (unit ? unit.fullText : ""),
          next_ayah_text: nextAyah ? nextAyah.t.split(/\s+/).slice(0, 15).join(" ") : ""
        };
      }
    }

    const canonicalState = {
      source_type: det.sourceType || "HADITH", // "QURAN" | "HADITH" | "ADHKAR"
      candidate_reference: det.displayRef || det.reference || "",
      canonical_corpus_text: det.canonicalText || matchedTranscriptSpan,
      context_before: contextBefore,
      matched_span_in_lecture: matchedTranscriptSpan,
      context_after: contextAfter,
      unmatched_corpus_prefix_words: unmatchedPrefix,
      immediate_transcript_before: immediateBefore,
      unmatched_corpus_suffix_words: unmatchedSuffix,
      immediate_transcript_after: immediateAfter,
      quran_neighboring_context: quranNeighbors,
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

    return { state: canonicalState, questions: canonicalQuestions, merge: buildMergeContext(det, words) };
  }

  // ---------------------------------------------------------------------------
  // 1a. Merge Context (one quotation the engine split into neighbouring findings)
  // Sent only to prompt-capable providers and only when a neighbour is close,
  // so the canonical envelope (and Laya's fixed questions) stay untouched.
  // ---------------------------------------------------------------------------

  const MERGE_MAX_GAP_WORDS = 12;

  function clipWords(text, n) {
    const w = String(text || "").split(/\s+/).filter(Boolean);
    return w.length > n ? w.slice(0, n).join(" ") + " …" : w.join(" ");
  }

  /** The findings right before and after `det` in transcript order, if no more than `maxGap` words away. */
  function findNeighborFindings(det, detections = currentState.detections || [], maxGap = MERGE_MAX_GAP_WORDS) {
    const sorted = detections
      .filter(d => typeof d.wordStartIdx === "number" && typeof d.wordEndIdx === "number")
      .slice()
      .sort((a, b) => a.wordStartIdx - b.wordStartIdx);
    const pos = sorted.indexOf(det);
    if (pos < 0) return { previous: null, next: null };
    const previous = sorted[pos - 1] || null;
    const next = sorted[pos + 1] || null;
    const gapTo = (a, b) => Math.max(0, b.wordStartIdx - a.wordEndIdx - 1);
    return {
      previous: previous && gapTo(previous, det) <= maxGap ? previous : null,
      next: next && gapTo(det, next) <= maxGap ? next : null
    };
  }

  function describeNeighbor(det, nb, direction, words) {
    const gapStart = direction === "previous" ? nb.wordEndIdx + 1 : det.wordEndIdx + 1;
    const gapEnd = direction === "previous" ? det.wordStartIdx : nb.wordStartIdx;
    const span = (words || []).slice(nb.wordStartIdx, nb.wordEndIdx + 1).map(w => w.word).join(" ") || nb.matchedText || "";
    return {
      source_type: nb.sourceType || "HADITH",
      candidate_reference: nb.displayRef || nb.reference || "",
      same_reference_as_current: Boolean(det.unitId && nb.unitId === det.unitId),
      gap_word_count: Math.max(0, gapEnd - gapStart),
      gap_transcript_text: (words || []).slice(gapStart, Math.max(gapStart, gapEnd)).map(w => w.word).join(" "),
      neighbor_span_in_lecture: clipWords(span, 30),
      neighbor_canonical_corpus_text: clipWords(nb.canonicalText || "", 40)
    };
  }

  function buildMergeContext(det, words) {
    const { previous, next } = findNeighborFindings(det);
    if (!previous && !next) return null;

    const criteria = {
      NO_MERGE: "This finding is a separate quotation (or the neighbour is a different text, or the gap is unrelated speech)."
    };
    if (previous) criteria.MERGE_WITH_PREVIOUS = "This finding and the `previous` neighbour are parts of the same quotation.";
    if (next) criteria.MERGE_WITH_NEXT = "This finding and the `next` neighbour are parts of the same quotation.";
    if (previous && next) criteria.MERGE_BOTH = "The `previous` neighbour, this finding and the `next` neighbour are all parts of the same quotation.";

    return {
      neighborIds: { previous: previous ? previous.id : null, next: next ? next.id : null },
      neighbors: {
        previous: previous ? describeNeighbor(det, previous, "previous", words) : null,
        next: next ? describeNeighbor(det, next, "next", words) : null
      },
      questions: {
        merge_suggestion: {
          type: "choice",
          instructions:
            "`neighbor_findings` lists the engine findings immediately before (`previous`) and/or after (`next`) this one, with the transcript words between them (`gap_transcript_text`). " +
            "The engine often splits ONE quotation into separate findings when an ASR typo, a garbled or missing word, or a short repetition breaks the match; a neighbour may even be linked to a different reference. " +
            "Decide, independently of `verdict`, whether this finding and a neighbour are consecutive parts of the same quoted text (compare the spans and the corpus texts) and should be one finding. " +
            "Do not merge two different texts quoted one after the other.",
          criteria
        },
        merge_gap_type: {
          type: "choice",
          instructions: "Only meaningful when you suggest a merge: what are the words in `gap_transcript_text` between the parts?",
          criteria: {
            PART_OF_QUOTE: "The gap is empty, or it is mis-transcribed / garbled / repeated words of the quoted text itself.",
            COMMENTARY: "The gap is the speaker's own interjection or explanation between two parts of the same quotation."
          }
        }
      }
    };
  }

  /** Reads a provider's merge answer into { previous, next, confidence, gapType }, or null for no merge. */
  function normalizeMergeSuggestion(choice, confidence, gapType, merge) {
    if (!merge || !choice) return null;
    const c = String(choice).toUpperCase();
    const previous = Boolean(merge.neighborIds.previous) && (c === "MERGE_WITH_PREVIOUS" || c === "MERGE_BOTH");
    const next = Boolean(merge.neighborIds.next) && (c === "MERGE_WITH_NEXT" || c === "MERGE_BOTH");
    if (!previous && !next) return null;
    return {
      previous,
      next,
      previousId: merge.neighborIds.previous,
      nextId: merge.neighborIds.next,
      confidence: typeof confidence === "number" ? confidence : 0.75,
      gapType: String(gapType || "").toUpperCase() === "COMMENTARY" ? "COMMENTARY" : "PART_OF_QUOTE"
    };
  }

  // ---------------------------------------------------------------------------
  // 1b. User Prompt Configuration (presets, rules, extra instructions)
  // Applied on top of the canonical envelope at request time only; the
  // canonical envelope stays untouched so Laya training records stay stable.
  // ---------------------------------------------------------------------------

  const DEFAULT_SYSTEM_PROMPTS = {
    gemini:
      "أنت مدقق شرعي ولغوي خبير في تفريغ المحاضرات الإسلامية. " +
      "مهمتك التمييز بدقة بين الاقتباس الفعلي (آية أو حديث نبوي أو ذكر) " +
      "وبين الكلام العادي للشيخ الشارح الذي تتشابه كلماته لفظياً مع الحديث أو الآية.",
    openrouter_chat:
      "You are an expert Arabic Islamic text verifier. " +
      "Given the JSON `state` and `questions`, determine whether `matched_span_in_lecture` is a genuine quotation or ordinary speech, and determine boundary status."
  };

  const CHAT_OUTPUT_CONTRACT =
    "Return ONLY a valid JSON object with keys: {\"verdict\": \"CORRECT\" | \"FALSE\" | \"NOT_SURE\", \"confidence\": 0.0-1.0, \"probabilities\": {\"CORRECT\": p1, \"FALSE\": p2, \"NOT_SURE\": p3}, \"boundary_status\": \"COMPLETE_SPAN\" | \"MISSING_START\" | \"MISSING_END\" | \"MISSING_BOTH\", \"boundary_confidence\": 0.0-1.0, \"reason\": \"concise explanation\"}. " +
    "If `questions` contains `merge_suggestion`, also include \"merge_suggestion\" (one of its criteria keys), \"merge_confidence\": 0.0-1.0 and \"merge_gap_type\": \"PART_OF_QUOTE\" | \"COMMENTARY\".";

  const PROMPT_PRESETS = {
    balanced: {
      label: "⚖️ متوازن",
      hint: "الإعداد الافتراضي: يقبل الاقتباس الحرفي والاستشهاد الواضح، ويستبعد الكلام العادي.",
      verdictAddendum: "",
      criteria: {}
    },
    strict: {
      label: "🎯 صارم",
      hint: "لا يقبل إلا التلاوة أو الرواية الحرفية الصريحة. مناسب حين تكثر الإيجابيات الكاذبة.",
      verdictAddendum: "Be strict: only accept verbatim (or near-verbatim, allowing ASR noise) recitation of the corpus text that the speaker clearly presents as a quotation.",
      criteria: {
        CORRECT: "The speaker recites the corpus text verbatim (allowing only ASR spelling noise) and clearly presents it as a quotation.",
        NOT_SURE: "Use only when the audio transcript is too garbled to decide; paraphrases and allusions are FALSE in strict mode."
      }
    },
    lenient: {
      label: "🤲 متساهل",
      hint: "يقبل الاقتباس بالمعنى والإشارة الواضحة للنص. مناسب حين يفوتك اقتباسات حقيقية.",
      verdictAddendum: "Be lenient: a clear paraphrase or partial quotation that unmistakably points to this specific text counts as a citation.",
      criteria: {
        CORRECT: "The speaker quotes this text verbatim, partially, or as a clear paraphrase that unmistakably refers to this specific Ayah, Hadith, or Dhikr.",
        NOT_SURE: "Only when it is genuinely unclear whether the speaker is referring to this specific text at all."
      }
    },
    boundaries: {
      label: "✂️ تركيز على الحدود",
      hint: "متوازن في الحكم، لكن يدقق بشدة في الكلمات المقطوعة من بداية المقتبس ونهايته.",
      verdictAddendum: "",
      criteria: {},
      boundaryAddendum: "Pay special attention to boundaries: scan `immediate_transcript_before` and `immediate_transcript_after` word by word for any words of `unmatched_corpus_prefix_words` / `unmatched_corpus_suffix_words`, tolerating ASR spelling errors and missing diacritics."
    }
  };

  const PROMPT_RULES = {
    ignoreAsrErrors: {
      label: "تجاهل أخطاء التفريغ الصوتي",
      hint: "الفروق الإملائية والتشكيل الناتجة عن التعرف على الكلام لا تُعد اختلافاً.",
      text: "The transcript comes from speech recognition: treat spelling differences, missing diacritics, merged or split words as matches, not as differences."
    },
    citationCues: {
      label: "صيغ الإسناد دليل قوي",
      hint: "«قال تعالى»، «قال رسول الله ﷺ»، «في الحديث» قبل النص ترجّح أنه اقتباس.",
      text: "Introductory cues in `context_before` such as «قال تعالى», «قال الله», «قال رسول الله ﷺ», «في الحديث», «يقول النبي» are strong evidence of a genuine quotation."
    },
    narratorNames: {
      label: "أسماء الرواة وحدها ليست اقتباساً",
      hint: "ذكر «عن أبي هريرة» أو اسم صحابي دون متن الحديث يُعد كلاماً عادياً.",
      text: "A span consisting only of narrator chains or names (e.g. «عن أبي هريرة رضي الله عنه») without the actual text of the hadith is FALSE."
    },
    explainingRepeat: {
      label: "تكرار كلمة أثناء الشرح كلام عادي",
      hint: "إذا أعاد الشيخ كلمة أو كلمتين من الآية ليشرحها فليس ذلك اقتباساً جديداً.",
      text: "When the speaker repeats one or two words of the text in order to explain them (e.g. «قوله: الرحمن، أي...»), treat it as ordinary explanation (FALSE) unless a fuller recitation is present."
    },
    preferNotSure: {
      label: "عند الشك: «غير متأكد»",
      hint: "يفضل النموذج «غير متأكد» بدل التخمين، فتراجعه أنت يدوياً.",
      text: "If the evidence is genuinely mixed, answer NOT_SURE rather than guessing."
    },
    suggestMerges: {
      label: "اقتراح دمج المقتبسات المجزأة",
      hint: "يرسل المقتبس المجاور (حتى 12 كلمة) ليقترح النموذج دمج حديث قسّمه المحرك بسبب خطأ تفريغ أو تعليق.",
      text: ""   // adds the merge_suggestion question instead of prompt text
    }
  };

  const DEFAULT_PROMPT_CONFIG = {
    preset: "balanced",
    rules: { ignoreAsrErrors: true, citationCues: true, narratorNames: false, explainingRepeat: false, preferNotSure: false, suggestMerges: true },
    reasonLang: "ar",          // "ar" | "en"
    reasonDetail: "brief",     // "brief" | "detailed"
    extraInstructions: "",
    systemPromptOverride: "",
    temperature: 0.1
  };

  function getPromptConfig() {
    const saved = currentState.aiVerification.promptConfig || {};
    return Object.assign({}, DEFAULT_PROMPT_CONFIG, saved, {
      rules: Object.assign({}, DEFAULT_PROMPT_CONFIG.rules, saved.rules || {})
    });
  }

  function providerSupportsPrompt(provider) {
    // Laya is a fine-tuned local classifier trained on the fixed canonical questions
    return provider !== "local_laya";
  }

  function composeQuestions(baseQuestions, provider) {
    if (!providerSupportsPrompt(provider)) return baseQuestions;
    const cfg = getPromptConfig();
    const preset = PROMPT_PRESETS[cfg.preset] || PROMPT_PRESETS.balanced;
    const q = JSON.parse(JSON.stringify(baseQuestions));

    const guidance = [];
    if (preset.verdictAddendum) guidance.push(preset.verdictAddendum);
    Object.keys(PROMPT_RULES).forEach(k => {
      if (cfg.rules[k] && PROMPT_RULES[k].text) guidance.push(PROMPT_RULES[k].text);
    });
    const extra = (cfg.extraInstructions || "").trim();
    if (extra) guidance.push(extra);

    if (guidance.length) {
      q.verdict.instructions += "\n\nAdditional guidance:\n" + guidance.map(g => `- ${g}`).join("\n");
    }
    Object.assign(q.verdict.criteria, preset.criteria || {});
    if (preset.boundaryAddendum) {
      q.boundary_status.instructions += "\n\n" + preset.boundaryAddendum;
    }
    return q;
  }

  /** The state + questions actually sent: the canonical envelope plus the merge question when it applies. */
  function composeRequestEnvelope(item, provider) {
    const questions = composeQuestions(item.envelope.questions, provider);
    const merge = item.envelope.merge;
    if (!merge || !providerSupportsPrompt(provider) || !getPromptConfig().rules.suggestMerges) {
      return { state: item.envelope.state, questions };
    }
    return {
      state: Object.assign({}, item.envelope.state, { neighbor_findings: merge.neighbors }),
      questions: Object.assign({}, questions, merge.questions)
    };
  }

  function composeSystemPrompt(provider) {
    const cfg = getPromptConfig();
    const base = (cfg.systemPromptOverride || "").trim() || DEFAULT_SYSTEM_PROMPTS[provider] || "";
    const lang = cfg.reasonLang === "en" ? "English" : "Arabic";
    const detail = cfg.reasonDetail === "detailed"
      ? "2-3 sentences citing the specific words that decided it"
      : "one short sentence";
    return `${base}\n\nWrite the \`reason\` field in ${lang}, ${detail}.`;
  }

  function getPromptTemperature() {
    const t = Number(getPromptConfig().temperature);
    return isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.1;
  }

  function findingIdOf(item) {
    return item.det.id || item.det._uniqueKey || `f_${item.index}`;
  }

  function normalizeBoundaryVerdict(verdict, bStatus, state) {
    if (verdict === "FALSE") return "COMPLETE_SPAN";
    let s = bStatus || "COMPLETE_SPAN";
    const hasPrefix = Boolean(state?.unmatched_corpus_prefix_words && String(state.unmatched_corpus_prefix_words).trim().length > 0);
    const hasSuffix = Boolean(state?.unmatched_corpus_suffix_words && String(state.unmatched_corpus_suffix_words).trim().length > 0);

    if (!hasPrefix && (s === "MISSING_START" || s === "MISSING_BOTH")) {
      s = (s === "MISSING_BOTH") ? "MISSING_END" : "COMPLETE_SPAN";
    }
    if (!hasSuffix && (s === "MISSING_END" || s === "MISSING_BOTH")) {
      s = (s === "MISSING_BOTH") ? "MISSING_START" : "COMPLETE_SPAN";
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // 2. Token-Bucket & RPM Pacer for Gemini Free Tier
  // ---------------------------------------------------------------------------

  function pruneGeminiWindow() {
    const now = Date.now();
    while (geminiRequestTimestamps.length && geminiRequestTimestamps[0] <= now - 60000) {
      geminiRequestTimestamps.shift();
    }
  }

  async function paceGeminiRequest(onCountdown) {
    if (!currentState.aiVerification.geminiFreeTierMode) return;
    const limit = currentState.aiVerification.geminiRpmLimit || 12;

    while (true) {
      if (isVerificationCancelled) throw new Error("VERIFICATION_CANCELLED");
      pruneGeminiWindow();
      if (geminiRequestTimestamps.length < limit) {
        geminiRequestTimestamps.push(Date.now());
        return;
      }
      const oldest = geminiRequestTimestamps[0];
      const waitMs = Math.max(500, oldest + 60000 - Date.now() + 500);
      const waitSec = Math.ceil(waitMs / 1000);
      if (typeof onCountdown === "function") {
        onCountdown(waitSec);
      }
      await new Promise(res => setTimeout(res, Math.min(1000, waitMs)));
    }
  }

  async function waitIfPaused() {
    while (isVerificationPaused) {
      if (isVerificationCancelled) throw new Error("VERIFICATION_CANCELLED");
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Provider 1: Google Gemini (gemini-3.5-flash-lite)
  // ---------------------------------------------------------------------------

  function buildGeminiRequestBody(batchItems) {
    const batchInput = batchItems.map(item => Object.assign({ finding_id: findingIdOf(item) }, composeRequestEnvelope(item, "gemini")));
    const systemPrompt = composeSystemPrompt("gemini");

    const userPrompt =
      "Given the following candidate citations extracted by the transcription engine, " +
      "evaluate each item against the instructions and criteria in `questions`. " +
      "Return ONLY a JSON array of evaluations corresponding to the input items. " +
      "Answer `merge_suggestion` / `merge_gap_type` only for items whose `questions` contain them (otherwise use NO_MERGE).\n\n" +
      JSON.stringify(batchInput, null, 2);

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: getPromptTemperature(),
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              finding_id: { type: "STRING" },
              verdict: { type: "STRING", enum: ["CORRECT", "FALSE", "NOT_SURE"] },
              confidence: { type: "NUMBER" },
              probabilities: {
                type: "OBJECT",
                properties: {
                  CORRECT: { type: "NUMBER" },
                  FALSE: { type: "NUMBER" },
                  NOT_SURE: { type: "NUMBER" }
                },
                required: ["CORRECT", "FALSE", "NOT_SURE"]
              },
              boundary_status: {
                type: "STRING",
                enum: ["COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"]
              },
              boundary_confidence: { type: "NUMBER" },
              merge_suggestion: {
                type: "STRING",
                enum: ["NO_MERGE", "MERGE_WITH_PREVIOUS", "MERGE_WITH_NEXT", "MERGE_BOTH"]
              },
              merge_confidence: { type: "NUMBER" },
              merge_gap_type: { type: "STRING", enum: ["PART_OF_QUOTE", "COMMENTARY"] },
              reason: { type: "STRING" }
            },
            required: ["finding_id", "verdict", "confidence", "probabilities", "boundary_status", "reason"]
          }
        }
      }
    };
    return requestBody;
  }

  async function callGeminiApi(batchItems, onCountdown) {
    const apiKey = (currentState.aiVerification.geminiApiKey || "").trim();
    if (!apiKey) {
      throw new Error("يرجى إدخال مفتاح Google Gemini API Key في إعدادات التدقيق الذكي.");
    }

    const model = (currentState.aiVerification.geminiModel || "gemini-3.5-flash-lite").trim();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const requestBody = buildGeminiRequestBody(batchItems);

    let retries = 0;
    const maxRetries = 4;
    const retryDelays = [5000, 15000, 35000, 65000];

    while (retries <= maxRetries) {
      await waitIfPaused();
      await paceGeminiRequest(onCountdown);

      const t0 = performance.now();
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });
      } catch (networkErr) {
        if (retries < maxRetries) {
          retries++;
          const d = retryDelays[retries - 1];
          if (onCountdown) onCountdown(Math.ceil(d / 1000), `خطأ اتصال، إعادة المحاولة...`);
          await new Promise(r => setTimeout(r, d));
          continue;
        }
        throw new Error(`فشل الاتصال بخادم Gemini API: ${networkErr.message}`);
      }

      const elapsedMs = Math.round(performance.now() - t0);

      if (response.status === 429 || response.status === 503) {
        // Handle Rate Limit Backoff
        let delayMs = retryDelays[Math.min(retries, retryDelays.length - 1)];
        try {
          const errData = await response.json();
          // Check for RetryInfo
          if (errData?.error?.details) {
            const rInfo = errData.error.details.find(d => d["@type"]?.includes("RetryInfo"));
            if (rInfo && rInfo.retryDelay) {
              const seconds = parseFloat(rInfo.retryDelay.replace("s", "")) || 20;
              delayMs = Math.round((seconds + 1.5) * 1000);
            }
          }
        } catch (_) {}

        retries++;
        if (retries <= maxRetries) {
          if (onCountdown) onCountdown(Math.ceil(delayMs / 1000), `تم بلوغ حد الطلبات (429). جاري الانتظار قبل إعادة المحاولة...`);
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        } else {
          throw new Error(`تم تجاوز حد الطلبات المسموح (HTTP 429 Resource Exhausted) بعد ${maxRetries} محاولات.`);
        }
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`رفض خادم Gemini API الطلب (HTTP ${response.status}): ${errText.slice(0, 300)}`);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      let parsedResults = [];
      try {
        parsedResults = JSON.parse(rawText);
        if (!Array.isArray(parsedResults)) parsedResults = [parsedResults];
      } catch (parseErr) {
        throw new Error(`تعذر تحليل استجابة JSON من Gemini: ${parseErr.message}`);
      }

      const usage = data.usageMetadata || {};
      const inTokens = usage.promptTokenCount || 0;
      const outTokens = usage.candidatesTokenCount || 0;

      // Price calculation for Gemini 3.5 Flash-Lite: $0.30/1M input, $2.50/1M output
      const costRateIn = model.includes("3.5-flash-lite") ? 0.00000030 : 0.00000015;
      const costRateOut = model.includes("3.5-flash-lite") ? 0.00000250 : 0.00000060;
      const shadowCost = (inTokens * costRateIn) + (outTokens * costRateOut);
      const effectiveCost = currentState.aiVerification.geminiFreeTierMode ? 0.0 : shadowCost;

      return {
        results: parsedResults,
        latencyMs: elapsedMs,
        model: model,
        provider: "gemini",
        inputTokens: inTokens,
        outputTokens: outTokens,
        costUsd: effectiveCost,
        shadowCostUsd: shadowCost,
        rawResponse: data,
        requestPayload: requestBody
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Provider 2: OpenRouter JEV Mode (Decisions API)
  // ---------------------------------------------------------------------------

  function buildJevPayload(item) {
    return Object.assign(
      { model: (currentState.aiVerification.openRouterJevModel || "typesafe/jev-1.14").trim() },
      composeRequestEnvelope(item, "openrouter_jev")
    );
  }

  async function callOpenRouterJev(item) {
    const apiKey = (currentState.aiVerification.openRouterApiKey || "").trim();
    if (!apiKey) {
      throw new Error("يرجى إدخال مفتاح OpenRouter API Key في إعدادات التدقيق الذكي.");
    }

    const payload = buildJevPayload(item);
    const model = payload.model;

    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://wahy-transcriber.local",
      "X-Title": "Wahy Transcriber JEV Verifier"
    };

    await waitIfPaused();
    const t0 = performance.now();
    let response;

    // Try backend proxy first to avoid browser CORS, fallback to direct
    try {
      response = await fetch("/api/openrouter/decisions", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });
    } catch (_) {
      response = null;
    }

    if (!response || response.status === 404 || response.status === 502 || response.status === 504) {
      try {
        const directResp = await fetch("https://openrouter.ai/api/alpha/decisions", {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload)
        });
        if (directResp) response = directResp;
      } catch (_) {
        // Direct fetch failed (e.g. CORS), keep proxy response to report original message
      }
    }

    const elapsedMs = Math.round(performance.now() - t0);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`خطأ OpenRouter JEV (HTTP ${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const verdictAnswer = data?.answers?.verdict || {};
    const choice = verdictAnswer.choice || "NOT_SURE";
    const confidence = typeof verdictAnswer.confidence === "number" ? verdictAnswer.confidence : 0.85;
    const probabilities = verdictAnswer.probabilities || {
      CORRECT: choice === "CORRECT" ? confidence : 0.05,
      FALSE: choice === "FALSE" ? confidence : 0.05,
      NOT_SURE: choice === "NOT_SURE" ? confidence : 0.05
    };

    const bAns = data?.answers?.boundary_status || {};
    const rawBStatus = bAns.choice || "COMPLETE_SPAN";
    const bConf = typeof bAns.confidence === "number" ? bAns.confidence : 0.85;
    const bProbs = bAns.probabilities || null;
    const finalBStatus = normalizeBoundaryVerdict(choice, rawBStatus, payload.state);

    const usage = data.usage || {};
    const inTokens = usage.input_tokens || Math.max(20, Math.round(JSON.stringify(payload.state).length / 3));
    const outTokens = usage.output_tokens || 0;
    const costUsd = typeof usage.cost === "number" ? usage.cost : (inTokens * 0.000000042);

    return {
      results: [{
        finding_id: item.det.id || item.det._uniqueKey || `f_${item.index}`,
        verdict: choice,
        confidence: confidence,
        probabilities: probabilities,
        boundary_status: finalBStatus,
        boundary_confidence: bConf,
        boundary_probabilities: bProbs,
        merge_suggestion: data?.answers?.merge_suggestion?.choice,
        merge_confidence: data?.answers?.merge_suggestion?.confidence,
        merge_gap_type: data?.answers?.merge_gap_type?.choice,
        reason: "قرار System-1 من نموذج JEV المصاغ بالاحتمالات المعايرة."
      }],
      latencyMs: elapsedMs,
      model: data.model || model,
      provider: "openrouter_jev",
      inputTokens: inTokens,
      outputTokens: outTokens,
      costUsd: costUsd,
      rawResponse: data,
      requestPayload: payload
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Provider 3: OpenRouter Universal Search & Chat Mode
  // ---------------------------------------------------------------------------

  async function fetchOpenRouterModelsCatalog(force = false) {
    if (currentState.aiVerification.openRouterModelsCatalog.length > 0 && !force) {
      return currentState.aiVerification.openRouterModelsCatalog;
    }
    if (isFetchingCatalog) return currentState.aiVerification.openRouterModelsCatalog;

    isFetchingCatalog = true;
    try {
      const cached = sessionStorage.getItem("wahy_openrouter_catalog");
      if (cached && !force) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          currentState.aiVerification.openRouterModelsCatalog = parsed;
          isFetchingCatalog = false;
          return parsed;
        }
      }

      const res = await fetch("https://openrouter.ai/api/v1/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const models = (json.data || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || 0,
        pricing: {
          prompt: m.pricing?.prompt || "0",
          completion: m.pricing?.completion || "0"
        },
        description: m.description || "",
        supportedParameters: Array.isArray(m.supported_parameters) ? m.supported_parameters : null,
        isFree: parseFloat(m.pricing?.prompt || "0") === 0 || m.id.endsWith(":free"),
        isJev: m.id.includes("jev") || m.id.includes("decider") || m.id.includes("liquid/d1"),
        isGemini: m.id.includes("gemini"),
        isChinese: m.id.includes("deepseek") || m.id.includes("qwen") || m.id.includes("glm")
      }));

      currentState.aiVerification.openRouterModelsCatalog = models;
      sessionStorage.setItem("wahy_openrouter_catalog", JSON.stringify(models));
      return models;
    } catch (e) {
      console.warn("Failed to fetch OpenRouter model catalog:", e);
      return currentState.aiVerification.openRouterModelsCatalog;
    } finally {
      isFetchingCatalog = false;
    }
  }

  const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

  /** OpenRouter IDs are "provider/model"; a bare Gemini name (as used by Google's direct API) 404s. */
  function normalizeOpenRouterModelId(id) {
    const m = String(id || "").trim() || "deepseek/deepseek-chat";
    return /^gemini-/i.test(m) ? `google/${m}` : m;
  }

  /** false only when the catalog says the model has no JSON mode; unknown (no catalog yet) → true. */
  function modelSupportsJsonMode(modelId) {
    const meta = (currentState.aiVerification.openRouterModelsCatalog || []).find(m => m.id === modelId);
    if (!meta || !Array.isArray(meta.supportedParameters)) return true;
    return meta.supportedParameters.includes("response_format") || meta.supportedParameters.includes("structured_outputs");
  }

  /**
   * Fails fast, before any finding is sent, when the chosen model is not on OpenRouter
   * (otherwise every finding of the batch gets the same 404).
   */
  async function assertOpenRouterChatModelExists() {
    const modelId = normalizeOpenRouterModelId(currentState.aiVerification.openRouterSelectedModel);
    if (/typesafe\/jev/.test(modelId)) return;
    const catalog = await fetchOpenRouterModelsCatalog();
    if (!catalog.length || catalog.some(m => m.id === modelId)) return;   // catalog unreachable: let the request decide
    const key = modelId.split("/").pop().split(":")[0].toLowerCase();
    const close = catalog.filter(m => m.id.toLowerCase().includes(key)).slice(0, 4).map(m => m.id);
    throw new Error(`النموذج «${modelId}» غير موجود على OpenRouter.` +
      (close.length ? ` هل تقصد: ${close.join("، ")}؟` : " اختر نموذجاً من قائمة البحث في إعدادات OpenRouter."));
  }

  /** An error whose cause is the same for every finding (bad key, unknown model, no credits): the batch stops. */
  function fatalError(message) {
    const err = new Error(message);
    err.fatal = true;
    return err;
  }

  function describeOpenRouterError(status, bodyText, modelId) {
    let msg = bodyText || "";
    try { msg = JSON.parse(bodyText)?.error?.message || msg; } catch (_) {}
    msg = String(msg).slice(0, 300);
    const lower = msg.toLowerCase();
    if (status === 401) return fatalError(`مفتاح OpenRouter غير صالح أو منتهي (401): ${msg}`);
    if (status === 402) return fatalError(`رصيد OpenRouter أو حد المفتاح غير كافٍ لهذا النموذج (402) — اشحن الرصيد، أو ارفع حد المفتاح من إعدادات OpenRouter، أو اختر نموذجاً أرخص: ${msg}`);
    if (status === 403) return fatalError(`رفض OpenRouter الطلب (403) — قد يكون النموذج محظوراً على حسابك أو المحتوى مرفوضاً: ${msg}`);
    if (status === 404) {
      if (lower.includes("data policy") || lower.includes("privacy") || lower.includes("guardrail")) {
        return fatalError(`لا يوجد مزوّد متاح للنموذج «${modelId}» بإعدادات الخصوصية في حسابك — فعّل المزوّدين من openrouter.ai/settings/privacy (404): ${msg}`);
      }
      return fatalError(`النموذج «${modelId}» غير متاح على OpenRouter (404): ${msg}`);
    }
    return new Error(`خطأ OpenRouter (${status}) — ${modelId}: ${msg}`);
  }

  /** The JSON object in a model reply: plain, inside ```json fences, or surrounded by prose. */
  function parseModelJson(text) {
    const t = String(text || "").trim();
    const attempts = [t];
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) attempts.push(fenced[1]);
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) attempts.push(t.slice(a, b + 1));
    for (const candidate of attempts) {
      try {
        const v = JSON.parse(candidate);
        if (v && typeof v === "object") return Array.isArray(v) ? v[0] : v;
      } catch (_) {}
    }
    return null;
  }

  const VERDICT_ALIASES = { TRUE: "CORRECT", YES: "CORRECT", QUOTE: "CORRECT", NO: "FALSE", INCORRECT: "FALSE", UNSURE: "NOT_SURE", UNCERTAIN: "NOT_SURE", "NOT SURE": "NOT_SURE" };

  function normalizeVerdict(v) {
    const u = String(v || "").trim().toUpperCase();
    if (u === "CORRECT" || u === "FALSE" || u === "NOT_SURE") return u;
    return VERDICT_ALIASES[u] || "NOT_SURE";
  }

  // The reply is one small JSON object (~150-400 tokens). Without max_tokens OpenRouter reserves the model's whole
  // output limit up front (64k for Claude Sonnet ≈ $1) and refuses the request with 402 on a small balance.
  // The headroom covers models that think before answering; an answer cut short is retried once with more.
  const CHAT_MAX_TOKENS = 1500;
  const CHAT_MAX_TOKENS_RETRY = 4000;
  const CHAT_EXPECTED_OUTPUT_TOKENS = 300;

  function buildOpenRouterChatPayload(item, modelId, jsonMode = modelSupportsJsonMode(modelId), maxTokens = CHAT_MAX_TOKENS) {
    const payload = {
      model: modelId,
      temperature: getPromptTemperature(),
      max_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: composeSystemPrompt("openrouter_chat") + "\n\n" + CHAT_OUTPUT_CONTRACT
        },
        {
          role: "user",
          content: JSON.stringify(composeRequestEnvelope(item, "openrouter_chat"))
        }
      ]
    };
    if (jsonMode) payload.response_format = { type: "json_object" };
    return payload;
  }

  async function callOpenRouterChat(item) {
    const apiKey = (currentState.aiVerification.openRouterApiKey || "").trim();
    if (!apiKey) {
      throw fatalError("يرجى إدخال مفتاح OpenRouter API Key.");
    }

    const modelId = normalizeOpenRouterModelId(currentState.aiVerification.openRouterSelectedModel);

    // Auto-route JEV models to Decisions API if user selected a JEV model in chat search
    if (modelId.includes("typesafe/jev") || modelId.includes("~typesafe/jev")) {
      currentState.aiVerification.openRouterJevModel = modelId;
      return callOpenRouterJev(item);
    }

    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://wahy-transcriber.local",
      "X-Title": "Wahy Transcriber Universal LLM Verifier"
    };

    let jsonMode = modelSupportsJsonMode(modelId);
    let maxTokens = CHAT_MAX_TOKENS;
    let payload = buildOpenRouterChatPayload(item, modelId, jsonMode, maxTokens);
    const retryDelays = [3000, 8000, 20000];
    let attempt = 0;
    let response;
    let elapsedMs = 0;

    while (true) {
      if (isVerificationCancelled) throw new Error("VERIFICATION_CANCELLED");
      await waitIfPaused();
      const t0 = performance.now();
      try {
        response = await fetch(OPENROUTER_CHAT_URL, { method: "POST", headers, body: JSON.stringify(payload) });
      } catch (networkErr) {
        if (attempt < retryDelays.length) {
          await new Promise(r => setTimeout(r, retryDelays[attempt++]));
          continue;
        }
        throw new Error(`تعذر الاتصال بـ OpenRouter: ${networkErr.message}`);
      }
      elapsedMs = Math.round(performance.now() - t0);
      if (response.ok) break;

      const errText = await response.text();
      // A model without JSON mode can be refused for `response_format`: retry once without it
      if (jsonMode && (response.status === 400 || response.status === 404) && /response_format|json|parameter/i.test(errText)) {
        jsonMode = false;
        payload = buildOpenRouterChatPayload(item, modelId, false, maxTokens);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < retryDelays.length) {
        await new Promise(r => setTimeout(r, retryDelays[attempt++]));
        continue;
      }
      throw describeOpenRouterError(response.status, errText, modelId);
    }

    let data = await response.json();
    // OpenRouter can answer 200 with an error object (provider failure mid-stream)
    if (data?.error) {
      throw new Error(`خطأ من مزوّد النموذج عبر OpenRouter: ${String(data.error.message || JSON.stringify(data.error)).slice(0, 300)}`);
    }
    let rawContent = data?.choices?.[0]?.message?.content || "";
    let parsed = parseModelJson(rawContent);

    // Cut off by max_tokens (usually a model that spent them thinking): one retry with more room
    if (!parsed && data?.choices?.[0]?.finish_reason === "length" && maxTokens < CHAT_MAX_TOKENS_RETRY) {
      maxTokens = CHAT_MAX_TOKENS_RETRY;
      payload = buildOpenRouterChatPayload(item, modelId, jsonMode, maxTokens);
      await waitIfPaused();
      const t0 = performance.now();
      const retryResp = await fetch(OPENROUTER_CHAT_URL, { method: "POST", headers, body: JSON.stringify(payload) });
      elapsedMs += Math.round(performance.now() - t0);
      if (!retryResp.ok) throw describeOpenRouterError(retryResp.status, await retryResp.text(), modelId);
      data = await retryResp.json();
      rawContent = data?.choices?.[0]?.message?.content || "";
      parsed = parseModelJson(rawContent);
    }
    if (!parsed) {
      const finish = data?.choices?.[0]?.finish_reason;
      throw new Error(rawContent.trim()
        ? `لم يُرجع النموذج JSON صالحاً: ${rawContent.slice(0, 160)}`
        : `رد فارغ من النموذج «${modelId}»${finish ? ` (finish_reason: ${finish})` : ""} — جرّب نموذجاً آخر.`);
    }

    const verdict = normalizeVerdict(parsed.verdict);
    const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0.80;
    const probs = parsed.probabilities || {
      CORRECT: verdict === "CORRECT" ? conf : (1 - conf) / 2,
      FALSE: verdict === "FALSE" ? conf : (1 - conf) / 2,
      NOT_SURE: verdict === "NOT_SURE" ? conf : (1 - conf) / 2
    };

    const rawBStatus = String(parsed.boundary_status || "COMPLETE_SPAN").toUpperCase();
    const bConf = typeof parsed.boundary_confidence === "number" ? parsed.boundary_confidence : 0.85;
    const finalBStatus = normalizeBoundaryVerdict(verdict, rawBStatus, item.envelope.state);

    const usage = data.usage || {};
    const inTokens = usage.prompt_tokens || 0;
    const outTokens = usage.completion_tokens || 0;

    let costUsd = 0.0;
    if (typeof usage.cost === "number") {
      costUsd = usage.cost;
    } else {
      const modelMeta = currentState.aiVerification.openRouterModelsCatalog.find(m => m.id === modelId);
      if (modelMeta) {
        costUsd = (inTokens * parseFloat(modelMeta.pricing.prompt || 0)) +
                  (outTokens * parseFloat(modelMeta.pricing.completion || 0));
      }
    }

    return {
      results: [{
        finding_id: item.det.id || item.det._uniqueKey || `f_${item.index}`,
        verdict: verdict,
        confidence: conf,
        probabilities: probs,
        boundary_status: finalBStatus,
        boundary_confidence: bConf,
        merge_suggestion: parsed.merge_suggestion,
        merge_confidence: parsed.merge_confidence,
        merge_gap_type: parsed.merge_gap_type,
        reason: parsed.reason || "تدقيق بواسطة نموذج OpenRouter."
      }],
      latencyMs: elapsedMs,
      model: data.model || modelId,
      provider: "openrouter_chat",
      inputTokens: inTokens,
      outputTokens: outTokens,
      costUsd: costUsd,
      rawResponse: data,
      requestPayload: payload
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Provider 4: Local Laya Engine (GTX 1050 3GB VRAM)
  // ---------------------------------------------------------------------------

  // Laya is trained without the engine's own score/band (they differ per engine and would become a shortcut);
  // keep this list in sync with ENGINE_STATE_KEYS in backend/laya_datagen/export.py
  const LAYA_HIDDEN_STATE_KEYS = ["engine_score", "engine_confidence_band"];
  function layaState(state) {
    const s = Object.assign({}, state);
    LAYA_HIDDEN_STATE_KEYS.forEach(k => delete s[k]);
    return s;
  }

  function buildLayaPayload(items) {
    if (items.length === 1) {
      return { state: layaState(items[0].envelope.state), questions: items[0].envelope.questions, max_len: 1024 };
    }
    return {
      items: items.map(it => ({ finding_id: findingIdOf(it), state: layaState(it.envelope.state), questions: it.envelope.questions })),
      max_len: 1024
    };
  }

  async function callLocalLaya(items) {
    await waitIfPaused();
    const t0 = performance.now();

    // Support single item or batch
    const isSingle = items.length === 1;
    const requestPayload = buildLayaPayload(items);

    const res = await fetch("/api/laya/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });

    const elapsedMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`خطأ في خادم Laya المحلي (HTTP ${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    let results = [];

    if (isSingle) {
      const answers = data.answers?.verdict || {};
      const choice = answers.choice || "NOT_SURE";
      const confidence = answers.confidence || 0.85;
      const probabilities = answers.probabilities || {
        CORRECT: choice === "CORRECT" ? confidence : 0.05,
        FALSE: choice === "FALSE" ? confidence : 0.05,
        NOT_SURE: choice === "NOT_SURE" ? confidence : 0.05
      };

      const bAns = data.answers?.boundary_status || {};
      const rawBStatus = bAns.choice || "COMPLETE_SPAN";
      const bConf = typeof bAns.confidence === "number" ? bAns.confidence : 0.85;
      const bProbs = bAns.probabilities || null;
      const finalBStatus = normalizeBoundaryVerdict(choice, rawBStatus, items[0].envelope.state);

      results.push({
        finding_id: items[0].det.id || items[0].det._uniqueKey || `f_${items[0].index}`,
        verdict: choice,
        confidence: confidence,
        probabilities: probabilities,
        boundary_status: finalBStatus,
        boundary_confidence: bConf,
        boundary_probabilities: bProbs,
        reason: `استدلال محلي فائق السرعة عبر Laya-Multilingual (${data.device || "GPU"}).`
      });
    } else {
      for (const itemRes of data.items || []) {
        const answers = itemRes.answers?.verdict || {};
        const choice = answers.choice || "NOT_SURE";
        const confidence = answers.confidence || 0.85;
        const probabilities = answers.probabilities || {
          CORRECT: choice === "CORRECT" ? confidence : 0.05,
          FALSE: choice === "FALSE" ? confidence : 0.05,
          NOT_SURE: choice === "NOT_SURE" ? confidence : 0.05
        };

        const bAns = itemRes.answers?.boundary_status || {};
        const rawBStatus = bAns.choice || "COMPLETE_SPAN";
        const bConf = typeof bAns.confidence === "number" ? bAns.confidence : 0.85;
        const bProbs = bAns.probabilities || null;
        const targetState = items.find(it => (it.det.id || it.det._uniqueKey || `f_${it.index}`) === itemRes.finding_id)?.envelope?.state;
        const finalBStatus = normalizeBoundaryVerdict(choice, rawBStatus, targetState);

        results.push({
          finding_id: itemRes.finding_id,
          verdict: choice,
          confidence: confidence,
          probabilities: probabilities,
          boundary_status: finalBStatus,
          boundary_confidence: bConf,
          boundary_probabilities: bProbs,
          reason: `استدلال محلي فائق السرعة عبر Laya-Multilingual (${itemRes.device || "GPU"}).`
        });
      }
    }

    const approxInTokens = items.reduce((acc, it) => acc + (it.envelope.state.canonical_corpus_text.length / 3), 0);

    return {
      results: results,
      latencyMs: elapsedMs,
      model: data.model || "convaiinnovations/laya-multilingual",
      provider: "local_laya",
      inputTokens: Math.round(approxInTokens),
      outputTokens: 0,
      costUsd: 0.0,
      rawResponse: data,
      requestPayload: requestPayload
    };
  }

  // ---------------------------------------------------------------------------
  // 7. Telemetry & Metrics Aggregator
  // ---------------------------------------------------------------------------

  function updateAiVerificationMetrics() {
    const logs = currentState.aiVerification.requestLogs || [];
    const detections = currentState.detections || [];

    let totalReq = logs.length;
    let successReq = 0;
    let failedReq = 0;
    let cumulativeLatency = 0;
    let totalInTokens = 0;
    let totalOutTokens = 0;
    let totalChars = 0;
    let totalCost = 0.0;

    logs.forEach(log => {
      if (log.status === "SUCCESS") {
        successReq++;
        cumulativeLatency += (log.latencyMs || 0);
        totalInTokens += (log.inputTokens || 0);
        totalOutTokens += (log.outputTokens || 0);
        totalChars += (log.contextChars || 0);
        totalCost += (log.costUsd || 0);
      } else {
        failedReq++;
      }
    });

    const verdicts = { CORRECT: 0, FALSE: 0, NOT_SURE: 0 };
    let evaluatedCount = 0;
    let clippedCount = 0;

    detections.forEach(det => {
      if (det.aiVerification && det.aiVerification.status === "VERIFIED") {
        evaluatedCount++;
        const v = det.aiVerification.verdict;
        if (verdicts[v] !== undefined) verdicts[v]++;
        if (det.aiVerification.boundaryStatus && det.aiVerification.boundaryStatus !== "COMPLETE_SPAN" && v !== "FALSE") {
          clippedCount++;
        }
      }
    });

    const avgReqTime = successReq > 0 ? Math.round(cumulativeLatency / successReq) : 0;
    const avgContextTokens = successReq > 0 ? Math.round(totalInTokens / successReq) : 0;
    const avgContextChars = successReq > 0 ? Math.round(totalChars / successReq) : 0;

    currentState.aiVerification.metrics = {
      engineDetectionTimeMs: parseFloat(currentState.lastElapsedMs || 0),
      totalRequests: totalReq,
      successfulRequests: successReq,
      failedOrRateLimitedRequests: failedReq,
      totalFindingsEvaluated: evaluatedCount,
      clippedCount: clippedCount,
      verdictCounts: verdicts,
      requestsFullTimeMs: cumulativeLatency,
      avgRequestTimeMs: avgReqTime,
      totalContextTokens: totalInTokens,
      totalOutputTokens: totalOutTokens,
      avgContextTokensPerRequest: avgContextTokens,
      totalContextChars: totalChars,
      avgContextCharsPerRequest: avgContextChars,
      estimatedTotalCostUsd: Number(totalCost.toFixed(6))
    };

    if (typeof window.updateAiMetricsUI === "function") {
      window.updateAiMetricsUI();
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Master Verification Orchestrator (Single & Batch)
  // ---------------------------------------------------------------------------

  /**
   * Filter detections by user-selected target scope
   */
  function filterDetectionsByScope(detections, scope) {
    if (!Array.isArray(detections)) return [];
    if (scope === "ALL") return detections;
    if (scope === "HADITH_ONLY") {
      return detections.filter(d => (d.sourceType || "").toUpperCase() === "HADITH");
    }
    // "HADITH_AND_CANDIDATES" (Default)
    return detections.filter(d => {
      const st = (d.sourceType || "").toUpperCase();
      const band = (d.confidenceBand || "").toUpperCase();
      return st === "HADITH" || band === "CANDIDATE" || band === "AMBIGUOUS" || (d.totalScore || 0) < 15;
    });
  }

  /**
   * Run verification over all matching detections in the active lecture
   */
  async function runBatchAiVerification(onProgress, selectedIndices = null) {
    isVerificationPaused = false;
    isVerificationCancelled = false;

    const provider = currentState.aiVerification.activeProvider || "gemini";
    const contextWindow = currentState.aiVerification.contextWindowWords || 25;
    const batchSize = provider === "gemini" ? (currentState.aiVerification.geminiBatchSize || 5) : 1;

    const targetIdx = (Array.isArray(selectedIndices) && selectedIndices.length) ? selectedIndices : resolveTargetIndices();
    const targetDetections = currentState.detections.filter((_, idx) => targetIdx.includes(idx));
    if (!targetDetections.length) {
      if (typeof showToast === "function") {
        showToast("لا توجد مقتبسات تطابق نطاق التدقيق المحدد.");
      }
      return;
    }

    if (provider === "openrouter_chat") {
      await assertOpenRouterChatModelExists();
    }

    // Mark as PENDING (the prior status comes back if the run stops before reaching a finding)
    const priorStatus = new Map();
    targetDetections.forEach(det => {
      det.aiVerification = det.aiVerification || {};
      priorStatus.set(det, det.aiVerification.status);
      det.aiVerification.status = "PENDING";
    });
    if (typeof window.renderAllViews === "function") window.renderAllViews();

    const preparedItems = targetDetections.map((det, idx) => ({
      det: det,
      index: idx,
      envelope: buildCanonicalDecisionEnvelope(det, currentState.words, contextWindow)
    }));

    let processedCount = 0;
    let failedCount = 0;
    let fatalErr = null;
    const totalCount = preparedItems.length;

    try {
      for (let i = 0; i < preparedItems.length; i += batchSize) {
        if (isVerificationCancelled) break;
        await waitIfPaused();

        const currentChunk = preparedItems.slice(i, i + batchSize);
        if (onProgress) {
          onProgress({
            processed: processedCount,
            total: totalCount,
            status: "running",
            message: `جاري تدقيق المقتبسات (${processedCount + 1} إلى ${Math.min(totalCount, processedCount + currentChunk.length)} من ${totalCount})...`
          });
        }

        let providerResult = null;
        let chunkStatus = "SUCCESS";
        let chunkErrorMsg = "";

        try {
          if (provider === "gemini") {
            providerResult = await callGeminiApi(currentChunk, (sec, customMsg) => {
              if (onProgress) {
                onProgress({
                  processed: processedCount,
                  total: totalCount,
                  status: "pacing",
                  message: customMsg || `⏳ انتظار حد الخطة المجانية (RPM): استئناف خلال ${sec} ثوانٍ...`
                });
              }
            });
          } else if (provider === "openrouter_jev") {
            providerResult = await callOpenRouterJev(currentChunk[0]);
          } else if (provider === "openrouter_chat") {
            providerResult = await callOpenRouterChat(currentChunk[0]);
          } else if (provider === "local_laya") {
            providerResult = await callLocalLaya(currentChunk);
          } else {
            throw new Error(`مزود الذكاء الاصطناعي غير مدعوم: ${provider}`);
          }
        } catch (apiErr) {
          chunkStatus = "ERROR";
          chunkErrorMsg = apiErr.message;
          if (apiErr.fatal) fatalErr = apiErr;
          console.error("AI Verification Request Error:", apiErr);
        }

        // Apply results to detections
        const timestampNow = Math.floor(Date.now() / 1000);
        const reqId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        if (chunkStatus === "SUCCESS" && providerResult) {
          currentChunk.forEach(item => {
            const findingId = item.det.id || item.det._uniqueKey || `f_${item.index}`;
            const evalResult = (providerResult.results || []).find(r => r.finding_id === findingId) || providerResult.results?.[0];

            if (evalResult) {
              const verdictChoice = (evalResult.verdict || "NOT_SURE").toUpperCase();
              const conf = typeof evalResult.confidence === "number" ? evalResult.confidence : 0.85;

              const rawB = evalResult.boundary_status || "COMPLETE_SPAN";
              const bStatus = normalizeBoundaryVerdict(verdictChoice, rawB, item.envelope.state);
              const bConf = typeof evalResult.boundary_confidence === "number" ? evalResult.boundary_confidence : 1.0;
              const bProbs = evalResult.boundary_probabilities || {
                COMPLETE_SPAN: bStatus === "COMPLETE_SPAN" ? bConf : (1 - bConf) / 3,
                MISSING_START: bStatus === "MISSING_START" ? bConf : (1 - bConf) / 3,
                MISSING_END: bStatus === "MISSING_END" ? bConf : (1 - bConf) / 3,
                MISSING_BOTH: bStatus === "MISSING_BOTH" ? bConf : (1 - bConf) / 3
              };

              item.det.aiVerification = {
                status: "VERIFIED",
                verdict: verdictChoice,
                confidence: conf,
                probabilities: evalResult.probabilities || null,
                boundaryStatus: bStatus,
                boundaryConfidence: bConf,
                boundaryProbabilities: bProbs,
                unmatchedPrefixPreview: item.envelope.state.unmatched_corpus_prefix_words || "",
                unmatchedSuffixPreview: item.envelope.state.unmatched_corpus_suffix_words || "",
                mergeSuggestion: getPromptConfig().rules.suggestMerges && providerSupportsPrompt(providerResult.provider)
                  ? normalizeMergeSuggestion(evalResult.merge_suggestion, evalResult.merge_confidence, evalResult.merge_gap_type, item.envelope.merge)
                  : null,
                reason: evalResult.reason || "",
                modelUsed: providerResult.model,
                provider: providerResult.provider,
                requestId: reqId,
                latencyMs: providerResult.latencyMs,
                inputTokens: Math.round(providerResult.inputTokens / currentChunk.length),
                outputTokens: Math.round(providerResult.outputTokens / currentChunk.length),
                costUsd: providerResult.costUsd / currentChunk.length,
                humanOverride: false,
                verifiedAt: new Date().toISOString()
              };

              // Persist into IndexedDB training dataset
              const layaRec = convertRecordToLayaTrainingEnvelope(item.det, item.envelope, timestampNow);
              if (typeof saveVerificationRecordToDB === "function") {
                saveVerificationRecordToDB(layaRec).catch(() => {});
              }
            } else {
              item.det.aiVerification = { status: "ERROR", verdict: null, reason: "لم ترجع استجابة صالحة لهذا المقتبس." };
            }
          });

          // Log request telemetry
          const contextCharLen = currentChunk.reduce((acc, it) => acc + (
            (it.envelope.state.context_before || "").length +
            (it.envelope.state.matched_span_in_lecture || "").length +
            (it.envelope.state.context_after || "").length
          ), 0);

          currentState.aiVerification.requestLogs.unshift({
            id: reqId,
            timestamp: new Date().toLocaleTimeString((typeof WahyI18n === "object" ? WahyI18n.dateLocale() : "ar-u-nu-latn")),
            model: providerResult.model,
            provider: providerResult.provider,
            findingsCount: currentChunk.length,
            findingsSummary: currentChunk.map(c => c.det.displayRef || c.det.canonicalText || c.det.matchedText).join(" | "),
            verdicts: currentChunk.map(c => c.det.aiVerification?.verdict || "UNKNOWN"),
            latencyMs: providerResult.latencyMs,
            inputTokens: providerResult.inputTokens,
            outputTokens: providerResult.outputTokens,
            contextChars: contextCharLen,
            costUsd: providerResult.costUsd,
            status: "SUCCESS",
            requestPayload: providerResult.requestPayload,
            rawResponse: providerResult.rawResponse
          });
        } else {
          // Chunk error handling
          currentChunk.forEach(item => {
            item.det.aiVerification = {
              status: "ERROR",
              verdict: null,
              reason: chunkErrorMsg
            };
          });

          currentState.aiVerification.requestLogs.unshift({
            id: reqId,
            timestamp: new Date().toLocaleTimeString((typeof WahyI18n === "object" ? WahyI18n.dateLocale() : "ar-u-nu-latn")),
            model: provider,
            provider: provider,
            findingsCount: currentChunk.length,
            findingsSummary: currentChunk.map(c => c.det.displayRef || c.det.canonicalText).join(" | "),
            verdicts: ["ERROR"],
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            contextChars: 0,
            costUsd: 0.0,
            status: "FAILED",
            error: chunkErrorMsg
          });
        }

        processedCount += currentChunk.length;
        if (chunkStatus !== "SUCCESS") failedCount += currentChunk.length;
        updateAiVerificationMetrics();
        if (fatalErr) break;
        if (typeof window.renderAllViews === "function") window.renderAllViews();
        if (typeof window.renderAiRequestLogsTable === "function") window.renderAiRequestLogsTable();
      }

      if (onProgress) {
        onProgress({
          processed: processedCount,
          total: totalCount,
          status: fatalErr ? "error" : (isVerificationCancelled ? "cancelled" : "done"),
          message: fatalErr
            ? `⛔ توقف التدقيق: ${fatalErr.message}`
            : (isVerificationCancelled ? "تم إيقاف التدقيق." : `اكتمل التدقيق الذكي لـ ${processedCount - failedCount} من ${totalCount} مقتبس${failedCount ? ` (فشل ${failedCount})` : ""}.`)
        });
      }
      if (fatalErr) throw fatalErr;
      return { processed: processedCount, failed: failedCount, total: totalCount, cancelled: isVerificationCancelled };
    } finally {
      // findings never sent (stopped, cancelled) get their previous status back instead of hanging on PENDING
      targetDetections.forEach(det => {
        if (det.aiVerification?.status === "PENDING") det.aiVerification.status = priorStatus.get(det);
      });
      // Rebuild smart captions with respect to visibility filter
      if (typeof recalculateCaptionsFromCurrentFindings === "function") {
        recalculateCaptionsFromCurrentFindings();
      }
    }
  }

  function pauseAiVerification() {
    isVerificationPaused = true;
  }

  function resumeAiVerification() {
    isVerificationPaused = false;
  }

  function cancelAiVerification() {
    isVerificationCancelled = true;
    isVerificationPaused = false;
  }

  // ---------------------------------------------------------------------------
  // 9. Manual Human Override Engine (Inspector & Table Controls)
  // ---------------------------------------------------------------------------

  async function setHumanOverrideVerdict(detectionId, newVerdict) {
    if (!detectionId || !newVerdict) return;
    const det = (currentState.detections || []).find(d => d.id === detectionId || d._uniqueKey === detectionId);
    if (!det) return;

    const vUpper = String(newVerdict).toUpperCase();
    det.aiVerification = det.aiVerification || {};
    det.aiVerification.status = "VERIFIED";
    det.aiVerification.verdict = vUpper;
    det.aiVerification.confidence = 0.98;
    det.aiVerification.humanOverride = true;
    det.aiVerification.reason = "تأكيد وتصحيح يدوي من المدقق البشري (Gold Standard).";
    det.aiVerification.probabilities = {
      CORRECT: vUpper === "CORRECT" ? 0.98 : 0.01,
      FALSE: vUpper === "FALSE" ? 0.98 : 0.01,
      NOT_SURE: vUpper === "NOT_SURE" ? 0.98 : 0.01
    };

    // Update in IndexedDB
    const env = buildCanonicalDecisionEnvelope(det, currentState.words);
    const layaRec = convertRecordToLayaTrainingEnvelope(det, env, Math.floor(Date.now() / 1000));
    layaRec.answers.verdict.choice = vUpper;
    layaRec.answers.verdict.probabilities = det.aiVerification.probabilities;
    layaRec.meta.human_verified = true;

    if (typeof saveVerificationRecordToDB === "function") {
      await saveVerificationRecordToDB(layaRec);
    }

    updateAiVerificationMetrics();
    if (typeof recalculateCaptionsFromCurrentFindings === "function") {
      recalculateCaptionsFromCurrentFindings();
    }
    if (typeof window.renderAllViews === "function") {
      window.renderAllViews();
    }
    if (typeof window.renderAiRequestLogsTable === "function") {
      window.renderAiRequestLogsTable();
    }
    if (typeof showToast === "function") {
      showToast(`تم تعيين حالة المقتبس يدوياً إلى: ${vUpper === "CORRECT" ? "صحيح ✓" : vUpper === "FALSE" ? "خاطئ ✕" : "غير متأكد ؟"}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 10. Universal In-Browser Laya Dataset Converter & Exporter
  // ---------------------------------------------------------------------------

  function convertRecordToLayaTrainingEnvelope(det, env, timestamp) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    const recId = det.aiVerification?.requestId || `wahy_dec_${ts}_${Math.floor(Math.random() * 10000)}`;

    const rawVerdict = (det.aiVerification?.verdict || "CORRECT").toUpperCase();
    const isHuman = Boolean(det.aiVerification?.humanOverride);
    const conf = typeof det.aiVerification?.confidence === "number" ? det.aiVerification.confidence : 0.88;

    let probs = det.aiVerification?.probabilities;
    if (isHuman) {
      probs = { CORRECT: 0.01, FALSE: 0.01, NOT_SURE: 0.01 };
      probs[rawVerdict] = 0.98;
    } else if (!probs) {
      const rem = parseFloat(((1.0 - conf) / 2.0).toFixed(4));
      probs = {
        CORRECT: rawVerdict === "CORRECT" ? conf : rem,
        FALSE: rawVerdict === "FALSE" ? conf : rem,
        NOT_SURE: rawVerdict === "NOT_SURE" ? conf : rem
      };
    }

    const bStatus = det.aiVerification?.boundaryStatus || "COMPLETE_SPAN";
    const bConf = typeof det.aiVerification?.boundaryConfidence === "number" ? det.aiVerification.boundaryConfidence : 0.95;
    let bProbs = det.aiVerification?.boundaryProbabilities;
    if (!bProbs) {
      const remB = parseFloat(((1.0 - bConf) / 3.0).toFixed(4));
      bProbs = {
        COMPLETE_SPAN: bStatus === "COMPLETE_SPAN" ? bConf : remB,
        MISSING_START: bStatus === "MISSING_START" ? bConf : remB,
        MISSING_END: bStatus === "MISSING_END" ? bConf : remB,
        MISSING_BOTH: bStatus === "MISSING_BOTH" ? bConf : remB
      };
    }

    return {
      id: recId,
      state: env.state,
      questions: env.questions,
      answers: {
        verdict: {
          type: "choice",
          choice: rawVerdict,
          probabilities: probs
        },
        boundary_status: {
          type: "choice",
          choice: bStatus,
          probabilities: bProbs
        }
      },
      meta: {
        source_provider: det.aiVerification?.modelUsed || det.aiVerification?.provider || "gemini-3.5-flash-lite",
        human_verified: isHuman,
        lecture_title: currentState.lectureTitle || "Wahy Islamic Lecture",
        converted_at: ts
      }
    };
  }

  function convertVerificationRecordsToLayaJsonl(records, options = {}) {
    const list = Array.isArray(records) ? records : [];
    const lines = [];
    const stats = {
      total_input: list.length,
      total_converted: 0,
      by_verdict: { CORRECT: 0, FALSE: 0, NOT_SURE: 0 },
      human_verified_count: 0,
      ai_count: 0
    };

    list.forEach((rec, idx) => {
      if (!rec) return;
      if (rec.state && rec.questions && rec.answers) {
        lines.push(JSON.stringify(rec));
        stats.total_converted++;
        const v = rec.answers?.verdict?.choice || "CORRECT";
        if (stats.by_verdict[v] !== undefined) stats.by_verdict[v]++;
        if (rec.meta?.human_verified) stats.human_verified_count++;
        else stats.ai_count++;
        return;
      }
      const converted = convertRecordToLayaTrainingEnvelope(rec, rec.envelope || null, Math.floor(Date.now() / 1000) + idx);
      if (converted) {
        lines.push(JSON.stringify(converted));
        stats.total_converted++;
        const v = converted.answers?.verdict?.choice || "CORRECT";
        if (stats.by_verdict[v] !== undefined) stats.by_verdict[v]++;
        if (converted.meta?.human_verified) stats.human_verified_count++;
        else stats.ai_count++;
      }
    });

    return {
      jsonl: lines.join("\n") + (lines.length ? "\n" : ""),
      lines,
      stats
    };
  }

  function exportLayaFineTuningJsonl() {
    const records = currentState.aiVerification.trainingDatasetRecords || [];
    if (!records.length) {
      if (typeof showToast === "function") {
        showToast("لا توجد سجلات تدقيق محفوظة لتصديرها. قم بتدقيق بعض المقتبسات أولاً!");
      }
      return;
    }

    const { jsonl, lines } = convertVerificationRecordsToLayaJsonl(records);
    const blob = new Blob([jsonl], { type: "application/x-jsonlines;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wahy_laya_train_${Math.floor(Date.now() / 1000)}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof showToast === "function") {
      showToast(`تم تصدير ${lines.length} سجل تدريب بصيغة Laya .jsonl بنجاح!`);
    }
  }

  // Export module to global scope
  
  /**
   * Indices of the detections the next batch run targets: either the manual pick
   * from the request-options panel, or every detection matching the scope.
   */
  function resolveTargetIndices() {
    const ai = currentState.aiVerification;
    const dets = currentState.detections || [];
    if (ai.selectionMode === "manual") {
      const picked = new Set(ai.manualSelectedIds || []);
      return dets.map((d, i) => (picked.has(d.id) ? i : -1)).filter(i => i >= 0);
    }
    const inScope = new Set(filterDetectionsByScope(dets, ai.targetScope || "HADITH_AND_CANDIDATES"));
    return dets.map((d, i) => (inScope.has(d) ? i : -1)).filter(i => i >= 0);
  }

  /**
   * Build (without sending) the exact request the active provider would receive
   * for one detection, so the options panel can preview it.
   */
  function buildRequestPreview(detIdx, provider = null) {
    const det = currentState.detections[detIdx];
    if (!det) return null;
    const prov = provider || currentState.aiVerification.activeProvider || "gemini";
    const item = {
      det,
      index: detIdx,
      envelope: buildCanonicalDecisionEnvelope(det, currentState.words, currentState.aiVerification.contextWindowWords || 25)
    };
    let model = "";
    let endpoint = "";
    let payload = null;
    if (prov === "gemini") {
      model = currentState.aiVerification.geminiModel || "gemini-3.5-flash-lite";
      endpoint = `generativelanguage.googleapis.com/…/models/${model}:generateContent`;
      payload = buildGeminiRequestBody([item]);
    } else if (prov === "openrouter_jev") {
      payload = buildJevPayload(item);
      model = payload.model;
      endpoint = "openrouter.ai/api/alpha/decisions";
    } else if (prov === "openrouter_chat") {
      model = normalizeOpenRouterModelId(currentState.aiVerification.openRouterSelectedModel);
      payload = buildOpenRouterChatPayload(item, model);
      endpoint = "openrouter.ai/api/v1/chat/completions";
    } else {
      model = currentState.aiVerification.layaCheckpoint || "laya-multilingual";
      payload = buildLayaPayload([item]);
      endpoint = "/api/laya/predict";
    }
    const json = JSON.stringify(payload);
    return {
      provider: prov,
      model,
      endpoint,
      payload,
      questions: composeRequestEnvelope(item, prov).questions,
      systemPrompt: (prov === "gemini" || prov === "openrouter_chat") ? composeSystemPrompt(prov) : "",
      approxTokens: Math.round(json.length / 3.2)
    };
  }

  function estimateBatchVerification(selectedIndices = null) {
    const provider = currentState.aiVerification.activeProvider || "gemini";
    const targetIdx = (Array.isArray(selectedIndices)) ? selectedIndices : resolveTargetIndices();
    const count = targetIdx.length;
    const sample = count ? buildRequestPreview(targetIdx[0], provider) : null;
    const approxTokens = count * (sample ? sample.approxTokens : 380);
    let estCost = 0.0;
    if (provider === "openrouter_chat") {
      const modelId = normalizeOpenRouterModelId(currentState.aiVerification.openRouterSelectedModel);
      const meta = (currentState.aiVerification.openRouterModelsCatalog || []).find(m => m.id === modelId);
      const priceIn = meta ? parseFloat(meta.pricing.prompt || 0) : 0.14 / 1000000;
      const priceOut = meta ? parseFloat(meta.pricing.completion || 0) : 0.28 / 1000000;
      estCost = approxTokens * priceIn + count * CHAT_EXPECTED_OUTPUT_TOKENS * priceOut;
    } else if (provider === "openrouter_jev") {
      estCost = (approxTokens / 1000000) * 0.042;
    }
    const rpm = provider === "gemini" ? (currentState.aiVerification.geminiRpmLimit || 12) : 60;
    const estSeconds = Math.ceil(count / rpm) * 60;
    return { count, approxTokens, estCost, estSeconds };
  }

  window.WahyAiVerifier = {
    estimateBatchVerification,
    resolveTargetIndices,
    buildRequestPreview,
    getPromptConfig,
    providerSupportsPrompt,
    DEFAULT_PROMPT_CONFIG,
    DEFAULT_SYSTEM_PROMPTS,
    PROMPT_PRESETS,
    PROMPT_RULES,
    buildCanonicalDecisionEnvelope,
    findNeighborFindings,
    MERGE_MAX_GAP_WORDS,
    callGeminiApi,
    callOpenRouterJev,
    callOpenRouterChat,
    callLocalLaya,
    fetchOpenRouterModelsCatalog,
    runBatchAiVerification,
    pauseAiVerification,
    resumeAiVerification,
    cancelAiVerification,
    setHumanOverrideVerdict,
    updateAiVerificationMetrics,
    convertVerificationRecordsToLayaJsonl,
    exportLayaFineTuningJsonl
  };

})(window);

