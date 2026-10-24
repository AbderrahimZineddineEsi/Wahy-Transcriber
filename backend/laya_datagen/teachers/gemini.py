import json
import time
from typing import Any, Dict, List

import httpx

from ..config import key
from .base import Teacher, normalize

SYSTEM = ("أنت مدقق شرعي ولغوي خبير في تفريغ المحاضرات الإسلامية. مهمتك التمييز بدقة بين الاقتباس الفعلي "
          "(آية أو حديث نبوي أو ذكر) وبين الكلام العادي للشيخ الشارح الذي تتشابه كلماته لفظياً مع الحديث أو الآية. "
          "Write `reason` in one short sentence.")
SCHEMA = {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
    "finding_id": {"type": "STRING"},
    "verdict": {"type": "STRING", "enum": ["CORRECT", "FALSE", "NOT_SURE"]},
    "confidence": {"type": "NUMBER"},
    "probabilities": {"type": "OBJECT", "properties": {k: {"type": "NUMBER"} for k in ("CORRECT", "FALSE", "NOT_SURE")},
                      "required": ["CORRECT", "FALSE", "NOT_SURE"]},
    "boundary_status": {"type": "STRING", "enum": ["COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"]},
    "reason": {"type": "STRING"}},
    "required": ["finding_id", "verdict", "confidence", "probabilities", "boundary_status", "reason"]}}


class GeminiTeacher(Teacher):
    """Same request shape as buildGeminiRequestBody in ai-verifier.js, with a fixed prompt (no UI presets)."""
    name = "gemini"
    batch_size = 5
    min_interval = 5.0          # free tier ~12 RPM

    def __init__(self, model: str = "gemini-3.5-flash-lite"):
        super().__init__(model)
        self._last = 0.0

    def _predict_uncached(self, envs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        items = [{"finding_id": str(i), "state": e["state"], "questions": e["questions"]} for i, e in enumerate(envs)]
        body = {"systemInstruction": {"parts": [{"text": SYSTEM}]},
                "contents": [{"role": "user", "parts": [{"text":
                    "Given the following candidate citations extracted by the transcription engine, evaluate each item against "
                    "the instructions and criteria in `questions`. Return ONLY a JSON array of evaluations corresponding to "
                    "the input items.\n\n" + json.dumps(items, ensure_ascii=False, indent=2)}]}],
                "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json", "responseSchema": SCHEMA}}
        for attempt in range(6):
            time.sleep(max(0, self.min_interval - (time.time() - self._last)))
            self._last = time.time()
            r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                           params={"key": key("GEMINI_API_KEY")}, json=body, timeout=120)
            if r.status_code in (429, 500, 503):
                time.sleep(min(60, 5 * 2 ** attempt))
                continue
            r.raise_for_status()
            arr = json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
            by_id = {str(x.get("finding_id")): x for x in arr}
            if len(by_id) != len(envs):
                raise RuntimeError(f"gemini returned {len(by_id)} items for {len(envs)}")
            return [{"verdict": by_id[str(i)]["verdict"],
                     "probs": normalize(by_id[str(i)]["verdict"], by_id[str(i)].get("probabilities"), by_id[str(i)].get("confidence")),
                     "boundary": by_id[str(i)].get("boundary_status"), "reason": by_id[str(i)].get("reason", ""), "cost": 0.0}
                    for i in range(len(envs))]
        raise RuntimeError("gemini unavailable after retries")
