from typing import Any, Dict, List

from .base import Teacher, normalize


class LayaLocal(Teacher):
    """Zero-shot (or fine-tuned) Laya. Used as the baseline in the benchmark, not as a label source.

    Envelopes are passed through `hide_engine_fields` when scoring a model trained without them."""
    name = "laya"

    def __init__(self, model: str = "convaiinnovations/laya-multilingual", hide_engine_fields: bool = False, device: str = "cpu"):
        super().__init__(model + ("|agnostic" if hide_engine_fields else ""))
        self.hide = hide_engine_fields
        self._agent = None
        self._path = model
        self._device = device

    def _predict_uncached(self, envs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        import laya
        from ..export import ENGINE_STATE_KEYS
        if self._agent is None:
            self._agent = laya.load(self._path, device=self._device)
        out = []
        for e in envs:
            st = {k: v for k, v in e["state"].items() if not (self.hide and k in ENGINE_STATE_KEYS)}
            res = self._agent.predict(st, e["questions"], max_len=1024)
            ans = res.get("answers", {}) if isinstance(res, dict) else getattr(res, "answers", {})
            v, b = ans.get("verdict", {}), ans.get("boundary_status", {})
            out.append({"verdict": v.get("choice", "NOT_SURE"),
                        "probs": normalize(v.get("choice", "NOT_SURE"), v.get("probabilities"), v.get("confidence")),
                        "boundary": b.get("choice"), "reason": "", "cost": 0.0})
        return out
