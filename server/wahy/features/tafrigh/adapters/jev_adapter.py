"""
JEV Adapter for AI Tafrigh Phase.
Implements the ChoiceClassifierAdapter interface.
Supports both independent_questions and split_as_tag_option layouts,
with parallel and sequential execution orders.
"""

from __future__ import annotations

import concurrent.futures
import time
from collections.abc import Callable
from typing import Any

from wahy.core.ai.layer import AiLayer
from wahy.core.ai.openrouter import DEFAULT_JEV_MODEL
from wahy.core.ai.types import AiError, Call

from ..models import StructuralTag, TranscriptSegment
from ..schemas import GeminiWindowItemSchema, JEVRequestConfig
from ..unit_of_work import UnitOfWork
from .base import ChoiceClassifierAdapter

# JEV sometimes answers a choice that is not among the options; ask again this many times before giving up
INVALID_ANSWER_ATTEMPTS = 3


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
    """Adapter for JEV (OpenRouter's Decisions API): it answers choice questions with calibrated probabilities.
    The request goes through `core/ai` (`ai.jev.decide`), which owns the key, retries, cost and request log."""

    def __init__(
        self,
        ai: AiLayer | None = None,
        call: Call | None = None,
        config: JEVRequestConfig | None = None,
        mock_response_fn: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
        model: str = DEFAULT_JEV_MODEL,
    ) -> None:
        self.ai, self.call = ai, call or Call(purpose="tafrigh")
        self.config = config or JEVRequestConfig()
        self.mock_response_fn = mock_response_fn
        self.model = model or DEFAULT_JEV_MODEL
        self.request_count = 0
        self.total_cost_usd = 0.0
        self.total_input_tokens = 0
        self.total_output_tokens = 0

    @property
    def is_live(self) -> bool:
        return self.ai is not None and self.ai.ready()["jev"]

    @staticmethod
    def question_payload(questions: dict[str, list[str]]) -> dict[str, Any]:
        """The questions in the envelope shape JEV and Laya read: instructions plus one description per option."""
        return {
            key: {
                "type": "choice",
                "instructions": QUESTION_INSTRUCTIONS.get(key, key),
                "criteria": {opt: describe_option(opt) for opt in options},
            }
            for key, options in questions.items()
            if options
        }

    @staticmethod
    def read_answers(raw_answers: dict[str, Any], questions: dict[str, list[str]]) -> dict[str, Any]:
        """{question: {choice, probabilities, confidence}} -> answers / confidences / probabilities. A choice
        outside the options is an error (the caller asks again)."""
        answers: dict[str, str] = {}
        confidences: dict[str, float] = {}
        probabilities: dict[str, dict[str, float]] = {}
        for key, options in questions.items():
            a_obj = raw_answers.get(key) or {}
            choice = a_obj.get("choice")
            if choice not in options:
                raise AiError(f"the model returned an invalid answer for the question {key}: {choice!r}")
            answers[key] = choice
            # JEV's "confidence" is the margin between the top two options; the probability of the
            # chosen option is in "probabilities"
            probs = {str(k): float(v) for k, v in (a_obj.get("probabilities") or {}).items() if isinstance(v, (int, float))}
            probabilities[key] = probs
            if choice in probs:
                confidences[key] = probs[choice]
            elif isinstance(a_obj.get("confidence"), (int, float)):
                confidences[key] = float(a_obj["confidence"])
        return {"answers": answers, "confidences": confidences, "probabilities": probabilities}

    def ask(self, state: dict[str, Any], payload: dict[str, Any]) -> tuple[dict[str, Any], float, int, int]:
        """One model request: (the raw answers, cost, input tokens, output tokens). Laya overrides this."""
        assert self.ai is not None
        data, _rid = self.ai.jev.decide(state, payload, call=self.call, model=self.model)
        usage = data.get("usage") or {}
        return (data.get("answers") or {}, float(usage.get("cost") or 0.0),
                int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0))

    def predict_questions(
        self,
        state: dict[str, Any],
        questions: dict[str, list[str]],
    ) -> dict[str, Any]:
        """Ask the given choice questions ({question_key: [option labels]}); returns {"answers": {key: label}, ...}."""
        if self.mock_response_fn:
            return self.mock_response_fn({"state": state, "questions": questions})
        if self.ai is None:
            raise AiError("no AI layer is configured for Tafrigh", fatal=True)

        payload = self.question_payload(questions)
        last: AiError | None = None
        for _ in range(INVALID_ANSWER_ATTEMPTS):
            t0 = time.perf_counter()
            raw, cost, tin, tout = self.ask(state, payload)
            # billed even if an answer below is invalid and the request is repeated
            self.request_count += 1
            self.total_cost_usd += cost
            self.total_input_tokens += tin
            self.total_output_tokens += tout
            try:
                out = self.read_answers(raw, questions)
            except AiError as exc:
                last = exc
                continue
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            out["cost"] = cost
            return out
        raise last or AiError("no usable answer from the model")

    def _format_tag_choice(self, choice: dict[str, Any]) -> str:
        tag = choice.get("tag", "paragraph")
        level = choice.get("level")
        parent_id = choice.get("parent_id")
        if tag == "heading" and level:
            return f"heading_{level}_{parent_id or 'none'}"
        return tag

    def _parse_tag_choice(self, chosen: str) -> dict[str, Any]:
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

        trace: dict[str, Any] = {"provider": "jev", "model": self.model, "layout": self.config.jev_layout, "answers": {}}

        def keep(res: dict[str, Any]) -> dict[str, Any]:
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

            if self.config.execution_order == "combined":
                answers = keep(self.predict_questions(state, {"tag": tag_choices, "hasTypo": ["true", "false"],
                                                              "needsSplitting": ["true", "false"]})).get("answers", {})
                parsed_tag = self._parse_tag_choice(answers.get("tag", "paragraph"))
                if answers.get("needsSplitting") == "true":
                    trace["tag_used_only_if_not_split"] = True
                return GeminiWindowItemSchema(
                    id=segment.id, tag=parsed_tag["tag"], level=parsed_tag["level"], parent=parsed_tag["parent"],
                    hasTypo=answers.get("hasTypo") == "true", needsSplitting=answers.get("needsSplitting") == "true",
                    confidence=trace["answers"].get("tag", {}).get("confidence"), trace=trace,
                )

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

    def classify_uow(self, uow: UnitOfWork) -> list[GeminiWindowItemSchema]:
        """Classifies all target segments inside UnitOfWork."""
        results: list[GeminiWindowItemSchema] = []
        for seg in uow.target_segments:
            results.append(self.classify_single_segment(seg, uow))
        return results
