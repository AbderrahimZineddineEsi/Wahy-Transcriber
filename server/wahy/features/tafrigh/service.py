"""Tafrigh as a feature: preview the sentences, estimate, run (a job), and keep, review, clone, export and
compare the saved runs (ROADMAP phase 18).

    tafrigh = TafrighService(db, settings, jobs, ai, lectures, detection, style=export.style)
    tafrigh.preview(lecture_id, TafrighPreviewRequest())                  # the sentences, before any model call
    job = tafrigh.start(lecture_id, TafrighRunRequest(first_n=20))        # a job; follow it at /api/jobs/{id}/events
    tafrigh.stop(job.id)                                           # stop now, keep the finished sentences
    detail = tafrigh.review(run_id, TafrighReviewIn(segment_id="seg_0001", action="confirm"))
    tafrigh.compare([run_a, run_b])

Pause, resume and cancel are the job runner's (cancel keeps nothing); stop is Tafrigh's own: it raises `TafrighStop`
inside the next model wait, and the run ends with the sentences that are finished. A run that the server
interrupted is not resumed (the classifier has no checkpoint); start it again. A finished run is a folder in
`data/tafrigh_runs/` (store.py), so reviews survive a restart.
"""

from __future__ import annotations

import html as html_lib
import json
import re
import statistics
import threading
from collections.abc import Callable
from typing import Any

from sqlalchemy import select

from wahy.core.ai.gemini import pick_model
from wahy.core.ai.layer import AiLayer
from wahy.core.ai.openrouter import normalize_model_id
from wahy.core.ai.types import Call
from wahy.core.db import Database
from wahy.core.jobs import JobContext, JobRunner, JobSnapshot
from wahy.core.settings import Settings
from wahy.features.detection.service import DetectionService
from wahy.features.lectures.models import Word
from wahy.features.lectures.service import LectureService

from .adapters.gemini_adapter import GeminiAdapter
from .adapters.jev_adapter import DEFAULT_JEV_MODEL, JEVAdapter
from .adapters.laya_adapter import LayaAdapter
from .api_schemas import (
    TafrighCompareOut,
    TafrighCompareRun,
    TafrighComparison,
    TafrighDisagreement,
    TafrighEstimate,
    TafrighExportedFile,
    TafrighGeminiModels,
    TafrighOutlineEntry,
    TafrighPreviewRequest,
    TafrighPriceOut,
    TafrighReviewIn,
    TafrighRunDetail,
    TafrighRunRequest,
    TafrighRunSummary,
    TafrighSegConfigIn,
    TafrighSourceIn,
)
from .compare_runs import compare_run_data, segment_disagreements
from .estimate import estimate_run
from .matn_aligner import MatnConfig
from .models import HeadingEntry, StructuralTag, TranscriptSegment
from .outline_repair import run_outline_repair_pass
from .pipeline import TafrighModelError, TafrighPipeline, TafrighStop
from .renderer import RenderConfig, render_to_html, render_to_markdown, render_to_structured_json
from .run_logger import RunLogger, result_row
from .schemas import JEVRequestConfig, PipelineConfig
from .segmenter import SegmentationConfig, segment_transcript
from .source import build_source, quote_findings
from .store import RunSession, RunStore, now_iso


class TafrighError(Exception):
    """The request can't be run as asked (a missing key, an unusable range). The API answers 422."""


class NoSentences(TafrighError):
    pass


STYLE_TO_RENDER = {
    "quranBracketOpen": "quran_open", "quranBracketClose": "quran_close",
    "hadithBracketOpen": "hadith_open", "hadithBracketClose": "hadith_close",
    "adhkarBracketOpen": "adhkar_open", "adhkarBracketClose": "adhkar_close",
    "showQuranSource": "show_quote_refs",
}

HTML_PAGE = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
body {{ font-family: 'Amiri', 'Tajawal', serif; max-width: 860px; margin: 0 auto; padding: 2.5rem 1.5rem;
  line-height: 2; color: #1f2937; background: #fffdf8; }}
.tafrigh-heading {{ color: #0f4c5c; font-weight: 700; margin: 2rem 0 .85rem; }}
.tafrigh-paragraph {{ margin: .75rem 0; text-align: justify; }}
.tafrigh-list-intro {{ font-weight: 600; margin-top: 1rem; }}
.tafrigh-list-item {{ margin: .35rem 1.5rem; }}
.tafrigh-matn-block {{ border-right: 4px solid #b7791f; background: #fef3c7; padding: .85rem 1.25rem; margin: 1.25rem 0; }}
.tafrigh-comment {{ border: 1px dashed #94a3b8; padding: .6rem .85rem; margin: .85rem 0; color: #64748b; }}
.tafrigh-quote {{ color: #0f4c5c; }}
.tafrigh-ref {{ color: #64748b; font-size: .85em; }}
</style>
</head>
<body>
{body}
</body>
</html>
"""


class TafrighService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        jobs: JobRunner,
        ai: AiLayer,
        lectures: LectureService,
        detection: DetectionService,
        *,
        style: Callable[[], Any] | None = None,
    ):
        self.db, self.settings, self.jobs, self.ai = db, settings, jobs, ai
        self.lectures, self.detection = lectures, detection
        self.style = style
        self.store = RunStore(settings.tafrigh_runs_dir)
        self._stops: dict[str, threading.Event] = {}
        jobs.register("tafrigh", self.run_job)   # not resumable: see the module doc

    # ---- the input ----------------------------------------------------------------------------------------

    def _words(self, lecture_id: int) -> list[dict[str, Any]]:
        with self.db.session() as s:
            rows = s.execute(select(Word.text, Word.start, Word.end).where(Word.lecture_id == lecture_id)
                             .order_by(Word.idx)).all()
        return [{"word": t, "start": a, "end": b} for t, a, b in rows]

    def _source(self, lecture_id: int, req: TafrighSourceIn) -> dict[str, Any]:
        self.lectures.list_one(lecture_id)   # LectureNotFound
        words = self._words(lecture_id)
        if not words:
            raise NoSentences("this lecture has no words yet: transcribe it or add text first")
        found = self.detection.findings(lecture_id).findings
        findings = [{**f.data, "verdict": f.verdict.verdict if f.verdict else None} for f in found]
        src = build_source(words, findings, req.text_source)
        if req.use_detection_boundaries is not None and src["detection_spans"]:
            src["use_detection_boundaries"] = req.use_detection_boundaries
        src["_quote_count"] = len(quote_findings(words, findings)) if req.text_source != "raw" else 0
        src["_words"] = len(words)
        return src

    @staticmethod
    def _seg_config(cfg: TafrighSegConfigIn) -> SegmentationConfig:
        return SegmentationConfig(**cfg.model_dump())

    def _segments(self, src: dict[str, Any], cfg: TafrighSegConfigIn) -> list[TranscriptSegment]:
        segs = segment_transcript(
            raw_text=src["raw_text"], asr_words=src["asr_words"], detection_spans=src["detection_spans"],
            use_detection_boundaries=src["use_detection_boundaries"], config=self._seg_config(cfg))
        if not segs:
            raise NoSentences("the text has no sentences")
        return segs

    def preview(self, lecture_id: int, req: TafrighPreviewRequest) -> dict[str, Any]:
        """The exact sentences a run would classify (same segmenter, same settings), with statistics (F-106)."""
        src = self._source(lecture_id, req)
        segs = self._segments(src, req.seg_config)
        rows, kinds = [], {}
        for k, sg in enumerate(segs):
            qk = sorted({str(d.get("type") or "") for d in sg.detection_signals if d.get("type")})
            for t in qk:
                kinds[t] = kinds.get(t, 0) + 1
            rows.append({
                "index": k, "id": sg.id, "text": sg.original_text.strip(),
                "words": len(sg.original_text.split()),
                "start_time": sg.source_pos.start_time, "end_time": sg.source_pos.end_time,
                "cut_reason": sg.cut_reason, "has_detection": bool(sg.detection_signals), "quote_kinds": qk,
            })
        counts = sorted(r["words"] for r in rows)
        reasons: dict[str, int] = {}
        for r in rows:
            key = r["cut_reason"] or "end"
            reasons[key] = reasons.get(key, 0) + 1
        durs = [r["end_time"] - r["start_time"] for r in rows
                if r["start_time"] is not None and r["end_time"] is not None]
        cap = req.seg_config.max_words
        stats = {
            "sentences": len(rows), "words_total": sum(counts), "min_words": counts[0], "max_words": counts[-1],
            "avg_words": round(sum(counts) / len(rows), 1), "median_words": int(statistics.median_low(counts)),
            "over_cap": sum(1 for c in counts if cap and c > cap),
            "avg_duration_sec": round(sum(durs) / len(durs), 1) if durs else None,
            "cut_reasons": reasons, "quote_sentences": sum(1 for r in rows if r["has_detection"]),
            "has_timestamps": any(r["start_time"] is not None for r in rows),
        }
        return {"sentences": rows, "stats": stats, "seg_config": req.seg_config.model_dump(),
                "text_source": req.text_source, "quotes": kinds, "words": src["_words"]}

    @staticmethod
    def _range(req: TafrighRunRequest, total: int) -> tuple[int, int]:
        if req.target_range:
            a, b = req.target_range
        elif req.first_n:
            a, b = 0, req.first_n
        else:
            a, b = 0, total
        a, b = max(0, min(total, a)), max(0, min(total, b))
        if b <= a:
            raise TafrighError(f"the sentence range {a}–{b} is empty (the text has {total} sentences)")
        return a, b

    def estimate(self, lecture_id: int, req: TafrighRunRequest) -> TafrighEstimate:
        """Requests and tokens of the run, for every mode, without calling a model (F-114)."""
        segs = self._segments(self._source(lecture_id, req), req.seg_config)
        a, b = self._range(req, len(segs))
        each = 1 if req.jev_execution_order == "combined" else (2 if req.jev_execution_order == "sequential" else 3)
        est = estimate_run(segs, a, b, window_size=req.window_size, jev_requests_per_sentence=each)
        price = None
        model = self._chat_model(req)
        if model:
            info = self.ai.catalog.cached(model)
            if info:
                price = TafrighPriceOut(model=info.id, prompt_per_token=info.prompt_price,
                                 completion_per_token=info.completion_price)
        return TafrighEstimate(**est, price=price)

    def models(self) -> TafrighGeminiModels:
        """The Gemini models this key can really call, so the app never offers a name that 404s."""
        names = self.ai.gemini.list_models()
        return TafrighGeminiModels(models=sorted(names), recommended=pick_model(names))

    # ---- starting a run ------------------------------------------------------------------------------------

    def _chat_model(self, req: TafrighRunRequest) -> str | None:
        if req.model_candidate == "openrouter_chat" and req.openrouter_chat_model:
            return normalize_model_id(req.openrouter_chat_model)
        if req.model_candidate == "jev_hybrid":
            return req.jev_model or DEFAULT_JEV_MODEL
        return None

    def start(self, lecture_id: int, req: TafrighRunRequest) -> JobSnapshot:
        self.lectures.list_one(lecture_id)   # LectureNotFound
        key = self.settings.key
        if req.model_candidate == "openrouter_chat":
            if not key("openrouter"):
                raise TafrighError("set the OpenRouter API key in the settings to use OpenRouter chat models")
            if not (req.openrouter_chat_model or "").strip():
                raise TafrighError("choose an OpenRouter chat model first (for example google/gemini-2.5-flash)")
        if req.model_candidate == "jev_hybrid" and not (key("jev") or key("openrouter")):
            raise TafrighError("set the OpenRouter (JEV) API key in the settings to use the JEV classifier")
        if req.model_candidate == "laya_hybrid" and not self.ai.ready()["laya"]:
            raise TafrighError("local Laya is not installed (uv sync --extra laya)")
        segs = self._segments(self._source(lecture_id, req), req.seg_config)
        self._range(req, len(segs))          # an empty range is refused now, not after the job has started
        job = self.jobs.submit("tafrigh", {"request": req.model_dump(mode="json")}, lecture_id=lecture_id)
        self._stops[job.id] = threading.Event()
        return job

    def stop(self, job_id: str) -> JobSnapshot:
        """Stop now and keep the sentences that are finished (a paused job is woken up first)."""
        event = self._stops.get(job_id)
        snap = self.jobs.get(job_id)
        if event is None:
            return snap
        event.set()
        return self.jobs.resume(job_id) if snap.status in ("paused", "pausing") else snap

    # ---- the job ---------------------------------------------------------------------------------------------

    def _adapters(self, req: TafrighRunRequest, call: Call) -> dict[str, Any]:
        key = self.settings.key
        route = req.gemini_route
        if route == "auto":
            route = "openrouter" if key("openrouter") else "gemini"
        route = "openrouter" if route == "openrouter" else "gemini"
        or_model = (req.openrouter_gemini_model or "").strip()
        if not or_model and req.model_name.startswith("gemini"):
            or_model = f"google/{req.model_name}"
        model_name = req.model_name if req.model_name.startswith("gemini") else "auto"
        if req.model_candidate == "openrouter_chat":   # any OpenRouter chat model does the whole job
            route, or_model = "openrouter", (req.openrouter_chat_model or "").strip()
        jev_cfg = JEVRequestConfig(jev_layout=req.jev_layout, execution_order=req.jev_execution_order)
        return {
            "gemini": GeminiAdapter(self.ai, call, model_name=model_name, typo_strategy=req.typo_strategy,
                                    route=route, openrouter_model=or_model or None,
                                    disable_thinking=req.disable_thinking),
            "jev": JEVAdapter(self.ai, call, config=jev_cfg, model=req.jev_model or DEFAULT_JEV_MODEL),
            "laya": LayaAdapter(self.ai, call, config=jev_cfg),
        }

    def _render_config(self) -> RenderConfig:
        style = self.style().model_dump() if self.style else {}
        return RenderConfig(**{STYLE_TO_RENDER[k]: v for k, v in style.items() if k in STYLE_TO_RENDER})

    def run_job(self, ctx: JobContext) -> dict[str, Any]:
        req = TafrighRunRequest.model_validate(ctx.params["request"])
        lecture_id = ctx.lecture_id
        stop = self._stops.setdefault(ctx.job_id, threading.Event())
        try:
            return self._run(ctx, req, lecture_id, stop)
        finally:
            self._stops.pop(ctx.job_id, None)

    def _run(self, ctx: JobContext, req: TafrighRunRequest, lecture_id: int | None, stop: threading.Event
             ) -> dict[str, Any]:
        assert lecture_id is not None

        def check() -> None:
            ctx.check()
            if stop.is_set():
                raise TafrighStop()

        def control() -> str:
            ctx.check()
            return "stop" if stop.is_set() else "run"

        ctx.progress(stage="prepare", message="جاري تقطيع النص ومطابقة المتن...", percent=0, done=0, total=0)
        src = self._source(lecture_id, req)
        candidate = "gemini_all" if req.model_candidate == "openrouter_chat" else req.model_candidate
        pcfg = PipelineConfig(
            processing_mode=req.processing_mode, model_candidate=candidate, jev_layout=req.jev_layout,
            jev_execution_order=req.jev_execution_order, typo_strategy=req.typo_strategy,
            use_detection_boundaries=src["use_detection_boundaries"], window_size=req.window_size)
        matn = MatnConfig(mode=req.matn.mode, matn_id=req.matn.matn_id, raw_matn_text=req.matn.raw_matn_text,
                          matn_dir=str(self.settings.data_dir / "matns"))
        call = Call(purpose="tafrigh", job_id=ctx.job_id, lecture_id=lecture_id, check=check)
        pipeline = TafrighPipeline(pipeline_config=pcfg, matn_config=matn, adapters=self._adapters(req, call))
        pipeline.segmentation_config = self._seg_config(req.seg_config)
        pipeline.control = control
        last = {"pct": 0.0}

        def on_progress(done: int, total: int, msg: str, info: dict[str, Any] | None = None) -> None:
            last["pct"] = max(last["pct"], min(99.0, 100.0 * done / max(1, total)))
            ctx.progress(**{"done": done, "total": total, **(info or {}), "stage": "tafrigh", "message": msg,
                            "percent": round(last["pct"], 1)})

        pipeline.on_progress = on_progress
        segs = self._segments(src, req.seg_config)
        rng = self._range(req, len(segs))
        try:
            result = pipeline.run(initial_segments=segs, target_range=rng)
        except TafrighModelError as exc:
            raise TafrighError(str(exc)) from exc

        if not result.segments:
            return {"run_id": None, "discarded": True, "message": "لم تكتمل أي جملة قبل الإيقاف"}

        manifest = result.run_manifest
        run_id = manifest["run_id"]
        manifest.update(lecture_id=lecture_id, text_source=req.text_source, seg_config=req.seg_config.model_dump(),
                        matn_mode=req.matn.mode)
        folder = self.store.path(run_id)
        logger = RunLogger(lecture_slug=f"lecture-{lecture_id}", label=req.name or "run", run_dir=folder)
        for r in result.request_logs:
            logger.log_request(r)
        run_outline_repair_pass(result.segments, result.outline_state)
        report = logger.finalize_run(manifest, result.segments)
        warnings = self._warnings(manifest, result)
        manifest["warnings"] = warnings
        session = RunSession(
            run_id=run_id, dir=folder, segments=result.segments, outline_state=result.outline_state,
            lecture_spans=result.lecture_spans, manifest=manifest, render_cfg=self._render_config(),
            meta={"lecture_id": lecture_id, "name": req.name or f"تفريغ {now_iso()[:16].replace('T', ' ')}",
                  "created_at": now_iso(), "copied_from": None, "job_id": ctx.job_id})
        self.store.save(session)
        ctx.progress(stage="done", message="اكتمل التفريغ الذكي", percent=100)
        return {"run_id": run_id, "stopped": bool(manifest.get("cancelled")), "sentences": len(result.segments),
                "cost_usd": manifest.get("total_cost_usd", 0.0), "warnings": warnings,
                "total_cost_usd": report.get("total_cost_usd")}

    @staticmethod
    def _warnings(manifest: dict[str, Any], result: Any) -> list[str]:
        out = []
        if manifest.get("adapter_mode") == "offline_heuristic":
            out.append("لم يُدخل مفتاح Gemini: تم التصنيف بقواعد نصية بسيطة وليس بنموذج ذكاء اصطناعي. "
                       "أدخل المفتاح في الإعدادات للحصول على نتائج حقيقية.")
        if manifest.get("cancelled"):
            out.append(f"تم إيقاف التفريغ بطلب منك بعد معالجة {len(result.segments)} جملة؛ "
                       "المعروض هو ما اكتمل فقط.")
        errs = sum(1 for r in result.request_logs if r.get("error"))
        if errs:
            out.append(f"فشل {errs} طلب إلى النموذج وتم تعليم الجمل المتأثرة للمراجعة.")
        return out

    # ---- saved runs ------------------------------------------------------------------------------------------

    def _session(self, run_id: str) -> RunSession:
        return self.store.load(run_id)

    def runs(self, lecture_id: int | None = None) -> list[TafrighRunSummary]:
        return [TafrighRunSummary.model_validate(r) for r in self.store.list(lecture_id)]

    def detail(self, run_id: str) -> TafrighRunDetail:
        return self._detail(self._session(run_id))

    def _detail(self, s: RunSession) -> TafrighRunDetail:
        with s.lock:
            report: dict[str, Any] = {}
            try:
                report = json.loads((s.dir / "report.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
            headings = self._headings(s)
            structured = render_to_structured_json(s.segments, s.outline_state, s.lecture_spans, s.render_cfg)
            structured["headings"] = [h.model_dump() for h in headings]
            return TafrighRunDetail(
                run=TafrighRunSummary.model_validate(s.summary()),
                markdown=render_to_markdown(s.segments, s.outline_state, s.render_cfg),
                html=render_to_html(s.segments, s.outline_state, s.render_cfg),
                structured_json=structured,
                outline=[TafrighOutlineEntry(segment_id=h.segment_id, level=h.level, title=h.title_text,
                                      parent_id=h.parent_id) for h in headings],
                review_items=s.manager.get_items(), report=report, manifest=s.manifest,
                warnings=list(s.manifest.get("warnings") or []))

    @staticmethod
    def _headings(s: RunSession) -> list[HeadingEntry]:
        """The outline as the sentences are labelled now: a review that makes a sentence a heading (or takes the
        label away) changes it, which the outline state saved at the end of the run does not know."""
        return [HeadingEntry(segment_id=x.id, level=x.final_decision.level or 1, title_text=x.active_text.strip(),
                             parent_id=x.final_decision.parent_id)
                for x in s.segments if x.final_decision and x.final_decision.tag == StructuralTag.HEADING]

    def rename(self, run_id: str, name: str) -> TafrighRunSummary:
        s = self._session(run_id)
        with s.lock:
            s.meta["name"] = name
            self.store.save(s)
            return TafrighRunSummary.model_validate(s.summary())

    def delete(self, run_id: str) -> None:
        self.store.delete(run_id)

    def clone(self, run_id: str, name: str | None = None) -> TafrighRunSummary:
        copy = self.store.clone(self._session(run_id), name=name)
        return TafrighRunSummary.model_validate(copy.summary())

    def review(self, run_id: str, body: TafrighReviewIn) -> TafrighRunDetail:
        """A human decision on one sentence, saved at once; the renders are redone with no model call."""
        s = self._session(run_id)
        with s.lock:
            if body.segment_id not in s.manager.segments_by_id:
                raise SegmentNotFound(body.segment_id)
            if body.action == "confirm":
                s.manager.confirm_decision(body.segment_id, reviewer_id=body.reviewer_id, note=body.note)
            elif body.action == "correct":
                s.manager.correct_decision(
                    segment_id=body.segment_id, corrected_tag=body.corrected_tag,
                    corrected_level=body.corrected_level, corrected_parent=body.corrected_parent,
                    corrected_comment_kind=body.corrected_comment_kind, corrected_text=body.corrected_text,
                    reviewer_id=body.reviewer_id, note=body.note)
            else:
                s.manager.reject_decision(body.segment_id, reviewer_id=body.reviewer_id, note=body.note)
            self.store.save(s)
            return self._detail(s)

    def export(self, run_id: str, fmt: str) -> TafrighExportedFile:
        s = self._session(run_id)
        name = re.sub(r"[^\w\-. ]+", "_", s.meta.get("name") or s.run_id).strip() or s.run_id
        with s.lock:
            if fmt == "md":
                return TafrighExportedFile(filename=f"{name}.md", mime="text/markdown",
                                    content=render_to_markdown(s.segments, s.outline_state, s.render_cfg))
            if fmt == "html":
                body = render_to_html(s.segments, s.outline_state, s.render_cfg)
                title = html_lib.escape(s.meta.get("name") or "التفريغ المهيكل")
                return TafrighExportedFile(filename=f"{name}.html", mime="text/html",
                                    content=HTML_PAGE.format(title=title, body=body))
            data = render_to_structured_json(s.segments, s.outline_state, s.lecture_spans, s.render_cfg)
            return TafrighExportedFile(filename=f"{name}.json", mime="application/json",
                                content=json.dumps(data, ensure_ascii=False, indent=2, default=str))

    def compare(self, run_ids: list[str]) -> TafrighCompareOut:
        """Saved runs side by side: settings, cost, and the sentences that get different labels (F-122). It
        compares the labels as they are now, review corrections included."""
        sessions = [self._session(r) for r in run_ids]
        runs = []
        for s in sessions:
            with s.lock:
                try:
                        report = json.loads((s.dir / "report.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    report = {}
                runs.append({"dir_name": s.meta.get("name") or s.run_id, "manifest": s.manifest, "report": report,
                             "results": [result_row(x) for x in s.segments]})
        rows = []
        for s, r in zip(sessions, runs, strict=True):
            m, rep = s.manifest, r["report"]
            tags: dict[str, int] = {}
            for x in s.segments:
                if x.final_decision:
                    tags[x.final_decision.tag.value] = tags.get(x.final_decision.tag.value, 0) + 1
            rows.append(TafrighCompareRun(
                run_id=s.run_id, name=r["dir_name"], model_candidate=m.get("model_candidate"),
                processing_mode=m.get("processing_mode"), jev_layout=m.get("jev_layout"),
                typo_strategy=m.get("typo_strategy"), num_segments=len(s.segments),
                wall_clock_seconds=m.get("wall_clock_seconds"), total_cost_usd=m.get("total_cost_usd", 0.0),
                cost_per_100_sentences_usd=rep.get("cost_per_100_sentences_usd", 0.0),
                requests_sent=m.get("requests_sent", 0), failure_rate=rep.get("failure_rate", 0.0),
                fallback_rate=rep.get("fallback_rate", 0.0), tag_distribution=tags))
        comps = []
        for other, s in zip(runs[1:], sessions[1:], strict=True):
            diffs = segment_disagreements(runs[0], other)
            comps.append(TafrighComparison(a=sessions[0].run_id, b=s.run_id, count=len(diffs),
                                    disagreements=[TafrighDisagreement(**d) for d in diffs]))
        return TafrighCompareOut(runs=rows, comparisons=comps, markdown=compare_run_data(runs))


class SegmentNotFound(KeyError):
    pass

