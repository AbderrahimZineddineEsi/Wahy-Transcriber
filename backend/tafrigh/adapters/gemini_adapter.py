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

# The rules below were written from real runs: the first version (a bare tag list) labelled 39 of 41 sentences of a
# Bin Baz lecture "paragraph", because nothing told the model that the sentences are pause-cut fragments and that a
# paragraph is a written block of several of them. The tag descriptions follow JEV's tested Arabic option texts.
STATIC_SYSTEM_PREFIX = """
You lay out the transcript of a spoken Arabic Islamic lesson (dars) as a clean written document, sentence by sentence, the way a careful human editor would.
The text comes from speech recognition and was cut into "sentences" automatically at pauses and punctuation, so a sentence often stops in the middle of a thought and the next one carries on.
You never rewrite, summarise, reorder or drop the speaker's words: you only label them (and fix clear speech-recognition errors, see 4).

For every target sentence decide:

1. "tag" — its role in the layout. Use only tags listed in "allowed_tags".
   - "continuation": stays in the SAME paragraph as the sentence right before it. Use it when the speaker carries on with the same point: the previous sentence was cut mid-thought, or this one adds an explanation, a detail, an example, a supporting ayah or hadith, or a conclusion to the same point. In a flowing lesson this is the most common tag.
   - "paragraph": starts a NEW paragraph, because the speaker moves on to a new point, ruling, question or part of the lesson (it often opens with ثم، وأما، واعلم، ومن ذلك، الأمر الثاني، المسألة…). A written paragraph usually holds about 2 to 6 sentences: do not open a new paragraph at every sentence, and do not glue a whole topic change onto the previous paragraph.
   - "heading": the speaker announces a section with a title-like phrase («باب شروط الصلاة»، «فصل في …»، «المسألة الأولى»، «الدرس الثاني»). Give "level": 1 for a main section, 2 for a sub-section inside it, 3 below that. The opening formulas (البسملة، الحمدلة، الصلاة على النبي ﷺ، خطبة الحاجة) are never headings, and a normal sentence that merely moves to a new topic is a "paragraph", not a heading.
   - "list_intro": announces an enumeration («شروط الصلاة تسعة:»، «وهي ثلاثة أمور»).
   - "list_item": one item of such an enumeration («الأول: الإسلام»، «الثاني: …»). Only after a list_intro or another list_item.
   - "comment": speech outside the lesson itself: greetings and small talk with the host or the audience, an attendee's question or interruption, remarks about the microphone or the recording, a sneeze and its reply. Add "commentKind": one of "sneeze", "student_question", "interruption", "attendee_exchange", "other_incidental". The lesson's own content, including the speaker's answer to a question, is not a comment.
   - "matn_section": the speaker reads aloud the original text of the book being explained (only when allowed).

2. "confidence": your probability (0 to 1) that the tag is right. Be honest: a sentence below 0.7 is sent to the human reviewer.

3. "needsSplitting" and "splitPoints": only when ONE sentence holds two roles that need different tags (the end of a paragraph and then a list_intro; a heading phrase followed by explanation). "splitPoints" are the [index] of the first word of each new part, never 0. A long sentence with a single role is not split.

4. "edits": speech-recognition errors only: a word replaced by a similar-sounding wrong word, a broken or merged word, a misheard religious term or name. Address words by their [index] marker:
   {"wordStart": i, "wordEnd": j, "original": "<the exact words i..j>", "replacement": "<corrected words>", "reason": "<short>"}.
   "original" must repeat the words exactly, or the edit is discarded. Never change the dialect, style or grammar the speaker really used, never add or remove meaning, and never touch the word ranges listed in "quotes" (they are displayed from the Quran / hadith source). When unsure, leave "edits": [].

Answer with JSON only:
{"decisions": [{"id": "<target id>", "tag": "<tag>", "level": null, "commentKind": null, "confidence": 0.0, "needsSplitting": false, "splitPoints": [], "edits": []}]}
exactly one decision per target sentence, in the order given, with the ids given.
"""

# Split points and typo fixes for JEV / Laya are separate requests with their own answer shape. They must not get the
# classifier's prompt: it demands {"decisions": [...]}, the model obeyed, and every fix and split point was lost.
HELPER_SYSTEM_PROMPT = (
    "You help edit the speech-recognition transcript of an Arabic Islamic lesson. Follow the request exactly, "
    "never rewrite the speaker's words beyond it, and answer with JSON only, in the shape the request gives."
)

WINDOW_NOTE = (
    "There are several target sentences: they follow each other in the lesson. Decide them in order, as if one by one: "
    "the sentence before each target is the previous target (the first target follows the last sentence of context_before), "
    "so a target can be a continuation of the target before it, or a list_item after a list_intro target."
)

ALL_TAGS = ["continuation", "paragraph", "heading", "list_intro", "list_item", "comment", "matn_section"]
COMMENT_KINDS = {k.value for k in CommentKind}


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


def quote_word_ranges(segment: TranscriptSegment) -> List[Dict[str, Any]]:
    """Detected ayat / hadiths / adhkar inside the sentence as [first, last] word indices (what the edit rule refers to)."""
    base = segment.source_pos.char_start
    out = []
    for d in segment.detection_signals:
        a, b = int(d.get("start", 0)) - base, int(d.get("end", 0)) - base
        idx = [t.word_index for t in segment.tokens if t.char_start < b and a < t.char_end]
        if idx:
            out.append({"type": d.get("type"), "ref": d.get("ref") or "", "words": [idx[0], idx[-1]]})
    return out


def helper_field(parsed: Dict[str, Any], key: str) -> Any:
    """`key` of a helper reply, also when the model wrapped it in a classifier-style {"decisions": [{...}]}."""
    if key in parsed:
        return parsed[key]
    first = (parsed.get("decisions") or [{}])[0] if isinstance(parsed.get("decisions"), list) else {}
    return first.get(key, []) if isinstance(first, dict) else []


def _clean_int(v: Any) -> Optional[int]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        return int(v.strip())
    return None


def sanitize_decision(d: Dict[str, Any]) -> Dict[str, Any]:
    """One model decision -> fields GeminiWindowItemSchema accepts. A model's small slip (an unknown tag, "level": "2",
    a numeric parent, a made-up comment kind) used to fail validation of the whole reply: in windowed mode that threw away
    up to 20 good decisions. Unknown values become None and the pipeline's defaults / repairs take over."""
    tag = str(d.get("tag") or "").strip().lower().replace("-", "_").replace(" ", "_")
    kind = str(d.get("commentKind") or d.get("comment_kind") or "").strip().lower()
    conf = d.get("confidence")
    conf = float(conf) if isinstance(conf, (int, float)) and not isinstance(conf, bool) else None
    points = d.get("splitPoints") if isinstance(d.get("splitPoints"), list) else []
    edits = [e for e in (d.get("edits") or []) if isinstance(e, dict)] if isinstance(d.get("edits"), list) else []
    has_typo = d.get("hasTypo")
    has_typo = (str(has_typo).lower() == "true") if not isinstance(has_typo, bool) else has_typo
    needs_split = d.get("needsSplitting")
    needs_split = (str(needs_split).lower() == "true") if not isinstance(needs_split, bool) else needs_split
    parent = d.get("parent")
    return {
        "id": str(d.get("id") or ""),
        "tag": tag if tag in ALL_TAGS else None,
        "level": _clean_int(d.get("level")),
        "parent": str(parent) if parent not in (None, "", "null", "none") else None,
        "commentKind": kind if kind in COMMENT_KINDS else ("other_incidental" if tag == "comment" else None),
        # an edit list is the answer to "is there a typo?": gated typo handling must not drop it
        "hasTypo": bool(has_typo) or bool(edits),
        "needsSplitting": bool(needs_split),
        "splitPoints": [p for p in (_clean_int(x) for x in points) if p is not None],
        "edits": edits,
        "confidence": max(0.0, min(1.0, conf)) if conf is not None else None,
    }


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
        disable_thinking: bool = False,
    ) -> None:
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        # OpenRouter models that reason before answering bill those tokens as output
        self.disable_thinking = disable_thinking
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
        """What the model reads for one request. Each target's text appears once, with [i] word markers (the text
        used to be sent twice, plain and annotated, plus the raw detection dicts with their full corpus text)."""
        targets = []
        for s in uow.target_segments:
            t: Dict[str, Any] = {"id": s.id, "text": annotate_segment_with_word_indices(s)}
            quotes = quote_word_ranges(s)
            if quotes:
                t["quotes"] = quotes
            ev = s.matn_evidence
            if ev and ev.canonical_text and ev.coverage_ratio > 0:
                t["matches_matn"] = {"matn_text": ev.canonical_text[:300], "coverage": round(ev.coverage_ratio, 2)}
            targets.append(t)

        allowed = [t for t in dict.fromkeys(str(c.get("tag")) for c in uow.allowed_choices) if t in ALL_TAGS]
        levels = sorted({int(c["level"]) for c in uow.allowed_choices if c.get("tag") == "heading" and c.get("level")})
        if len(targets) > 1:
            # inside a window a continuation / list item / deeper heading can become valid after an earlier target
            allowed = [t for t in ALL_TAGS if t in allowed or t in ("continuation", "list_item")]
            levels = [1, 2, 3]
        payload: Dict[str, Any] = {
            "allowed_tags": allowed,
            "allowed_heading_levels": levels or [1],
            "previous_sentence_tag": uow.previous_tag,
            "headings_so_far": [{"level": h.get("level"), "title": str(h.get("title_text") or "")[:80]} for h in uow.partial_toc],
            "context_before": [s.original_text.strip() for s in uow.context_before],
            "targets": targets,
            "context_after": [s.original_text.strip() for s in uow.context_after],
        }
        if uow.in_list:
            payload["inside_a_list"] = True
        return payload

    def build_classify_prompt(self, uow: UnitOfWork) -> str:
        payload = json.dumps(self.build_dynamic_payload(uow), ensure_ascii=False)
        note = f"{WINDOW_NOTE}\n\n" if len(uow.target_segments) > 1 else ""
        return f"{note}{payload}"

    def _call_model(self, prompt: str, max_tokens: int = OPENROUTER_MAX_TOKENS, system: str = STATIC_SYSTEM_PREFIX) -> Dict[str, Any]:
        """Internal call to Gemini API or mock function."""
        if self.mock_response_fn:
            res = self.mock_response_fn({"prompt": prompt, "model": self.model_name, "system": system})
            if isinstance(res, dict) and "usage" in res:   # a mock that reports usage is counted like a real request
                self.request_count += 1
                self._count_usage(res)
            return res

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

        return self._post_openrouter(prompt, max_tokens, system) if self.openrouter_api_key else self._post_generate(prompt, system)

    def _count_usage(self, res: Any) -> None:
        """Every request counts (classify, split, typo fix): the pipeline reports tokens / cost per purpose."""
        usage = res.get("usage", {}) if isinstance(res, dict) else {}
        self.input_tokens_total += int(usage.get("input_tokens") or 0)
        self.output_tokens_total += int(usage.get("output_tokens") or 0)
        self.cached_tokens_total += int(usage.get("cached_tokens") or 0)

    def _post_openrouter(self, prompt: str, max_tokens: int = OPENROUTER_MAX_TOKENS, system: str = STATIC_SYSTEM_PREFIX) -> Dict[str, Any]:
        body = {
            "model": self.openrouter_model,
            "temperature": 0.1,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }
        if self.disable_thinking:
            body["reasoning"] = {"enabled": False}
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
                if resp.status_code in (400, 404) and "reasoning" in body and re.search(r"reasoning", resp.text, re.I):
                    body.pop("reasoning")   # a model that cannot switch thinking off: ask again without the setting
                    raise GeminiAPIError(f"OpenRouter HTTP {resp.status_code}: reasoning setting refused, retrying without it", resp.status_code, True)
                if (resp.status_code in (400, 404) and "response_format" in body
                        and re.search(r"response_format|json|parameter", resp.text, re.I)):
                    body.pop("response_format")   # a model without JSON mode: ask again without it (the prompt still asks for JSON)
                    raise GeminiAPIError(f"OpenRouter HTTP {resp.status_code}: JSON mode unsupported, retrying without it", resp.status_code, True)
                if resp.status_code != 200:
                    raise GeminiAPIError(f"OpenRouter HTTP {resp.status_code} ({self.openrouter_model}): {resp.text[:300]}", resp.status_code)
                data = resp.json()
                # a billed reply counts even if it turns out unusable (cut off by max_tokens, bad JSON) and is retried:
                # counting only parsed replies hid about a third of a DeepSeek run's real cost
                usage = data.get("usage") or {}
                self.request_count += 1
                self.total_cost_usd += float(usage.get("cost") or 0.0)
                self._count_usage({"usage": {
                    "input_tokens": usage.get("prompt_tokens", 0),
                    "output_tokens": usage.get("completion_tokens", 0),
                    "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0),
                }})
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
                        body["max_tokens"] = max(OPENROUTER_MAX_TOKENS_RETRY, 2 * body["max_tokens"])
                    raise GeminiAPIError(str(exc), None, True) from exc
                return {"parsed": parsed}
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

    def _post_generate(self, prompt: str, system: str = STATIC_SYSTEM_PREFIX) -> Dict[str, Any]:
        if self.model_name in ("auto", "") and not self._model_resolved:
            self.resolve_model()
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
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
                usage = data.get("usageMetadata", {})
                self.request_count += 1
                self._count_usage({"usage": {
                    "input_tokens": usage.get("promptTokenCount", 0),
                    "output_tokens": usage.get("candidatesTokenCount", 0),
                    "cached_tokens": usage.get("cachedContentTokenCount", 0),
                }})
                cand = (data.get("candidates") or [{}])[0]
                parts = (cand.get("content") or {}).get("parts") or [{}]
                raw_text = "".join(p.get("text", "") for p in parts)
                if not raw_text.strip():
                    raise GeminiAPIError(f"رد فارغ من النموذج (finishReason={cand.get('finishReason')})", None, True)
                try:
                    parsed = parse_model_json(raw_text)
                except ValueError as exc:
                    raise GeminiAPIError(str(exc), None, True) from exc
                return {"parsed": parsed}
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

        # ~250 output tokens per sentence with edits: a 20-sentence window needs more room than one sentence
        res = self._call_model(self.build_classify_prompt(uow), max(OPENROUTER_MAX_TOKENS, 600 + 300 * len(uow.target_segments)))
        parsed = res.get("parsed", res)

        decisions_raw = parsed.get("decisions", [])
        if isinstance(decisions_raw, dict):     # a single decision not wrapped in a list
            decisions_raw = [decisions_raw]
        items: List[GeminiWindowItemSchema] = []
        for d in decisions_raw if isinstance(decisions_raw, list) else []:
            if not isinstance(d, dict):
                continue
            item = GeminiWindowItemSchema.model_validate(sanitize_decision(d))
            item.trace = ({"provider": "openrouter", "model": self.openrouter_model, "raw": d} if self.openrouter_api_key
                          else {"provider": "gemini", "model": self.model_name, "raw": d})
            if item.confidence is not None and item.tag is not None:
                # same shape as JEV's answers, so the review card shows the model's confidence
                item.trace["answers"] = {"tag": {"choice": item.tag.value if item.tag != StructuralTag.HEADING
                                                 else f"heading_{item.level or 1}", "confidence": item.confidence}}
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
        res = self._call_model(prompt, system=HELPER_SYSTEM_PROMPT)
        parsed = res.get("parsed", res)
        return normalize_split_points(helper_field(parsed, "splitPoints"), len(segment.tokens))

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
        res = self._call_model(prompt, system=HELPER_SYSTEM_PROMPT)
        parsed = res.get("parsed", res)
        return [e for e in helper_field(parsed, "edits") if isinstance(e, dict)]
