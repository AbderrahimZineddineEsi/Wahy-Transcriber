"""Prompt tuning for the prompt-driven verifiers (Gemini, JEV, OpenRouter chat; F-086), copied from the
old app's `js/ai-verifier.js` (PROMPT_PRESETS, PROMPT_RULES, composeQuestions, composeRequestEnvelope).
The envelope the engine builds is never changed: the guidance is added to a copy of its questions at
request time, so Laya's training rows stay stable. Laya gets none of this: it reads the envelope it was
trained on.

    questions = compose_questions(envelope["questions"], config)   # preset + rules + extra instructions
    state, questions = with_merge(envelope, questions, config)      # + the neighbours and the merge question

New here (N-020, review notes 5 and 29): two optional rules, `cue_before_garbled` and `explaining_with_text`.
"""

from __future__ import annotations

import copy
from typing import Any

PRESETS: dict[str, dict[str, Any]] = {
    "balanced": {
        "label": "⚖️ متوازن",
        "hint": "الإعداد الافتراضي: يقبل الاقتباس الحرفي والاستشهاد الواضح، ويستبعد الكلام العادي.",  # noqa: E501
        "verdict_addendum": "",
        "criteria": {},
        "boundary_addendum": "",
    },
    "strict": {
        "label": "🎯 صارم",
        "hint": "لا يقبل إلا التلاوة أو الرواية الحرفية الصريحة. مناسب حين تكثر الإيجابيات الكاذبة.",  # noqa: E501
        "verdict_addendum": "Be strict: only accept verbatim (or near-verbatim, allowing ASR noise) recitation of the corpus text that the speaker clearly presents as a quotation.",  # noqa: E501
        "criteria": {
            "CORRECT": "The speaker recites the corpus text verbatim (allowing only ASR spelling noise) and clearly presents it as a quotation.",  # noqa: E501
            "NOT_SURE": "Use only when the audio transcript is too garbled to decide; paraphrases and allusions are FALSE in strict mode.",  # noqa: E501
        },
        "boundary_addendum": "",
    },
    "lenient": {
        "label": "🤲 متساهل",
        "hint": "يقبل الاقتباس بالمعنى والإشارة الواضحة للنص. مناسب حين يفوتك اقتباسات حقيقية.",  # noqa: E501
        "verdict_addendum": "Be lenient: a clear paraphrase or partial quotation that unmistakably points to this specific text counts as a citation.",  # noqa: E501
        "criteria": {
            "CORRECT": "The speaker quotes this text verbatim, partially, or as a clear paraphrase that unmistakably refers to this specific Ayah, Hadith, or Dhikr.",  # noqa: E501
            "NOT_SURE": "Only when it is genuinely unclear whether the speaker is referring to this specific text at all.",  # noqa: E501
        },
        "boundary_addendum": "",
    },
    "boundaries": {
        "label": "✂️ تركيز على الحدود",
        "hint": "متوازن في الحكم، لكن يدقق بشدة في الكلمات المقطوعة من بداية المقتبس ونهايته.",  # noqa: E501
        "verdict_addendum": "",
        "criteria": {},
        "boundary_addendum": "Pay special attention to boundaries: scan `immediate_transcript_before` and `immediate_transcript_after` word by word for any words of `unmatched_corpus_prefix_words` / `unmatched_corpus_suffix_words`, tolerating ASR spelling errors and missing diacritics.",  # noqa: E501
    },
}

# The rules, in the order their texts are added. Rules with an empty text change the request instead of the
# prompt
# (passages: group the findings; no_thinking: a request setting; suggest_merges: the merge question).
RULES: dict[str, dict[str, Any]] = {
    "ignore_asr_errors": {
        "label": "تجاهل أخطاء التفريغ الصوتي",
        "hint": "الفروق الإملائية والتشكيل الناتجة عن التعرف على الكلام لا تُعد اختلافاً.",  # noqa: E501
        "text": "The transcript comes from speech recognition: treat spelling differences, missing diacritics, merged or split words as matches, not as differences.",  # noqa: E501
        "default": True,
    },
    "citation_cues": {
        "label": "صيغ الإسناد دليل قوي",
        "hint": "«قال تعالى»، «قال رسول الله ﷺ»، «في الحديث» قبل النص ترجّح أنه اقتباس.",  # noqa: E501
        "text": "Introductory cues in `context_before` such as «قال تعالى», «قال الله», «قال رسول الله ﷺ», «في الحديث», «يقول النبي» are strong evidence of a genuine quotation.",  # noqa: E501
        "default": True,
    },
    "narrator_names": {
        "label": "أسماء الرواة وحدها ليست اقتباساً",
        "hint": "ذكر «عن أبي هريرة» أو اسم صحابي دون متن الحديث يُعد كلاماً عادياً.",  # noqa: E501
        "text": "A span consisting only of narrator chains or names (e.g. «عن أبي هريرة رضي الله عنه») without the actual text of the hadith is FALSE.",  # noqa: E501
        "default": False,
    },
    "explaining_repeat": {
        "label": "تكرار كلمة أثناء الشرح كلام عادي",
        "hint": "إذا أعاد الشيخ كلمة أو كلمتين من الآية ليشرحها فليس ذلك اقتباساً جديداً.",  # noqa: E501
        "text": "When the speaker repeats one or two words of the text in order to explain them (e.g. «قوله: الرحمن، أي...»), treat it as ordinary explanation (FALSE) unless a fuller recitation is present.",  # noqa: E501
        "default": False,
    },
    # N-020, review note 5
    "cue_before_garbled": {
        "label": "صيغة استشهاد تليها كلمات مشوّهة: الاقتباس بدأ قبل المقطع",
        "hint": "إذا جاءت «قال جل وعلا» ثم كلمات أفسدها التفريغ قبل المقطع، فالاقتباس بدأ قبله (ينقصه البداية)، وكذلك في النهاية.",  # noqa: E501
        "text": "A citation cue (such as «قال تعالى», «قال جل وعلا», «قال ﷺ») followed by garbled or unrecognisable words right before the span means the quotation most likely started earlier, at the cue: report a missing start even though those words cannot be read. Likewise, garbled words right after the span that still echo the rest of the text (a few recognisable words of it) mean the end is missing.",  # noqa: E501
        "default": False,
    },
    # N-020, review note 29
    "explaining_with_text": {
        "label": "الشرح بألفاظ النص ليس اقتباساً",
        "hint": "إذا شرح الشيخ بألفاظ الحديث أو الآية نفسها (بعد «يعني»، «أي»، «معناه») فليس ذلك اقتباساً.",  # noqa: E501
        "text": "A speaker explaining in the text's own words is not quoting it, even when the words match: when the span follows an explanation marker such as «يعني», «أي», «معناه», «المراد», or re-uses the text right after quoting it in order to explain it, answer FALSE unless he clearly recites it again as a quotation.",  # noqa: E501
        "default": False,
    },
    "prefer_not_sure": {
        "label": "عند الشك: «غير متأكد»",
        "hint": "يفضل النموذج «غير متأكد» بدل التخمين، فتراجعه أنت يدوياً.",
        "text": "If the evidence is genuinely mixed, answer NOT_SURE rather than guessing.",
        "default": False,
    },
    "passages": {
        "label": "تجميع الآيات المتتالية في مقطع واحد",
        "hint": "الآيات المتتالية من سورة واحدة التي وجدها المحرك متجاورة تُرسل في طلب واحد ويُحكم عليها معاً (كما في Laya). أقل طلبات وحكم أدق على التلاوة الطويلة. Laya يتبع إعداد نموذجه.",  # noqa: E501
        "text": "",
        "default": True,
    },
    "no_thinking": {
        "label": "تعطيل تفكير النموذج (OpenRouter)",
        "hint": "النماذج التي تفكر قبل الإجابة (مثل DeepSeek) تُحسب كلمات تفكيرها كإخراج مدفوع. التعطيل أرخص وأسرع.",  # noqa: E501
        "text": "",
        "default": False,
    },
    "suggest_merges": {
        "label": "اقتراح دمج المقتبسات المجزأة",
        "hint": "يرسل المقتبس المجاور (حتى 12 كلمة) ليقترح النموذج دمج حديث قسّمه المحرك بسبب خطأ تفريغ أو تعليق.",  # noqa: E501
        "text": "",
        "default": True,
    },
}


def compose_questions(questions: dict[str, Any], config: Any) -> dict[str, Any]:
    """The envelope's questions with the preset, the chosen rules and the user's own instructions added
    (js/ai-verifier.js composeQuestions). `config` is a PromptConfig."""
    preset = PRESETS.get(config.preset, PRESETS["balanced"])
    q = copy.deepcopy(questions)
    guidance = []
    if preset["verdict_addendum"]:
        guidance.append(preset["verdict_addendum"])
    rules = config.rules.model_dump()
    guidance += [r["text"] for name, r in RULES.items() if rules.get(name) and r["text"]]
    extra = (config.extra_instructions or "").strip()
    if extra:
        guidance.append(extra)
    verdict = q.get("verdict")
    if isinstance(verdict, dict):
        if guidance:
            verdict["instructions"] = (
                str(verdict.get("instructions", ""))
                + "\n\nAdditional guidance:\n"
                + "\n".join(f"- {g}" for g in guidance)
            )
        verdict.setdefault("criteria", {}).update(preset["criteria"])
    boundary = q.get("boundary_status")
    if preset["boundary_addendum"] and isinstance(boundary, dict):
        boundary["instructions"] = (
            str(boundary.get("instructions", "")) + "\n\n" + preset["boundary_addendum"]
        )
    return q


def with_merge(
    envelope: dict[str, Any], questions: dict[str, Any], config: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The state and questions actually sent: the envelope's, plus its neighbours and the merge question when
    the envelope has one and merge suggestions are on (composeRequestEnvelope; F-092)."""
    merge = envelope.get("merge")
    if not merge or not config.rules.suggest_merges:
        return envelope["state"], questions
    return (
        {**envelope["state"], "neighbor_findings": merge["neighbors"]},
        {**questions, **merge["questions"]},
    )
