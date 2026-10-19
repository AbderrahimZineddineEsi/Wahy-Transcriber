# Wahy Studio — Wahy Transcriber

A local-first Arabic transcription and lecture editing workspace for audio, video, and YouTube media. Wahy Studio combines a Vanilla JavaScript frontend with a FastAPI backend, word-level timestamps, Arabic-aware transcription workflows, and tools for reviewing, editing, and exporting synchronized captions.

> **Project status:** Active development. Interfaces and backend behavior may change as the project evolves.

## Features

- **Multiple input sources**
  - Paste or edit transcript text directly in the browser.
  - Import subtitle files such as `.txt`, `.srt`, and `.vtt`.
  - Upload local audio or video files.
  - Download YouTube media through `yt-dlp`.
- **Arabic speech transcription**
  - Groq Cloud transcription using `whisper-large-v3-turbo`.
  - Local transcription using `faster-whisper` with `large-v3-turbo` or `small` models.
  - Word-level timestamps for synchronized editing and caption generation.
  - Automatic fallback from Groq to local models when enabled.
- **Media processing**
  - FFmpeg-based audio extraction and normalization.
  - Automatic conversion to 16 kHz mono WAV for local Whisper processing.
  - Compressed MP3 generation for Groq uploads.
  - Long recordings are split into sequential chunks while preserving time offsets.
- **Editing and review tools**
  - Synchronized media playback and transcript navigation.
  - Caption and transcript editing.
  - Qur’an, hadith, adhkar, and corpus-oriented review workflows supported by the frontend.
  - Structured error diagnostics from the backend.
- **Export and data workflows**
  - Export transcript and caption content in formats supported by the frontend, including HTML, Markdown, TXT, JSON, and subtitle-oriented outputs.
  - Optional corpus cache stored locally by the backend.

## Architecture

```text
Wahy-Transcriber/
├── index.html                 # Main browser application
├── css/                       # Frontend styles
├── js/                        # Frontend modules and editor logic
├── data/                      # Optional static datasets
├── backend/
│   ├── app.py                 # FastAPI server and API routes
│   ├── media_processor.py     # Upload, YouTube, FFmpeg, and chunk processing
│   ├── transcriber.py         # Groq and faster-whisper transcription engines
│   └── requirements.txt       # Python dependencies
├── run.sh                     # Linux/macOS launcher
├── run.bat                    # Windows launcher
└── .gitignore
```

The backend serves the frontend at `http://127.0.0.1:8000` and exposes the transcription API. Temporary media is written to `backend/temp_media/`, while optional corpus data is cached under `backend/data_cache/`; both locations are ignored by Git.

## Requirements

- Python 3.9 or newer
- FFmpeg and FFprobe available on your system `PATH`
- A modern browser
- Optional:
  - A **Groq API key** for cloud transcription.
  - A CUDA-capable NVIDIA GPU for local Whisper transcription. The implementation is optimized for constrained GPUs using INT8 processing, but CPU execution can also be used when CUDA is unavailable.

### Installing FFmpeg

Install FFmpeg using your operating system's package manager, then verify both commands are available:

```bash
ffmpeg -version
ffprobe -version
```

Examples:

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# macOS with Homebrew
brew install ffmpeg

# Windows with winget
winget install Gyan.FFmpeg
```

## Quick start

### Windows

From the repository root, run:

```bat
run.bat
```

The script creates `.venv` when needed, installs `backend/requirements.txt`, and starts the FastAPI server.

### Linux/macOS

Make the launcher executable once, then run it:

```bash
chmod +x run.sh
./run.sh
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

### Manual setup

```bash
python3 -m venv .venv
source .venv/bin/activate              # Windows: .venv\\Scripts\\activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt

# Optional: configure Groq for cloud transcription
export GROQ_API_KEY="your_api_key_here" # Windows PowerShell: $env:GROQ_API_KEY="your_api_key_here"

cd backend
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

If you only need the browser-based text and subtitle tools, you can open `index.html` directly or serve the repository with a simple local web server. You will need the FastAPI backend for YouTube downloads, uploaded-media transcription, and backend-managed media playback.

## Transcription modes

The backend supports these model selections:

| Mode | Description | Best for |
| --- | --- | --- |
| `groq-whisper-large-v3-turbo` | Uses Groq Cloud with `whisper-large-v3-turbo`; can fall back locally when enabled. | Fast cloud transcription with a Groq API key |
| `local-turbo-int8` | Uses local `faster-whisper` with `large-v3-turbo` in INT8 mode. | Higher local quality on compatible hardware |
| `local-small-int8` | Uses local `faster-whisper` with the `small` model in INT8 mode. | Lower VRAM usage and safer fallback processing |

When the Groq mode is selected, long audio is automatically divided into smaller chunks before upload. The resulting word timestamps are stitched back together using each chunk's original time offset.

## API overview

### Health check

```http
GET /api/health
```

Returns backend status, FFmpeg availability, CUDA availability, detected GPU information, and whether `GROQ_API_KEY` is configured.

### Transcribe media

```http
POST /api/transcribe
Content-Type: multipart/form-data
```

Accepted form fields include:

- `youtube_url` — a YouTube URL, or
- `file` — an uploaded audio/video file
- `model_selected` — one of the supported model names
- `groq_api_key` — optional key supplied by the client
- `auto_fallback` — whether local fallback is enabled

A successful response includes the media URL, title, selected model, duration, full text, and an array of timestamped words with character offsets.

Example health check:

```bash
curl http://127.0.0.1:8000/api/health
```

## Development notes

- Frontend code is written in plain JavaScript using ES modules; no frontend build step is currently required.
- The FastAPI application enables CORS for local development.
- Temporary uploads, downloaded media, generated audio files, and cache files should not be committed.
- The backend returns structured diagnostic information for unexpected errors, including the endpoint, selected model, input source, and traceback.
- Do not expose the development server or Groq API keys publicly without adding appropriate authentication, access controls, and production configuration.

## Troubleshooting

### `FFmpeg was not found`

Install FFmpeg and FFprobe, confirm they are on `PATH`, then restart the launcher or terminal.

### Groq transcription fails

Verify that the API key is valid, that the selected model is available to your account, and that the media can be processed within the provider's limits. Enable automatic fallback to try local transcription instead.

### CUDA out-of-memory errors

Use `local-small-int8`, enable automatic fallback, or run transcription on the CPU. Closing other GPU-heavy applications may also help.

### The page loads but transcription does not work

Start the FastAPI backend with `run.bat`, `run.sh`, or Uvicorn, then use `http://127.0.0.1:8000` rather than opening the HTML file from an unrelated origin.

## Contributing

Contributions, bug reports, and suggestions are welcome. Before opening a pull request:

1. Describe the problem or improvement clearly.
2. Test the frontend and backend paths affected by the change.
3. Avoid committing `.venv/`, generated media, cache files, API keys, or model artifacts.
4. Include screenshots or sample input/output when changing the editor UI or export behavior.

## License

No license file is currently included in this repository. Until a license is added, the project's source code should be treated as **all rights reserved**.
