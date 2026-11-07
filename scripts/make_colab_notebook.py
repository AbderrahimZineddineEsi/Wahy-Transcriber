"""Generates the Colab notebook that runs the whole app on a Colab GPU (F-130).

    python scripts/make_colab_notebook.py

It writes notebooks/colab/wahy_colab_runner.ipynb (the one Colab opens). The notebook clones this repo, starts the
same `./run.sh` a laptop uses (with the local-asr and laya extras), loads Laya, and opens a Cloudflare tunnel to
the app's single port. Nothing else is needed: the server serves the web app itself.
"""

import json
from pathlib import Path

BRANCH = "factory-reset"
REPO = "AbderrahimZineddineEsi/Wahy-Transcriber"
LAYA = "ZenoAbderrahim/laya-wahy-r6-v3_mixed"
PORT = 8000


def lines(text: str) -> list[str]:
    parts = text.strip("\n").split("\n")
    return [p + "\n" for p in parts[:-1]] + [parts[-1]]


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": lines(text)}


def code(text: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": lines(text)}


INTRO = f"""
# 🎙️ Wahy Studio on Google Colab (GPU)

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/{REPO}/blob/{BRANCH}/notebooks/colab/wahy_colab_runner.ipynb)

Runs the full app on a Colab GPU, with the specialized Arabic Whisper (`Abu-Dju/whisper-large-v3-ar`) and local Laya
(`{LAYA}`), and gives you a public link (Cloudflare tunnel).

**Before you run:** *Runtime → Change runtime type → T4 GPU*. Optional keys go in Colab *Secrets* (🔑 in the left bar):
`HF_TOKEN` (if the Laya checkpoint is private), `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`.

**Run the three cells in order.** The last one keeps running while you use the app: stop it to shut the app down.
The link is random and public: do not share it, because anyone who has it can use your keys.
"""

SETUP = f"""
# Step 1: GPU check, secrets, clone, system packages
import os, subprocess

print(subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True).stdout or "NO GPU: choose Runtime > Change runtime type > T4 GPU")

try:
    from google.colab import userdata
    for name in ["HF_TOKEN", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]:
        try:
            value = userdata.get(name)
            if value:
                os.environ[name] = str(value).strip()
                print("loaded secret:", name)
        except Exception:
            pass
except ImportError:
    print("not on Colab: using the environment as it is")

REPO_DIR = "/content/Wahy-Transcriber"
if not os.path.exists(REPO_DIR):
    !git clone -q -b {BRANCH} https://github.com/{REPO}.git {{REPO_DIR}}
else:
    !cd {{REPO_DIR}} && git fetch -q origin {BRANCH} && git reset -q --hard origin/{BRANCH}
%cd {{REPO_DIR}}

!apt-get update -qq && apt-get install -y -qq ffmpeg > /dev/null
!pip install -q uv
# Colab ships an old Node: the engine needs 20+
node_major = subprocess.run("node -v", shell=True, capture_output=True, text=True).stdout.strip().lstrip("v").split(".")[0]
if not node_major.isdigit() or int(node_major) < 20:
    !curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    !apt-get install -y -qq nodejs > /dev/null
print("node", subprocess.run("node -v", shell=True, capture_output=True, text=True).stdout.strip(), "- setup done")
"""

START = f"""
# Step 2: start the app with the same ./run.sh as on a laptop, then load Laya on the GPU
import json, os, subprocess, sys, time, urllib.request

!pkill -f uvicorn || true
env = dict(os.environ, HOST="127.0.0.1", PORT="{PORT}", WAHY_EXTRAS="local-asr laya")
app_proc = subprocess.Popen(["./run.sh"], cwd=REPO_DIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

def wait_for_app(timeout_s=1500):
    start = time.time()
    while time.time() - start < timeout_s:
        if app_proc.poll() is not None:
            raise RuntimeError("run.sh stopped:\\n" + app_proc.stdout.read())
        try:
            urllib.request.urlopen("http://127.0.0.1:{PORT}/api/health", timeout=3)
            return
        except Exception:
            time.sleep(3)
    raise TimeoutError("the app did not start in time")

print("installing and starting (the first run takes several minutes)...")
wait_for_app()
print("app is up")

req = urllib.request.Request("http://127.0.0.1:{PORT}/api/settings/laya/load", method="POST",
                             data=json.dumps({{"checkpoint": "{LAYA}", "device": "cuda"}}).encode(),
                             headers={{"content-type": "application/json"}})
try:
    print(json.loads(urllib.request.urlopen(req, timeout=600).read()))
except Exception as e:
    print("Laya did not load (the app still works; load it from Settings):", e)
"""

TUNNEL = f"""
# Step 3: public link through a Cloudflare tunnel, then stay alive
import re
from IPython.display import HTML, display

if not os.path.exists("/usr/local/bin/cloudflared") and not os.path.exists("/usr/bin/cloudflared"):
    !wget -q -nc https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    !dpkg -i cloudflared-linux-amd64.deb > /dev/null
!pkill -f cloudflared || true

tunnel = subprocess.Popen(["cloudflared", "tunnel", "--url", "http://127.0.0.1:{PORT}"],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
url = None
for _ in range(100):
    line = tunnel.stdout.readline()
    match = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", line or "")
    if match:
        url = match.group(0)
        break
if url:
    display(HTML(f'<h2>Wahy Studio is live: <a href="{{url}}" target="_blank">{{url}}</a></h2>'))
else:
    print("no tunnel link found; check the cloudflared output")

try:
    for line in app_proc.stdout:   # live server log; stop the cell to shut everything down
        print(line, end="")
except KeyboardInterrupt:
    pass
finally:
    tunnel.terminate()
    app_proc.terminate()
    print("stopped")
"""

notebook = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "accelerator": "GPU",
        "colab": {"provenance": [], "gpuType": "T4"},
        "kernelspec": {"display_name": "Python 3", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "cells": [md(INTRO), code(SETUP), code(START), code(TUNNEL)],
}

if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "notebooks" / "colab" / "wahy_colab_runner.ipynb"
    out.write_text(json.dumps(notebook, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", out)
