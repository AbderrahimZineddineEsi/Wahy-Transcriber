import time
from typing import Any, Dict, List

import httpx

from ..config import key
from .base import Teacher, normalize

URL = "https://openrouter.ai/api/alpha/decisions"


class JevTeacher(Teacher):
    name = "jev"

    def __init__(self, model: str = "typesafe/jev-1.14"):
        super().__init__(model)

    def _predict_uncached(self, envs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        e = envs[0]
        for attempt in range(4):
            r = httpx.post(URL, headers={"Authorization": f"Bearer {key('OPENROUTER_API_KEY')}"},
                           json={"model": self.model, "state": e["state"], "questions": e["questions"]}, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            a = r.json()["answers"]
            v, b = a["verdict"], a.get("boundary_status", {})
            return [{"verdict": v["choice"], "probs": normalize(v["choice"], v.get("probabilities"), v.get("confidence")),
                     "boundary": b.get("choice"), "reason": "", "cost": float((r.json().get("usage") or {}).get("cost") or 0)}]
        raise RuntimeError("JEV unavailable after retries")
