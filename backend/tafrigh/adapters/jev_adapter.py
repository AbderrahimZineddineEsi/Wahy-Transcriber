"""
JEV Adapter for AI Tafrigh Phase.
Implements the ChoiceClassifierAdapter interface.
Supports both independent_questions and split_as_tag_option layouts,
with parallel and sequential execution orders.
"""

from __future__ import annotations

import concurrent.futures
import os
import time
from typing import Any, Callable, Dict, List, Literal, Optional

import httpx

from ..models import CommentKind, StructuralTag, TranscriptSegment
from ..schemas import GeminiWindowItemSchema, JEVRequestConfig
from ..unit_of_work import UnitOfWork
from .base import ChoiceClassifierAdapter
from .errors import ModelAPIError


JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
DEFAULT_JEV_MODEL = "typesafe/jev-1.14"


class JEVAPIError(ModelAPIError):
    """A JEV / OpenRouter Decisions call failed (see ModelAPIError)."""


QUESTION_INSTRUCTIONS = {
    "tag": (
        "في هذا النص المفرَّغ من درس علمي إسلامي، حدِّد الدور البنيوي للجملة `target_text` "
        "(الجمل المجاورة في `context_before` و`context_after` للسياق فقط). اختر الخيار الأنسب."
    ),
    "hasTypo": (
        "هل تحتوي `target_text` على خطأ تفريغ آلي محتمل (كلمة مستبدلة بأخرى مشابهة في النطق، أو خطأ إملائي، "
        "أو حدود كلمات خاطئة، أو خطأ في مصطلح شرعي)؟"
    ),
    "needsSplitting": (
        "هل تجمع `target_text` أدواراً بنيوية مختلفة تحتاج إلى وسوم مختلفة "
        "(مثل: نهاية فقرة ثم تمهيد لقائمة ثم أول عنصر فيها)؟ ليس السؤال عن كثرة الجمل، "
        "ولا عن صعوبة التصنيف؛ الجواب نعم فقط إذا تغيّر الدور داخل الجملة نفسها."
    ),
}

OPTION_DESCRIPTIONS = {
    "paragraph": ("بداية كلام جديد من الشيخ: جملة مستقلة المعنى تبدأ قولاً أو فكرة جديدة، مثل «قال الله تعالى…»، "
                  "«وقال عز وجل…»، «نعم، …»، «ثم…»، «واعلم…». ويشمل افتتاح الدرس بالبسملة والحمدلة."),
    "list_intro": "جملة تمهّد لقائمة (مثل: شروط الصلاة تسعة:).",
    "list_item": "عنصر مُرقَّم أو مُعدَّد ينتمي إلى قائمة سبقها تمهيد.",
    "matn_section": "الشيخ يقرأ نص المتن الأصلي كقسم مستقل.",
    "continuation": ("تكملة نحوية للجملة السابقة: تبدأ في منتصف جملة لم تتم ولا يستقيم معناها وحدها "
                     "(مثل أن تبدأ بمفعول أو صفة أو جواب لما قبلها). إذا بدأت قولاً جديداً فليست تكملة."),
    "comment": "كلام عارض خارج الشرح (عطاس، سؤال طالب، مقاطعة، حديث مع أحد الحضور).",
    "true": "نعم.",
    "false": "لا.",
    "needs_splitting": "الجملة مختلطة الأدوار وتحتاج إلى تقسيم.",
}


def describe_option(label: str) -> str:
    if label in OPTION_DESCRIPTIONS:
        return OPTION_DESCRIPTIONS[label]
    if label.startswith("heading_"):
        parts = label.split("_", 2)
        lvl = parts[1] if len(parts) > 1 else "1"
        parent = parts[2] if len(parts) > 2 else "none"
        under = "" if parent == "none" else f" تحت العنوان {parent}"
        return (f"عنوان من المستوى {lvl}{under}: يعلن الشيخ به باباً أو فصلاً أو مسألة جديدة "
                f"(مثل: باب شروط الصلاة). البسملة والحمدلة وخطبة الحاجة ليست عناوين.")
    return label


class JEVAdapter(ChoiceClassifierAdapter):
    """Adapter for JEV (Joint Entity / Value) choice-based classification API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        config: Optional[JEVRequestConfig] = None,
        api_url: Optional[str] = None,
        mock_response_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
        model: str = DEFAULT_JEV_MODEL,
        transport: Optional[httpx.BaseTransport] = None,
        max_retries: int = 3,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
        self.api_key = api_key or os.getenv("JEV_API_KEY", "") or os.getenv("OPENROUTER_API_KEY", "")
        self.config = config or JEVRequestConfig()
        self.api_url = api_url or JEV_DECISIONS_URL
        self.mock_response_fn = mock_response_fn
        self.model = model or DEFAULT_JEV_MODEL
        self.transport = transport
        self.max_retries = max_retries
        self._sleep = sleep_fn
        self.request_count = 0
        self.total_cost_usd = 0.0
        self.total_input_tokens = 0

    def predict_questions(
        self,
        state: Dict[str, Any],
        questions: Dict[str, List[str]],
    ) -> Dict[str, Any]:
        """Ask JEV the given choice questions ({question_key: [option labels]}); returns {"answers": {key: label}, ...}."""
        if self.mock_response_fn:
            return self.mock_response_fn({"state": state, "questions": questions})
        if not self.api_key:
            raise JEVAPIError("مفتاح OpenRouter مطلوب لتشغيل نموذج JEV. أدخله في إعدادات التدقيق الذكي.", 401)

        payload_questions = {
            key: {
                "type": "choice",
                "instructions": QUESTION_INSTRUCTIONS.get(key, key),
                "criteria": {opt: describe_option(opt) for opt in options},
            }
            for key, options in questions.items()
            if options
        }
        body = {"model": self.model, "state": state, "questions": payload_questions}
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://wahy-transcriber.local",
            "X-Title": "Wahy Transcriber Tafrigh",
        }

        last: Optional[JEVAPIError] = None
        for attempt in range(self.max_retries + 1):
            t0 = time.perf_counter()
            try:
                with httpx.Client(timeout=60.0, transport=self.transport) as client:
                    resp = client.post(self.api_url, headers=headers, json=body)
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise JEVAPIError(f"JEV HTTP {resp.status_code}: {resp.text[:200]}", resp.status_code, True)
                if resp.status_code != 200:
                    raise JEVAPIError(f"JEV HTTP {resp.status_code}: {resp.text[:300]}", resp.status_code)
                try:
                    data = resp.json()
                except ValueError as exc:
                    raise JEVAPIError(f"رد JEV ليس JSON: {resp.text[:120]}", None, True) from exc
                raw_answers = data.get("answers") or {}
                answers: Dict[str, str] = {}
                confidences: Dict[str, float] = {}
                probabilities: Dict[str, Dict[str, float]] = {}
                for key, options in questions.items():
                    a_obj = raw_answers.get(key) or {}
                    choice = a_obj.get("choice")
                    if choice not in options:
                        raise JEVAPIError(f"JEV أعاد إجابة غير صالحة للسؤال {key}: {choice!r}", None, True)
                    answers[key] = choice
                    # JEV's "confidence" is the margin between the top two options; the probability of the
                    # chosen option is in "probabilities"
                    probs = {str(k): float(v) for k, v in (a_obj.get("probabilities") or {}).items() if isinstance(v, (int, float))}
                    probabilities[key] = probs
                    if choice in probs:
                        confidences[key] = probs[choice]
                    elif isinstance(a_obj.get("confidence"), (int, float)):
                        confidences[key] = float(a_obj["confidence"])
                usage = data.get("usage") or {}
                self.request_count += 1
                self.total_cost_usd += float(usage.get("cost") or 0.0)
                self.total_input_tokens += int(usage.get("input_tokens") or 0)
                return {
                    "answers": answers,
                    "confidences": confidences,
                    "probabilities": probabilities,
                    "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                    "cost": float(usage.get("cost") or 0.0),
                }
            except httpx.HTTPError as exc:
                last = JEVAPIError(f"تعذر الاتصال بـ OpenRouter: {exc}", None, True)
            except JEVAPIError as exc:
                last = exc
                if not exc.retryable:
                    raise
            if attempt < self.max_retries:
                self._sleep(min(20.0, 1.0 * (2 ** attempt)))
        raise last or JEVAPIError("فشل غير معروف في استدعاء JEV")

    def _format_tag_choice(self, choice: Dict[str, Any]) -> str:
        tag = choice.get("tag", "paragraph")
        level = choice.get("level")
        parent_id = choice.get("parent_id")
        if tag == "heading" and level:
            return f"heading_{level}_{parent_id or 'none'}"
        return tag

    def _parse_tag_choice(self, chosen: str) -> Dict[str, Any]:
        if chosen == "needs_splitting":
            return {"tag": None, "level": None, "parent": None, "needsSplitting": True}
        if chosen.startswith("heading_"):
            parts = chosen.split("_", 2)   # parent segment ids contain underscores (seg_0003)
            lvl = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
            parent = parts[2] if len(parts) > 2 and parts[2] != "none" else None
            return {"tag": StructuralTag.HEADING, "level": lvl, "parent": parent, "needsSplitting": False}
        try:
            tag_enum = StructuralTag(chosen)
        except ValueError:
            tag_enum = StructuralTag.PARAGRAPH
        return {"tag": tag_enum, "level": None, "parent": None, "needsSplitting": False}

    def classify_single_segment(
        self,
        segment: TranscriptSegment,
        uow: UnitOfWork,
    ) -> GeminiWindowItemSchema:
        state = {
            "target_text": segment.original_text,
            "context_before": [s.original_text for s in uow.context_before],
            "context_after": [s.original_text for s in uow.context_after],
            "partial_toc": uow.partial_toc,
        }
        quotes = [
            {"type": d.get("type"), "ref": d.get("ref"), "text": segment.original_text[
                max(0, int(d.get("start", 0)) - segment.source_pos.char_start):max(0, int(d.get("end", 0)) - segment.source_pos.char_start)]}
            for d in segment.detection_signals if d.get("ref")
        ]
        if quotes:
            state["quotations_in_target"] = quotes   # ayat/hadiths found by the detection engine (not typos)

        trace: Dict[str, Any] = {"provider": "jev", "model": self.model, "layout": self.config.jev_layout, "answers": {}}

        def keep(res: Dict[str, Any]) -> Dict[str, Any]:
            for k, v in (res.get("answers") or {}).items():
                trace["answers"][k] = {
                    "choice": v,
                    "confidence": (res.get("confidences") or {}).get(k),        # probability of the chosen option
                    "probabilities": (res.get("probabilities") or {}).get(k, {}),
                }
            return res

        if self.config.jev_layout == "independent_questions":
            tag_choices = [self._format_tag_choice(c) for c in uow.allowed_choices if c.get("tag") != "needs_splitting"]
            trace["tag_choices"] = tag_choices

            if self.config.execution_order == "sequential":
                needs_splitting = keep(self.predict_questions(state, {"needsSplitting": ["true", "false"]})).get("answers", {}).get("needsSplitting") == "true"
                if needs_splitting:
                    has_typo = keep(self.predict_questions(state, {"hasTypo": ["true", "false"]})).get("answers", {}).get("hasTypo") == "true"
                    return GeminiWindowItemSchema(id=segment.id, tag=None, hasTypo=has_typo, needsSplitting=True, trace=trace)
                answers = keep(self.predict_questions(state, {"tag": tag_choices, "hasTypo": ["true", "false"]})).get("answers", {})
                parsed_tag = self._parse_tag_choice(answers.get("tag", "paragraph"))
                return GeminiWindowItemSchema(
                    id=segment.id, tag=parsed_tag["tag"], level=parsed_tag["level"], parent=parsed_tag["parent"],
                    hasTypo=answers.get("hasTypo") == "true", needsSplitting=False,
                    confidence=trace["answers"].get("tag", {}).get("confidence"), trace=trace,
                )

            # parallel: the three questions at once; a "split" answer discards the tag answer
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                f_tag = executor.submit(self.predict_questions, state, {"tag": tag_choices})
                f_typo = executor.submit(self.predict_questions, state, {"hasTypo": ["true", "false"]})
                f_split = executor.submit(self.predict_questions, state, {"needsSplitting": ["true", "false"]})
                res_tag, res_typo, res_split = keep(f_tag.result()), keep(f_typo.result()), keep(f_split.result())

            needs_splitting = res_split.get("answers", {}).get("needsSplitting") == "true"
            has_typo = res_typo.get("answers", {}).get("hasTypo") == "true"
            parsed_tag = self._parse_tag_choice(res_tag.get("answers", {}).get("tag", "paragraph"))
            if needs_splitting:
                # if the split ends up applied the pieces are re-classified and this tag is unused; if the split
                # is skipped or fails, JEV's own tag is kept instead of falling back to «paragraph»
                trace["tag_used_only_if_not_split"] = True
                return GeminiWindowItemSchema(
                    id=segment.id, tag=parsed_tag["tag"], level=parsed_tag["level"], parent=parsed_tag["parent"],
                    hasTypo=has_typo, needsSplitting=True,
                    confidence=trace["answers"].get("tag", {}).get("confidence"), trace=trace,
                )
            return GeminiWindowItemSchema(
                id=segment.id, tag=parsed_tag["tag"], level=parsed_tag["level"], parent=parsed_tag["parent"],
                hasTypo=has_typo, needsSplitting=False,
                confidence=trace["answers"].get("tag", {}).get("confidence"), trace=trace,
            )
        else:
            # split_as_tag_option layout
            tag_choices = [self._format_tag_choice(c) for c in uow.allowed_choices]
            if "needs_splitting" not in tag_choices:
                tag_choices.append("needs_splitting")

            q_res = self.predict_questions(
                state,
                {"tag": tag_choices, "hasTypo": ["true", "false"]},
            )
            answers = q_res.get("answers", {})
            chosen_tag = answers.get("tag", "paragraph")
            has_typo = answers.get("hasTypo") == "true"

            parsed = self._parse_tag_choice(chosen_tag)
            return GeminiWindowItemSchema(
                id=segment.id,
                tag=parsed["tag"],
                level=parsed["level"],
                parent=parsed["parent"],
                hasTypo=has_typo,
                needsSplitting=parsed["needsSplitting"],
            )

    def classify_uow(self, uow: UnitOfWork) -> List[GeminiWindowItemSchema]:
        """Classifies all target segments inside UnitOfWork."""
        results: List[GeminiWindowItemSchema] = []
        for seg in uow.target_segments:
            results.append(self.classify_single_segment(seg, uow))
        return results
