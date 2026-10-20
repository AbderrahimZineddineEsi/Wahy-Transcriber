"""
Stage 7 Deterministic Renderer for Wahy-Transcriber AI Tafrigh Phase.
Zero LLM calls. Deterministically transforms structural segments and lecture spans into
clean, student-friendly Markdown, HTML, and structured JSON.
"""

from __future__ import annotations

import html
import time
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .models import (
    CommentKind,
    LectureSpan,
    OutlineState,
    StructuralDecision,
    StructuralTag,
    TranscriptSegment,
)


class RenderConfig(BaseModel):
    matn_display_source: Literal["spoken", "canonical"] = "spoken"
    show_comments: bool = True
    comment_style: Literal["aside_box", "footnote", "dimmed_inline"] = "aside_box"
    use_corrected_text: bool = True


COMMENT_KIND_LABELS: Dict[CommentKind, str] = {
    CommentKind.SNEEZE: "عطاس / دعاء",
    CommentKind.STUDENT_QUESTION: "سؤال طالب",
    CommentKind.INTERRUPTION: "مقاطعة عارضة",
    CommentKind.ATTENDEE_EXCHANGE: "حديث مع الحاضرين",
    CommentKind.OTHER_INCIDENTAL: "تعليق عارض",
}


def get_segment_render_text(segment: TranscriptSegment, config: RenderConfig) -> str:
    """Returns the text to display for a segment based on config."""
    if not config.use_corrected_text:
        return segment.original_text

    # If matn section and user requested canonical
    if (
        segment.final_decision
        and segment.final_decision.tag == StructuralTag.MATN_SECTION
        and config.matn_display_source == "canonical"
        and segment.matn_evidence
        and segment.matn_evidence.canonical_text
    ):
        return segment.matn_evidence.canonical_text

    return segment.active_text


def render_to_markdown(
    segments: List[TranscriptSegment],
    outline_state: Optional[OutlineState] = None,
    config: Optional[RenderConfig] = None,
) -> str:
    """Renders segments to formatted Markdown deterministically."""
    cfg = config or RenderConfig()
    lines: List[str] = []

    in_matn_block = False
    in_sharh_block = False

    for idx, seg in enumerate(segments):
        decision = seg.final_decision or StructuralDecision(tag=StructuralTag.PARAGRAPH)
        tag = decision.tag
        text = get_segment_render_text(seg, cfg).strip()

        # Handle Matn vs Sharh block transitions
        if tag == StructuralTag.MATN_SECTION:
            if not in_matn_block:
                in_matn_block = True
                in_sharh_block = False
                lines.append(f"\n**المتن:** {text}")
            else:
                # continuation or subsequent matn segment
                lines.append(f"{text}")
            continue
        else:
            if in_matn_block:
                in_matn_block = False
                in_sharh_block = True
                # Starting sharh
                if tag != StructuralTag.COMMENT:
                    lines.append(f"\n**الشرح:**")

        if tag == StructuralTag.CONTINUATION:
            if lines:
                lines[-1] = lines[-1] + " " + text
            else:
                lines.append(text)

        elif tag == StructuralTag.HEADING:
            level = max(1, min(6, decision.level or 1))
            hashes = "#" * level
            lines.append(f"\n{hashes} {text}\n")

        elif tag == StructuralTag.LIST_INTRO:
            intro_text = text if text.endswith(":") or text.endswith("：") else f"{text}:"
            lines.append(f"\n{intro_text}")

        elif tag == StructuralTag.LIST_ITEM:
            lines.append(f"- {text}")

        elif tag == StructuralTag.COMMENT:
            if cfg.show_comments:
                kind = decision.comment_kind or CommentKind.OTHER_INCIDENTAL
                label = COMMENT_KIND_LABELS.get(kind, "تعليق عارض")
                if cfg.comment_style == "aside_box":
                    lines.append(f"\n> *[{label}]* {text}\n")
                elif cfg.comment_style == "dimmed_inline":
                    lines.append(f" *({label}: {text})* ")
                else:  # footnote
                    lines.append(f" [^{idx+1}]\n\n[^{idx+1}]: *{label}*: {text}")

        else:  # PARAGRAPH
            lines.append(f"\n{text}")

    return "\n".join(lines).strip() + "\n"


def render_to_html(
    segments: List[TranscriptSegment],
    outline_state: Optional[OutlineState] = None,
    config: Optional[RenderConfig] = None,
) -> str:
    """Renders segments to responsive semantic HTML deterministically."""
    cfg = config or RenderConfig()
    elements: List[str] = []

    in_matn_block = False

    for idx, seg in enumerate(segments):
        decision = seg.final_decision or StructuralDecision(tag=StructuralTag.PARAGRAPH)
        tag = decision.tag
        text = html.escape(get_segment_render_text(seg, cfg).strip())
        sid = seg.id

        # Matn / Sharh block handling
        if tag == StructuralTag.MATN_SECTION:
            if not in_matn_block:
                in_matn_block = True
                variant_attr = ' data-variant-wording="true"' if (seg.matn_evidence and seg.matn_evidence.has_variant_wording) else ''
                elements.append(f'<div class="tafrigh-matn-block"{variant_attr} id="{sid}"><strong class="tafrigh-label">المتن:</strong> <span class="tafrigh-content">{text}</span>')
            else:
                elements.append(f' <span class="tafrigh-content" id="{sid}">{text}</span>')
            continue
        else:
            if in_matn_block:
                in_matn_block = False
                elements.append('</div>')
                if tag != StructuralTag.COMMENT:
                    elements.append('<div class="tafrigh-sharh-block"><strong class="tafrigh-label">الشرح:</strong></div>')

        if tag == StructuralTag.CONTINUATION:
            if elements and elements[-1].endswith('</p>'):
                elements[-1] = elements[-1][:-4] + f' <span class="tafrigh-continuation" id="{sid}">{text}</span></p>'
            elif elements and elements[-1].endswith('</li>'):
                elements[-1] = elements[-1][:-5] + f' <span class="tafrigh-continuation" id="{sid}">{text}</span></li>'
            else:
                elements.append(f'<span class="tafrigh-continuation" id="{sid}">{text}</span>')

        elif tag == StructuralTag.HEADING:
            level = max(1, min(6, decision.level or 1))
            pid_attr = f' data-parent-id="{decision.parent_id}"' if decision.parent_id else ''
            elements.append(f'<h{level} class="tafrigh-heading" id="{sid}"{pid_attr}>{text}</h{level}>')

        elif tag == StructuralTag.LIST_INTRO:
            intro_text = text if text.endswith(":") or text.endswith("：") else f"{text}:"
            elements.append(f'<p class="tafrigh-list-intro" id="{sid}">{intro_text}</p>')

        elif tag == StructuralTag.LIST_ITEM:
            elements.append(f'<li class="tafrigh-list-item" id="{sid}">{text}</li>')

        elif tag == StructuralTag.COMMENT:
            if cfg.show_comments:
                kind = decision.comment_kind or CommentKind.OTHER_INCIDENTAL
                label = COMMENT_KIND_LABELS.get(kind, "تعليق عارض")
                elements.append(
                    f'<aside class="tafrigh-comment" data-comment-kind="{kind.value}" id="{sid}">'
                    f'<span class="tafrigh-comment-badge">[{label}]</span> {text}</aside>'
                )

        else:  # PARAGRAPH
            elements.append(f'<p class="tafrigh-paragraph" id="{sid}">{text}</p>')

    if in_matn_block:
        elements.append('</div>')

    return "\n".join(elements)


def render_to_structured_json(
    segments: List[TranscriptSegment],
    outline_state: Optional[OutlineState] = None,
    lecture_spans: Optional[List[LectureSpan]] = None,
    config: Optional[RenderConfig] = None,
) -> Dict[str, Any]:
    """Generates structured JSON view of the finalized transcript."""
    cfg = config or RenderConfig()
    return {
        "config": cfg.model_dump(),
        "headings": [h.model_dump() for h in outline_state.headings] if outline_state else [],
        "spans": [s.model_dump() for s in lecture_spans] if lecture_spans else [],
        "segments": [
            {
                "id": s.id,
                "text": get_segment_render_text(s, cfg),
                "original_text": s.original_text,
                "tag": s.final_decision.tag.value if s.final_decision else "paragraph",
                "level": s.final_decision.level if s.final_decision else None,
                "parent_id": s.final_decision.parent_id if s.final_decision else None,
                "comment_kind": (
                    s.final_decision.comment_kind.value
                    if s.final_decision and s.final_decision.comment_kind
                    else None
                ),
                "review_flags": s.review_flags,
                "has_versions": bool(s.versions),
            }
            for s in segments
        ],
    }
