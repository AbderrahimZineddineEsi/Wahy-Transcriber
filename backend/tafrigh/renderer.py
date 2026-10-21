"""
Stage 7 Deterministic Renderer for Wahy-Transcriber AI Tafrigh Phase.
Zero LLM calls. Deterministically transforms structural segments and lecture spans into
clean, student-friendly Markdown, HTML, and structured JSON.
"""

from __future__ import annotations

import html
import re
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
    # detected quotations (from the detection engine) are shown from their source
    quran_open: str = "﴿"
    quran_close: str = "﴾"
    hadith_open: str = "«"
    hadith_close: str = "»"
    adhkar_open: str = "〖"
    adhkar_close: str = "〗"
    show_quote_refs: bool = True


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

    # segments keep their original surrounding whitespace (exact reconstruction); trim it only for display
    return segment.active_text.strip()


_JOINABLE = re.compile(r"^[\s،,.؛;:]*$")


def _quote_ops(seg: TranscriptSegment) -> List[Dict[str, Any]]:
    """Detected quotations fully inside this sentence, as ops on its original text (relative offsets).
    Consecutive ayat of one surah separated only by spaces/commas become one quote with a range label."""
    base, n = seg.source_pos.char_start, len(seg.original_text)
    ops: List[Dict[str, Any]] = []
    for d in sorted(seg.detection_signals, key=lambda x: int(x.get("start", 0))):
        a, b = int(d.get("start", 0)) - base, int(d.get("end", 0)) - base
        if not (0 <= a < b <= n) or not d.get("ref"):
            continue
        kind = {"quran": "quran", "hadith": "hadith"}.get(str(d.get("type")), "adhkar")
        m = re.match(r"^(\d+):(\d+)$", str(d.get("unit_id") or ""))
        op = {
            "start": a, "end": b, "kind": kind, "ref": str(d["ref"]), "band": d.get("band"),
            "spoken": seg.original_text[a:b],
            # an ayah is shown in the Mushaf wording; hadith/dhikr keep the words the shaykh actually said
            "text": (d.get("canonical") or seg.original_text[a:b]) if kind == "quran" else seg.original_text[a:b],
            "surah": int(m.group(1)) if m and kind == "quran" else None,
            "ayah_from": int(m.group(2)) if m and kind == "quran" else None,
        }
        op["ayah_to"] = op["ayah_from"]
        prev = ops[-1] if ops else None
        if (prev and kind == "quran" and prev["kind"] == "quran" and prev["surah"] and prev["surah"] == op["surah"]
                and op["ayah_from"] == prev["ayah_to"] + 1 and _JOINABLE.match(seg.original_text[prev["end"]:a])
                and prev["band"] != "AMBIGUOUS" and op["band"] != "AMBIGUOUS"):
            prev["end"], prev["ayah_to"] = b, op["ayah_from"]
            prev["text"] = f'{prev["text"]} ۝ {op["text"]}'
            prev["ref"] = f'{prev["ref"].split(":")[0].strip()}: {prev["ayah_from"]}-{prev["ayah_to"]}'
            continue
        if prev and a < prev["end"]:
            continue                                   # overlapping detections: keep the first
        ops.append(op)
    return ops


def _segment_pieces(seg: TranscriptSegment, cfg: RenderConfig) -> List[Any]:
    """The sentence as [str | quote-dict] pieces: accepted corrections applied, quotations from their source."""
    text = seg.original_text
    ops: List[Dict[str, Any]] = [dict(o, op="quote") for o in _quote_ops(seg)]
    if cfg.use_corrected_text and seg.active_version_id:
        ver = next((v for v in seg.versions if v.version_id == seg.active_version_id), None)
        for e in (ver.edits if ver else []):
            if not any(e.start < q["end"] and q["start"] < e.end for q in ops if q["op"] == "quote"):
                ops.append({"op": "edit", "start": e.start, "end": e.end, "text": e.replacement})
    ops.sort(key=lambda o: o["start"])
    pieces: List[Any] = []
    cur = 0
    for o in ops:
        if o["start"] < cur:
            continue
        pieces.append(text[cur:o["start"]])
        pieces.append(o["text"] if o["op"] == "edit" else o)
        cur = o["end"]
    pieces.append(text[cur:])
    # merge adjacent strings and trim the sentence edges
    out: List[Any] = []
    for p in pieces:
        if isinstance(p, str) and out and isinstance(out[-1], str):
            out[-1] += p
        elif p != "":
            out.append(p)
    if out and isinstance(out[0], str):
        out[0] = out[0].lstrip()
    if out and isinstance(out[-1], str):
        out[-1] = out[-1].rstrip()
    return [p for p in out if p != ""]


def _quote_brackets(q: Dict[str, Any], cfg: RenderConfig) -> tuple:
    return {"quran": (cfg.quran_open, cfg.quran_close), "hadith": (cfg.hadith_open, cfg.hadith_close)}.get(
        q["kind"], (cfg.adhkar_open, cfg.adhkar_close))


def _ref_label(q: Dict[str, Any]) -> str:
    return q["ref"] + ("؟" if q.get("band") == "CANDIDATE" else "")


def segment_markdown_text(seg: TranscriptSegment, cfg: RenderConfig) -> str:
    if seg.final_decision and seg.final_decision.tag == StructuralTag.MATN_SECTION and cfg.matn_display_source == "canonical":
        return get_segment_render_text(seg, cfg).strip()
    parts = []
    for p in _segment_pieces(seg, cfg):
        if isinstance(p, str):
            parts.append(p)
        else:
            o, c = _quote_brackets(p, cfg)
            parts.append(f"{o}{p['text']}{c}" + (f" [{_ref_label(p)}]" if cfg.show_quote_refs else ""))
    return "".join(parts).strip()


def segment_html_text(seg: TranscriptSegment, cfg: RenderConfig) -> str:
    if seg.final_decision and seg.final_decision.tag == StructuralTag.MATN_SECTION and cfg.matn_display_source == "canonical":
        return html.escape(get_segment_render_text(seg, cfg).strip())
    parts = []
    for p in _segment_pieces(seg, cfg):
        if isinstance(p, str):
            parts.append(html.escape(p))
        else:
            o, c = _quote_brackets(p, cfg)
            ref = f' <span class="tafrigh-ref">[{html.escape(_ref_label(p))}]</span>' if cfg.show_quote_refs else ""
            parts.append(
                f'<span class="tafrigh-quote tafrigh-quote-{p["kind"]}" title="{html.escape(p["spoken"])}">'
                f'{html.escape(o)}{html.escape(p["text"])}{html.escape(c)}</span>{ref}'
            )
    return "".join(parts).strip()


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
        text = segment_markdown_text(seg, cfg)

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
            if lines and not lines[-1].lstrip().startswith("#"):
                lines[-1] = lines[-1] + " " + text
            else:
                lines.append(text)

        elif tag == StructuralTag.HEADING:
            level = max(1, min(6, decision.level or 1))
            hashes = "#" * level
            lines.append(f"\n{hashes} {text}\n")

        elif tag == StructuralTag.LIST_INTRO:
            intro_text = text if text.endswith((":", "：", ".", "؟", "!", "؛", "،")) else f"{text}:"  # never ".:"
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
        text = segment_html_text(seg, cfg)
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
            intro_text = text if text.endswith((":", "：", ".", "؟", "!", "؛", "،")) else f"{text}:"  # never ".:"
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


def _public_trace(trace: Dict[str, Any]) -> Dict[str, Any]:
    """The model input kept for training exports (sentences + context) is large and not needed by the UI."""
    out = {k: v for k, v in trace.items() if k != "input"}
    if isinstance(out.get("split_from"), dict):
        out["split_from"] = {k: v for k, v in out["split_from"].items() if k != "input"}
    return out


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
                "display_text": segment_markdown_text(s, cfg),
                "corrected_text": s.active_text if s.versions else None,
                "cut_reason": s.cut_reason,
                "start_time": s.source_pos.start_time,
                "end_time": s.source_pos.end_time,
                "quotes": [{k: q[k] for k in ("kind", "ref", "band", "spoken", "text")} for q in _quote_ops(s)],
                "trace": _public_trace(s.trace),
            }
            for s in segments
        ],
    }
