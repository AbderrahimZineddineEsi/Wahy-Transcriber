"""Case tags used for coverage reporting and quota sampling."""
from __future__ import annotations

from typing import Any, Dict, List

from .label import DocCtx, Label


def bucket(n: int, edges=(3, 7, 15)) -> str:
    for e in edges:
        if n <= e:
            return f"<={e}"
    return f">{edges[-1]}"


def default_scope(d: Dict[str, Any]) -> bool:
    """Mirror of filterDetectionsByScope("HADITH_AND_CANDIDATES") in ai-verifier.js."""
    return (d["sourceType"] == "HADITH" or d.get("confidenceBand") in ("CANDIDATE", "AMBIGUOUS")
            or (d.get("totalScore") or 0) < 15)


def tag_cases(det: Dict[str, Any], lab: Label, c: DocCtx) -> List[str]:
    ws, we = det["wordStartIdx"], det["wordEndIdx"]
    a0, a1 = c.word_tok[ws], c.word_tok[we + 1]
    n_exact = sum(c.al.exact[a0:a1])
    noise = 1 - n_exact / max(1, a1 - a0)
    tags = [f"src:{det['sourceType']}", f"band:{det.get('confidenceBand')}", f"len:{bucket(we - ws + 1)}",
            f"noise:{'clean' if noise < 0.1 else 'mild' if noise < 0.3 else 'noisy'}"]
    if default_scope(det):
        tags.append("in_default_scope")
    if det.get("hasCitationCue"):
        tags.append("cue")
    if len(det.get("segments") or []) > 1:
        tags.append("interrupted")
    if len(det.get("candidateRefs") or []) > 1:
        tags.append("ref_ambiguity")
    if det.get("embeddedQuran"):
        tags.append("embedded_quran")
    if det.get("alsoAdhkar"):
        tags.append("also_adhkar")
    if det.get("qiraah") and det["qiraah"] != "hafs":
        tags.append("qiraah")
    if c.al.asr2gt[a0] >= 0:
        tags.append(f"role:{c.gt.roles[c.al.asr2gt[a0]]}")
    tags += [f"flag:{f}" for f in lab.flags]
    if lab.boundary and lab.boundary != "COMPLETE_SPAN":
        tags.append("boundary_cut")
    return tags
