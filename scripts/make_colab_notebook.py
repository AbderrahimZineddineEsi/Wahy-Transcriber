"""Generates the Colab notebook that runs the whole app on a Colab GPU (F-130).

    python scripts/make_colab_notebook.py

It writes notebooks/colab/tadqeeq_colab_runner.ipynb (the one Colab opens): ONE "Run all" flow in three cells.

    1. Options and Google Drive   clone this public repo, mount the user's Drive (default ON), restore saved data
    2. Install                    models, Python packages, Node, the web build and the corpus, all in parallel
    3. Run                        start ./run.sh (the same launcher as a laptop), load Laya on the GPU, open a
                                  Cloudflare tunnel, print the private link, keep data/ saved until you stop it

The helpers that can be tested without a GPU live in scripts/colab_support.py (the notebook imports them from the
clone). The cells are plain Python (no `!` or `%` magics), so tests can parse them, and they hold no key: keys come
from Colab Secrets, a hidden prompt, or the app's own Settings screen.
"""

import json
from pathlib import Path

BRANCH = "tadqeeq"
REPO = "AbderrahimZineddineEsi/Wahy-Transcriber"
LAYA = "ZenoAbderrahim/laya-wahy-r6-v3_mixed"
SPECIALIZED_WHISPER = "Abu-Dju/whisper-large-v3-ar"
PORT = 8000
NODE_VERSION = "v24.22.1"      # the engine worker is TypeScript that node runs directly: needs 22.18+
NOTEBOOK = "notebooks/colab/tadqeeq_colab_runner.ipynb"
SECRET_NAMES = ["HF_TOKEN", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]


def lines(text: str) -> list[str]:
    parts = text.strip("\n").split("\n")
    return [p + "\n" for p in parts[:-1]] + [parts[-1]]


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": lines(text)}


def code(text: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": lines(text)}


def fill(text: str) -> str:
    """Put the constants into a cell (placeholders, because the cells are full of braces)."""
    for key, value in {"@@REPO@@": REPO, "@@BRANCH@@": BRANCH, "@@LAYA@@": LAYA, "@@PORT@@": str(PORT),
                       "@@WHISPER@@": SPECIALIZED_WHISPER, "@@NODE@@": NODE_VERSION,
                       "@@SECRETS@@": json.dumps(SECRET_NAMES)}.items():
        text = text.replace(key, value)
    return text


INTRO = fill("""
# 🎙️ Tadqeeq on Google Colab (GPU)

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/@@REPO@@/blob/@@BRANCH@@/notebooks/colab/tadqeeq_colab_runner.ipynb)

The whole app on a free Colab GPU: every transcription model (Groq, local Whisper, the **specialized Arabic Whisper**),
detection, verification with the AI providers **and with local Laya on the GPU**, the editor, exports and Tafrigh.
You get a private link you open in any browser.

### How to use it
1. *Runtime → Change runtime type → **T4 GPU*** (the free tier is enough).
2. *Runtime → **Run all***. Approve the Google Drive pop-up when it appears (you can untick it in the first cell).
3. After about 5 minutes (about 2 on later runs) the last cell prints **your link**. Open it.
4. Type your API keys in the app's *Settings* screen (or put them in Colab *Secrets* 🔑 first: `HF_TOKEN` for the
   Laya model, and optionally `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`). No key is ever written in this notebook.

### Where your lectures are saved
| Option | What happens |
|---|---|
| **Drive ON (default)** | Lectures, settings, the database, uploaded media and the keys file are copied to **My Drive → Tadqeeq** every minute and when you stop. The next session restores them. It is your own Drive; nobody else sees it. |
| **Drive OFF** | Everything lives on the Colab machine and is **lost when the session ends**. A backup zip is refreshed every 2 minutes at `/content/tadqeeq-backup.zip` (Files panel on the left → download it) and is also offered for download when you stop the last cell. Put it in `RESTORE_BACKUP_ZIP` next time to get your lectures back. |

### Safety
The link is public on the internet, so the app is locked with a **random access token** that is part of the link
(`...trycloudflare.com/?token=...`). Anyone who has the full link can use the app and the API keys saved in it, so
do not share it, and *clear this notebook's outputs before sharing the notebook* (the link is in the output).
A new link and token are made every time you run the last cell.
""")

OPTIONS = fill('''
#@title 1 · Options, clone, Google Drive  { display-mode: "form" }
USE_GOOGLE_DRIVE = True        #@param {type:"boolean"}
DRIVE_FOLDER = "Tadqeeq"   #@param {type:"string"}
LOAD_LAYA = True               #@param {type:"boolean"}
RESTORE_BACKUP_ZIP = ""        #@param {type:"string"}

import getpass, os, subprocess, sys, time

REPO_DIR = "/content/Wahy-Transcriber"
START_TIME = time.time()


def sh(cmd, check=True, cwd=None, env=None):
    """Run a shell command and stream its output into the cell."""
    p = subprocess.Popen(cmd, shell=True, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, bufsize=1)
    for line in p.stdout:
        print(line, end="")
    code = p.wait()
    if check and code:
        raise RuntimeError(f"command failed ({code}): {cmd}")
    return code


# ---- the code: this public repo ----
if os.path.exists(REPO_DIR + "/.git"):
    sh(f"cd {REPO_DIR} && git fetch -q origin @@BRANCH@@ && git reset -q --hard origin/@@BRANCH@@")
else:
    sh(f"git clone -q --depth 1 -b @@BRANCH@@ https://github.com/@@REPO@@.git {REPO_DIR}")
sys.path.insert(0, REPO_DIR + "/scripts")
import colab_support as cs

# ---- the GPU ----
gpu = subprocess.run("nvidia-smi -L", shell=True, capture_output=True, text=True).stdout.strip()
print(gpu or "NO GPU: choose Runtime > Change runtime type > T4 GPU, then run all again (local Whisper and Laya need it).")

# ---- Google Drive: where your lectures are kept ----
DRIVE_DIR = None
if USE_GOOGLE_DRIVE:
    try:
        from google.colab import drive
    except ImportError:
        raise SystemExit("Google Drive can only be mounted on Colab. Set USE_GOOGLE_DRIVE = False to run without it.")
    drive.mount("/content/drive")
    DRIVE_DIR = cs.drive_dir_for("/content/drive", DRIVE_FOLDER, legacy=("Wahy-Studio",))
    restored = cs.restore_from_drive(REPO_DIR, DRIVE_DIR)
    print(f"Google Drive is ON. Your lectures are saved in: My Drive/{DRIVE_FOLDER}  ({DRIVE_DIR})")
    print("  restored from a previous session:", restored if (restored.files or restored.db) else "nothing yet (first run)")
else:
    print("=" * 78)
    print("Google Drive is OFF: everything (lectures, settings, keys) is LOST when this session ends.")
    print("A backup zip is refreshed every 2 minutes at /content/tadqeeq-backup.zip (Files panel, left bar),")
    print("and it is offered for download when you stop the last cell.")
    print("=" * 78)
if RESTORE_BACKUP_ZIP:
    if os.path.exists(RESTORE_BACKUP_ZIP):
        print("restored", cs.restore_backup_zip(RESTORE_BACKUP_ZIP, REPO_DIR), "file(s) from", RESTORE_BACKUP_ZIP)
    else:
        print("RESTORE_BACKUP_ZIP not found (upload it in the Files panel first):", RESTORE_BACKUP_ZIP)

# ---- keys from Colab Secrets (optional; never typed into this notebook) ----
try:
    from google.colab import userdata
except ImportError:
    userdata = None
for name in @@SECRETS@@:
    if userdata is None or os.environ.get(name):
        continue
    try:
        value = userdata.get(name)
    except Exception:
        value = None          # secret not set, or notebook access not granted
    if value:
        os.environ[name] = str(value).strip()
        print("loaded Colab secret:", name)

# ---- the Laya checkpoint is a private Hugging Face repo: it needs your read token ----
if LOAD_LAYA and not os.environ.get("HF_TOKEN"):
    try:
        from huggingface_hub import HfApi
    except ImportError:
        sh("pip install -q huggingface_hub")
        from huggingface_hub import HfApi
    try:
        HfApi().model_info("@@LAYA@@")
    except Exception:
        token = getpass.getpass("Hugging Face READ token for Laya (or press Enter to run without local Laya): ").strip()
        if token:
            os.environ["HF_TOKEN"] = token
        else:
            LOAD_LAYA = False
            print("Running without local Laya (the other models still work).")
print("step 1 done in", round(time.time() - START_TIME), "s")
''')

INSTALL = fill('''
#@title 2 · Install everything (parallel, cached)  { display-mode: "form" }
# Four things happen at once: the Python packages (torch, faster-whisper, laya), Node + the web build, the corpus
# (checked against its sha256) and the model downloads. A later run on the same Drive skips what it can.
import shutil

T0 = time.time()
LOGS = "/content/wahy-install"
os.makedirs(LOGS, exist_ok=True)
WEB_CACHE = (DRIVE_DIR / "cache") if DRIVE_DIR else None

# the built web app from a previous session (same sources) makes npm and the build unnecessary
web_cached = bool(WEB_CACHE) and cs.restore_web_dist(REPO_DIR, WEB_CACHE)
print("web app:", "restored from the Drive cache" if web_cached else "will be built once")

TOOLS = f"""
set -e
node_ok() {{ command -v node >/dev/null && node -p 'const [a,b]=process.versions.node.split(".").map(Number); (a>22||(a===22&&b>=18))?0:1' | grep -q 0; }}
if ! node_ok; then
  echo "installing Node @@NODE@@ (the engine runs TypeScript directly)..."
  curl -fsSL https://nodejs.org/dist/@@NODE@@/node-@@NODE@@-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
fi
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)
if ! command -v cloudflared >/dev/null; then
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
fi
if [ ! -f web/dist/index.html ]; then
  npm ci --silent && npm run --silent build --workspace web
fi
echo tools-ready
"""
background = {
    "python packages": subprocess.Popen(
        "pip install -q uv && cd server && uv sync --quiet --extra local-asr --extra laya"
        f" > {LOGS}/python.log 2>&1", shell=True, cwd=REPO_DIR),
    "node, web app, ffmpeg, tunnel": subprocess.Popen(
        ["bash", "-c", TOOLS], cwd=REPO_DIR, stdout=open(f"{LOGS}/tools.log", "w"), stderr=subprocess.STDOUT),
    "corpus": subprocess.Popen(
        "scripts/fetch_corpus.sh data/corpus.json" + f" > {LOGS}/corpus.log 2>&1", shell=True, cwd=REPO_DIR),
}

# models: shown in this cell with progress bars, downloaded once into the Hugging Face cache
if gpu:
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        sh("pip install -q huggingface_hub")
        from huggingface_hub import snapshot_download
    todo = [("specialized Arabic Whisper (3.2 GB)", "@@WHISPER@@", ["last-checkpoint/*", "runs/*"])]
    if LOAD_LAYA:
        todo.append(("local Laya", "@@LAYA@@", None))
    for label, repo_id, ignore in todo:
        print("downloading", label, "...")
        try:
            snapshot_download(repo_id, ignore_patterns=ignore)
        except Exception as e:
            print(f"  could not download {repo_id} now ({type(e).__name__}); the app will try again when it needs it")

failed = []
for name, proc in background.items():
    code = proc.wait()
    print(f"{'ok  ' if code == 0 else 'FAIL'} {name}")
    if code:
        failed.append(name)
if failed:
    for log_file in sorted(os.listdir(LOGS)):
        print("-----", log_file)
        print(open(f"{LOGS}/{log_file}").read()[-3000:])
    raise RuntimeError("install failed: " + ", ".join(failed))
if WEB_CACHE and not web_cached:
    cs.save_web_dist(REPO_DIR, WEB_CACHE)       # next session starts without npm
print("step 2 done in", round(time.time() - T0), "s")
''')

RUN = fill('''
#@title 3 · Run the app and get your link (keep this cell running)  { display-mode: "form" }
import collections, json, queue, re, threading, urllib.request
from IPython.display import HTML, display

PORT = @@PORT@@
TOKEN = cs.new_token()                       # new every time; the link below carries it
BASE = f"http://127.0.0.1:{PORT}"
STOP_OLD = "pkill -f '[u]vicorn wahy.main' ; pkill -f '[c]loudflared tunnel' ; true"   # [x]: do not match this shell itself
subprocess.run(STOP_OLD, shell=True)

env = dict(os.environ, HOST="127.0.0.1", PORT=str(PORT), WAHY_EXTRAS="local-asr laya", WAHY_ACCESS_TOKEN=TOKEN,
           PYTHONUNBUFFERED="1")
app = subprocess.Popen(["./run.sh"], cwd=REPO_DIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, bufsize=1)
log_lines = queue.Queue()


def pump_log():
    for line in app.stdout:
        log_lines.put(cs.redact(line, TOKEN))     # the access log would otherwise show the token once


threading.Thread(target=pump_log, daemon=True).start()


def call(path, data=None, timeout=10):
    req = urllib.request.Request(BASE + path, method="POST" if data is not None else "GET",
                                 data=None if data is None else json.dumps(data).encode(),
                                 headers={"x-wahy-token": TOKEN, "content-type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def drain():
    while not log_lines.empty():
        print(log_lines.get_nowait(), end="")


print("starting the app...")
deadline = time.time() + 900
while True:
    drain()
    if app.poll() is not None:
        drain()
        raise RuntimeError("run.sh stopped; see the log above")
    try:
        call("/api/health")
        break
    except Exception:
        if time.time() > deadline:
            raise TimeoutError("the app did not start in 15 minutes")
        time.sleep(2)
print("app is up after", round(time.time() - START_TIME), "s since the first cell")

if LOAD_LAYA and gpu:
    try:
        print("loading Laya on the GPU...")
        status = call("/api/settings/laya/load", {"checkpoint": "@@LAYA@@", "device": "cuda"}, timeout=900)
        print("Laya:", {k: status.get(k) for k in ("loaded", "device", "checkpoint")})
    except Exception as e:
        print("Laya did not load (the app works without it; load it from Settings):", e)

# ---- the public link: a Cloudflare quick tunnel to the app's one port ----
tunnel, public = None, None
for attempt in range(3):
    tunnel = subprocess.Popen(["cloudflared", "tunnel", "--no-autoupdate", "--url", BASE],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    watchdog = threading.Timer(60, tunnel.terminate)       # a tunnel that says nothing for a minute is stuck
    watchdog.start()
    for line in tunnel.stdout:
        m = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", line)
        if m:
            public = m.group(0)
            break
    watchdog.cancel()
    if public:
        threading.Thread(target=lambda: collections.deque(tunnel.stdout, maxlen=0), daemon=True).start()  # keep its pipe empty
        break
    tunnel.terminate()
    print("the tunnel did not start, retrying...")
    time.sleep(3)

# ---- keep the data safe while you work ----
if DRIVE_DIR:
    keeper = cs.DriveSyncer(REPO_DIR, DRIVE_DIR, interval_s=60).start()
    saved_note = f"Lectures are saved to My Drive/{DRIVE_FOLDER} every minute."
else:
    keeper = cs.ZipBackupper(REPO_DIR, "/content/tadqeeq-backup.zip", interval_s=120).start()
    saved_note = "Drive is OFF: nothing is kept after this session. Backup zip: /content/tadqeeq-backup.zip (Files panel)."

if public:
    link = cs.access_url(public, TOKEN)
    display(HTML(f'<div style="font-size:18px;padding:12px;border:2px solid #0a7;border-radius:8px">'
                 f'<b>Tadqeeq is ready:</b> <a href="{link}" target="_blank">{link}</a><br>'
                 f'<small>Private link: it contains your access token, so do not share it. {saved_note}<br>'
                 f'Keep this cell running; stop it (square button) to shut the app down and save.</small></div>'))
else:
    print("No public link could be made (Cloudflare tunnel failed). The app runs inside Colab only; run this cell again.")
print(saved_note)

try:
    while app.poll() is None:
        drain()
        time.sleep(1)
except KeyboardInterrupt:
    print("stopping...")
finally:
    drain()
    for proc in (tunnel, app):
        if proc is not None and proc.poll() is None:
            proc.terminate()
    try:
        app.wait(timeout=15)
    except Exception:
        pass
    subprocess.run(STOP_OLD, shell=True)
    final = keeper.stop()
    if DRIVE_DIR:
        print("saved to Google Drive:", final)
    else:
        print("backup zip written:", final)
        try:
            from google.colab import files
            files.download(str(final))
        except Exception:
            print("download it from the Files panel: /content/tadqeeq-backup.zip")
''')

notebook = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "accelerator": "GPU",
        "colab": {"provenance": [], "gpuType": "T4", "name": "Tadqeeq (Colab GPU)"},
        "kernelspec": {"display_name": "Python 3", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "cells": [md(INTRO), code(OPTIONS), code(INSTALL), code(RUN)],
}

if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / NOTEBOOK
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(notebook, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", out)
