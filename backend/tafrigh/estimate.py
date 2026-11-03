"""
Before a run: how many requests and tokens each processing mode would cost for the chosen sentences.

The prompts are the real ones (GeminiAdapter.build_classify_prompt / the JEV state), built without calling a model;
only the outline state is unknown in advance (assumed: inside a paragraph, no headings yet). Characters -> tokens
were calibrated on a real run (Bin Baz lecture, gemini-3.1-flash-lite, 2026-10-29): the English system prompt reads
~4 characters per token, the Arabic payload ~2. Output tokens per sentence were measured on the same run. Other
tokenizers (DeepSeek, Claude) differ, and a "thinking" model adds its own reasoning tokens: the numbers are a guide
(about ±30 %), not a bill.
"""

from __future__ import annotations

import json
import math
from typing import Any, Dict, List

from .adapters.gemini_adapter import STATIC_SYSTEM_PREFIX, GeminiAdapter
from .adapters.jev_adapter import OPTION_DESCRIPTIONS, QUESTION_INSTRUCTIONS
from .models import OutlineState, StructuralDecision, StructuralTag, TranscriptSegment
from .unit_of_work import UnitOfWork

SYSTEM_CHARS_PER_TOKEN = 4.0
PAYLOAD_CHARS_PER_TOKEN = 2.0
# measured output per sentence: one decision with confidence and edits
OUT_TOKENS_PER_SENTENCE_WINDOWED = 150
OUT_TOKENS_PER_SENTENCE_SINGLE = 220     # + the JSON wrapper of a reply of its own
# splits and typo-fix follow-ups seen in real runs: a few % more requests in per-sentence mode
EXTRA_REQUEST_SHARE = 0.05


def _tokens(system_chars: int, payload_chars: int) -> int:
    return int(system_chars / SYSTEM_CHARS_PER_TOKEN + payload_chars / PAYLOAD_CHARS_PER_TOKEN)


def _outline() -> OutlineState:
    o = OutlineState()
    o.record_decision("prev", "", StructuralDecision(tag=StructuralTag.PARAGRAPH))
    return o


def _uow(segs: List[TranscriptSegment], a: int, b: int, before: int, after: int, o: OutlineState) -> UnitOfWork:
    return UnitOfWork(target_segments=segs[a:b], context_before=segs[max(0, a - before):a],
                      context_after=segs[b:b + after], allowed_choices=o.get_allowed_structural_choices(),
                      previous_tag="paragraph")


def estimate_run(segments: List[TranscriptSegment], start: int, end: int, *, window_size: int = 10,
                 context_before: int = 3, context_after: int = 3, jev_requests_per_sentence: int = 3) -> Dict[str, Any]:
    """{per_sentence, windowed, jev, laya}: requests, input / output tokens for sentences [start, end)."""
    start, end = max(0, start), min(len(segments), end)
    n = max(0, end - start)
    adapter, o = GeminiAdapter(), _outline()
    sys_chars = len(STATIC_SYSTEM_PREFIX)

    per_in = 0
    for i in range(start, end):
        per_in += _tokens(sys_chars, len(adapter.build_classify_prompt(_uow(segments, i, i + 1, context_before, context_after, o))))
    extra = math.ceil(n * EXTRA_REQUEST_SHARE)
    avg_in = per_in / n if n else 0
    per_sentence = {"requests": n + extra, "input_tokens": int(per_in + extra * avg_in),
                    "output_tokens": (n + extra) * OUT_TOKENS_PER_SENTENCE_SINGLE}

    w = max(1, int(window_size))
    win_in, windows = 0, 0
    for a in range(start, end, w):
        b = min(end, a + w)
        win_in += _tokens(sys_chars, len(adapter.build_classify_prompt(_uow(segments, a, b, context_before, context_after, o))))
        windows += 1
    windowed = {"requests": windows, "input_tokens": win_in, "output_tokens": n * OUT_TOKENS_PER_SENTENCE_WINDOWED,
                "window_size": w}

    # JEV: the sentence state is sent once per question (tag / typo / split), each with its Arabic criteria
    criteria_chars = sum(len(v) for v in QUESTION_INSTRUCTIONS.values()) + sum(len(v) for v in OPTION_DESCRIPTIONS.values())
    jev_in = 0
    for i in range(start, end):
        s = segments[i]
        state = {"target_text": s.original_text,
                 "context_before": [x.original_text for x in segments[max(0, i - context_before):i]],
                 "context_after": [x.original_text for x in segments[i + 1:i + 1 + context_after]]}
        jev_in += int(len(json.dumps(state, ensure_ascii=False)) * jev_requests_per_sentence / PAYLOAD_CHARS_PER_TOKEN
                      + criteria_chars / PAYLOAD_CHARS_PER_TOKEN)
    jev = {"requests": n * jev_requests_per_sentence, "input_tokens": jev_in, "output_tokens": 0}

    return {"sentences": n, "per_sentence": per_sentence, "windowed": windowed, "jev": jev,
            "laya": {"requests": n, "input_tokens": 0, "output_tokens": 0}}
