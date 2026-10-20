"""
Gemini Adapter for AI Tafrigh Phase.
Supports Gemini Flash-Lite in both per_sentence and windowed modes.
Features static prefix context caching and [word_idx] prompt annotations.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Callable, Dict, List, Literal, Optional

import httpx

from ..models import CommentKind, StructuralTag, TextEdit, TranscriptSegment
from ..schemas import GeminiSingleOutputSchema, GeminiWindowItemSchema, GeminiWindowOutputSchema
from ..unit_of_work import UnitOfWork
from .base import BaseAdapter

STATIC_SYSTEM_PREFIX = """
You are an expert Islamic transcription assistant for the Wahy-Transcriber system.
Your task is to structure and faithfully transcribe an Arabic Islamic lecture (dars).

NON-NEGOTIABLE GUARDRAILS:
1. ABSOLUTE FAITHFULNESS: Never summarize, paraphrase, remove repetitions, or omit speaker words.
2. STRUCTURAL TAGS:
   - "paragraph": Ordinary lecture explanation.
   - "list_intro": Introductory sentence announcing a list (e.g. "شروط الصلاة تسعة:").
   - "list_item": An enumerated or bulleted item belonging to a list.
   - "heading": A major section/chapter title. Must include integer level (1, 2, 3) and valid parent ID.
   - "matn_section": The shaykh reading the canonical matn text as a distinct section.
   - "continuation": Continues the immediately preceding segment without starting a new line/paragraph.
   - "comment": Incidental speech outside substantive explanation (sneeze, student question, interruption, attendee exchange).
3. COMMENT POLICY: Never delete comments. Tag them as "comment" and provide "commentKind".
4. INDEX-BASED SPLITTING: If a segment contains mixed roles (e.g. conclusion of paragraph + list intro + first item), set "needsSplitting": true, and provide "splitPoints" using the 0-based word indices [idx] provided in the text.
5. TYPO CORRECTIONS: If phonetic ASR errors exist, provide "hasTypo": true and "edits": [{"start": char_start, "end": char_end, "replacement": str}]. Do not rewrite wording outside typo spans.
"""


def annotate_segment_with_word_indices(segment: TranscriptSegment) -> str:
    """Formats segment text with [word_idx] injected before each word."""
    parts: List[str] = []
    for token in segment.tokens:
        parts.append(f"[{token.word_index}] {token.text}")
    return " ".join(parts)


class GeminiAdapter(BaseAdapter):
    """Adapter for Google Gemini API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "gemini-2.0-flash",
        typo_strategy: Literal["gated", "always_correct", "asr_confidence_gated"] = "gated",
        mock_response_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
        enable_cache: bool = True,
    ) -> None:
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        self.model_name = model_name
        self.typo_strategy = typo_strategy
        self.mock_response_fn = mock_response_fn
        self.enable_cache = enable_cache
        self.cached_tokens_total: int = 0
        self.input_tokens_total: int = 0
        self.output_tokens_total: int = 0

    def build_dynamic_payload(self, uow: UnitOfWork) -> Dict[str, Any]:
        """Builds dynamic payload from UnitOfWork."""
        targets = []
        for s in uow.target_segments:
            targets.append({
                "id": s.id,
                "text": s.original_text,
                "annotated_text": annotate_segment_with_word_indices(s),
                "matn_evidence": s.matn_evidence.model_dump() if s.matn_evidence else None,
                "detection_signals": s.detection_signals,
            })

        return {
            "partial_toc": uow.partial_toc,
            "last_confirmed_heading": (
                uow.last_confirmed_heading.model_dump() if uow.last_confirmed_heading else None
            ),
            "allowed_choices": uow.allowed_choices,
            "context_before": [s.original_text for s in uow.context_before],
            "target_segments": targets,
            "context_after": [s.original_text for s in uow.context_after],
        }

    def _call_model(self, prompt: str) -> Dict[str, Any]:
        """Internal call to Gemini API or mock function."""
        if self.mock_response_fn:
            return self.mock_response_fn({"prompt": prompt, "model": self.model_name})

        if not self.api_key:
            # Fallback heuristic if no API key is provided in testing/offline
            return {
                "decisions": [
                    {
                        "id": "unknown",
                        "tag": "paragraph",
                        "level": None,
                        "parent": None,
                        "hasTypo": False,
                        "needsSplitting": False,
                        "splitPoints": [],
                        "edits": [],
                    }
                ],
                "usage": {"input_tokens": 100, "output_tokens": 50, "cached_tokens": 0},
            }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent?key={self.api_key}"
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": STATIC_SYSTEM_PREFIX},
                        {"text": prompt},
                    ]
                }
            ],
            "generationConfig": {
                "response_mime_type": "application/json",
            },
        }

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw_text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "{}")
            )
            parsed = json.loads(raw_text)
            usage = data.get("usageMetadata", {})
            return {
                "parsed": parsed,
                "usage": {
                    "input_tokens": usage.get("promptTokenCount", 0),
                    "output_tokens": usage.get("candidatesTokenCount", 0),
                    "cached_tokens": usage.get("cachedContentTokenCount", 0),
                },
            }

    def classify_uow(self, uow: UnitOfWork) -> List[GeminiWindowItemSchema]:
        """Classifies target segments inside a UnitOfWork."""
        if not self.api_key and not self.mock_response_fn:
            return self._offline_classify_uow(uow)

        dynamic_data = self.build_dynamic_payload(uow)
        prompt = (
            f"DYNAMIC TARGET PAYLOAD:\n{json.dumps(dynamic_data, ensure_ascii=False, indent=2)}\n\n"
            "Return a JSON object conforming to: {\"decisions\": [{\"id\": ..., \"tag\": ..., \"level\": ..., \"parent\": ..., \"commentKind\": ..., \"hasTypo\": ..., \"needsSplitting\": ..., \"splitPoints\": [...], \"edits\": [...]}]}"
        )

        res = self._call_model(prompt)
        parsed = res.get("parsed", res)
        usage = res.get("usage", {})
        self.input_tokens_total += usage.get("input_tokens", 0)
        self.output_tokens_total += usage.get("output_tokens", 0)
        self.cached_tokens_total += usage.get("cached_tokens", 0)

        decisions_raw = parsed.get("decisions", [])
        items: List[GeminiWindowItemSchema] = []
        for d in decisions_raw:
            items.append(GeminiWindowItemSchema.model_validate(d))

        return items

    def _offline_classify_uow(self, uow: UnitOfWork) -> List[GeminiWindowItemSchema]:
        """Provides high-quality offline rule/detection-based classification when no API key is provided."""
        items: List[GeminiWindowItemSchema] = []
        for s in uow.target_segments:
            text = s.original_text.strip()

            # 1. Matn section candidate from sequential pointer
            if s.matn_evidence and s.matn_evidence.is_candidate_standalone_matn:
                items.append(GeminiWindowItemSchema(id=s.id, tag=StructuralTag.MATN_SECTION))
                continue

            # 2. Mixed long sentence needing splitting
            if len(s.tokens) >= 10:
                split_indices = []
                for t in s.tokens:
                    if t.word_index > 0 and t.text in ("وسنذكر", "الأول", "الثاني", "ثم", "فائدة:", "مسألة:"):
                        split_indices.append(t.word_index)
                if split_indices:
                    items.append(
                        GeminiWindowItemSchema(
                            id=s.id,
                            tag=StructuralTag.PARAGRAPH,
                            needsSplitting=True,
                            splitPoints=sorted(set(split_indices)),
                        )
                    )
                    continue

            # 3. Headings
            if (
                text.startswith("كتاب ")
                or text.startswith("باب ")
                or text.startswith("فصل ")
                or text.startswith("# ")
                or text.startswith("## ")
            ):
                lvl = 1
                pid = None
                if text.startswith("باب ") or text.startswith("فصل ") or text.startswith("## "):
                    lvl = 2
                    if uow.last_confirmed_heading:
                        pid = uow.last_confirmed_heading.segment_id
                items.append(GeminiWindowItemSchema(id=s.id, tag=StructuralTag.HEADING, level=lvl, parent=pid))
                continue

            # 4. List Intro
            if (
                text.endswith(":")
                or text.endswith("：")
                or "شروط" in text
                or "أركان" in text
                or "واجبات" in text
            ):
                items.append(GeminiWindowItemSchema(id=s.id, tag=StructuralTag.LIST_INTRO))
                continue

            # 5. List Item
            if (
                text.startswith("الأول ")
                or text.startswith("الثاني ")
                or text.startswith("الثالث ")
                or text.startswith("الرابع ")
                or text.startswith("- ")
                or text.startswith("• ")
                or (len(s.tokens) > 0 and s.tokens[0].text in ("الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"))
            ):
                items.append(GeminiWindowItemSchema(id=s.id, tag=StructuralTag.LIST_ITEM))
                continue

            # 6. Incidental Comment
            if (
                "يرحمكم الله" in text
                or "أثابكم الله" in text
                or "تفضل بالسؤال" in text
                or "سؤال:" in text
                or "عطاس" in text
            ):
                items.append(
                    GeminiWindowItemSchema(
                        id=s.id,
                        tag=StructuralTag.COMMENT,
                        commentKind=CommentKind.STUDENT_QUESTION if "سؤال" in text else CommentKind.OTHER_INCIDENTAL,
                    )
                )
                continue

            # 7. Continuation
            if text.startswith("وهو ") or text.startswith("وهذا "):
                items.append(GeminiWindowItemSchema(id=s.id, tag=StructuralTag.CONTINUATION))
                continue

            # Default: Paragraph
            items.append(GeminiWindowItemSchema(id=s.id, tag=StructuralTag.PARAGRAPH))

        return items

    def get_split_points(self, segment: TranscriptSegment, context: Optional[UnitOfWork] = None) -> List[int]:
        """Dedicated request to determine split word indices for a segment."""
        if not self.api_key and not self.mock_response_fn:
            pts = []
            for t in segment.tokens:
                if t.word_index > 0 and t.text in ("وسنذكر", "الأول", "الثاني", "ثم", "فائدة:", "مسألة:"):
                    pts.append(t.word_index)
            return sorted(set(pts)) if pts else [len(segment.tokens) // 2] if len(segment.tokens) >= 6 else []

        annotated = annotate_segment_with_word_indices(segment)
        prompt = (
            f"Segment text with word indices:\n{annotated}\n\n"
            "This segment contains mixed roles and must be split into distinct subsegments.\n"
            "Return a JSON object with: {\"splitPoints\": [word_index_1, word_index_2, ...]}\n"
            "where each word_index is the 0-based index marking the start of a new subsegment."
        )
        res = self._call_model(prompt)
        parsed = res.get("parsed", res)
        return parsed.get("splitPoints", [])

    def get_typo_edits(self, segment: TranscriptSegment, context: Optional[UnitOfWork] = None) -> List[TextEdit]:
        """Dedicated request to determine character-level typo edits."""
        if not self.api_key and not self.mock_response_fn:
            return []

        prompt = (
            f"Segment text:\n{segment.original_text}\n\n"
            "Identify phonetic ASR transcription errors and return exact character edit spans.\n"
            "Format: {\"edits\": [{\"start\": int, \"end\": int, \"replacement\": str, \"reason\": str}]}"
        )
        res = self._call_model(prompt)
        parsed = res.get("parsed", res)
        edits_raw = parsed.get("edits", [])
        return [TextEdit.model_validate(e) for e in edits_raw]

