"""Verification: verifiers judge a lecture's findings, as a job (GLOSSARY: Verification pass), plus the user's
own verdicts. The behaviour is the old app's `js/ai-verifier.js` (runBatchAiVerification, estimate, preview,
setHumanOverrideVerdict) and the editor's boundary heal, moved to the server.

    verification = VerificationService(db, settings, jobs, engine, ai, lectures, detection)
    verification.estimate(lecture_id, PassRequest(scope="ALL"))      # findings, requests, tokens, cost, time
    job = verification.start(lecture_id, PassRequest(finding_ids=[4, 9]))   # follow /api/jobs/<id>/events
    verification.metrics(job.id)                                     # F-089, from the saved requests
    verification.set_verdict(finding_id, VerdictIn(verdict="FALSE"))  # the user's verdict = a gold label
    verification.approve_all(lecture_id)                             # every AI verdict → gold label
    verification.expand(finding_id, ExpandIn())                      # grow a finding over its missing words

How a pass works (`run_job`):
1. **Envelopes.** The engine builds them from every finding of the lecture (passages and neighbours are found
   among all of them), for the target findings only (ADR 0003). A prompt-driven verifier (Gemini, JEV,
   OpenRouter chat, fake) reads envelope v1, with the passages rule and the prompt tuning (prompts.py). Laya
   reads the envelope version its checkpoint was trained on (v1, v2 or v3), with its own options and only the
   questions it was trained on.
2. **Requests.** Gemini sends `gemini_batch_size` items per request, the others one. Before each request the
   job can be paused or cancelled; a free-tier wait shows in the progress. A failed request marks its findings
   failed and the pass goes on; a fatal one (no key, unknown model) stops the pass.
3. **Verdicts.** Each answer becomes one verdict per target finding in its item: a passage's P(start cut off)
   belongs to its first verse and P(end cut off) to its last; a Laya checkpoint not trained on the boundary
   gets it from the word-overlap rule. Each verdict links the AI request that produced it.

The pass is resumable: after a restart it skips the requests it already made.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select

from wahy.core.ai.gemini import GeminiOptions
from wahy.core.ai.gemini import price as gemini_price
from wahy.core.ai.laya_local import EnvelopeInfo, LayaOptions
from wahy.core.ai.layer import AiLayer
from wahy.core.ai.models import AiRequest
from wahy.core.ai.openrouter import ChatOptions, JevOptions, is_jev_model, normalize_model_id
from wahy.core.ai.prompts import VERIFIER_SYSTEM_PROMPT, system_prompt
from wahy.core.ai.types import AiError, Answer, Call, Item, normalize_boundary
from wahy.core.db import Database
from wahy.core.engine import EngineClient
from wahy.core.jobs import UNFINISHED, JobContext, JobRunner, JobSnapshot
from wahy.core.settings import Settings
from wahy.features.detection.models import Finding
from wahy.features.detection.service import DetectionService
from wahy.features.lectures.models import Lecture
from wahy.features.lectures.service import LectureNotFound, LectureService
from wahy.features.settings.store import SettingsStore
from wahy.features.training.models import Label
from wahy.features.verification import prompts
from wahy.features.verification.models import Verdict
from wahy.features.verification.schemas import (
    Approved,
    Estimate,
    OptionsPatch,
    PassMetrics,
    PassOptions,
    PassRequest,
    Preview,
    PreviewRequest,
    PromptCatalog,
    Selection,
    VerdictIn,
    VerdictSaved,
)

SETTINGS_KEY = "verification"
PROMPTED = ("gemini", "jev", "openrouter", "fake")  # read envelope v1 and the prompt tuning
BOUNDARY_KEYS = ("COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH")
# the old app's estimate constants (js/ai-verifier.js estimateBatchVerification)
CHARS_PER_TOKEN = 3.2
CHAT_EXPECTED_OUTPUT_TOKENS = 300
DEFAULT_CHAT_PRICES = (0.14 / 1_000_000, 0.28 / 1_000_000)  # per token, when the catalog can't be read
JEV_PRICE_PER_M = 0.042
SECONDS_PER_REQUEST = 2.5
HUMAN_CONFIDENCE = 0.98
# Laya's envelope when its checkpoint's config can't be read before loading it (the old app's default)
UNKNOWN_LAYA_ENVELOPE = EnvelopeInfo(version=3, options={"passages": True}, questions=None)


class VerificationError(Exception):
    pass


class FindingNotFound(VerificationError, KeyError):
    pass


class NothingToVerify(VerificationError, ValueError):
    """No finding matches the selection."""


class PassRunning(VerificationError):
    """The lecture already has a verification pass that has not ended (the API answers 409)."""


def to_saved_boundary(boundary: str | None) -> str | None:
    """A model's boundary → what a verdict saves (COMPLETE_SPAN is saved as COMPLETE)."""
    return "COMPLETE" if boundary == "COMPLETE_SPAN" else boundary


def to_model_boundary(boundary: str | None) -> str | None:
    return "COMPLETE_SPAN" if boundary == "COMPLETE" else boundary


def boundary_from_yes_no(p_start: float, p_end: float) -> dict[str, float]:
    """P(start cut off) and P(end cut off) → the four boundary classes, the two sides independent
    (boundaryFromYesNo)."""
    s, e = min(1.0, max(0.0, p_start or 0.0)), min(1.0, max(0.0, p_end or 0.0))
    return {
        "COMPLETE_SPAN": (1 - s) * (1 - e),
        "MISSING_START": s * (1 - e),
        "MISSING_END": (1 - s) * e,
        "MISSING_BOTH": s * e,
    }


def in_scope(data: dict[str, Any], scope: str) -> bool:
    """js/ai-verifier.js filterDetectionsByScope: the default scope is hadiths and the findings the engine
    itself
    doubts (a candidate or ambiguous band, or a score under 15)."""
    if scope == "ALL":
        return True
    source = str(data.get("sourceType") or "").upper()
    if scope == "HADITH_ONLY":
        return source == "HADITH"
    band = str(data.get("confidenceBand") or "").upper()
    return source == "HADITH" or band in ("CANDIDATE", "AMBIGUOUS") or (data.get("totalScore") or 0) < 15


@dataclass
class Planned:
    """One item to send: its envelope, the findings it covers (`members`, indices into the lecture's findings)
    and the ones among them that get a verdict (`targets`)."""

    item: Item
    members: list[int]
    targets: list[int]
    grouped: bool  # a passage (or a Laya v2 / v3 envelope): boundary per side
    merge: dict[str, Any] | None = None
    rule: dict[str, int] | None = (
        None  # the word-overlap boundary, for a checkpoint without boundary questions
    )


@dataclass
class Plan:
    provider: str
    model: str
    version: int
    rows: list[Finding]
    items: list[Planned]
    per_request: int
    provider_options: Any
    system_prompt: str
    envelope_ms: int
    by_index: dict[int, int] = field(default_factory=dict)  # finding index → finding id

    def chunks(self) -> list[list[Planned]]:
        return [self.items[i : i + self.per_request] for i in range(0, len(self.items), self.per_request)]

    @property
    def target_count(self) -> int:
        return sum(len(p.targets) for p in self.items)


class VerificationService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        jobs: JobRunner,
        engine: EngineClient,
        ai: AiLayer,
        lectures: LectureService,
        detection: DetectionService,
    ):
        self.db, self.settings, self.jobs, self.engine, self.ai = db, settings, jobs, engine, ai
        self.lectures, self.detection = lectures, detection
        self.store = SettingsStore(db)
        jobs.register("verify", self.run_job, resumable=True)

    # ---- the verifier settings -----------------------------------------------------------------------------

    def get_options(self) -> PassOptions:
        return PassOptions.model_validate(self.store.get(SETTINGS_KEY, {}))

    def update_options(self, patch: OptionsPatch) -> PassOptions:
        changes = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if v is not None}
        new = PassOptions.model_validate({**self.get_options().model_dump(), **changes})
        self.store.set(SETTINGS_KEY, new.model_dump())
        return new

    @staticmethod
    def prompt_catalog() -> PromptCatalog:
        return PromptCatalog(
            presets=prompts.PRESETS,
            rules=prompts.RULES,
            default_system_prompt=VERIFIER_SYSTEM_PROMPT,
            defaults=PassOptions(),
        )

    # ---- selection and envelopes ---------------------------------------------------------------------------

    def _rows(self, lecture_id: int) -> list[Finding]:
        self.lectures.list_one(lecture_id)  # LectureNotFound
        with self.db.session() as s:
            rows = list(
                s.scalars(
                    select(Finding)
                    .where(Finding.lecture_id == lecture_id, Finding.deleted.is_(False))
                    .order_by(Finding.idx)
                )
            )
            s.expunge_all()
        return rows

    @staticmethod
    def _targets(rows: list[Finding], selection: Selection) -> list[int]:
        if selection.finding_ids is not None:
            wanted = set(selection.finding_ids)
            unknown = wanted - {r.id for r in rows}
            if unknown:
                raise FindingNotFound(f"findings {sorted(unknown)} are not in this lecture")
            return [i for i, r in enumerate(rows) if r.id in wanted]
        return [i for i, r in enumerate(rows) if in_scope(r.data, selection.scope)]

    def _engine_options(self, rows: list[Finding]) -> dict[str, Any]:
        return self.detection.engine_options(engine=rows[0].engine if rows else None)

    def _laya_envelope(self, o: PassOptions, *, load: bool, check: Any = None) -> EnvelopeInfo:
        laya = self.ai.laya
        info = laya.envelope(o.laya_checkpoint)
        if info is None and load:
            laya.load(o.laya_checkpoint, o.laya_device, should_stop=check)  # reads the config once loaded
            info = laya.envelope(o.laya_checkpoint)
        return info or UNKNOWN_LAYA_ENVELOPE

    def _plan(
        self,
        lecture_id: int,
        o: PassOptions,
        targets: list[int] | None,
        selection: Selection | None,
        *,
        laya_info: EnvelopeInfo | None = None,
    ) -> Plan:
        rows = self._rows(lecture_id)
        if targets is None:
            assert selection is not None
            targets = self._targets(rows, selection)
        if not targets:
            raise NothingToVerify("no finding matches the selection")
        words = self.detection._words(lecture_id)
        engine_options = self._engine_options(rows)
        provider = o.provider
        t0 = time.perf_counter()
        if provider == "laya":
            info = laya_info or self._laya_envelope(o, load=False)
            version = info.version
            env_options: dict[str, Any] = {"targets": targets}
            if version == 1:
                env_options |= {
                    "passages": bool(info.options.get("passages", False)),
                    "contextWords": o.context_words,
                }
            else:
                env_options["passages"] = bool(info.options.get("passages", True))
                if version == 2:
                    env_options["neighbours"] = bool(info.options.get("neighbours", False))
        else:
            info, version = None, 1
            env_options = {
                "targets": targets,
                "passages": o.prompt.rules.passages,
                "contextWords": o.context_words,
            }
        envs = self.engine.envelopes(
            [r.data for r in rows], words, version, {**engine_options, **env_options}
        )

        wanted = set(targets)
        items: list[Planned] = []
        for env in envs:
            members = list(env["members"])
            item_targets = [m for m in members if m in wanted]
            state, questions = env["state"], env["questions"]
            if provider == "laya":
                assert info is not None
                if info.questions is not None:
                    questions = {k: v for k, v in questions.items() if k in info.questions}
                grouped = version in (2, 3)
            else:
                questions = prompts.compose_questions(questions, o.prompt)
                state, questions = prompts.with_merge(env, questions, o.prompt)
                grouped = len(members) > 1
            planned = Planned(
                Item(id=str(rows[members[0]].id), state=state, questions=questions),
                members,
                item_targets,
                grouped,
                merge=env.get("merge") if provider != "laya" else None,
            )
            if provider == "laya" and not any(
                q in questions for q in ("start_missing", "end_missing", "boundary_status")
            ):
                planned.rule = env.get("boundaryByRule")
            items.append(planned)
        missing_rules = [
            p
            for p in items
            if provider == "laya"
            and p.rule is None
            and not any(q in p.item.questions for q in ("start_missing", "end_missing", "boundary_status"))
        ]
        if missing_rules:
            for p, rule in zip(
                missing_rules, self.engine.rule_boundary([p.item.state for p in missing_rules]), strict=True
            ):
                p.rule = rule
        envelope_ms = round((time.perf_counter() - t0) * 1000)

        model, provider_options, system = self._provider_options(o)
        per_request = o.gemini_batch_size if provider == "gemini" else 1
        return Plan(
            provider,
            model,
            version,
            rows,
            items,
            per_request,
            provider_options,
            system,
            envelope_ms,
            by_index={i: r.id for i, r in enumerate(rows)},
        )

    def _provider_options(self, o: PassOptions) -> tuple[str, Any, str]:
        """(model name, the provider's options, the system prompt it gets)."""
        p = o.prompt
        system = system_prompt(
            p.system_prompt_override, reason_lang=p.reason_lang, reason_detail=p.reason_detail
        )
        if o.provider == "gemini":
            return (
                o.gemini_model,
                GeminiOptions(
                    model=o.gemini_model,
                    free_tier=o.gemini_free_tier,
                    rpm=o.gemini_rpm,
                    batch_size=o.gemini_batch_size,
                    temperature=p.temperature,
                    system_prompt=p.system_prompt_override or None,
                    reason_lang=p.reason_lang,
                    reason_detail=p.reason_detail,
                ),
                system,
            )
        if o.provider == "jev":
            return o.jev_model, JevOptions(model=o.jev_model), ""
        if o.provider == "openrouter":
            model = normalize_model_id(o.openrouter_model)
            return (
                model,
                ChatOptions(
                    model=model,
                    temperature=p.temperature,
                    no_thinking=p.rules.no_thinking,
                    system_prompt=p.system_prompt_override or None,
                    reason_lang=p.reason_lang,
                    reason_detail=p.reason_detail,
                ),
                "" if is_jev_model(model) else system,
            )
        if o.provider == "laya":
            checkpoint = (o.laya_checkpoint or "").strip() or self.ai.laya.checkpoint
            return checkpoint, LayaOptions(checkpoint=o.laya_checkpoint, device=o.laya_device), ""
        return self.ai.fake.model, None, ""

    # ---- before a pass: estimate and preview ---------------------------------------------------------------

    def estimate(self, lecture_id: int, req: PassRequest) -> Estimate:
        """F-087: findings, requests, tokens, cost and time of the pass `req` describes. Tokens are counted
        from
        the size of the requests that would be sent (the old app's 3.2 characters per token)."""
        o = req.options or self.get_options()
        plan = self._plan(lecture_id, o, None, req)
        chunks = plan.chunks()
        tokens_in = sum(self._approx_tokens(plan, chunk) for chunk in chunks)
        items = len(plan.items)
        tokens_out = items * CHAT_EXPECTED_OUTPUT_TOKENS if o.provider in ("gemini", "openrouter") else 0
        cost = 0.0
        if o.provider == "openrouter" and not is_jev_model(plan.model):
            meta = self.ai.catalog.get(plan.model)
            p_in, p_out = (meta.prompt_price, meta.completion_price) if meta else DEFAULT_CHAT_PRICES
            cost = tokens_in * p_in + tokens_out * p_out
        elif o.provider == "jev" or (o.provider == "openrouter" and is_jev_model(plan.model)):
            cost = tokens_in / 1_000_000 * JEV_PRICE_PER_M
        elif o.provider == "gemini" and not o.gemini_free_tier:
            cost = gemini_price(plan.model, tokens_in, tokens_out)
        if o.provider == "gemini" and o.gemini_free_tier:
            seconds = math.ceil(len(chunks) / o.gemini_rpm) * 60
        else:
            seconds = round(len(chunks) * SECONDS_PER_REQUEST)
        return Estimate(
            provider=o.provider,
            model=plan.model,
            findings=plan.target_count,
            items=items,
            requests=len(chunks),
            approx_input_tokens=tokens_in,
            approx_output_tokens=tokens_out,
            est_cost_usd=round(cost, 6),
            est_seconds=seconds,
            envelope_version=plan.version,
        )

    def _approx_tokens(self, plan: Plan, chunk: list[Planned]) -> int:
        body = self.ai.preview(plan.provider, [p.item for p in chunk], plan.provider_options)["body"]
        text = json.dumps(body, ensure_ascii=False)
        if plan.provider in ("jev", "openrouter", "laya", "fake") and len(chunk) > 1:
            text *= len(chunk)  # one request per item
        return round(len(text) / CHARS_PER_TOKEN)

    def preview(self, lecture_id: int, req: PreviewRequest) -> Preview:
        """F-086: the exact request the verifier would get for one finding (its passage, if it is in one)."""
        o = req.options or self.get_options()
        plan = self._plan(lecture_id, o, None, Selection(finding_ids=[req.finding_id]))
        planned = plan.items[0]
        sent = self.ai.preview(o.provider, [planned.item], plan.provider_options)
        return Preview(
            provider=o.provider,
            model=sent["model"],
            endpoint=sent["endpoint"],
            finding_ids=[plan.by_index[m] for m in planned.members],
            envelope_version=plan.version,
            system_prompt=plan.system_prompt,
            state=planned.item.state,
            questions=planned.item.questions,
            body=sent["body"],
            approx_tokens=self._approx_tokens(plan, [planned]),
        )

    # ---- the pass ------------------------------------------------------------------------------------------

    def start(self, lecture_id: int, req: PassRequest) -> JobSnapshot:
        """Start a verification pass (F-088). The selection is resolved now, so the pass judges exactly the
        findings selected when it was started."""
        o = req.options or self.get_options()
        rows = self._rows(lecture_id)
        targets = self._targets(rows, req)
        if not targets:
            raise NothingToVerify("no finding matches the selection")
        running = [j for j in self.jobs.list(lecture_id=lecture_id, kind="verify") if j.status in UNFINISHED]
        if running:
            raise PassRunning(
                f"verification pass {running[0].id} is still {running[0].status} on this lecture"
            )
        params = {
            "options": o.model_dump(),
            "finding_ids": [rows[i].id for i in targets],
            "scope": None if req.finding_ids is not None else req.scope,
        }
        return self.jobs.submit("verify", params, lecture_id=lecture_id)

    def run_job(self, ctx: JobContext) -> dict[str, Any]:
        lecture_id = ctx.lecture_id
        assert lecture_id is not None
        o = PassOptions.model_validate(ctx.params["options"])
        wanted_ids = list(ctx.params["finding_ids"])
        state = dict(ctx.checkpoint or {"chunks": 0, "findings_done": 0, "failed": [], "requests_done": 0})
        ctx.progress(stage="prepare", stages=["prepare", "verify"], provider=o.provider, percent=0)

        laya_info = self._laya_envelope(o, load=True, check=ctx.check) if o.provider == "laya" else None
        rows = self._rows(lecture_id)
        index_of = {r.id: i for i, r in enumerate(rows)}
        gone = [fid for fid in wanted_ids if fid not in index_of]
        if gone:
            raise NothingToVerify(
                f"findings {gone} are gone (the lecture was detected again); start a new pass"
            )
        plan = self._plan(lecture_id, o, [index_of[fid] for fid in wanted_ids], None, laya_info=laya_info)
        chunks = plan.chunks()
        total = plan.target_count

        def report(**extra: Any) -> None:
            ctx.progress(
                stage="verify",
                provider=o.provider,
                model=plan.model,
                envelope_version=plan.version,
                findings_done=state["findings_done"],
                findings_total=total,
                requests_done=state["requests_done"],
                requests_total=len(chunks),
                failed=len(state["failed"]),
                envelope_ms=plan.envelope_ms,
                percent=round(100 * state["findings_done"] / total, 1) if total else 100,
                **extra,
            )

        report(waiting=None)
        for ci, chunk in enumerate(chunks):
            if ci < state["chunks"]:
                continue  # done before a restart
            ctx.check()
            chunk_ids = [plan.by_index[t] for p in chunk for t in p.targets]
            call = Call(
                purpose="verify",
                job_id=ctx.job_id,
                lecture_id=lecture_id,
                check=ctx.check,
                on_wait=lambda s, why: report(waiting={"seconds": round(s, 1), "reason": why}),
                finding_ids=chunk_ids,
            )
            try:
                answers = self.ai.verify(
                    o.provider, [p.item for p in chunk], call=call, options=plan.provider_options
                )
                error = None
            except AiError as e:
                if e.fatal:
                    raise
                answers, error = [], str(e)
            by_item = {a.item_id: a for a in answers}
            failed_now: list[dict[str, Any]] = []
            with self.db.session() as s:
                for p in chunk:
                    answer = by_item.get(p.item.id)
                    if answer is None or not answer.ok:
                        why = error or (answer.error if answer else None) or "no answer for this finding"
                        failed_now += [{"finding_id": plan.by_index[t], "error": why} for t in p.targets]
                        continue
                    for t in p.targets:
                        s.add(self._verdict_row(plan, p, t, answer, o, ctx.job_id))
            state["chunks"] = ci + 1
            state["requests_done"] += 1
            state["findings_done"] += sum(len(p.targets) for p in chunk)
            state["failed"] = state["failed"] + failed_now
            ctx.save_checkpoint(state)
            report(waiting=None)
        result = self.metrics(
            ctx.job_id,
            live={
                "findings_total": total,
                "failed": state["failed"],
                "envelope_ms": plan.envelope_ms,
                "provider": o.provider,
                "model": plan.model,
            },
        ).model_dump()
        result["failed"] = state["failed"]
        return result

    def _verdict_row(
        self, plan: Plan, p: Planned, t: int, answer: Answer, o: PassOptions, job_id: str
    ) -> Verdict:
        """One verdict for target finding `t` of item `p` (the old app's per-finding loop in
        runBatchAiVerification)."""
        verdict = answer.verdict or "NOT_SURE"
        st = p.item.state
        is_first = not p.grouped or t == p.members[0]
        is_last = not p.grouped or t == p.members[-1]
        start_missing, end_missing = answer.start_missing, answer.end_missing
        if p.grouped and plan.provider != "laya":
            # a passage on a 4-class verifier: its boundary answer becomes "start cut off?" / "end cut off?"
            b = str(answer.boundary or "COMPLETE_SPAN").upper()
            c = answer.boundary_confidence if answer.boundary_confidence is not None else 0.85
            start_missing = c if b in ("MISSING_START", "MISSING_BOTH") else 1 - c
            end_missing = c if b in ("MISSING_END", "MISSING_BOTH") else 1 - c
        by_rule = p.rule is not None
        start_p = end_p = None
        b_probs: dict[str, float] | None = None
        if p.grouped or by_rule:
            rule = p.rule
            start_p = (rule["start"] if rule else (start_missing or 0.0)) if is_first else 0.0
            end_p = (rule["end"] if rule else (end_missing or 0.0)) if is_last else 0.0
            b_probs = boundary_from_yes_no(float(start_p), float(end_p))
            raw = "COMPLETE_SPAN"
            for k in BOUNDARY_KEYS:
                if b_probs[k] > b_probs[raw]:
                    raw = k
        else:
            raw = answer.boundary or "COMPLETE_SPAN"
        boundary = normalize_boundary(verdict, raw, st)
        if b_probs is not None:
            b_conf = b_probs[raw]
        else:
            b_conf = answer.boundary_confidence if answer.boundary_confidence is not None else 1.0
            b_probs = answer.boundary_probabilities or {
                k: (b_conf if k == boundary else (1 - b_conf) / 3) for k in BOUNDARY_KEYS
            }
        merge = None
        if plan.provider != "laya" and o.prompt.rules.suggest_merges and p.merge and answer.merge_suggestion:
            merge = self._merge(p, answer, plan, is_first, is_last)
        passage = None
        if p.grouped and len(p.members) > 1:
            passage = {
                "reference": st.get("candidate_reference"),
                "verses": len(p.members),
                "position": "first" if is_first else "last" if is_last else "inner",
                "finding_ids": [plan.by_index[m] for m in p.members],
            }
        details = {
            "probabilities": answer.probabilities,
            "boundary_confidence": b_conf,
            "boundary_probabilities": b_probs,
            "boundary_source": "rule" if by_rule else "model",
            "start_missing_p": start_p,
            "end_missing_p": end_p,
            "envelope_version": plan.version,
            "passage": passage,
            "merge": merge,
            "unmatched_prefix_preview": st.get("unmatched_corpus_prefix_words") or "" if is_first else "",
            "unmatched_suffix_preview": st.get("unmatched_corpus_suffix_words") or "" if is_last else "",
        }
        return Verdict(
            finding_id=plan.by_index[t],
            verifier=plan.provider,
            model=answer.model or plan.model,
            verdict=verdict,
            boundary=to_saved_boundary(boundary),
            confidence=answer.confidence,
            reason=answer.reason,
            job_id=job_id,
            ai_request_id=answer.request_id,
            details=details,
        )

    @staticmethod
    def _merge(
        p: Planned, answer: Answer, plan: Plan, is_first: bool, is_last: bool
    ) -> dict[str, Any] | None:
        """normalizeMergeSuggestion: which neighbours the verifier would merge with; for a passage, the
        previous
        one belongs to its first verse and the next one to its last."""
        assert p.merge is not None
        ids = p.merge.get("neighborIds") or {}
        c = str(answer.merge_suggestion).upper()
        previous = bool(ids.get("previous")) and c in ("MERGE_WITH_PREVIOUS", "MERGE_BOTH")
        nxt = bool(ids.get("next")) and c in ("MERGE_WITH_NEXT", "MERGE_BOTH")
        if p.grouped:
            previous, nxt = previous and is_first, nxt and is_last
        if not previous and not nxt:
            return None
        engine_ids = {r.data.get("id"): r.id for r in plan.rows}
        return {
            "previous": previous,
            "next": nxt,
            "previous_id": engine_ids.get(ids.get("previous")),
            "next_id": engine_ids.get(ids.get("next")),
            "confidence": answer.merge_confidence if answer.merge_confidence is not None else 0.75,
            "gap_type": "COMMENTARY"
            if str(answer.merge_gap_type or "").upper() == "COMMENTARY"
            else "PART_OF_QUOTE",
        }

    def metrics(self, job_id: str, *, live: dict[str, Any] | None = None) -> PassMetrics:
        """F-089: a pass's numbers from its saved requests and verdicts."""
        job = self.jobs.get(job_id)  # JobNotFound
        if job.kind != "verify":
            raise VerificationError(f"job {job_id} is a {job.kind} job, not a verification pass")
        info = live or {
            **(job.result or {}),
            "findings_total": len(job.params.get("finding_ids") or []),
            "failed": (job.result or {}).get("failed") or [],
            "envelope_ms": job.progress.get("envelope_ms"),
            "provider": job.params["options"]["provider"],
            "model": job.progress.get("model"),
        }
        with self.db.session() as s:
            reqs = list(
                s.execute(
                    select(
                        AiRequest.ok,
                        AiRequest.latency_ms,
                        AiRequest.input_tokens,
                        AiRequest.output_tokens,
                        AiRequest.cost_usd,
                    ).where(AiRequest.job_id == job_id)
                )
            )
            verdicts = list(
                s.execute(select(Verdict.verdict, Verdict.boundary).where(Verdict.job_id == job_id))
            )
        ok = [r for r in reqs if r.ok]
        counts = {"CORRECT": 0, "FALSE": 0, "NOT_SURE": 0}
        for v in verdicts:
            counts[v.verdict] = counts.get(v.verdict, 0) + 1
        latency = sum(r.latency_ms or 0 for r in ok)
        tokens_in = sum(r.input_tokens or 0 for r in ok)
        start, end = job.started_at, job.finished_at or datetime.now(UTC).replace(tzinfo=None)
        return PassMetrics(
            job_id=job_id,
            status=job.status,
            provider=info.get("provider"),
            model=info.get("model"),
            findings_total=int(info.get("findings_total") or 0),
            findings_verified=len(verdicts),
            findings_failed=len(info.get("failed") or []),
            verdict_counts=counts,
            clipped=sum(
                1
                for v in verdicts
                if v.verdict != "FALSE" and v.boundary in ("MISSING_START", "MISSING_END", "MISSING_BOTH")
            ),
            requests=len(reqs),
            requests_ok=len(ok),
            requests_failed=len(reqs) - len(ok),
            total_latency_ms=latency,
            avg_latency_ms=round(latency / len(ok)) if ok else 0,
            input_tokens=tokens_in,
            output_tokens=sum(r.output_tokens or 0 for r in ok),
            avg_input_tokens=round(tokens_in / len(ok)) if ok else 0,
            cost_usd=round(sum(r.cost_usd or 0.0 for r in reqs), 9),
            envelope_ms=info.get("envelope_ms"),
            elapsed_s=round((end - start).total_seconds(), 2) if start else None,
        )

    # ---- the user's verdicts -------------------------------------------------------------------------------

    def _finding(self, finding_id: int) -> Finding:
        with self.db.session() as s:
            row = s.get(Finding, finding_id)
            if row is None:
                raise FindingNotFound(f"no finding {finding_id}")
            s.expunge(row)
            return row

    def _newest(self, s: Any, finding_ids: list[int]) -> dict[int, Verdict]:
        newest = (
            select(func.max(Verdict.id))
            .where(Verdict.finding_id.in_(finding_ids))
            .group_by(Verdict.finding_id)
        )
        return {v.finding_id: v for v in s.scalars(select(Verdict).where(Verdict.id.in_(newest)))}

    def set_verdict(self, finding_id: int, body: VerdictIn) -> VerdictSaved:
        """F-065: the user's verdict, saved as the finding's newest verdict and as its gold label."""
        finding = self._finding(finding_id)
        with self.db.session() as s:
            prev = self._newest(s, [finding_id]).get(finding_id)
        boundary = body.boundary or (prev.boundary if prev else None)
        details = {
            "probabilities": {
                k: HUMAN_CONFIDENCE if k == body.verdict else 0.01 for k in ("CORRECT", "FALSE", "NOT_SURE")
            },
            "based_on": prev.id if prev else None,
            "user_action": "SET",
        }
        saved = self._save_human(finding.lecture_id, [(finding, body.verdict, boundary, details, prev)])
        return saved[0]

    def approve_all(self, lecture_id: int) -> Approved:
        """F-091: every finding whose newest verdict is a verifier's gets it as the user's verdict (gold)."""
        rows = self._rows(lecture_id)
        with self.db.session() as s:
            newest = self._newest(s, [r.id for r in rows])
        todo = []
        for r in rows:
            v = newest.get(r.id)
            if v is None or v.verifier == "human":
                continue
            details = {
                "probabilities": (v.details or {}).get("probabilities"),
                "based_on": v.id,
                "user_action": "VALIDATE_ALL",
            }
            todo.append((r, v.verdict, v.boundary, details, v))
        saved = self._save_human(lecture_id, todo) if todo else []
        return Approved(approved=len(saved), labels=len({x.label_id for x in saved}))

    def _save_human(
        self, lecture_id: int, todo: list[tuple[Finding, str, str | None, dict[str, Any], Verdict | None]]
    ) -> list[VerdictSaved]:
        """Save the user's verdicts and their gold labels (one per finding, updated when it exists). Each
        label's
        card keeps the finding and its v1 envelope as they are now, so it outlives a re-detection."""
        rows = self._rows(lecture_id)
        index_of = {r.id: i for i, r in enumerate(rows)}
        words = self.detection._words(lecture_id)
        envs = self.engine.envelopes(
            [r.data for r in rows],
            words,
            1,
            {
                **self._engine_options(rows),
                "targets": [index_of[f.id] for f, *_ in todo],
                "passages": False,
                "contextWords": 25,
            },
        )
        env_of = {rows[e["members"][0]].id: e for e in envs}
        out = []
        with self.db.session() as s:
            lecture = s.get(Lecture, lecture_id)
            title = lecture.title if lecture else ""
            for finding, verdict, boundary, details, prev in todo:
                row = Verdict(
                    finding_id=finding.id,
                    verifier="human",
                    model=None,
                    verdict=verdict,
                    boundary=boundary,
                    confidence=HUMAN_CONFIDENCE,
                    reason="تأكيد وتصحيح يدوي من المدقق البشري (Gold Standard).",
                    details=details,
                )
                s.add(row)
                s.flush()
                env = env_of.get(finding.id) or {}
                card = {
                    "finding": finding.data,
                    "engine": finding.engine,
                    "envelope": {"version": 1, "state": env.get("state"), "questions": env.get("questions")},
                    "verdict": {
                        "verdict": verdict,
                        "boundary": boundary,
                        "confidence": HUMAN_CONFIDENCE,
                        "probabilities": details.get("probabilities"),
                        "user_action": details.get("user_action"),
                        "ai": None
                        if prev is None or prev.verifier == "human"
                        else {
                            "verifier": prev.verifier,
                            "model": prev.model,
                            "verdict": prev.verdict,
                            "boundary": prev.boundary,
                            "confidence": prev.confidence,
                            "details": prev.details,
                            "reason": prev.reason,
                        },
                    },
                    "lecture": {"id": lecture_id, "title": title},
                }
                label = s.scalar(select(Label).where(Label.finding_id == finding.id, Label.source == "user"))
                if label is None:
                    label = Label(
                        finding_id=finding.id,
                        lecture_id=lecture_id,
                        source="user",
                        verdict=verdict,
                        boundary=boundary,
                        card=card,
                    )
                    s.add(label)
                else:
                    label.verdict, label.boundary, label.card = verdict, boundary, card
                s.flush()
                out.append(
                    VerdictSaved(
                        finding_id=finding.id,
                        verdict_id=row.id,
                        verdict=verdict,
                        boundary=boundary,
                        label_id=label.id,
                    )
                )
        return out


__all__ = [
    "FindingNotFound",
    "LectureNotFound",
    "NothingToVerify",
    "PassRunning",
    "VerificationError",
    "VerificationService",
]
