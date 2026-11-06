"""What the Tafrigh API sends and receives (the web app's types are generated from these)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from wahy.core.jobs import JobSnapshot

from .models import CommentKind, StructuralTag
from .review_queue import ReviewItem

TextSource = Literal["raw_findings", "corrected", "raw"]
Candidate = Literal["gemini_all", "jev_hybrid", "laya_hybrid", "openrouter_chat"]
TypoStrategy = Literal["gated", "always_correct", "asr_confidence_gated", "off"]


class TafrighSegConfigIn(BaseModel):
    """How the text is cut into sentences (F-107)."""

    use_punctuation: bool = True
    pause_sec: float = Field(0.7, ge=0, le=10, description="a silence at least this long ends a sentence")
    min_words: int = Field(2, ge=1, le=50)
    max_words: int = Field(40, ge=0, le=500)


class TafrighMatnIn(BaseModel):
    """The matn being explained (F-108): pasted text, or a file `data/matns/<matn_id>.txt`."""

    mode: Literal["no_matn", "upload", "builtin"] = "no_matn"
    matn_id: str | None = Field(None, pattern=r"^[\w\-]{1,64}$")
    raw_matn_text: str | None = None


class TafrighSourceIn(BaseModel):
    """Which text a Tafrigh run reads (F-109) and how it is cut into sentences."""

    text_source: TextSource = Field(
        "raw_findings", description="raw_findings: quotes as found | corrected: quotes from their source | raw")
    use_detection_boundaries: bool | None = Field(
        None, description="each quote its own sentence; default: yes, except for the raw text")
    seg_config: TafrighSegConfigIn = TafrighSegConfigIn()


class TafrighPreviewRequest(TafrighSourceIn):
    pass


class TafrighRunRequest(TafrighSourceIn):
    processing_mode: Literal["per_sentence", "windowed"] = "windowed"
    window_size: int = Field(15, ge=1, le=40, description="sentences per request in windowed mode (F-111)")
    model_candidate: Candidate = Field("gemini_all", description="the classifier (F-110)")
    model_name: str = Field("auto", description="a Gemini model, or auto: the best Flash-Lite this key can call")
    gemini_route: Literal["auto", "direct", "openrouter"] = Field(
        "auto", description="auto: through OpenRouter when its key is set, else Google directly")
    openrouter_gemini_model: str | None = None
    openrouter_chat_model: str | None = Field(None, description="for model_candidate openrouter_chat")
    jev_model: str | None = None
    jev_layout: Literal["independent_questions", "split_as_tag_option"] = "independent_questions"
    jev_execution_order: Literal["parallel", "sequential", "combined"] = "parallel"
    typo_strategy: TypoStrategy = "gated"
    disable_thinking: bool = False
    matn: TafrighMatnIn = TafrighMatnIn()
    target_range: tuple[int, int] | None = Field(
        None, description="only sentences [from, to) are classified; the others are context (F-113)")
    first_n: int | None = Field(
        None, ge=1, description="shortcut for target_range [0, n): the cheap test slice (20 sentences)")
    name: str | None = Field(None, max_length=120, description="the run's name in the saved runs")


class TafrighSentenceOut(BaseModel):
    index: int
    id: str
    text: str
    words: int
    start_time: float | None
    end_time: float | None
    cut_reason: str | None
    has_detection: bool
    quote_kinds: list[str]


class TafrighPreviewStats(BaseModel):
    sentences: int
    words_total: int
    min_words: int
    max_words: int
    avg_words: float
    median_words: int
    over_cap: int
    avg_duration_sec: float | None
    cut_reasons: dict[str, int]
    quote_sentences: int
    has_timestamps: bool


class TafrighPreview(BaseModel):
    """The sentences a run would classify, before any model is called (F-106)."""

    sentences: list[TafrighSentenceOut]
    stats: TafrighPreviewStats
    seg_config: TafrighSegConfigIn
    text_source: TextSource
    quotes: dict[str, int] = Field(description="quotes sent as their own sentences, by kind")
    words: int


class TafrighPriceOut(BaseModel):
    model: str
    prompt_per_token: float
    completion_per_token: float


class TafrighEstimate(BaseModel):
    """Requests and tokens of a run over the chosen sentences, for every mode, from the real prompts (F-114).
    `price` is the OpenRouter price of the chosen model, when it is known."""

    sentences: int
    per_sentence: dict[str, Any]
    windowed: dict[str, Any]
    jev: dict[str, Any]
    laya: dict[str, Any]
    price: TafrighPriceOut | None = None


class TafrighStarted(BaseModel):
    job: JobSnapshot


class TafrighRunSummary(BaseModel):
    run_id: str
    lecture_id: int | None
    name: str
    created_at: str | None
    copied_from: str | None
    job_id: str | None
    num_segments: int
    needs_review: int
    reviewed: int
    processing_mode: str | None
    window_size: int | None
    model_candidate: str | None
    model_name: str | None
    typo_strategy: str | None
    target_range: list[int] | None
    stopped: bool
    total_cost_usd: float
    requests_sent: int
    wall_clock_seconds: float | None


class TafrighOutlineEntry(BaseModel):
    segment_id: str
    level: int
    title: str
    parent_id: str | None


class TafrighRunDetail(BaseModel):
    """A saved Tafrigh run with its renders (F-117 to F-119)."""

    run: TafrighRunSummary
    markdown: str
    html: str
    structured_json: dict[str, Any]
    outline: list[TafrighOutlineEntry]
    review_items: list[ReviewItem]
    report: dict[str, Any]
    manifest: dict[str, Any]
    warnings: list[str]


class TafrighRunPatch(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class TafrighReviewIn(BaseModel):
    segment_id: str
    action: Literal["confirm", "correct", "reject"] = "confirm"
    corrected_tag: StructuralTag | None = None
    corrected_level: int | None = Field(None, ge=1, le=6)
    corrected_parent: str | None = None
    corrected_comment_kind: CommentKind | None = None
    corrected_text: str | None = None
    reviewer_id: str = "web_editor"
    note: str | None = None


class TafrighCloneIn(BaseModel):
    name: str | None = Field(None, max_length=120)


class TafrighExportedFile(BaseModel):
    filename: str
    mime: str
    content: str


class TafrighCompareIn(BaseModel):
    run_ids: list[str] = Field(min_length=2, max_length=6)


class TafrighCompareRun(BaseModel):
    run_id: str
    name: str
    model_candidate: str | None
    processing_mode: str | None
    jev_layout: str | None
    typo_strategy: str | None
    num_segments: int
    wall_clock_seconds: float | None
    total_cost_usd: float
    cost_per_100_sentences_usd: float
    requests_sent: int
    failure_rate: float
    fallback_rate: float
    tag_distribution: dict[str, int]


class TafrighDisagreement(BaseModel):
    segment_id: str
    text: str
    diff_type: str
    run_a: str
    run_b: str


class TafrighComparison(BaseModel):
    """The first run against another one: the sentences they label differently."""

    a: str
    b: str
    count: int
    disagreements: list[TafrighDisagreement]


class TafrighCompareOut(BaseModel):
    """Saved Tafrigh runs side by side (F-122): settings, cost, and which sentences get different labels."""

    runs: list[TafrighCompareRun]
    comparisons: list[TafrighComparison]
    markdown: str


class TafrighGeminiModels(BaseModel):
    models: list[str]
    recommended: str | None
