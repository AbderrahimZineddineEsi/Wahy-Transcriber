# Wahy Studio (Wahy-Transcriber v2.2)

> **An integrated platform for transcribing lectures and scholarly lessons, detecting and sourcing Quranic verses, Prophetic hadiths, and adhkar, building synchronized visual captions, with a multi-model AI Verification Layer and ultra-fast local inference via the Laya model (3GB VRAM).**

---

## 🌟 Key Highlights of v2.2

### 1. 🤖 AI Verification Layer for Quotes
A religious and linguistic verification engine supporting 4 providers and multiple working models to validate quotes and distinguish genuine quotes from ordinary explanatory speech by the sheikh:

* **✨ Google Gemini 3.5 Flash-Lite (API & Free Plan):**
  * Supports the latest Flash-Lite releases (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.8-flash`).
  * **Sliding Window RPM Pacer:** automatic compliance with the free plan limit (12–15 RPM) without key suspension.
  * **Rate-Limit Handling (429 / 503 Backoff):** automatic reading of the `Retry-After` header with exponential backoff, plus pause/resume/skip controls.
  * **Smart Batching:** batch up to 5–10 quotes per API request to conserve the free quota.
* **🎯 OpenRouter — Custom JEV Mode (Decisions API):**
  * Dedicated connection to TypeSafe System-1 models (`typesafe/jev-1.14`, `~typesafe/jev-latest`, `typesafe/jev-1.13`) via the `/api/alpha/decisions` endpoint.
  * Calibrated probability output per option (`CORRECT`, `FALSE`, `NOT_SURE`) without text generation, at minimal token cost ($0.042 per million tokens).
* **🌐 OpenRouter — Universal LLM Search:**
  * Instant search bar and live library of 500+ models (DeepSeek V3/R1, Qwen 2.5, Claude, Gemini, Llama, and `:free` models).
  * Live token pricing display and automatic routing of the invocation method.
* **🖥️ Local Laya Engine (Local Laya-Multilingual on GTX 1050 3GB VRAM):**
  * 100% offline execution of `convaiinnovations/laya-multilingual` (322M, `mmBERT-base` architecture).
  * Very economical VRAM usage (~750MB in FP16) with ~30ms inference per decision.
  * Smart VRAM protection: automatically unloads the Whisper model when verification is requested, with automatic fallback to CPU if VRAM drops below 850MB.

---

### 2. 🎛️ AI Answer Filtering in Reader and Editor (Visibility Filter)
Full, free control over how quotes appear and are formatted inside the lecture and visual captions, based on the AI verdict:
* **Multi-button filter group (`#aiVerdictFilterGroup`):**
  * `[✓ Accepted 🟢]` (`showCorrect`)
  * `[? Unsure 🟡]` (`showNotSure`)
  * `[✕ Wrong / Ordinary speech 🔴]` (`showFalse` — disabled by default after verification to clean up the lecture automatically, re-enable with one click to review excluded items).
  * `[⏳ Unverified ⚪]` (`showUnverified`)
  * Quick toggle buttons: `All`, `Accepted only`, `Accepted + Unsure`, `Excluded only`.
* **Smart display behavior:** when a quote is classified as `FALSE` and hidden, **the original text is not deleted** — formatting and brackets are stripped so it returns to ordinary speech in both the lecture transcript and video subtitles.
* **Instant verification badges:** confidence percentage shown on quotes: `🟢 Confirmed (94%)`, `🟡 Unsure (58%)`, `🔴 Ordinary speech (89%)`.

---

### 3. 📊 Request Telemetry Studio (Tab 5: AI & Logs)
A fifth main tab dedicated to analysis, monitoring, and tuning:
* **Live KPI strip (8 cards):**
  * Language engine detection time • total requests and success rate • total request time (Wall-Clock & Cumulative) • average request time • total context sent (tokens and characters) • average context per request • decision distribution (correct / wrong / unsure) • estimated actual cost in USD.
* **Detailed Request Inspector table:**
  * Review every request with its timestamp, model, probability bar, cost, and duration.
  * **Instant Human Gold Override:** direct correction buttons `[🟢]` `[🔴]` `[🟡]` inside the table and in the Finding Inspector card, giving the user's opinion top priority and storing it as golden training data.
  * **Inspect Payload Modal:** view the exact JSON sent to the model (`state` and `questions`) and the raw response received.

---

### 4. 📦 Universal Laya Converter and Training Script
* **Universal Laya Converter:**
  * Converts audit logs from any source (Gemini, OpenRouter LLMs, JEV, Human Overrides) into standard `.jsonl` fully compatible with `Laya` training standards.
  * Generates Laplace-smoothed soft targets for Gemini/LLM outputs and a high-precision teacher target (0.98) for human corrections.
* **Cumulative training data bank:**
  * Automatic saving of decisions via IndexedDB (`WahyLayaTrainingDB`) across all lectures, exportable with one click.
* **Ready training script ([`backend/finetune_laya.py`](file:///home/zeno/Documents/work/new_projects/Wahy-Transcriber/backend/finetune_laya.py)):**
  * **`--head-only` mode:** designed for budget hardware such as GTX 1050 (3GB VRAM); freezes `mmBERT` (307M) and trains only the decision head (15M) with temperature calibration, under 1.3GB VRAM.
  * **`--full-finetune` mode:** full training on cloud GPUs (Google Colab / Kaggle T4 16GB).

---

### 5. 🎬 Display, Editing, and Caption Building Engine (Core Features)
* **Synchronized Display View:** advanced video player synchronized with the formatted lecture text, equipped with a **live word-tracking bar** and smart smooth scrolling that pauses automatically during selection or editing.
* **FN Studio (missing-item studio):** mark missed verses, hadiths, and adhkar with two clicks (first word and last word) with interactive highlighting, instant suggestions from the corpus, Ottoman-script matching, and support for the ten readings.
* **Atomic (undivided) smart captions:** build synchronized subtitles (`SRT`, `VTT`, `ASS`) ensuring verses and hadiths stay as a single undivided unit, with precise word timing via the Longest Common Subsequence (LCS) algorithm.
* **Datasets & Adhkar Studio:** manage, search, import, and export the adhkar and supplications database, synced locally and in the cloud.

---

### 6. ✂️ Boundary-Truncation Flagging & Smart Auto-Heal
An advanced system for handling the limitations of audio engines in precisely determining the start or end of a quote:
* **Zero extra API cost synchronous query:** a second orthogonal `boundary_status` question (`COMPLETE_SPAN`, `MISSING_START`, `MISSING_END`, `MISSING_BOTH`) is injected into the same original verification request for all providers (Gemini, OpenRouter JEV, Universal LLMs, Local Laya).
* **Distinguishing intentional partial quotes:** intelligently distinguishes an intentional partial quote by the explanatory sheikh (the evidentiary spot — `COMPLETE_SPAN`) from engine truncation of the start or end of a verse/hadith actually spoken by the sheikh in the adjacent transcript.
* **Visual badges and dedicated filtering:**
  * Warning badges in the lecture view: `[✂️ Missing start]`, `[✂️ Missing end]`, `[✂️ Missing both ends]`.
  * Quick filter button in the toolbar: `[✂️ Truncated boundaries only 🟠]` to isolate truncated quotes with one click.
* **1-Click Smart Auto-Heal:** a magic button `[🪄 Auto-expand missing boundaries]` in the quote inspection card algorithmically matches adjacent words from the original text and expands the quote's time range and text, updating captions instantly without manual editing.
* **Multi-task Laya training outputs:** export `.jsonl` files containing both decisions to train Laya on religious verification and boundary-truncation detection in parallel.

---

## 🏗️ Project Architecture

```
Wahy-Transcriber/
├── index.html                       # Main UI (5 tabs, filter bars, AI studio)
├── css/
│   └── styles.css                   # UI styling, AI badges, and metric cards
├── js/
│   ├── state.js                     # Global state management and IndexedDB training store
│   ├── ai-verifier.js               # AI verification engine (Gemini, JEV, OpenRouter, Laya) and universal converter
│   ├── engine.js                    # Linguistic and audio matching engine for quotes
│   ├── corpus-loader.js             # Loading Quran, hadith, and adhkar corpora
│   ├── caption-builder.js           # Caption generation respecting AI filters
│   ├── render.js                    # UI rendering, filter bar, request table, metric cards
│   ├── editor.js                    # Smart editor, FN studio, manual decision editing
│   ├── events.js                    # Wiring all UI elements, events, and buttons
│   └── error-handler.js             # Diagnostic error trap and AI copy window
├── backend/
│   ├── app.py                       # FastAPI server, Laya endpoints, audio/media transcription
│   ├── laya_engine.py               # Safe local Laya engine on GTX 1050 (3GB VRAM)
│   ├── laya_converter.py            # Converting logs into Laya JSONL training data
│   ├── finetune_laya.py             # Local and cloud precise training script
│   ├── transcriber.py               # Audio transcription via faster-whisper or Groq
│   ├── media_processor.py           # YouTube processing and media conversion via yt-dlp and ffmpeg
│   └── requirements.txt            # Python requirements (torch, laya, transformers, fastapi)
├── run.sh                           # Auto-run script for Linux / macOS
├── run.bat                          # Auto-run script for Windows
├── wahy_ai_verification_and_laya_plan.md     # Architectural reference and system specs
├── agy_phase2_audit_and_fix_plan.md          # Comprehensive phased audit and fix plan
└── agy_boundary_truncation_feature_plan.md   # Boundary-truncation detection and auto-heal feature plan
```

---

## 🚀 Quick Start

### Method 1: Direct Browser Run (Client-Only Mode)
* No backend server required! Open `index.html` in any modern browser (Chrome / Firefox / Edge).
* Immediately enables:
  * Pasting text and subtitle files (`.txt / .srt / .vtt`).
  * Running detection and matching of Quran, hadith, and adhkar locally in the browser.
  * Verification with **Gemini 3.5 Flash-Lite** and **OpenRouter (JEV & Universal)** using your own API keys.
  * Exporting Laya training data directly from the browser.

---

### Method 2: Full Run with Local Server (Full-Stack Mode)
Enables YouTube transcription, audio/video file uploads, and running the **local Laya model** on your GPU (GTX 1050 3GB):

#### On Linux / macOS:
```bash
# Grant execute permission
chmod +x run.sh

# Auto-run (creates the environment, installs requirements, and starts the server)
./run.sh
```

#### On Windows:
Double-click `run.bat` or run it from the command prompt:
```bat
run.bat
```

The system will automatically open the browser at: `http://127.0.0.1:8000`

---

## ⚙️ AI Provider Setup

Open the **«🤖 AI & Logs»** tab:
1. **Google Gemini:** enter your key from Google AI Studio and select `gemini-3.5-flash-lite`. Enable `Free Tier` to protect your quota from overuse.
2. **OpenRouter:** enter your OpenRouter key:
   * Choose `🎯 JEV Decisions API` mode to use `typesafe/jev-1.14` models.
   * Or use `💬 Universal Search` mode to type any model name you want (e.g. `deepseek/deepseek-chat`, `qwen/qwen-2.5-72b-instruct`, or `free`).
3. **Local Laya:** in the Laya card, click **«Load Laya locally»**; VRAM will be checked and the model activated on `CUDA FP16` or `CPU`.

---

## 🧪 Fine-Tuning Laya Locally

After collecting and verifying lectures and exporting `wahy_laya_train.jsonl` via the data bank:

```bash
# Economical decision-head training on GTX 1050 (under 1.3GB VRAM):
python backend/finetune_laya.py --data wahy_laya_train.jsonl --head-only --epochs 5

# Full training on Google Colab / Kaggle:
python backend/finetune_laya.py --data wahy_laya_train.jsonl --full-finetune --epochs 3
```

---

## 📄 License & Credits
* The project is built with the latest web technologies and standards for processing Islamic texts and the sciences of Quran and hadith.
* The project uses: [Laya](https://github.com/convaiinnovations/laya), [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper), [Transformers](https://github.com/huggingface/transformers), [FastAPI](https://fastapi.tiangolo.com).
