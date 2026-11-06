"""The default texts sent to prompt-driven verifiers (Gemini, OpenRouter chat), copied from the old app's
`js/ai-verifier.js` (VERIFIER_SYSTEM_PROMPT, CHAT_OUTPUT_CONTRACT, buildGeminiRequestBody). A verification
pass can replace the system prompt (F-086); the questions and criteria travel inside each item's envelope.
Laya and JEV get no prompt: they read the envelope as it is.
"""

from __future__ import annotations

VERIFIER_SYSTEM_PROMPT = "\n".join(
    [
        "You verify quotations that an automatic detector found in transcripts of Arabic Islamic lectures. The transcripts come from speech recognition: expect misspellings, merged or split words, missing diacritics and wrong hamzas.",  # noqa: E501
        "The detector matched `matched_span_in_lecture` against `canonical_corpus_text` (a Quran ayah, a hadith or a dhikr, see `source_type`). It favours recall, so many of its findings are ordinary speech. Answer the questions in `questions` with their criteria keys exactly.",  # noqa: E501
        "Verdict:",
        "- CORRECT: the speaker actually recites or quotes this text. The span reproduces a run of the corpus words in order (allowing speech-recognition noise), even when only part of a long ayah or hadith is quoted, and even without an introduction such as «قال تعالى» or «قال ﷺ». A recitation in the middle of an explanation is still a quotation, and so is a full formula recited as such (e.g. the opening خطبة الحاجة for a dhikr).",  # noqa: E501
        "- FALSE: the shared words are the speaker's own language: a common phrase inside a normal sentence (إن شاء الله، الحمد لله، صلى الله عليه وسلم، رضي الله عنه), a narrator chain or names alone, a few generic words that also occur in the text, or the speaker retelling the meaning in his own words.",  # noqa: E501
        "- NOT_SURE: the transcript really does not allow a decision (heavily garbled words, a very short span that fits both readings), or the speaker clearly quotes something but it is a different text than `canonical_corpus_text` (say so in the reason).",  # noqa: E501
        "Compare word by word, not by topic: a span about the same subject as the corpus text is not a quote unless the words follow it. Use `context_before` / `context_after` for citation cues and to see whether the recitation continues. `engine_confidence_band` and `engine_score` are the detector's own guess: weigh them, do not copy them.",  # noqa: E501
        "Boundaries: compare what was said right before / after the span (`immediate_transcript_before` / `immediate_transcript_after`) with the corpus words just before / after the matched part (`unmatched_corpus_prefix_words` / `unmatched_corpus_suffix_words`). Report a missing start or end only when the speaker really said those corpus words there; when he stopped quoting and went back to his explanation, the span is complete.",  # noqa: E501
        "Passages: when `verses_in_passage` is present, the span is that many consecutive ayat found back to back. Judge them together as one recitation; a missing start concerns the first ayah, a missing end the last.",  # noqa: E501
        "Probabilities sum to 1, and `confidence` is the probability of the verdict you chose.",
    ]
)

CHAT_OUTPUT_CONTRACT = (
    'Return ONLY a valid JSON object with keys: {"verdict": "CORRECT" | "FALSE" | "NOT_SURE", '
    '"confidence": 0.0-1.0, "probabilities": {"CORRECT": p1, "FALSE": p2, "NOT_SURE": p3}, '
    '"boundary_status": "COMPLETE_SPAN" | "MISSING_START" | "MISSING_END" | "MISSING_BOTH", '
    '"boundary_confidence": 0.0-1.0, "reason": "concise explanation"}. '
    'If `questions` contains `merge_suggestion`, also include "merge_suggestion" (one of its criteria keys), '
    '"merge_confidence": 0.0-1.0 and "merge_gap_type": "PART_OF_QUOTE" | "COMMENTARY".'
)

GEMINI_BATCH_INSTRUCTION = (
    "Given the following candidate citations extracted by the transcription engine, "
    "evaluate each item against the instructions and criteria in `questions`. "
    "Return ONLY a JSON array of evaluations corresponding to the input items. "
    "Answer `merge_suggestion` / `merge_gap_type` only for items whose `questions` contain them "
    "(otherwise use NO_MERGE).\n\n"
)

GEMINI_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "finding_id": {"type": "STRING"},
            "verdict": {"type": "STRING", "enum": ["CORRECT", "FALSE", "NOT_SURE"]},
            "confidence": {"type": "NUMBER"},
            "probabilities": {
                "type": "OBJECT",
                "properties": {
                    "CORRECT": {"type": "NUMBER"},
                    "FALSE": {"type": "NUMBER"},
                    "NOT_SURE": {"type": "NUMBER"},
                },
                "required": ["CORRECT", "FALSE", "NOT_SURE"],
            },
            "boundary_status": {
                "type": "STRING",
                "enum": ["COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"],
            },
            "boundary_confidence": {"type": "NUMBER"},
            "merge_suggestion": {
                "type": "STRING",
                "enum": ["NO_MERGE", "MERGE_WITH_PREVIOUS", "MERGE_WITH_NEXT", "MERGE_BOTH"],
            },
            "merge_confidence": {"type": "NUMBER"},
            "merge_gap_type": {"type": "STRING", "enum": ["PART_OF_QUOTE", "COMMENTARY"]},
            "reason": {"type": "STRING"},
        },
        "required": ["finding_id", "verdict", "confidence", "probabilities", "boundary_status", "reason"],
    },
}


def system_prompt(
    override: str | None = None, *, reason_lang: str = "ar", reason_detail: str = "brief"
) -> str:
    """The system prompt as the old app composed it: the base text (or the user's own) plus how to write the
    reason."""
    base = (override or "").strip() or VERIFIER_SYSTEM_PROMPT
    lang = "English" if reason_lang == "en" else "Arabic"
    detail = (
        "2-3 sentences citing the specific words that decided it"
        if reason_detail == "detailed"
        else "one short sentence"
    )
    return f"{base}\n\nWrite the `reason` field in {lang}, {detail}."
