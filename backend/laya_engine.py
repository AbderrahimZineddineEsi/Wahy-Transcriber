"""
Local Laya Engine Integration for Wahy-Transcriber
Optimized for NVIDIA GTX 1050 (3GB VRAM) and CPU fallback.
Checkpoint: convaiinnovations/laya-multilingual (mmBERT-base backbone, 322M params)
"""

import os
# CRITICAL: Prevent TensorFlow/abseil deadlock when loading Laya/ModernBERT/mmBERT
os.environ["USE_TF"] = "0"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import gc
import time
from typing import Any, Callable, Dict, List, Optional, Union
import torch

class LocalLayaVerifier:
    DEFAULT_CHECKPOINT = "convaiinnovations/laya-multilingual"

    def __init__(self):
        self.agent = None
        self.loaded_checkpoint = None
        self.device = "cpu"
        self.dtype_str = "float16"

    def get_vram_status(self) -> Dict[str, Any]:
        if not torch.cuda.is_available():
            return {
                "cuda_available": False,
                "gpu_name": "CPU Only",
                "free_mb": 0.0,
                "allocated_mb": 0.0,
                "total_mb": 0.0,
            }
        try:
            free_b, total_b = torch.cuda.mem_get_info()
            alloc_b = torch.cuda.memory_allocated()
            return {
                "cuda_available": True,
                "gpu_name": torch.cuda.get_device_name(0),
                "free_mb": round(free_b / (1024 * 1024), 1),
                "allocated_mb": round(alloc_b / (1024 * 1024), 1),
                "total_mb": round(total_b / (1024 * 1024), 1),
            }
        except Exception as e:
            return {
                "cuda_available": True,
                "gpu_name": "CUDA (error querying VRAM)",
                "free_mb": 0.0,
                "allocated_mb": 0.0,
                "total_mb": 0.0,
                "error": str(e)
            }

    def load_model(
        self,
        checkpoint_id_or_path: Optional[str] = None,
        preferred_device: str = "auto",
        unload_whisper_fn: Optional[Callable[[], None]] = None
    ) -> Dict[str, Any]:
        target_ckpt = (checkpoint_id_or_path or "").strip() or self.DEFAULT_CHECKPOINT
        if self.agent is not None and self.loaded_checkpoint == target_ckpt:
            return self.get_status()

        # Unload existing Laya model if switching checkpoints
        self.unload_model()

        # If Whisper or other models are occupying VRAM on the 3GB GTX 1050, free it first
        if callable(unload_whisper_fn):
            try:
                unload_whisper_fn()
            except Exception:
                pass

        vram = self.get_vram_status()
        use_cuda = False
        if preferred_device == "cuda" and vram["cuda_available"]:
            use_cuda = True
        elif preferred_device == "auto" and vram["cuda_available"] and vram["free_mb"] >= 850:
            use_cuda = True

        import laya
        target_device = "cuda" if use_cuda else "cpu"
        try:
            self.agent = laya.load(target_ckpt, device=target_device)
            # Configure max_len=1024 for Arabic context + 256 head budget if cfg is present
            if hasattr(self.agent, "cfg") and isinstance(self.agent.cfg, dict):
                self.agent.cfg["max_len"] = 1024
                self.agent.cfg["head_max_len"] = 256
            self.device = target_device
            self.loaded_checkpoint = target_ckpt
        except RuntimeError as e:
            err_str = str(e).lower()
            if ("out of memory" in err_str or "cuda" in err_str) and target_device == "cuda":
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                gc.collect()
                self.agent = laya.load(target_ckpt, device="cpu")
                self.device = "cpu"
                self.loaded_checkpoint = target_ckpt
            else:
                raise

        return self.get_status()

    def unload_model(self) -> Dict[str, Any]:
        if self.agent is not None:
            del self.agent
            self.agent = None
            self.loaded_checkpoint = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        return self.get_status()

    def get_status(self) -> Dict[str, Any]:
        vram = self.get_vram_status()
        return {
            "loaded": self.agent is not None,
            "checkpoint": self.loaded_checkpoint or self.DEFAULT_CHECKPOINT,
            "device": self.device,
            "vram": vram,
        }

    def predict_decision(
        self,
        state: dict,
        questions: dict,
        max_len: int = 1024
    ) -> Dict[str, Any]:
        if self.agent is None:
            self.load_model(self.DEFAULT_CHECKPOINT, preferred_device="auto")
        
        t0 = time.perf_counter()
        result = self.agent.predict(state, questions, max_len=max_len)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        
        raw_answers = result.get("answers", {}) if isinstance(result, dict) else getattr(result, "answers", {})
        
        # Approximate input token count based on state text length
        context_str = (
            str(state.get("context_before", "")) + " " +
            str(state.get("matched_span_in_lecture", "")) + " " +
            str(state.get("context_after", "")) + " " +
            str(state.get("canonical_corpus_text", ""))
        )
        approx_tokens = max(10, len(context_str.split()))

        return {
            "answers": raw_answers,
            "latency_ms": elapsed_ms,
            "model": self.loaded_checkpoint or self.DEFAULT_CHECKPOINT,
            "device": self.device,
            "usage": {
                "input_tokens": approx_tokens,
                "output_tokens": 0,
                "cost": 0.0,
            },
            "cost": 0.0,
        }

# Global singleton instance for the FastAPI app
laya_verifier = LocalLayaVerifier()
