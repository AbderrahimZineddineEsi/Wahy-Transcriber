"""What the verification API sends and receives."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from wahy.core.ai.gemini import DEFAULT_MODEL as DEFAULT_GEMINI_MODEL
from wahy.core.ai.openrouter import DEFAULT_CHAT_MODEL, DEFAULT_JEV_MODEL
from wahy.core.jobs import JobSnapshot

Provider = Literal["gemini", "jev", "openrouter", "laya", "fake"]
Scope = Literal["HADITH_AND_CANDIDATES", "HADITH_ONLY", "ALL"]
VerdictValue = Literal["CORRECT", "FALSE", "NOT_SURE"]
# what is saved on a verdict (the models answer the first four; EXTRA_* is the user's own, review note 2)
BoundaryValue = Literal[
    "COMPLETE", "MISSING_START", "MISSING_END", "MISSING_BOTH", "EXTRA_START", "EXTRA_END"
]


class PromptRules(BaseModel):
    """The optional rules (see prompts.RULES for each one's text). Laya ignores them."""

    ignore_asr_errors: bool = True
    citation_cues: bool = True
    narrator_names: bool = False
    explaining_repeat: bool = False
    cue_before_garbled: bool = Field(
        False, description="N-020: a cue then garbled words: the quote started earlier"
    )
    explaining_with_text: bool = Field(
        False, description="N-020: explaining in the text's own words is not a quote"
    )
    prefer_not_sure: bool = False
    passages: bool = Field(True, description="consecutive verses found back to back go out as one passage")
    no_thinking: bool = Field(False, description="ask OpenRouter reasoning models not to think")
    suggest_merges: bool = Field(True, description="send the close neighbours and ask whether to merge")


class PromptConfig(BaseModel):
    preset: Literal["balanced", "strict", "lenient", "boundaries"] = "balanced"
    rules: PromptRules = Field(default_factory=PromptRules)
    reason_lang: Literal["ar", "en"] = "ar"
    reason_detail: Literal["brief", "detailed"] = "brief"
    extra_instructions: str = Field("", max_length=4000)
    system_prompt_override: str = Field("", max_length=20000, description="empty: the default system prompt")
    temperature: float = Field(0.1, ge=0.0, le=1.0)


class PassOptions(BaseModel):
    """Everything a verification pass can be told (F-085, F-086). Saved as the verifier settings; a pass can
    send its own."""

    provider: Provider = "gemini"
    gemini_model: str = DEFAULT_GEMINI_MODEL
    gemini_batch_size: int = Field(5, ge=5, le=10, description="findings per Gemini request")
    gemini_free_tier: bool = Field(
        True, description="pace the requests to the free tier and count them as free"
    )
    gemini_rpm: int = Field(12, ge=1, le=120, description="requests per minute on the free tier")
    jev_model: str = DEFAULT_JEV_MODEL
    openrouter_model: str = DEFAULT_CHAT_MODEL
    laya_checkpoint: str | None = Field(None, description="empty: the selected checkpoint")
    laya_device: Literal["auto", "cuda", "cpu"] | None = None
    context_words: int = Field(25, ge=5, le=100, description="transcript words on each side (envelope v1)")
    prompt: PromptConfig = Field(default_factory=PromptConfig)


class OptionsPatch(BaseModel):
    """A change to the saved verifier settings: only the fields given change (`prompt` is replaced whole)."""

    provider: Provider | None = None
    gemini_model: str | None = None
    gemini_batch_size: int | None = Field(None, ge=5, le=10)
    gemini_free_tier: bool | None = None
    gemini_rpm: int | None = Field(None, ge=1, le=120)
    jev_model: str | None = None
    openrouter_model: str | None = None
    laya_checkpoint: str | None = None
    laya_device: Literal["auto", "cuda", "cpu"] | None = None
    context_words: int | None = Field(None, ge=5, le=100)
    prompt: PromptConfig | None = None


class Selection(BaseModel):
    """Which findings a pass judges (F-084): `finding_ids` when given (picked by hand), else the `scope`."""

    scope: Scope = "HADITH_AND_CANDIDATES"
    finding_ids: list[int] | None = Field(None, description="exactly these findings (overrides the scope)")


class PassRequest(Selection):
    options: PassOptions | None = Field(None, description="empty: the saved verifier settings")


class PreviewRequest(BaseModel):
    finding_id: int
    options: PassOptions | None = None


class Estimate(BaseModel):
    """What a pass would cost before it runs (F-087). Tokens and cost are estimates from the requests'
    size."""

    provider: str
    model: str
    findings: int = Field(description="findings that get a verdict")
    items: int = Field(description="what is sent: a passage of verses is one item for several findings")
    requests: int
    approx_input_tokens: int
    approx_output_tokens: int
    est_cost_usd: float
    est_seconds: int
    envelope_version: int


class Preview(BaseModel):
    """The exact request the verifier would get for one finding (F-086), without sending it."""

    provider: str
    model: str
    endpoint: str
    finding_ids: list[int] = Field(description="the findings this request judges (a passage holds several)")
    envelope_version: int
    system_prompt: str = Field(description="empty for JEV and Laya, which get no prompt")
    state: dict[str, Any]
    questions: dict[str, Any]
    body: Any = Field(description="the whole request body, as it would be sent (without the key)")
    approx_tokens: int


class PassStarted(BaseModel):
    job: JobSnapshot


class PassMetrics(BaseModel):
    """A pass's numbers (F-089), from its saved requests and verdicts, so `cost_usd` is the sum of the logged
    requests' costs."""

    job_id: str
    status: str
    provider: str | None
    model: str | None
    findings_total: int
    findings_verified: int
    findings_failed: int
    verdict_counts: dict[str, int]
    clipped: int = Field(description="verdicts that say the start or the end is missing")
    requests: int
    requests_ok: int
    requests_failed: int
    total_latency_ms: int
    avg_latency_ms: int
    input_tokens: int
    output_tokens: int
    avg_input_tokens: int = Field(description="the average context per successful request")
    cost_usd: float
    envelope_ms: int | None = Field(None, description="time the engine took to build the envelopes")
    elapsed_s: float | None


class VerdictIn(BaseModel):
    """The user's own verdict on a finding (F-065). Without `boundary`, the boundary of the newest verdict
    stays."""

    verdict: VerdictValue
    boundary: BoundaryValue | None = None


class VerdictSaved(BaseModel):
    finding_id: int
    verdict_id: int
    verdict: str
    boundary: str | None
    label_id: int = Field(description="the gold label it was saved as")


class Approved(BaseModel):
    approved: int = Field(description="findings whose AI verdict became the user's (gold) verdict")
    labels: int


class ExpandIn(BaseModel):
    boundary: Literal["MISSING_START", "MISSING_END", "MISSING_BOTH"] | None = Field(
        None, description="empty: the newest verdict's boundary (MISSING_BOTH when it has none)"
    )


class Expanded(BaseModel):
    finding_id: int
    changed: bool
    reason: str | None = Field(None, description="no_unit | no_match when nothing changed")
    added: dict[str, int] = Field(description="words added at the start and at the end")
    word_start: int
    word_end: int
    data: dict[str, Any]


class PromptCatalog(BaseModel):
    """The texts the options screen shows: presets, rules and the default system prompt (F-086)."""

    presets: dict[str, dict[str, Any]]
    rules: dict[str, dict[str, Any]]
    default_system_prompt: str
    defaults: PassOptions
