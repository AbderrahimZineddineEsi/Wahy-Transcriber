import json
import time
from typing import Any, Dict, List

import httpx

from ..config import key
from .base import Teacher, normalize

SYSTEM = ("You are an expert Arabic Islamic text verifier. Given the JSON `state` and `questions`, determine whether "
          "`matched_span_in_lecture` is a genuine quotation or ordinary speech, and determine boundary status.")
CONTRACT = ('Return ONLY a valid JSON object with keys: {"verdict": "CORRECT" | "FALSE" | "NOT_SURE", "confidence": 0.0-1.0, '
            '"probabilities": {"CORRECT": p1, "FALSE": p2, "NOT_SURE": p3}, "boundary_status": "COMPLETE_SPAN" | '
            '"MISSING_START" | "MISSING_END" | "MISSING_BOTH", "reason": "one short sentence"}.')


class OpenRouterChatTeacher(Teacher):
    name = "orchat"

    def __init__(self, model: str):
        super().__init__(model)

    def _predict_uncached(self, envs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        e = envs[0]
        body = {"model": self.model, "temperature": 0.1, "max_tokens": 800,
                "messages": [{"role": "system", "content": SYSTEM + "\n\n" + CONTRACT},
                             {"role": "user", "content": json.dumps({"state": e["state"], "questions": e["questions"]}, ensure_ascii=False)}],
                "response_format": {"type": "json_object"}}
        for attempt in range(4):
            r = httpx.post("https://openrouter.ai/api/v1/chat/completions", json=body, timeout=120,
                           headers={"Authorization": f"Bearer {key('OPENROUTER_API_KEY')}"})
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            txt = r.json()["choices"][0]["message"]["content"].strip().removeprefix("```json").removesuffix("```").strip()
            a = json.loads(txt)
            usage = r.json().get("usage") or {}
            return [{"verdict": a["verdict"], "probs": normalize(a["verdict"], a.get("probabilities"), a.get("confidence")),
                     "boundary": a.get("boundary_status"), "reason": a.get("reason", ""), "cost": float(usage.get("cost") or 0)}]
        raise RuntimeError("openrouter chat unavailable after retries")
