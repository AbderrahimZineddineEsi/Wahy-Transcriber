@echo off
REM =============================================================================
REM Wahy-Finder v2.0 — Windows Startup Script (GTX 1050 3GB VRAM + Groq Ready)
REM =============================================================================
setlocal
cd /d "%~dp0"

echo ========================================================
echo   Wahy-Finder v2.0 — FastAPI + Whisper/Groq Launcher
echo ========================================================

where ffmpeg >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARNING] FFmpeg was not found in your system PATH.
    echo           Please install FFmpeg (e.g., winget install Gyan.FFmpeg) for audio extraction.
)

if not exist ".venv" (
    echo [1/3] Creating Python virtual environment (.venv)...
    python -m venv .venv
)

echo [2/3] Activating virtual environment and installing requirements...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r backend\requirements.txt

echo [3/3] Starting Wahy-Finder v2.0 at http://127.0.0.1:8000 ...
start "" http://127.0.0.1:8000
cd backend
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
pause
