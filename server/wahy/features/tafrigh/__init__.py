"""Tafrigh: turning a transcript into a structured written lesson without changing what was said (GLOSSARY:
Tafrigh). Ported from `backend/tafrigh/` (phase 18). The pipeline, segmenter, validators, renderer and review
queue are the old package's code; what is new is where it plugs in: model calls go through `core/ai`, a run is a
job (`core/jobs.py`), and a run is a folder in `data/tafrigh_runs/` (`store.py`) that survives a restart."""
