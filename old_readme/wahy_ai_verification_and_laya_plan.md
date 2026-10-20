# Wahy Studio (Wahy-Transcriber v2.2) — Phase 2 Master Implementation Plan for Coding Agent `Agy`

## AI Verification Layer (Gemini 3.5 Flash-Lite, OpenRouter JEV & Universal LLMs), Request Telemetry Studio, and Local `Laya-Multilingual` (3GB VRAM) Inference & Fine-Tuning Pipeline

## 0. Executive Architectural Answers & Ground Truth Constraints

Before writing any code, **Agy** must adhere to the following verified technical facts:

1. **Can `Laya` be fine-tuned only with `JEV` data, or with any model's data?**

   * **It can be fine-tuned with ANY model's data (Gemini 3.5 Flash-Lite, DeepSeek, Qwen, JEV, or Human Corrections) once passed through the Universal Laya Converter specified in Module 6.**

   * **Why?** Both TypeSafe's `JEV` (`typesafe/jev-1.14` / `typesafe/jev-1.13`) and open-weight `Laya` (`convaiinnovations/laya-multilingual`) are **System-1 non-autoregressive decision models** that take a structured `(state, questions)` input and score each option in `criteria` at its own `[MASK]` option-marker token.

   * **Difference between JEV data and LLM data:**

     * **JEV** natively takes `{ state, questions }` and outputs a calibrated probability distribution over the options (`probabilities: { "CORRECT": 0.91, "FALSE": 0.03, "NOT_SURE": 0.06 }`). This supports both **hard-label Cross-Entropy** and **soft-label Knowledge Distillation / RLCD**.

     * **Generative LLMs (Gemini 3.5 Flash-Lite, DeepSeek, etc.)** take a prompt and return a JSON verdict (`{ "verdict": "CORRECT" | "FALSE" | "NOT_SURE", "confidence": 0.92, "reason": "..." }`).

     * By constructing the **exact same canonical `state` and `questions` object** for every finding *before* dispatching to any provider, our **Universal Laya Converter** (`backend/laya_converter.py` and frontend exporter) can convert Gemini, OpenRouter LLM, JEV, and Human-corrected records into unified Laya training `.jsonl` files (supporting both hard labels and Laplace-smoothed soft probability targets).

2. **Which `Laya` checkpoint must be installed for Arabic on a GTX 1050 (3GB VRAM)?**

   * **MUST USE:** `convaiinnovations/laya-multilingual` (322M parameters, `mmBERT-base` backbone, 256k vocab, 647 MB in FP16).

   * **DO NOT USE:** `convaiinnovations/laya` (English-only `ModernBERT-large`, 421M params), which collapses to near-random accuracy on Arabic script while remaining overconfident.

   * **GTX 1050 (3GB VRAM) Memory Budget:**

     * `convaiinnovations/laya-multilingual` loaded in `torch.float16` uses **\~680 MB – 850 MB VRAM**, easily fitting inside the 3GB VRAM limit (\~33 ms per decision on GPU).

     * **VRAM Contention Guard:** When `faster-whisper` runs locally on the GTX 1050, `backend/app.py` must unload Whisper (`del model; torch.cuda.empty_cache()`) before loading `laya-multilingual` into CUDA, or run Laya in FP16 with automatic CPU fallback if free VRAM is `< 900 MB`.

     * **Deadlock Guard:** Always set `os.environ["USE_TF"] = "0"` before `import laya` or `import transformers` to prevent the known TensorFlow/abseil import deadlock.

3. **Why does `JEV` require a dedicated mode on OpenRouter?**

   * Unlike chat models that use `POST https://openrouter.ai/api/v1/chat/completions`, TypeSafe's `JEV` (`typesafe/jev-1.14`, `typesafe/jev-1.13`, `~typesafe/jev-latest`) is a System-1 decision model that does **not** generate text.

   * It must be called via OpenRouter's **Decisions API**: `POST https://openrouter.ai/api/alpha/decisions` (or `POST https://openrouter.ai/api/v1/systemone`) with `{ model, state, questions }`.

   * Output tokens are **free (\$0.00)** and input tokens cost **\$0.042 / 1M tokens**, with exact USD cost returned in `response.usage.cost`.

## 1. Repository File Map & Target Architecture

**Agy** will modify existing files and add modular new files in `wahy-transcriber` as follows:

```
wahy-transcriber/
├── index.html                        # [MODIFY] Add AI Verification Bar, Display Filter Pills, 5th Main Tab "🤖 الذكاء الاصطناعي والسجل (AI & Logs)", Settings API keys
├── css/
│   └── styles.css                    # [MODIFY] Add styles for AI verdict badges (CORRECT / FALSE / NOT_SURE / PENDING), telemetry cards, and filter pills
├── js/
│   ├── state.js                      # [MODIFY] Add currentState.aiVerification state tree, IndexedDB store for verification logs & training dataset
│   ├── ai-verifier.js                # [NEW] Core AI Verification Orchestrator (Gemini 3.5 Flash-Lite, OpenRouter JEV Decisions Mode, OpenRouter Chat Mode, Local Laya Mode, Rate Limiter, Cost/Metrics Calculator, Laya Dataset Exporter)
│   ├── render.js                     # [MODIFY] Add AI verdict filtering in Display & Editor views, render AI Badges on citations, render AI Telemetry & Requests Tab
│   ├── editor.js                     # [MODIFY] Allow manual override of AI Verdict (Correct / False / Not Sure) in Finding Inspector (marks record as gold human-verified for Laya fine-tuning)
│   └── events.js                     # [MODIFY] Wire up AI Verification controls, model search bar, filter checkboxes, batch/single verification, and Laya converter export
└── backend/
    ├── requirements.txt              # [MODIFY] Add laya, accelerate, safetensors, httpx
    ├── app.py                        # [MODIFY] Add /api/laya/status, /api/laya/predict, /api/laya/convert-dataset, and /api/openrouter/decisions proxy
    ├── laya_engine.py                # [NEW] Local Laya-Multilingual manager (3GB VRAM safe loader, FP16 inference, CUDA/CPU fallback)
    └── laya_converter.py             # [NEW] Universal converter from (Gemini / OpenRouter / JEV / Human) logs -> Laya RLCD & Cross-Entropy .jsonl training dataset + starter fine-tuning script

```

## 2. Canonical Data Structures (`js/state.js` & `js/ai-verifier.js`)

### 2.1. The Canonical `state` and `questions` Schema (Shared Across All Providers)

Every candidate detection produced by `engine.js` (`QuotationMatcherJS.detect()`) must be packaged into a **Canonical Decision Envelope** before calling *any* AI model. This guarantees 1:1 structural parity between JEV, Laya, Gemini, and OpenRouter LLMs.

```
/**
 * Build the canonical System-1 state and questions for a single engine detection.
 * @param {Object} det - Detection object from currentState.detections
 * @param {Array} words - currentState.words array
 * @param {number} contextWindowWords - Number of words before/after (default: 25)
 */
function buildCanonicalDecisionEnvelope(det, words, contextWindowWords = 25) {
  const sIdx = Math.max(0, det.wordStartIdx);
  const eIdx = Math.min(words.length - 1, det.wordEndIdx);

  const beforeStart = Math.max(0, sIdx - contextWindowWords);
  const afterEnd = Math.min(words.length, eIdx + 1 + contextWindowWords);

  const contextBefore = words.slice(beforeStart, sIdx).map(w => w.word).join(" ");
  const matchedTranscriptSpan = words.slice(sIdx, eIdx + 1).map(w => w.word).join(" ");
  const contextAfter = words.slice(eIdx + 1, afterEnd).map(w => w.word).join(" ");

  const canonicalState = {
    source_type: det.sourceType || "HADITH", // "QURAN" | "HADITH" | "ADHKAR"
    candidate_reference: det.displayRef || det.reference || "",
    canonical_corpus_text: det.canonicalText || matchedTranscriptSpan,
    context_before: contextBefore,
    matched_span_in_lecture: matchedTranscriptSpan,
    context_after: contextAfter,
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
    }
  };

  return { state: canonicalState, questions: canonicalQuestions };
}

```

### 2.2. Enriched Detection Fields on `currentState.detections[i]`

Each detection in `currentState.detections` must be extended with:

```
det.aiVerification = {
  status: "UNVERIFIED",         // "UNVERIFIED" | "PENDING" | "VERIFIED" | "ERROR"
  verdict: null,                // "CORRECT" | "FALSE" | "NOT_SURE" | null
  confidence: null,             // 0.0 to 1.0
  probabilities: null,          // { CORRECT: number, FALSE: number, NOT_SURE: number }
  reason: "",                   // Optional short explanation (from Gemini/Chat LLMs) or "System-1 Calibrated Decision"
  modelUsed: "",                // e.g. "gemini-3.5-flash-lite", "typesafe/jev-1.14", "convaiinnovations/laya-multilingual"
  provider: "",                 // "gemini" | "openrouter_jev" | "openrouter_chat" | "local_laya" | "human_override"
  requestId: "",                // Links to currentState.aiVerification.requestLogs
  latencyMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0.0,
  humanOverride: false,         // true if user manually changed/confirmed the AI verdict
  verifiedAt: null
};

```

### 2.3. Global AI Verification State (`currentState.aiVerification`)

Add the following object to `currentState` in `js/state.js`:

```
aiVerification: {
  enabled: true,
  autoVerifyAfterEngine: false,          // Toggle: automatically trigger AI verification after engine.detect()
  targetScope: "HADITH_AND_CANDIDATES",  // "ALL" | "HADITH_ONLY" | "HADITH_AND_CANDIDATES" (since Hadiths confuse most with regular speech)
  contextWindowWords: 25,                // Words before & after the span sent as context
  activeProvider: "gemini",              // "gemini" | "openrouter_jev" | "openrouter_chat" | "local_laya"
  
  // Provider 1: Google Gemini API (Free Plan / Paid Tier)
  geminiApiKey: "",
  geminiModel: "gemini-3.5-flash-lite",  // Default: latest 3.5 Flash-Lite (with dropdown for gemini-3.1-flash-lite, gemini-3.8-flash)
  geminiFreeTierMode: true,              // Enforces RPM pacing & multi-item batching
  geminiRpmLimit: 12,                    // Safe default for Free Tier (12 RPM = 1 request / 5s or batched)
  geminiBatchSize: 5,                    // Pack up to 5 findings per Gemini request to save RPM quota!

  // Provider 2 & 3: OpenRouter (JEV Mode + Universal Searchable Models)
  openRouterApiKey: "",
  openRouterMode: "jev",                 // "jev" (Decisions API) | "chat" (Standard Chat Completions API)
  openRouterJevModel: "typesafe/jev-1.14", // Options: "typesafe/jev-1.14", "~typesafe/jev-latest", "typesafe/jev-1.13"
  openRouterSelectedModel: "deepseek/deepseek-chat", // Selected via live search bar
  openRouterModelsCatalog: [],           // Cached from GET https://openrouter.ai/api/v1/models
  openRouterSearchQuery: "",

  // Provider 4: Local Laya (GTX 1050 3GB VRAM)
  layaCheckpoint: "convaiinnovations/laya-multilingual",
  layaDevice: "auto",                    // "auto" (CUDA FP16 if >=900MB free, else CPU) | "cuda" | "cpu"
  layaCustomCheckpointPath: "",          // Path to user's fine-tuned checkpoint if available
  layaBackendReady: false,

  // Display & Editor Verdict Filter (Multi-select checkboxes in Tab 1 / Display)
  // User requirement: "in the first tab add a filter to show or not according to the answer
  // (so i can decide to show correct and not sure, or only correct, or maybe false, i just can choose freely)"
  visibilityFilter: {
    showCorrect: true,
    showNotSure: true,
    showFalse: false,                    // Hidden by default once AI marks it FALSE, but user can toggle it ON freely!
    showUnverified: true                 // Findings not yet checked by AI
  },

  // Real-Time Metrics & Telemetry Summary
  metrics: {
    engineDetectionTimeMs: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedOrRateLimitedRequests: 0,
    totalFindingsEvaluated: 0,
    verdictCounts: { CORRECT: 0, FALSE: 0, NOT_SURE: 0 },
    requestsFullTimeMs: 0,               // Wall-clock or cumulative request time
    avgRequestTimeMs: 0,
    totalContextTokens: 0,
    totalOutputTokens: 0,
    avgContextTokensPerRequest: 0,
    totalContextChars: 0,
    avgContextCharsPerRequest: 0,
    estimatedTotalCostUsd: 0.0
  },

  // Detailed Request Logs & Persisted Laya Fine-Tuning Dataset
  requestLogs: [],                       // Every API call with full input, output, model, latency, tokens, cost, status
  trainingDatasetRecords: []             // Saved in IndexedDB (WahyLayaTrainingDB) across lectures for Phase 3 Laya fine-tuning
}

```

## 3. Provider Implementations & Rate-Limit Resilience (`js/ai-verifier.js`)

### 3.1. Mode 1: Google Gemini API (`gemini-3.5-flash-lite`) with Free-Tier RPM Protection

1. **Supported Models in Selector:**

   * `gemini-3.5-flash-lite` *(Default — Latest Gemini 3.5 Flash-Lite)*

   * `gemini-3.1-flash-lite`

   * `gemini-3.8-flash`

   * `gemini-2.5-flash-lite`

2. **Endpoint:**

   ```
   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}
   Content-Type: application/json
   
   ```

3. **Structured JSON Output Schema (`generationConfig`):** Use Gemini's native `responseMimeType: "application/json"` and `responseSchema` so output parsing never fails.

   * **Smart Batching for Free Tier RPM:** Because the user is on the Gemini Free Plan (where RPM is typically capped at 15 RPM), allow sending either **1 finding per request** or **batched findings (`geminiBatchSize = 5`)** in a single request:

   ```
   {
     "systemInstruction": {
       "parts": [{
         "text": "أنت مدقق شرعي ولغوي خبير في تفريغ المحاضرات الإسلامية. مهمتك التمييز بدقة بين الاقتباس الفعلي (آية أو حديث نبوي أو ذكر) وبين الكلام العادي للشيخ الشارح الذي تتشابه كلماته لفظياً مع الحديث أو الآية."
       }]
     },
     "contents": [{
       "role": "user",
       "parts": [{ "text": "<JSON array of { finding_id, state, questions }>" }]
     }],
     "generationConfig": {
       "temperature": 0.1,
       "responseMimeType": "application/json",
       "responseSchema": {
         "type": "ARRAY",
         "items": {
           "type": "OBJECT",
           "properties": {
             "finding_id": { "type": "STRING" },
             "verdict": { "type": "STRING", "enum": ["CORRECT", "FALSE", "NOT_SURE"] },
             "confidence": { "type": "NUMBER" },
             "probabilities": {
               "type": "OBJECT",
               "properties": {
                 "CORRECT": { "type": "NUMBER" },
                 "FALSE": { "type": "NUMBER" },
                 "NOT_SURE": { "type": "NUMBER" }
               },
               "required": ["CORRECT", "FALSE", "NOT_SURE"]
             },
             "reason": { "type": "STRING" }
           },
           "required": ["finding_id", "verdict", "confidence", "probabilities", "reason"]
         }
       }
     }
   }
   
   ```

4. **Rate-Limit (RPM / 429) & Failure Handling State Machine:**

   * **Token-Bucket Pacer:** Maintain a sliding window of request timestamps in `js/ai-verifier.js`. If `geminiFreeTierMode` is enabled and `requestsInLast60s >= geminiRpmLimit`, automatically pause the queue and display a live countdown in the UI status bar (`⏳ انتظار حد الخطة المجانية (RPM): استئناف خلال Xs...`) before firing the next request.

   * **HTTP 429 / 503 Exponential Backoff:**

     * If Gemini returns HTTP `429` (`RESOURCE_EXHAUSTED`) or `503`:

       1. Inspect error JSON for `RetryInfo` (`retryDelay`, e.g., `"32s"`) or `Retry-After` header.

       2. If present, wait `retryDelay + 1.5s`; otherwise use exponential backoff: `5s -> 15s -> 35s -> 65s` (up to 4 retries).

       3. Log the `RATE_LIMITED` attempt in `requestLogs` with the exact error message so the user can inspect it in the Requests tab.

       4. Provide a **\[⏸ إيقاف مؤقت / ▶ استئناف\]** button and **\[⏭ تخطي إلى نموذج بديل\]** button in the verification progress banner so the user never loses already-verified findings if daily quota (RPD) is exhausted.

5. **Token & Cost Calculation:**

   * Read `usageMetadata.promptTokenCount` and `usageMetadata.candidatesTokenCount` from Gemini's response.

   * Display **\$0.00 (Free Tier)** when `geminiFreeTierMode` is checked, AND also compute the shadow paid-tier equivalent (`$0.30 / 1M input`, `$2.50 / 1M output` for `gemini-3.5-flash-lite`) in parentheses so the user can compare theoretical API costs across models!

### 3.2. Mode 2: OpenRouter Dedicated `JEV` Mode (TypeSafe System-1 Decisions API)

1. **Why JEV Mode is Special:**

   * JEV (`typesafe/jev-1.14`, `~typesafe/jev-latest`, `typesafe/jev-1.13`) uses OpenRouter's **Decisions API**, NOT `/api/v1/chat/completions`.

2. **Endpoint & Headers:**

   ```
   POST https://openrouter.ai/api/alpha/decisions
   Authorization: Bearer {OPENROUTER_API_KEY}
   Content-Type: application/json
   
   ```

   *(Note: Also add a lightweight pass-through route `/api/openrouter/decisions` in `backend/app.py` in case browser CORS blocks direct calls to `/api/alpha/decisions`, falling back automatically if running in browser-only mode).*

3. **Exact JEV Request Payload:** Send the exact `state` and `questions` produced by `buildCanonicalDecisionEnvelope()`:

   ```
   {
     "model": "typesafe/jev-1.14",
     "state": {
       "source_type": "HADITH",
       "candidate_reference": "صحيح مسلم (2699)",
       "canonical_corpus_text": "من نفس عن مؤمن كربة من كرب الدنيا نفس الله عنه كربة من كرب يوم القيامة",
       "context_before": "ولذلك ينبغي للمسلم أن يعين إخوانه ويفرج همومهم، فلا يبخل بجاهه ولا بماله، لأن",
       "matched_span_in_lecture": "من نفس عن مؤمن كربة من كرب الدنيا",
       "context_after": "فهذا فضل عظيم رواه الإمام مسلم في صحيحه عن أبي هريرة",
       "engine_confidence_band": "CANDIDATE",
       "engine_score": 14.2,
       "has_citation_cue": false
     },
     "questions": {
       "verdict": {
         "type": "choice",
         "instructions": "In this Arabic Islamic lecture transcript, determine whether `matched_span_in_lecture` (surrounded by `context_before` and `context_after`) is an actual quotation/citation of `canonical_corpus_text` (`source_type`), or if it is merely ordinary speaker prose/explanation that happens to share words with the corpus text.",
         "criteria": {
           "CORRECT": "The speaker is genuinely quoting, reciting, or invoking this Quranic Ayah, Prophetic Hadith, or Dhikr (verbatim or as a direct religious citation in context).",
           "FALSE": "False positive: the words are ordinary conversational speech, fiqh explanation, or narrator/person names that coincidentally overlap with corpus vocabulary without quoting the text.",
           "NOT_SURE": "Ambiguous or partial paraphrase/meaning-only allusion where it is borderline whether the speaker intended a direct quotation."
         }
       }
     }
   }
   
   ```

4. **Exact JEV Response Parsing:** JEV returns:

   ```
   {
     "id": "gen-dec-...",
     "model": "typesafe/jev-1.14-20261015",
     "provider": "TypeSafe",
     "answers": {
       "verdict": {
         "type": "choice",
         "choice": "CORRECT",
         "confidence": 0.89,
         "probabilities": {
           "CORRECT": 0.92,
           "FALSE": 0.03,
           "NOT_SURE": 0.05
         }
       }
     },
     "usage": {
       "input_tokens": 312,
       "output_tokens": 0,
       "cost": 0.000013104
     }
   }
   
   ```

   * Extract:

     * `verdict = res.answers.verdict.choice` (`"CORRECT" | "FALSE" | "NOT_SURE"`)

     * `confidence = res.answers.verdict.confidence`

     * `probabilities = res.answers.verdict.probabilities`

     * `inputTokens = res.usage.input_tokens`

     * `outputTokens = res.usage.output_tokens || 0`

     * `costUsd = res.usage.cost ?? (res.usage.input_tokens * 0.000000042)`

   * **Bonus JEV Multi-Question Batching:** JEV allows multiple independent questions in one `questions` dictionary (`verdict_0`, `verdict_1`, ...) over a shared lecture segment state, or concurrent single-finding calls with configurable concurrency (`1` to `5`). Support both single-finding mode (default for highest accuracy on JEV) and multi-question mode!

### 3.3. Mode 3: OpenRouter Universal Model Search & Chat Completions Mode

1. **Dynamic Model Catalog Fetcher & Search Bar:**

   * On page load (or when opening the AI Verification bar/modal), fetch:

     ```
     GET https://openrouter.ai/api/v1/models
     
     ```

   * Cache the returned model list (`id`, `name`, `context_length`, `pricing.prompt`, `pricing.completion`, `architecture`) in `sessionStorage` / `currentState.aiVerification.openRouterModelsCatalog`.

   * Build an interactive **Searchable Model Combobox** (`#inpOpenRouterModelSearch` + `#openRouterModelDropdownList`) featuring:

     * **Instant search filter** by model ID or name (e.g., typing `gemini`, `deepseek`, `qwen`, `flash`, `jev`, `claude`, `llama`, `free`).

     * **Quick Category Filter Chips** inside the dropdown:

       * `⚡ JEV & Decision Models` (`typesafe/jev-1.14`, `~typesafe/jev-latest`, `typesafe/jev-1.13`, `perplexity/pplx-decider-flash-v1.2`, `liquid/d1`)

       * `✨ Google Gemini` (`google/gemini-3.5-flash-lite`, `google/gemini-3.8-flash`, `google/gemini-3.1-flash-lite`, `google/gemini-2.5-flash`)

       * `🐉 Chinese Models (DeepSeek / Qwen / GLM)` (`deepseek/deepseek-chat`, `deepseek/deepseek-r1-distill-qwen-32b`, `qwen/qwen-2.5-72b-instruct`, `qwen/qwen-turbo`, `thudm/glm-4-plus`)

       * `🆓 Free Models` (any model where `parseFloat(pricing.prompt) === 0` or ID ends with `:free`)

     * Each dropdown row shows: **Model Name**, **`id`**, **Context Window** (e.g. `1M` / `128K`), and **Live Price** (`$X.XX / 1M in • $Y.YY / 1M out`).

2. **Smart Auto-Routing When a Model is Selected:**

   * If the selected model ID starts with `typesafe/jev` or `~typesafe/jev` (or belongs to the Decisions API family), automatically switch the request handler to **JEV Decisions Mode (`/api/alpha/decisions`)**!

   * Otherwise, use **OpenRouter Chat Completions Mode (`POST https://openrouter.ai/api/v1/chat/completions`)**:

     ```
     {
       "model": "<selected_openrouter_model_id>",
       "temperature": 0.1,
       "response_format": { "type": "json_object" },
       "messages": [
         {
           "role": "system",
           "content": "You are an expert Arabic Islamic text verifier. Given the JSON `state` and `questions`, return ONLY a valid JSON object with keys: {\"verdict\": \"CORRECT\" | \"FALSE\" | \"NOT_SURE\", \"confidence\": 0.0-1.0, \"probabilities\": {\"CORRECT\": p1, \"FALSE\": p2, \"NOT_SURE\": p3}, \"reason\": \"concise Arabic explanation\"}."
         },
         {
           "role": "user",
           "content": "<JSON.stringify({ state, questions })>"
         }
       ]
     }
     
     ```

   * **Cost Calculation for OpenRouter Chat Models:**

     * If `response.usage.cost` is returned by OpenRouter, use it directly.

     * Otherwise calculate `costUsd = (usage.prompt_tokens * parseFloat(modelMeta.pricing.prompt)) + (usage.completion_tokens * parseFloat(modelMeta.pricing.completion))`.

## 4. Local `Laya` Integration on GTX 1050 (3GB VRAM) (`backend/laya_engine.py` & `backend/app.py`)

### 4.1. Dependencies (`backend/requirements.txt`)

Append to `backend/requirements.txt`:

```
laya>=0.1.0
transformers>=4.46.0
accelerate>=0.34.0
safetensors>=0.4.5
httpx>=0.27.0

```

### 4.2. `backend/laya_engine.py` Implementation Specification

**Agy** must create `backend/laya_engine.py` with strict 3GB VRAM protection for the user's GTX 1050:

```
import os
# CRITICAL: Prevent TensorFlow/abseil deadlock when loading Laya/ModernBERT/mmBERT
os.environ["USE_TF"] = "0"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import time
import gc
import torch

class LocalLayaVerifier:
    DEFAULT_CHECKPOINT = "convaiinnovations/laya-multilingual"

    def __init__(self):
        self.agent = None
        self.loaded_checkpoint = None
        self.device = "cpu"
        self.dtype_str = "float32"

    def get_vram_status(self):
        if not torch.cuda.is_available():
            return {"cuda_available": False, "free_mb": 0, "allocated_mb": 0, "total_mb": 0}
        free_b, total_b = torch.cuda.mem_get_info()
        alloc_b = torch.cuda.memory_allocated()
        return {
            "cuda_available": True,
            "gpu_name": torch.cuda.get_device_name(0),
            "free_mb": round(free_b / (1024 * 1024), 1),
            "allocated_mb": round(alloc_b / (1024 * 1024), 1),
            "total_mb": round(total_b / (1024 * 1024), 1),
        }

    def load_model(self, checkpoint_id_or_path=None, preferred_device="auto", unload_whisper_fn=None):
        target_ckpt = checkpoint_id_or_path or self.DEFAULT_CHECKPOINT
        if self.agent is not None and self.loaded_checkpoint == target_ckpt:
            return self.get_status()

        # Unload existing Laya model if switching checkpoints
        self.unload_model()

        # If Whisper is occupying VRAM on the 3GB GTX 1050, free it first
        if callable(unload_whisper_fn):
            unload_whisper_fn()

        vram = self.get_vram_status()
        use_cuda = False
        if preferred_device == "cuda" and vram["cuda_available"]:
            use_cuda = True
        elif preferred_device == "auto" and vram["cuda_available"] and vram["free_mb"] >= 850:
            use_cuda = True

        import laya
        target_device = "cuda" if use_cuda else "cpu"
        try:
            self.agent = laya.load(target_ckpt, device=target_device)
            # Configure max_len=1024 for Arabic context + 256 head budget
            if hasattr(self.agent, "cfg") and isinstance(self.agent.cfg, dict):
                self.agent.cfg["max_len"] = 1024
                self.agent.cfg["head_max_len"] = 256
            self.device = target_device
            self.loaded_checkpoint = target_ckpt
        except RuntimeError as e:
            if "out of memory" in str(e).lower() and target_device == "cuda":
                torch.cuda.empty_cache()
                gc.collect()
                self.agent = laya.load(target_ckpt, device="cpu")
                self.device = "cpu"
                self.loaded_checkpoint = target_ckpt
            else:
                raise

        return self.get_status()

    def unload_model(self):
        if self.agent is not None:
            del self.agent
            self.agent = None
            self.loaded_checkpoint = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    def get_status(self):
        vram = self.get_vram_status()
        return {
            "loaded": self.agent is not None,
            "checkpoint": self.loaded_checkpoint or self.DEFAULT_CHECKPOINT,
            "device": self.device,
            "vram": vram
        }

    def predict_decision(self, state: dict, questions: dict, max_len: int = 1024):
        if self.agent is None:
            self.load_model(self.DEFAULT_CHECKPOINT, preferred_device="auto")
        t0 = time.perf_counter()
        result = self.agent.predict(state, questions, max_len=max_len)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "answers": result.get("answers", {}),
            "latency_ms": elapsed_ms,
            "model": self.loaded_checkpoint,
            "device": self.device,
            "cost": 0.0
        }

```

### 4.3. Backend Endpoints in `backend/app.py`

Add these endpoints to `backend/app.py`:

1. `GET /api/laya/status`: Returns whether `laya` is installed, whether `convaiinnovations/laya-multilingual` (or a fine-tuned checkpoint) is loaded in memory, active device (`cuda` vs `cpu`), and GTX 1050 VRAM usage.

2. `POST /api/laya/load`: Loads `convaiinnovations/laya-multilingual` (or a custom fine-tuned path in `models/laya-wahy-finetuned`) onto the GTX 1050 (automatically unloading Whisper if needed so the 3GB VRAM never overflows).

3. `POST /api/laya/predict`: Accepts `{ state, questions }` (or a batch of `[{ finding_id, state, questions }]`), runs `laya_verifier.predict_decision()`, and returns JEV-identical output:

   ```
   {
     "answers": {
       "verdict": {
         "type": "choice",
         "choice": "CORRECT",
         "confidence": 0.84,
         "probabilities": { "CORRECT": 0.84, "FALSE": 0.10, "NOT_SURE": 0.06 }
       }
     },
     "latency_ms": 28.4,
     "model": "convaiinnovations/laya-multilingual",
     "device": "cuda",
     "usage": { "input_tokens": 245, "output_tokens": 0, "cost": 0.0 }
   }
   
   ```

4. `POST /api/openrouter/decisions`: Server-side proxy for `https://openrouter.ai/api/alpha/decisions` so JEV requests never encounter browser CORS issues when the backend is running.

## 5. UI & UX Design Specification

### 5.1. Filter Bar in Display & Editor Tabs (Filter by AI Answer)

The user requested:

> *"in the first tab add a filter to show or not according to the answer ( so i can decide to show correct and not sure, or only correct, or maybe false, i just can choose freely )"*

1. **Where to place it:** In the **Display Section (`#section_display`)** lecture toolbar (right next to the category filter `الكل / الآيات / الأحاديث / الأذكار`) AND synced with the **Smart Editor (`#section_editor`)**:

2. **Multi-Toggle Pill Group (`#aiVerdictFilterGroup`):** Render 4 independent toggle pills (all toggleable freely in any combination):

   * `[✓ مقبول (Correct) 🟢]` (`#chkFilterShowCorrect` — default: **ON**)

   * `[✓ غير متأكد (Not Sure) 🟡]` (`#chkFilterShowNotSure` — default: **ON**)

   * `[✕ خاطئ / كلام عادي (False) 🔴]` (`#chkFilterShowFalse` — default: **OFF** once AI verification has run, so false-positive Hadiths disappear from the formatted lecture & captions automatically, OR can be toggled **ON** with 1 click whenever the user wants to inspect/review rejected items!)

   * `[⏳ غير مفحوص (Unverified) ⚪]` (`#chkFilterShowUnverified` — default: **ON**)

   * Plus quick preset buttons: `الكل` (All), `الصحيح فقط` (Only Correct), `الصحيح + غير المتأكد` (Correct + Not Sure), `الخاطئ فقط للمراجعة` (Only False).

3. **How Filtering Affects the Lecture View & Smart Captions:**

   * In `renderFormattedLectureView()` and `buildSmartCaptions()`:

     * Check each detection's `det.aiVerification?.verdict` against `currentState.aiVerification.visibilityFilter`.

     * If a detection's verdict is unchecked in `visibilityFilter` (for example, `verdict === "FALSE"` and `showFalse === false`), **suppress its citation styling/brackets** so those words render as normal speech in both the Formatted Lecture View and the Video Captions!

     * Important: **Never delete** the detection from `currentState.detections` when filtered out — keep it in memory so the user can toggle `showFalse` back ON at any time and see it highlighted with a dashed red/rose badge `[🔴 مستبعد بالذكاء الاصطناعي: كلام عادي]`!

   * When a visible citation has been verified by AI, show a crisp micro-badge on its citation pill:

     * `CORRECT`: `🟢 مؤكد (94%)`

     * `NOT_SURE`: `🟡 غير متأكد (58%)`

     * `FALSE` (when `showFalse` is toggled ON): `🔴 خاطئ / كلام عادي (91%)`

### 5.2. AI Verification Control Bar & Post-Run Metrics Summary Banner

Add a sleek, collapsible **AI Verification Control Bar** at the top of the Display / Editor workspace (and accessible from the new AI tab):

* **Provider Selector:**

  1. `✨ Gemini Flash-Lite (Free/API)`

  2. `🎯 OpenRouter — JEV Mode (Decisions API)`

  3. `🌐 OpenRouter — All Models (Search)`

  4. `🖥️ Local Laya (GTX 1050 3GB VRAM)`

* **Scope Selector:**

  * `الأحاديث والمشتبه به فقط (موصى به)` *(Default: verifies all `HADITH` detections + any `CANDIDATE`/`AMBIGUOUS` detections, since Quran Uthmani exact matches with high scores rarely need LLM verification, saving 60%+ of requests!)*

  * `الأحاديث النبوية فقط (Hadiths Only)`

  * `جميع المقتبسات (الكل: قرآن + حديث + أذكار)`

* **Action Button:** `[🤖 بدء التدقيق الذكي للمقتبسات (Verify Findings)]` + `[⏸ إيقاف مؤقت]`

* **Post-Verification Metrics Ribbon (`#aiMetricsSummaryGrid`):** As soon as verification runs (and updating live as requests complete), display a clean 8-card metric strip:

  1. **زمن اكتشاف المحرك (`Engine Time`):** e.g. `4.2 ms`

  2. **إجمالي الطلبات (`Total Requests`):** e.g. `14 طلب` (with breakdown: `14 ناجح / 0 محدّد RPM`)

  3. **الزمن الكلي للطلبات (`Requests Full Time`):** e.g. `6.42 s` (wall-clock & cumulative)

  4. **متوسط زمن الطلب (`Avg Request Time`):** e.g. `458 ms / طلب`

  5. **إجمالي السياق المرسل (`Total Context`):** e.g. `4,820 توكن (19,400 حرف)`

  6. **متوسط السياق لكل طلب (`Avg Context / Req`):** e.g. `344 توكن / طلب`

  7. **نتائج التصنيف (`Verdicts Breakdown`):** `🟢 9 صحيح | 🔴 4 خاطئ | 🟡 1 غير متأكد`

  8. **التكلفة التقديرية (`Estimated Cost`):** e.g. `$0.000202 USD` (or `$0.00 Free Tier` + shadow cost)

### 5.3. New Navigation Section / Tab 5: `🤖 الذكاء الاصطناعي والسجل (AI & Requests Log)`

Add a 5th main navigation button `#navBtn_ai_logs` (`🤖 الذكاء الاصطناعي والسجل`) in the top navbar (`index.html`) that opens `#section_ai_logs`.

Inside `#section_ai_logs`, build 3 sub-panels:

1. **Top Panel: Provider Configuration, OpenRouter Live Model Search Bar & Local Laya Control:**

   * **Gemini Card:** API Key input, Model selector (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.8-flash`), Free Tier RPM Pacer toggle (`12 RPM`), Batch size (`1` to `10`).

   * **OpenRouter Card:** API Key input, Mode switch (`🎯 JEV Decisions Mode` vs `💬 General LLM Chat Mode`), **Live Search Bar (`#inpOpenRouterModelSearch`)** with instant filtering across all 500+ OpenRouter models (Gemini, DeepSeek, Qwen, JEV, etc.) displaying live per-token pricing.

   * **Local Laya Card (GTX 1050 3GB):** Status badge (`Loaded on CUDA FP16 — 710MB VRAM` or `Unloaded`), `[⚡ تحميل Laya محلياً للاستدلال الصفري (Zero-Shot Test)]` button, checkpoint selector (`convaiinnovations/laya-multilingual` or custom fine-tuned folder), and device selector (`Auto 3GB Safe`, `CUDA FP16`, `CPU`).

2. **Middle Panel: Detailed Requests Inspector Table (`#tbodyAiRequestLogs`):**

   * Columns:

     1. `#` & Timestamp

     2. **المقتبس والنوع (`Finding & Type`)** — e.g. `«إنما الأعمال...» (HADITH)`

     3. **النموذج والوضع (`Model & Mode`)** — e.g. `typesafe/jev-1.14 (Decisions)` or `gemini-3.5-flash-lite`

     4. **القرار والاحتمالات (`Verdict & Probabilities`)** — Badge (`CORRECT` / `FALSE` / `NOT_SURE`) + probability bar (`P(C)=0.91, P(F)=0.04, P(NS)=0.05`) + manual override buttons `[🟢] [🔴] [🟡]` so the user can correct any decision right in the table!

     5. **حجم السياق (`Context Size`)** — `Input Tokens` + `Output Tokens` + `Chars`

     6. **الزمن (`Latency`)** — `ms` (plus backoff/retry badge if rate-limited)

     7. **التكلفة (`Cost`)** — Exact `$0.0000XX`

     8. **التفاصيل (`Inspect Payload`)** — Button `[🔍 عرض المدخلات والمخرجات]` that opens a clean drawer/modal showing the exact JSON `state`, `questions` / prompt sent, and the raw JSON response received.

3. **Bottom Panel: Phase 3 Laya Training Dataset Bank & Universal Converter (`#layaDatasetBankPanel`):**

   * Shows total accumulated verified decisions across all lectures stored in `IndexedDB` (`WahyLayaTrainingDB`):

     * Total records, count by source (`JEV`, `Gemini`, `OpenRouter LLM`, `Human Override`), class balance (`CORRECT` vs `FALSE` vs `NOT_SURE`).

   * Export & Conversion buttons:

     * `[📦 تصدير بيانات تدريب Laya الموحدة (.jsonl)]` (runs the Universal Converter!)

     * `[🐍 تحميل سكريبت تدريب Laya الجاهز (finetune_laya.py)]`

     * `[🗑️ مسح سجل التدريب]`

## 6. The Universal `Laya` Dataset Converter & Fine-Tuning Recipe (`backend/laya_converter.py`)

The user asked:

> *"btw if fine tuning laya can be done only with jev data tell me, or if it can be with any data but need converting build that converter"*

### 6.1. How the Universal Converter Works

**Agy** must implement `convertVerificationRecordsToLayaJsonl(records, options)` in **both** `js/ai-verifier.js` (so it works 100% in browser without backend) AND `backend/laya_converter.py` (for CLI/backend pipelines).

Every saved verification record in `WahyLayaTrainingDB` has:

* `state`: The canonical `state` dictionary (`source_type`, `candidate_reference`, `canonical_corpus_text`, `context_before`, `matched_span_in_lecture`, `context_after`, `engine_confidence_band`, `engine_score`, `has_citation_cue`).

* `questions`: The canonical `questions` dictionary (`verdict` with `type: "choice"` and `criteria: { CORRECT, FALSE, NOT_SURE }`).

* `verdict`: Final label (`"CORRECT"`, `"FALSE"`, or `"NOT_SURE"` — if `humanOverride` is true, the human label takes priority over the AI label!).

* `probabilities`:

  * If the record came from **JEV** or **Laya**, it already has calibrated `probabilities: { CORRECT, FALSE, NOT_SURE }`.

  * If the record came from **Gemini 3.5 Flash-Lite** or an **OpenRouter Chat LLM** (which returns `verdict` and `confidence` $c \in [0.34, 1.0]$), the converter synthesizes calibrated soft probabilities using Laplace-smoothed confidence distribution: 

    $$
    P(\text{verdict}) = c, \quad P(\text{other}_1) = \frac{1 - c}{2}, \quad P(\text{other}_2) = \frac{1 - c}{2}
    $$

  * If the record was **Human Overridden**, it sets a high-confidence teacher target: 

    $$
    P(\text{human\_verdict}) = 0.98, \quad P(\text{other}_1) = 0.01, \quad P(\text{other}_2) = 0.01
    $$

### 6.2. Output JSONL Line Schema for `Laya` Fine-Tuning

Each line in the exported `wahy_laya_train.jsonl` file follows Laya's exact `typed-decisions` training schema:

```
{
  "id": "wahy_dec_1729351200_0042",
  "state": {
    "source_type": "HADITH",
    "candidate_reference": "رياض الصالحين (18)",
    "canonical_corpus_text": "اتق الله حيثما كنت وأتبع السيئة الحسنة تمحها وخالق الناس بخلق حسن",
    "context_before": "ومن أعظم الوصايا الجامعة التي يحتاجها العبد في سلوكه مع ربه ومع الخلق قوله عليه الصلاة والسلام",
    "matched_span_in_lecture": "اتق الله حيثما كنت وأتبع السيئة الحسنة تمحها",
    "context_after": "وهذا الحديث أصل في باب المعاملات والأخلاق",
    "engine_confidence_band": "VERIFIED",
    "engine_score": 19.4,
    "has_citation_cue": true
  },
  "questions": {
    "verdict": {
      "type": "choice",
      "instructions": "In this Arabic Islamic lecture transcript, determine whether `matched_span_in_lecture` (surrounded by `context_before` and `context_after`) is an actual quotation/citation of `canonical_corpus_text` (`source_type`), or if it is merely ordinary speaker prose/explanation that happens to share words with the corpus text.",
      "criteria": {
        "CORRECT": "The speaker is genuinely quoting, reciting, or invoking this Quranic Ayah, Prophetic Hadith, or Dhikr (verbatim or as a direct religious citation in context).",
        "FALSE": "False positive: the words are ordinary conversational speech, fiqh explanation, or narrator/person names that coincidentally overlap with corpus vocabulary without quoting the text.",
        "NOT_SURE": "Ambiguous or partial paraphrase/meaning-only allusion where it is borderline whether the speaker intended a direct quotation."
      }
    }
  },
  "answers": {
    "verdict": {
      "type": "choice",
      "choice": "CORRECT",
      "probabilities": {
        "CORRECT": 0.96,
        "FALSE": 0.02,
        "NOT_SURE": 0.02
      }
    }
  },
  "meta": {
    "source_provider": "gemini-3.5-flash-lite",
    "human_verified": false,
    "lecture_title": "محاضرة علمية"
  }
}

```

### 6.3. Included Fine-Tuning Script (`backend/finetune_laya.py`)

**Agy** must also create a ready-to-run script `backend/finetune_laya.py` (which can run locally on the GTX 1050 3GB by freezing the `mmBERT-base` encoder layers and training only the 2-layer Decision Head + temperature calibration in `< 1.4 GB VRAM`, OR run full-model fine-tuning on free Kaggle/Colab T4):

* **Mode A (`--head-only`, Default for Local GTX 1050 3GB VRAM):**

  * Freezes `model.encoder` (`mmBERT-base` 307M params) so no encoder gradients or optimizer states are stored in VRAM!

  * Trains only the **15M-parameter Decision Head** (2 transformer layers + option-marker scorer + act/escalate head) in FP16/BF16 with `batch_size=1, grad_accum=8`, using **< 1.3 GB VRAM** on the GTX 1050!

  * Fits per-option-count **temperature calibration** (`temperature = [T_choice, T_noul, T_score]`) on the validation split (20%) to fix Laya's default uncalibrated overconfidence.

  * Saves the fine-tuned checkpoint to `backend/models/laya-wahy-finetuned`.

* **Mode B (`--full-finetune`, for Colab / Kaggle 16GB T4):**

  * Unfreezes the top 6 encoder layers + decision head with RLCD / soft-target KL-divergence + cross-entropy loss.

## 7. Step-by-Step Execution Checklist for `Agy`

`Agy` must execute the implementation in the following strict sequence:

1. **Step 1 — Backend Local Laya & Universal Converter (`backend/`):**

   * Update `backend/requirements.txt` with `laya`, `transformers`, `accelerate`, `safetensors`, `httpx`.

   * Create `backend/laya_engine.py` with `USE_TF=0`, `LocalLayaVerifier`, GTX 1050 3GB VRAM check (`torch.cuda.mem_get_info()`), Whisper unload hook, and FP16 inference on `convaiinnovations/laya-multilingual`.

   * Create `backend/laya_converter.py` and `backend/finetune_laya.py` (supporting `--head-only` for 3GB VRAM local fine-tuning and `--full-finetune` for cloud GPUs).

   * Update `backend/app.py` to add `/api/laya/status`, `/api/laya/load`, `/api/laya/predict`, `/api/laya/convert-dataset`, and `/api/openrouter/decisions`.

2. **Step 2 — State & IndexedDB Training Store (`js/state.js`):**

   * Extend `currentState` with `aiVerification` state object.

   * Add IndexedDB helper functions (`openWahyLayaTrainingDB`, `saveVerificationRecordToDB`, `getAllVerificationRecordsFromDB`, `clearVerificationRecordsDB`) so every verified finding and human override is persisted automatically across sessions.

3. **Step 3 — Core AI Verifier Module (`js/ai-verifier.js`):**

   * Implement `buildCanonicalDecisionEnvelope(det, words, contextWindowWords)`.

   * Implement Provider 1: `verifyWithGeminiFlashLite()` with batching (`geminiBatchSize`), sliding-window RPM rate limiter (`geminiRpmLimit`), and HTTP 429 exponential backoff + `Retry-After` handling.

   * Implement Provider 2: `verifyWithOpenRouterJev()` calling `/api/alpha/decisions` (or `/api/openrouter/decisions` proxy) with `{ model, state, questions }` and reading `answers.verdict` + `usage.cost`.

   * Implement Provider 3: `fetchOpenRouterModelsCatalog()` (`GET https://openrouter.ai/api/v1/models`) and `verifyWithOpenRouterChat()` for any searched model (Gemini, DeepSeek, Qwen, etc.).

   * Implement Provider 4: `verifyWithLocalLaya()` calling `POST /api/laya/predict`.

   * Implement live telemetry aggregator (`updateAiVerificationMetrics()`) computing Engine Time, Total Requests, Requests Full Time, Avg Request Time, Total Context (tokens & chars), Avg Context per Request, and Estimated Cost (USD).

   * Implement `exportLayaFineTuningJsonl()` (the in-browser Universal Converter).

4. **Step 4 — UI Updates (`index.html`, `css/styles.css`, `js/render.js`, `js/editor.js`, `js/events.js`):**

   * In `index.html`:

     * Add the 5th main navbar tab `#navBtn_ai_logs` (`🤖 الذكاء الاصطناعي والسجل`).

     * In `#section_display` and `#section_editor`, add the **AI Verdict Visibility Filter Bar** (`[🟢 مقبول]`, `[🟡 غير متأكد]`, `[🔴 خاطئ]`, `[⚪ غير مفحوص]`) and the collapsible **AI Verification Runner & Metrics Ribbon**.

     * Build `#section_ai_logs` containing the Provider & Model Search Studio, the Request Telemetry & Inspector Table, the Request Payload Modal, and the Laya Fine-Tuning Dataset Bank.

   * In `js/render.js` & `js/caption-builder.js`:

     * Respect `currentState.aiVerification.visibilityFilter` when rendering citations in the lecture view and when building smart captions (so detections classified as `FALSE` are automatically demoted to normal speech unless the user toggles `showFalse` ON).

     * Render AI verdict badges (`🟢`, `🟡`, `🔴`) on citations and inside the Finding Inspector (`js/editor.js`), allowing 1-click human override of the AI verdict.

   * Include `<script defer src="js/ai-verifier.js"></script>` in `index.html` right after `js/caption-builder.js`.

5. **Step 5 — Validation & End-to-End Verification:**

   * Run `node --check` on all `.js` files and `python3 -m py_compile` on all `backend/*.py` files.

   * Verify that every static `getElementById` in `js/*.js` matches an `id` in `index.html`.

   * Test all 4 verification modes (Gemini 3.5 Flash-Lite with simulated 429 backoff, OpenRouter JEV Decisions payload, OpenRouter searchable model selector, and Local Laya `convaiinnovations/laya-multilingual` zero-shot inference) and verify `.jsonl` export from the Universal Converter.