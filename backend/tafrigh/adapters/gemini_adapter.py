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
from .errors import ModelAPIError, redact_secrets

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
5. TYPO CORRECTIONS: If ASR errors exist, set "hasTypo": true and give "edits" addressed by the [word_idx] markers:
   [{"wordStart": i, "wordEnd": j, "original": "<the exact words i..j as written>", "replacement": "<corrected words>", "reason": "..."}].
   "original" must repeat the words exactly; edits whose "original" does not match are discarded. Never use character offsets.
   Do not correct words inside Quran/hadith quotations listed in detection_signals (they are displayed from the corpus).
"""


GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OPENROUTER_GEMINI_MODEL = "google/gemini-3.1-flash-lite"
# Without max_tokens OpenRouter reserves the model's whole output limit up front (64k for Claude Sonnet ≈ $1) and
# answers 402 on a small balance. A window of 20 decisions with edits fits well inside this; a reply cut short
# (thinking models) is retried once with OPENROUTER_MAX_TOKENS_RETRY.
OPENROUTER_MAX_TOKENS = 4096
OPENROUTER_MAX_TOKENS_RETRY = 12000


def normalize_openrouter_model(model: Optional[str]) -> str:
    """OpenRouter IDs are "provider/model"; a bare Gemini name (as used by Google's direct API) 404s there."""
    m = (model or "").strip() or DEFAULT_OPENROUTER_GEMINI_MODEL
    return f"google/{m}" if m.lower().startswith("gemini-") else m
# Preference order when no model is chosen (or the chosen one does not exist for this key): first hit wins.
PREFERRED_MODEL_HINTS = ["flash-lite-latest", "3.1-flash-lite", "2.5-flash-lite", "flash-lite", "flash-latest", "flash"]


class GeminiAPIError(ModelAPIError):
    """A Gemini call failed (see ModelAPIError)."""


def pick_model(available: List[str], wanted: Optional[str] = None) -> Optional[str]:
    """Choose a generateContent model from the ListModels names (without the 'models/' prefix)."""
    names = [n.split("/", 1)[-1] for n in available]
    if wanted and wanted not in ("auto", "") and wanted in names:
        return wanted
    for hint in PREFERRED_MODEL_HINTS:
        hits = sorted((n for n in names if hint in n and "preview" not in n and "tts" not in n and "image" not in n), reverse=True)
        if hits:
            return hits[0]
    return None


def list_gemini_models(api_key: str, client: Optional[httpx.Client] = None) -> List[str]:
    """Names of the models this key can call with generateContent."""
    own = client is None
    client = client or httpx.Client(timeout=20.0)
    try:
        out: List[str] = []
        token = ""
        for _ in range(5):
            params = {"pageSize": 200, **({"pageToken": token} if token else {})}
            resp = client.get(f"{GEMINI_BASE_URL}/models", params=params, headers={"x-goog-api-key": api_key})
            if resp.status_code != 200:
                raise GeminiAPIError(f"فشل جلب قائمة النماذج (HTTP {resp.status_code}): {resp.text[:200]}", resp.status_code)
            data = resp.json()
            for m in data.get("models", []):
                if "generateContent" in (m.get("supportedGenerationMethods") or []):
                    out.append(str(m.get("name", "")).split("/", 1)[-1])
            token = data.get("nextPageToken", "")
            if not token:
                break
        return out
    except httpx.HTTPError as exc:
        raise GeminiAPIError(f"تعذر الاتصال بخادم Gemini: {exc}", None, True) from exc
    finally:
        if own:
            client.close()


def parse_model_json(raw: str) -> Dict[str, Any]:
    """Models sometimes wrap JSON in ``` fences or add chatter; recover the object or raise ValueError."""
    txt = (raw or "").strip()
    txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", txt, flags=re.I)
    try:
        val = json.loads(txt)
    except json.JSONDecodeError:
        a, b = txt.find("{"), txt.rfind("}")
        if a < 0 or b <= a:
            raise ValueError(f"رد النموذج ليس JSON صالحاً: {txt[:120]}")
        val = json.loads(txt[a : b + 1])
    if isinstance(val, list):
        val = {"decisions": val}
    if not isinstance(val, dict):
        raise ValueError("رد النموذج ليس كائن JSON")
    return val


def normalize_split_points(points: Any, num_tokens: int) -> List[int]:
    """Models often list 0 (the implicit start) or repeat an index. Drop those; text is never touched."""
    clean = {p for p in (points or []) if isinstance(p, int) and not isinstance(p, bool) and 0 < p < num_tokens}
    return sorted(clean)

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
        model_name: str = "auto",
        typo_strategy: Literal["gated", "always_correct", "asr_confidence_gated"] = "gated",
        mock_response_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
        enable_cache: bool = True,
        transport: Optional[httpx.BaseTransport] = None,
        max_retries: int = 3,
        sleep_fn: Callable[[float], None] = time.sleep,
        openrouter_api_key: Optional[str] = None,
        openrouter_model: Optional[str] = None,
    ) -> None:
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        # When set, every call goes through OpenRouter's chat API instead of Google's (free-tier) endpoint:
        # no free-plan rate limits / 429 back-off, billed on the OpenRouter account that JEV already uses.
        self.openrouter_api_key = (openrouter_api_key or "").strip()
        self.openrouter_model = normalize_openrouter_model(openrouter_model)
        self.total_cost_usd = 0.0
        self.model_name = model_name
        self.typo_strategy = typo_strategy
        self.mock_response_fn = mock_response_fn
        self.enable_cache = enable_cache
        self.transport = transport
        self.max_retries = max_retries
        self._sleep = sleep_fn
        self._model_resolved = False
        self.request_count: int = 0
        self.cached_tokens_total: int = 0
        self.input_tokens_total: int = 0
        self.output_tokens_total: int = 0

    @property
    def is_live(self) -> bool:
        return bool(self.api_key or self.openrouter_api_key)

    @property
    def provider_label(self) -> str:
        return f"openrouter:{self.openrouter_model}" if self.openrouter_api_key else f"gemini:{self.model_name}"

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

        if not self.is_live:
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

        return self._post_openrouter(prompt) if self.openrouter_api_key else self._post_generate(prompt)

    def _post_openrouter(self, prompt: str) -> Dict[str, Any]:
        body = {
            "model": self.openrouter_model,
            "temperature": 0.1,
            "max_tokens": OPENROUTER_MAX_TOKENS,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": STATIC_SYSTEM_PREFIX},
                {"role": "user", "content": prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://wahy-transcriber.local",
            "X-Title": "Wahy Transcriber Tafrigh",
        }
        last_exc: Optional[GeminiAPIError] = None
        for attempt in range(self.max_retries + 1):
            try:
                with self._client() as client:
                    resp = client.post(OPENROUTER_CHAT_URL, json=body, headers=headers)
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise GeminiAPIError(f"OpenRouter HTTP {resp.status_code}: {resp.text[:200]}", resp.status_code, True)
                if (resp.status_code in (400, 404) and "response_format" in body
                        and re.search(r"response_format|json|parameter", resp.text, re.I)):
                    body.pop("response_format")   # a model without JSON mode: ask again without it (the prompt still asks for JSON)
                    raise GeminiAPIError(f"OpenRouter HTTP {resp.status_code}: JSON mode unsupported, retrying without it", resp.status_code, True)
                if resp.status_code != 200:
                    raise GeminiAPIError(f"OpenRouter HTTP {resp.status_code} ({self.openrouter_model}): {resp.text[:300]}", resp.status_code)
                data = resp.json()
                if data.get("error"):
                    raise GeminiAPIError(f"OpenRouter provider error ({self.openrouter_model}): {str(data['error'])[:300]}", None, True)
                choice = (data.get("choices") or [{}])[0]
                raw_text = (choice.get("message") or {}).get("content") or ""
                cut_short = choice.get("finish_reason") == "length"
                try:
                    if not raw_text.strip():
                        raise ValueError(f"رد فارغ من النموذج عبر OpenRouter (finish_reason={choice.get('finish_reason')})")
                    parsed = parse_model_json(raw_text)
                except ValueError as exc:
                    if cut_short and body["max_tokens"] < OPENROUTER_MAX_TOKENS_RETRY:
                        body["max_tokens"] = OPENROUTER_MAX_TOKENS_RETRY
                    raise GeminiAPIError(str(exc), None, True) from exc
                usage = data.get("usage") or {}
                self.request_count += 1
                self.total_cost_usd += float(usage.get("cost") or 0.0)
                return {
                    "parsed": parsed,
                    "usage": {
                        "input_tokens": usage.get("prompt_tokens", 0),
                        "output_tokens": usage.get("completion_tokens", 0),
                        "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0),
                    },
                }
            except httpx.HTTPError as exc:
                last_exc = GeminiAPIError(f"تعذر الاتصال بـ OpenRouter: {exc}", None, True)
            except GeminiAPIError as exc:
                last_exc = exc
                if not exc.retryable:
                    raise
            if attempt < self.max_retries:
                self._sleep(min(30.0, 1.5 * (2 ** attempt)))
        raise last_exc or GeminiAPIError("فشل غير معروف في استدعاء OpenRouter")

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=90.0, transport=self.transport)

    def resolve_model(self, client: Optional[httpx.Client] = None) -> str:
        """Make sure self.model_name exists for this key; fall back to the best available Flash-Lite."""
        own = client is None
        client = client or self._client()
        try:
            available = list_gemini_models(self.api_key, client)
        finally:
            if own:
                client.close()
        chosen = pick_model(available, self.model_name)
        if not chosen:
            raise GeminiAPIError("لا يوجد أي نموذج Gemini متاح لهذا المفتاح يدعم generateContent.", 404)
        self.model_name = chosen
        self._model_resolved = True
        return chosen

    def _post_generate(self, prompt: str) -> Dict[str, Any]:
        if self.model_name in ("auto", "") and not self._model_resolved:
            self.resolve_model()
        payload = {
            "systemInstruction": {"parts": [{"text": STATIC_SYSTEM_PREFIX}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
        }
        last_exc: Optional[GeminiAPIError] = None
        for attempt in range(self.max_retries + 1):
            try:
                with self._client() as client:
                    resp = client.post(
                        f"{GEMINI_BASE_URL}/models/{self.model_name}:generateContent",
                        json=payload,
                        headers={"x-goog-api-key": self.api_key},
                    )
                    if resp.status_code == 404 and not self._model_resolved:
                        # configured name is unknown to this key: discover a real one once, then retry immediately
                        self._model_resolved = True
                        self.resolve_model(client)
                        continue
                    if resp.status_code in (429, 500, 502, 503, 504):
                        raise GeminiAPIError(f"Gemini HTTP {resp.status_code}: {resp.text[:200]}", resp.status_code, True)
                    if resp.status_code != 200:
                        raise GeminiAPIError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}", resp.status_code)
                    data = resp.json()
                cand = (data.get("candidates") or [{}])[0]
                parts = (cand.get("content") or {}).get("parts") or [{}]
                raw_text = "".join(p.get("text", "") for p in parts)
                if not raw_text.strip():
                    raise GeminiAPIError(f"رد فارغ من النموذج (finishReason={cand.get('finishReason')})", None, True)
                try:
                    parsed = parse_model_json(raw_text)
                except ValueError as exc:
                    raise GeminiAPIError(str(exc), None, True) from exc
                usage = data.get("usageMetadata", {})
                self.request_count += 1
                return {
                    "parsed": parsed,
                    "usage": {
                        "input_tokens": usage.get("promptTokenCount", 0),
                        "output_tokens": usage.get("candidatesTokenCount", 0),
                        "cached_tokens": usage.get("cachedContentTokenCount", 0),
                    },
                }
            except httpx.HTTPError as exc:
                last_exc = GeminiAPIError(f"تعذر الاتصال بخادم Gemini: {exc}", None, True)
            except GeminiAPIError as exc:
                last_exc = exc
                if not exc.retryable:
                    raise
            if attempt < self.max_retries:
                self._sleep(min(30.0, 1.5 * (2 ** attempt)))
        raise last_exc or GeminiAPIError("فشل غير معروف في استدعاء Gemini")

    def classify_uow(self, uow: UnitOfWork) -> List[GeminiWindowItemSchema]:
        """Classifies target segments inside a UnitOfWork."""
        if not self.is_live and not self.mock_response_fn:
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
            item = GeminiWindowItemSchema.model_validate(d)
            item.trace = ({"provider": "openrouter", "model": self.openrouter_model, "raw": d} if self.openrouter_api_key
                          else {"provider": "gemini", "model": self.model_name, "raw": d})
            items.append(item)

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
        if not self.is_live and not self.mock_response_fn:
            pts = []
            for t in segment.tokens:
                if t.word_index > 0 and t.text in ("وسنذكر", "الأول", "الثاني", "ثم", "فائدة:", "مسألة:"):
                    pts.append(t.word_index)
            return sorted(set(pts)) if pts else [len(segment.tokens) // 2] if len(segment.tokens) >= 6 else []

        annotated = annotate_segment_with_word_indices(segment)
        prompt = (
            f"Segment text with word indices:\n{annotated}\n\n"
            "This segment contains mixed structural roles and must be split into subsegments, one per role.\n"
            "Return a JSON object: {\"splitPoints\": [i1, i2, ...]} where each index is the 0-based index of the FIRST word of a NEW "
            "subsegment. Never include 0 (the first subsegment starts there implicitly). Split only where the role changes.\n"
            "Example: [0] فهذا [1] هو [2] الأصل [3] الأول [4] وسنذكر [5] الآن [6] شروط [7] الصلاة [8] وهي [9] تسعة [10] الأول [11] الإسلام\n"
            "-> {\"splitPoints\": [4, 10]}  (end of a paragraph | list intro | first list item)"
        )
        res = self._call_model(prompt)
        parsed = res.get("parsed", res)
        return normalize_split_points(parsed.get("splitPoints", []), len(segment.tokens))

    def get_typo_edits(self, segment: TranscriptSegment, context: Optional[UnitOfWork] = None) -> List[Dict[str, Any]]:
        """Dedicated correction request. Returns raw word-indexed edits; edit_resolver verifies and maps them."""
        if not self.is_live and not self.mock_response_fn:
            return []

        prompt = (
            f"Segment with word indices:\n{annotate_segment_with_word_indices(segment)}\n\n"
            "Find likely ASR transcription errors (a similar-sounding wrong word, misspelling, wrong word boundary, "
            "wrong religious term). Return only real errors, as JSON:\n"
            '{"edits": [{"wordStart": i, "wordEnd": j, "original": "exact words i..j", "replacement": "corrected words", '
            '"reason": "..."}]}\n'
            "Address words only by the [index] markers and repeat the original words exactly. Return {\"edits\": []} if none."
        )
        res = self._call_model(prompt)
        parsed = res.get("parsed", res)
        return [e for e in parsed.get("edits", []) if isinstance(e, dict)]
