"""Local Laya, the fine-tuned verifier, run through the GPU owner (ADR 0006).

    laya.envelope()          # EnvelopeInfo(version=3, options={"passages": True}, questions=["verdict"])
    laya.load("ZenoAbderrahim/laya-wahy-r6-v3_mixed", device="auto")   # the "load" button (waits for the GPU)
    laya.verify(items, call=call)          # [Answer, ...], one saved request per item
    laya.unload()                          # frees the GPU
    laya.status()                          # loaded?, checkpoint, device, envelope, VRAM

Which envelope to build is the checkpoint's own business: each checkpoint's `rl_agent_config.json` says the
envelope version it was trained on (`wahy_envelope`, 1 when missing), its options and the questions it answers
(F-093). `envelope()` reads that file without loading the model (a local folder, or the Hugging Face cache),
so a verification pass can build the right envelopes (with the engine, ADR 0003) before it asks for the GPU.

The model is borrowed from the GPU owner under the name `laya:<checkpoint>`, so loading Whisper unloads Laya
and the other way round. The device: "cuda" when asked and the installed torch has kernels for this card,
"auto" also needs 850 MB free, otherwise the CPU; running out of memory while loading falls back to the CPU.
The engine's own score and band are taken out of the state first, as in training
(wahy/laya/export.py ENGINE_STATE_KEYS).
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from wahy.core.ai.log import RequestLog
from wahy.core.ai.types import AiError, Answer, Call, Item, answer_from_decisions
from wahy.core.gpu import GpuError, GpuOwner, cuda_card, free_cuda_memory

log = logging.getLogger("wahy.ai.laya")

DEFAULT_CHECKPOINT = "ZenoAbderrahim/laya-wahy-r6-v3_mixed"
BASE_CHECKPOINT = "convaiinnovations/laya-multilingual"
CONFIG_FILE = "rl_agent_config.json"
HIDDEN_STATE_KEYS = ("engine_score", "engine_confidence_band")
AUTO_CUDA_MIN_FREE_MB = 850
DEVICES = ("auto", "cuda", "cpu")


@dataclass(frozen=True)
class EnvelopeInfo:
    version: int  # 1, 2 or 3
    options: dict[str, Any]  # e.g. {"passages": True} or {"passages": True, "neighbours": True}
    questions: list[str] | None  # the questions it was trained on (None: all of its envelope's)
    max_len: int | None = None
    head_max_len: int | None = None


@dataclass
class LayaStatus:
    loaded: bool
    checkpoint: str  # the loaded one, else the one selected for next time
    device: str | None  # "cuda" | "cpu" when loaded
    envelope: EnvelopeInfo | None
    vram: dict[str, Any] = field(default_factory=dict)
    installed: bool = True  # the `laya` package and torch can be imported

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class LoadedLaya:
    """What the GPU owner holds while Laya is resident."""

    agent: Any
    checkpoint: str
    device: str  # where it really runs ("cpu" after a CUDA out-of-memory fallback)
    config: dict[str, Any]
    requested: str = ""  # the device it was asked for ("auto", "cuda", "cpu")


def envelope_from_config(config: dict[str, Any] | None) -> EnvelopeInfo:
    c = config or {}
    questions = c.get("wahy_questions")
    return EnvelopeInfo(
        version=int(c.get("wahy_envelope") or 1),
        options=dict(c.get("wahy_envelope_options") or {}),
        questions=list(questions) if isinstance(questions, list) else None,
        max_len=_int(c.get("max_len")),
        head_max_len=_int(c.get("head_max_len")),
    )


def _int(v: Any) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def read_checkpoint_config(checkpoint: str) -> dict[str, Any] | None:
    """The checkpoint's rl_agent_config.json: from a local folder, or from the Hugging Face cache (no
    download). None when it can't be found without the network."""
    path = Path(checkpoint).expanduser()
    if path.is_dir():
        file = path / CONFIG_FILE
        return json.loads(file.read_text(encoding="utf-8")) if file.exists() else None
    try:
        from huggingface_hub import try_to_load_from_cache

        found = try_to_load_from_cache(checkpoint, CONFIG_FILE)
        if isinstance(found, str):
            return json.loads(Path(found).read_text(encoding="utf-8"))
    except ImportError:
        pass
    # without huggingface_hub, look in the cache folder by hand (models--owner--name/snapshots/<rev>/...)
    hub = Path(
        os.environ.get("HF_HUB_CACHE")
        or Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface") / "hub"
    )
    folder = hub / ("models--" + checkpoint.replace("/", "--"))
    ref = folder / "refs" / "main"
    if ref.exists():
        file = folder / "snapshots" / ref.read_text().strip() / CONFIG_FILE
        if file.exists():
            return json.loads(file.read_text(encoding="utf-8"))
    return None


def laya_installed() -> bool:
    import importlib.util

    return all(importlib.util.find_spec(m) is not None for m in ("laya", "torch"))


def vram_status() -> dict[str, Any]:
    """Free and total VRAM: from torch when it is already imported (also shows what this process holds), else
    from nvidia-smi. Never imports torch just to answer."""
    torch = sys.modules.get("torch")
    if torch is not None and torch.cuda.is_available():
        try:
            free_b, total_b = torch.cuda.mem_get_info()
            return {
                "cuda_available": True,
                "gpu_name": torch.cuda.get_device_name(0),
                "free_mb": round(free_b / 2**20, 1),
                "total_mb": round(total_b / 2**20, 1),
                "allocated_mb": round(torch.cuda.memory_allocated() / 2**20, 1),
            }
        except Exception as e:  # a broken driver must not break the status
            return {"cuda_available": True, "error": str(e)}
    card = cuda_card()
    if card is None:
        return {"cuda_available": False}
    return {
        "cuda_available": True,
        "gpu_name": card.name,
        "free_mb": float(card.free_mb),
        "total_mb": float(card.total_mb),
        "allocated_mb": None,
    }


def _cuda_supported(torch: Any) -> bool:
    """True when the installed torch has kernels for GPU 0 (CUDA can be "available" on a card the build
    dropped, such as the GTX 1050, sm_61, with a torch built from sm_75 up: loading works, every forward pass
    fails)."""
    if not torch.cuda.is_available():
        return False
    major, minor = torch.cuda.get_device_capability(0)
    for arch in torch.cuda.get_arch_list():
        if arch.startswith("sm_") and int(arch[3:-1]) == major and int(arch[-1]) <= minor:
            return True
        if arch.startswith("compute_") and (int(arch[8:-1]), int(arch[-1])) <= (major, minor):
            return True
    return False


def load_laya(checkpoint: str, device: str) -> LoadedLaya:
    """The real loader (needs the `laya` extra: `uv sync --extra laya`)."""
    os.environ.setdefault("USE_TF", "0")  # TensorFlow/abseil can deadlock mmBERT's load
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    try:
        import laya
        import torch
    except ImportError as e:
        raise AiError(
            f"Laya is not installed ({e.name}); install it with: uv sync --extra laya", fatal=True
        ) from e
    use_cuda = False
    if _cuda_supported(torch):
        free_mb = torch.cuda.mem_get_info()[0] / 2**20
        use_cuda = device == "cuda" or (device == "auto" and free_mb >= AUTO_CUDA_MIN_FREE_MB)
    target = "cuda" if use_cuda else "cpu"
    try:
        agent = laya.load(checkpoint, device=target)
    except RuntimeError as e:
        if target != "cuda" or not any(x in str(e).lower() for x in ("out of memory", "cuda")):
            raise
        log.warning("Laya did not fit on the GPU (%s); loading it on the CPU", e)
        free_cuda_memory()
        target, agent = "cpu", laya.load(checkpoint, device="cpu")
    cfg = getattr(agent, "cfg", None)
    if isinstance(cfg, dict):
        # a fine-tuned checkpoint keeps the budgets it was trained with (laya_v1: 1024, laya_v2: 2048); the
        # base checkpoint gets at least 1024 for Arabic context and 256 for the questions
        cfg["max_len"] = max(1024, int(cfg.get("max_len") or 0))
        cfg["head_max_len"] = max(256, int(cfg.get("head_max_len") or 0))
    return LoadedLaya(agent, checkpoint, target, dict(cfg) if isinstance(cfg, dict) else {})


def _jsonable(value: Any) -> Any:
    """Laya's answers may hold numpy or torch numbers: plain Python for the request log."""
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    if hasattr(value, "item") and callable(value.item):
        try:
            return value.item()
        except (TypeError, ValueError):
            pass
    return value


def visible_state(state: dict[str, Any]) -> dict[str, Any]:
    """The state as Laya reads it: without the engine's own score (it was hidden in training too)."""
    return {k: v for k, v in state.items() if k not in HIDDEN_STATE_KEYS}


def _answers_of(result: Any) -> dict[str, Any]:
    raw = result.get("answers", {}) if isinstance(result, dict) else getattr(result, "answers", {})
    return _jsonable(raw) if isinstance(raw, dict) else {}


@dataclass
class LayaOptions:
    checkpoint: str | None = None  # None: the selected one
    device: str | None = None  # None: the selected one


class LayaLocal:
    name = "laya"

    def __init__(
        self,
        log: RequestLog,
        gpu: GpuOwner,
        *,
        loader: Callable[[str, str], LoadedLaya] = load_laya,
        read_config: Callable[[str], dict[str, Any] | None] = read_checkpoint_config,
        installed: Callable[[], bool] = laya_installed,
        vram: Callable[[], dict[str, Any]] = vram_status,
    ):
        self.log, self.gpu = log, gpu
        self._loader, self._read_config, self._installed, self._vram = loader, read_config, installed, vram
        self._lock = threading.Lock()
        self.checkpoint, self.device = DEFAULT_CHECKPOINT, "auto"
        self._loaded: LoadedLaya | None = None  # set by the loader, cleared by the unloader

    # ---- choosing and loading ------------------------------------------------------------------------------

    def select(self, checkpoint: str | None = None, device: str | None = None) -> None:
        """Choose the checkpoint and device the next load or pass uses (nothing is loaded now)."""
        if device is not None and device not in DEVICES:
            raise ValueError(f"unknown device {device!r}; use one of {', '.join(DEVICES)}")
        with self._lock:
            self.checkpoint = (checkpoint or "").strip() or self.checkpoint
            self.device = device or self.device

    def _gpu_name(self, checkpoint: str) -> str:
        return f"laya:{checkpoint}"

    def _prepare(self, checkpoint: str, device: str) -> str:
        """Register `checkpoint` with the GPU owner; if it is resident on another device, unload it first."""
        name = self._gpu_name(checkpoint)
        loaded = self._loaded
        if loaded is not None and loaded.checkpoint == checkpoint and loaded.requested != device:
            self.gpu.unload()  # the user chose another device: load it again there

        def load() -> LoadedLaya:
            model = self._loader(checkpoint, device)
            model.requested = device
            self._loaded = model
            return model

        def unload(_model: LoadedLaya) -> None:
            self._loaded = None

        self.gpu.register(name, load=load, unload=unload)
        return name

    def load(
        self,
        checkpoint: str | None = None,
        device: str | None = None,
        *,
        should_stop: Callable[[], None] | None = None,
    ) -> LayaStatus:
        """Make Laya resident now (waits while another job uses the GPU)."""
        self.select(checkpoint, device)
        name = self._prepare(self.checkpoint, self.device)
        try:
            self.gpu.load(name, should_stop=should_stop)
        except GpuError as e:
            raise AiError(str(e), fatal=True) from e
        return self.status()

    def unload(self) -> LayaStatus:
        """Free the GPU if Laya is on it."""
        resident = self.gpu.status().resident
        if resident and resident.startswith("laya:"):
            self.gpu.unload()
        return self.status()

    def envelope(self, checkpoint: str | None = None) -> EnvelopeInfo | None:
        """What `checkpoint` (default: the selected one) was trained to read; None when its config can't be
        read without loading it."""
        ckpt = (checkpoint or "").strip() or self.checkpoint
        loaded = self._loaded
        if loaded is not None and loaded.checkpoint == ckpt and loaded.config:
            return envelope_from_config(loaded.config)
        try:
            config = self._read_config(ckpt)
        except (OSError, ValueError) as e:
            log.warning("could not read %s's config: %s", ckpt, e)
            return None
        return envelope_from_config(config) if config is not None else None

    def status(self) -> LayaStatus:
        loaded = self._loaded
        resident = self.gpu.status().resident
        is_loaded = loaded is not None and resident == self._gpu_name(loaded.checkpoint)
        checkpoint = loaded.checkpoint if is_loaded and loaded else self.checkpoint
        return LayaStatus(
            loaded=is_loaded,
            checkpoint=checkpoint,
            device=loaded.device if is_loaded and loaded else None,
            envelope=self.envelope(checkpoint),
            vram=self._vram(),
            installed=self._installed(),
        )

    # ---- asking --------------------------------------------------------------------------------------------

    def preview(self, items: list[Item], options: LayaOptions | None = None) -> dict[str, Any]:
        """What Laya would read for the first of `items` (the engine's score fields are hidden from it)."""
        o = options or LayaOptions()
        it = items[0]
        return {"endpoint": "local", "model": (o.checkpoint or "").strip() or self.checkpoint,
                "body": {"state": visible_state(it.state), "questions": it.questions}}

    def verify(self, items: list[Item], *, call: Call, options: LayaOptions | None = None) -> list[Answer]:
        """Answers for `items` (envelopes of the version `envelope()` gave). Borrows the GPU for the whole
        list, so another job waits until these items are done; a pause or cancel works between items."""
        o = options or LayaOptions()
        if o.checkpoint or o.device:
            self.select(o.checkpoint, o.device)
        checkpoint, device = self.checkpoint, self.device
        name = self._prepare(checkpoint, device)
        answers: list[Answer] = []
        try:
            with self.gpu.use(name, should_stop=call.check) as model:
                for it in items:
                    call.check()
                    data, rid = self._predict(model, it.state, it.questions, call)
                    a = answer_from_decisions(
                        it, data, provider=self.name, model=checkpoint, reason=f"Laya ({model.device})."
                    )
                    a.request_id = rid
                    answers.append(a)
        except GpuError as e:
            raise AiError(str(e), fatal=True) from e
        return answers

    def predict(self, state: dict[str, Any], questions: dict[str, Any], *, call: Call) -> dict[str, Any]:
        """One raw prediction (Tafrigh asks its own questions): the answers dict."""
        name = self._prepare(self.checkpoint, self.device)
        with self.gpu.use(name, should_stop=call.check) as model:
            return self._predict(model, state, questions, call)[0]

    def _predict(
        self, model: LoadedLaya, state: dict[str, Any], questions: dict[str, Any], call: Call
    ) -> tuple[dict[str, Any], int | None]:
        state = visible_state(state)
        max_len = int(model.config.get("max_len") or 1024)
        request = {
            "checkpoint": model.checkpoint,
            "device": model.device,
            "max_len": max_len,
            "state": state,
            "questions": questions,
        }
        t0 = time.perf_counter()
        try:
            result = model.agent.predict(state, questions, max_len=max_len)
        except Exception as e:
            latency = round((time.perf_counter() - t0) * 1000)
            rid = self.log.save(
                provider=self.name,
                model=model.checkpoint,
                call=call,
                ok=False,
                request=request,
                error=f"Laya failed: {e}",
                latency_ms=latency,
            )
            raise AiError(f"Laya failed: {e}", request_id=rid) from e
        latency = round((time.perf_counter() - t0) * 1000)
        answers = _answers_of(result)
        context = " ".join(
            str(state.get(k, ""))
            for k in ("context_before", "matched_span_in_lecture", "context_after", "canonical_corpus_text")
        )
        rid = self.log.save(
            provider=self.name,
            model=model.checkpoint,
            call=call,
            ok=bool(answers),
            request=request,
            response={"answers": answers, "device": model.device},
            error=None if answers else "Laya gave no answers",
            input_tokens=max(10, len(context.split())),
            output_tokens=0,
            cost_usd=0.0,
            latency_ms=latency,
        )
        if not answers:
            raise AiError("Laya gave no answers", request_id=rid)
        return answers, rid
