# Agy Phase 2 Audit, Verification & Fix Plan (`wahy-transcriber`)

> **Why this Audit & Fix Plan is required:**
> The GitHub repository snapshot attached to the session is currently at commit `2fa60f87cddb1d00171972c5851a6fba0d3593ff` (8,249 total lines across 19 files — the v2.0 baseline prior to the Phase 2 AI Verification Layer). Whether `Agy`'s Phase 2 changes are on an unpushed local branch, a separate unmerged Git branch, or partially applied, **`Agy` must first run the automated verification script in Section 1 below and apply every fix in Section 2 where a check fails before merging or starting the Boundary-Truncation feature.**

---

## 1. Automated Self-Audit Script for `Agy` (`verify_phase2.py`)

**Instruction for `Agy`:** Run the following command from the root of `wahy-transcriber` to audit your current working tree and branch:

```bash
python3 - << 'EOF'
import os, re, glob, subprocess, sys

REQUIRED_FILES = [
    "index.html",
    "css/styles.css",
    "js/state.js",
    "js/corpus-loader.js",
    "js/engine.js",
    "js/caption-builder.js",
    "js/ai-verifier.js",
    "js/editor.js",
    "js/render.js",
    "js/events.js",
    "backend/app.py",
    "backend/laya_engine.py",
    "backend/laya_converter.py",
    "backend/finetune_laya.py",
    "backend/requirements.txt"
]

issues = []

# 1. File existence check
for rf in REQUIRED_FILES:
    if not os.path.isfile(rf):
        issues.append(f"[MISSING FILE] {rf} does not exist.")

# 2. JS Syntax check via node --check
for jsf in glob.glob("js/*.js"):
    res = subprocess.run(["node", "--check", jsf], capture_output=True, text=True)
    if res.returncode != 0:
        issues.append(f"[JS SYNTAX ERROR] {jsf}: {res.stderr.strip()}")

# 3. Python syntax check
for pyf in glob.glob("backend/*.py"):
    res = subprocess.run([sys.executable, "-m", "py_compile", pyf], capture_output=True, text=True)
    if res.returncode != 0:
        issues.append(f"[PYTHON SYNTAX ERROR] {pyf}: {res.stderr.strip()}")

# 4. DOM ID cross-check between index.html and js/*.js
if os.path.isfile("index.html"):
    html = open("index.html", encoding="utf-8").read()
    html_ids = set(re.findall(r'id="([^"]+)"', html))
    for req_id in [
        "navBtn_ai_logs", "section_ai_logs", "aiVerdictFilterGroup",
        "chkFilterShowCorrect", "chkFilterShowNotSure", "chkFilterShowFalse", "chkFilterShowUnverified",
        "inpOpenRouterModelSearch", "tbodyAiRequestLogs", "aiMetricsSummaryGrid"
    ]:
        if req_id not in html_ids:
            issues.append(f"[MISSING HTML ID] #{req_id} is missing from index.html")

    if "js/ai-verifier.js" not in html:
        issues.append("[MISSING SCRIPT TAG] <script defer src=\"js/ai-verifier.js\"></script> is missing from index.html")

# 5. Critical Phase 2 Feature Checks
if os.path.isfile("js/ai-verifier.js"):
    aiv = open("js/ai-verifier.js", encoding="utf-8").read()
    for token, desc in [
        ("gemini-3.5-flash-lite", "Default Gemini 3.5 Flash-Lite model ID"),
        ("/api/alpha/decisions", "OpenRouter JEV Decisions API endpoint"),
        ("typesafe/jev-1.14", "TypeSafe JEV 1.14 model ID"),
        ("/api/v1/models", "OpenRouter dynamic models catalog fetch"),
        ("buildCanonicalDecisionEnvelope", "Canonical { state, questions } builder"),
        ("convertVerificationRecordsToLayaJsonl", "Universal Laya JSONL converter")
    ]:
        if token not in aiv:
            issues.append(f"[MISSING LOGIC in js/ai-verifier.js] {desc} ({token})")

if os.path.isfile("backend/laya_engine.py"):
    le = open("backend/laya_engine.py", encoding="utf-8").read()
    if 'os.environ["USE_TF"] = "0"' not in le and "os.environ['USE_TF'] = '0'" not in le:
        issues.append("[CRITICAL DEADLOCK BUG in backend/laya_engine.py] Missing os.environ['USE_TF'] = '0' before importing laya/transformers")
    if "convaiinnovations/laya-multilingual" not in le:
        issues.append("[WRONG CHECKPOINT in backend/laya_engine.py] Must use convaiinnovations/laya-multilingual for Arabic, not English laya")

if issues:
    print("❌ AUDIT FAILED WITH ISSUES:")
    for i in issues:
        print("  -", i)
    sys.exit(1)
else:
    print("✅ ALL PHASE 2 CHECKS PASSED!")
EOF
```

---

## 2. Mandatory Fixes & Implementation Checklist (If Any Check Fails)

### Fix 1: Missing or Unlinked `js/ai-verifier.js` & Script Load Order in `index.html`
- Ensure `js/ai-verifier.js` is created and loaded in `index.html` in this exact order:
  ```html
  <script defer src="js/error-handler.js"></script>
  <script defer src="js/state.js"></script>
  <script defer src="js/corpus-loader.js"></script>
  <script defer src="js/engine.js"></script>
  <script defer src="js/caption-builder.js"></script>
  <script defer src="js/ai-verifier.js"></script>
  <script defer src="js/editor.js"></script>
  <script defer src="js/render.js"></script>
  <script defer src="js/events.js"></script>
  ```

### Fix 2: OpenRouter `JEV` Mode Must Use `/api/alpha/decisions` (Not `/api/v1/chat/completions`)
- **Common Bug to Fix:** Calling `typesafe/jev-1.14`, `typesafe/jev-1.13`, or `~typesafe/jev-latest` via `/api/v1/chat/completions` fails with HTTP 400 because JEV does not generate text.
- **Required Fix in `js/ai-verifier.js` & `backend/app.py`:**
  - When `activeProvider === "openrouter_jev"` OR when the selected OpenRouter model ID starts with `typesafe/jev` or `~typesafe/jev`:
    - Send `POST https://openrouter.ai/api/alpha/decisions` (or via backend proxy `POST /api/openrouter/decisions`) with body:
      ```json
      {
        "model": "typesafe/jev-1.14",
        "state": { ... },
        "questions": {
          "verdict": {
            "type": "choice",
            "instructions": "...",
            "criteria": {
              "CORRECT": "...",
              "FALSE": "...",
              "NOT_SURE": "..."
            }
          }
        }
      }
      ```
    - Parse `res.answers.verdict.choice`, `res.answers.verdict.confidence`, `res.answers.verdict.probabilities`, and `res.usage.cost` (or `res.usage.input_tokens * 0.000000042`, with output tokens = `$0.00`).

### Fix 3: Gemini 3.5 Flash-Lite Free-Tier Rate Limit (RPM) & HTTP 429 Recovery
- Default model must be `gemini-3.5-flash-lite` (with selector options for `gemini-3.1-flash-lite`, `gemini-3.8-flash`, `gemini-2.5-flash-lite`).
- When `geminiFreeTierMode === true`:
  - Batch up to `geminiBatchSize` (default `5`) findings into a single `generateContent` call using `responseMimeType: "application/json"` and `responseSchema` (an `ARRAY` of `{ finding_id, verdict, confidence, probabilities, reason }`).
  - Enforce a sliding-window token bucket (`geminiRpmLimit = 12` requests per 60 seconds).
  - On HTTP `429` (`RESOURCE_EXHAUSTED`) or `503`, parse `retryDelay` from `error.details` or `Retry-After` header, display a live countdown in the UI, and retry up to 4 times with exponential backoff (`5s -> 15s -> 35s -> 65s`) without losing already-verified findings.

### Fix 4: OpenRouter Searchable Model Selector (`GET https://openrouter.ai/api/v1/models`)
- Fetch the live OpenRouter catalog once per session and cache it.
- Provide a live search input (`#inpOpenRouterModelSearch`) and category filter chips (`⚡ JEV & Decision Models`, `✨ Google Gemini`, `🐉 Chinese Models: DeepSeek / Qwen / GLM`, `🆓 Free Models`) showing live prompt/completion pricing per 1M tokens.

### Fix 5: Display & Editor Verdict Visibility Filter (`#aiVerdictFilterGroup`)
- In the Display tab (`#section_display`) and Smart Editor tab (`#section_editor`), provide 4 independent checkboxes/pills that the user can toggle in any combination:
  - `chkFilterShowCorrect` (`🟢 مقبول` — default `true`)
  - `chkFilterShowNotSure` (`🟡 غير متأكد` — default `true`)
  - `chkFilterShowFalse` (`🔴 خاطئ / كلام عادي` — default `false`)
  - `chkFilterShowUnverified` (`⚪ غير مفحوص` — default `true`)
- **Non-Destructive Filtering:** In `renderFormattedLectureView()` and `buildSmartCaptions()`, if a detection's AI verdict is unchecked in `visibilityFilter`, render its words as plain lecture text (suppressing citation brackets and color pills) **without removing the detection from `currentState.detections`**, so toggling `chkFilterShowFalse` back ON immediately reveals rejected items for inspection.

### Fix 6: Post-Run Metrics Ribbon & Tab 5 (`🤖 الذكاء الاصطناعي والسجل`)
- Ensure `#aiMetricsSummaryGrid` displays all 8 metrics:
  1. `Engine Detection Time (ms)`
  2. `Total Requests` (successful vs. rate-limited)
  3. `Requests Full Time (s / ms)`
  4. `Avg Request Time (ms)`
  5. `Total Context` (tokens & characters)
  6. `Avg Context per Request` (tokens & characters)
  7. `Verdicts Breakdown` (`CORRECT` / `FALSE` / `NOT_SURE`)
  8. `Estimated Cost ($ USD)`
- Ensure Tab 5 (`#section_ai_logs`) displays every request in `#tbodyAiRequestLogs` with an `[🔍 عرض المدخلات والمخرجات]` modal inspector, inline human verdict override buttons (`[🟢] [🔴] [🟡]`), and the **Universal Laya Dataset Exporter (`.jsonl`)**.

### Fix 7: Local `Laya-Multilingual` on GTX 1050 (3GB VRAM) & Universal Converter
- In `backend/laya_engine.py`:
  - Set `os.environ["USE_TF"] = "0"` before importing `laya`.
  - Load `convaiinnovations/laya-multilingual` (322M params, ~647 MB FP16) — never English-only `convaiinnovations/laya`.
  - Unload `faster-whisper` from CUDA before loading Laya if free VRAM on the GTX 1050 is `< 900 MB`.
- In `backend/laya_converter.py` and `js/ai-verifier.js`:
  - Convert verification records from **any** provider (Gemini, OpenRouter Chat, JEV, or Human Overrides) into Laya's `{ id, state, questions, answers, meta }` `.jsonl` format, synthesizing Laplace-smoothed soft probabilities when the source model only returned a scalar confidence score.
