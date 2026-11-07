"""The research side of Laya (was backend/laya_datagen, moved in rewrite phase 22): lectures and their ASR, review
cards and labels, teachers, the datasets (laya_v1, laya_v2, laya_v3), teacher evaluations and the Kaggle scripts.

It runs on the server's own machinery, so research and product share one path (ADR 0003, ADR 0004):
- the engine and the envelopes come from the engine worker through wahy/core/engine.py (engine_bridge.py);
- every teacher is a verifier of wahy/core/ai (teachers/), logged in the app's request log as purpose "teacher";
- speech recognition is wahy/features/transcription (asr.py).

Command line: `uv run python -m wahy.laya --help` (from server/). Data: data/laya_datagen/ (git-ignored).
The folder `kaggle/` is shipped inside each dataset and runs on Kaggle: it imports nothing from wahy.
"""
