"""Telemetry: reading the AI request log that core/ai writes (ADR 0004), for the request log screen (F-095)
and
the request inspector (F-096).

    telemetry = TelemetryService(db)
    telemetry.requests(lecture_id=3, limit=50)    # newest first, with the findings each request judged
    telemetry.request(812)                        # one request with its exact payloads
    telemetry.clear(lecture_id=3)                 # forget a lecture's requests (verdicts keep, unlinked)
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import delete, func, select

from wahy.core.ai.models import AiRequest
from wahy.core.db import Database
from wahy.features.detection.models import Finding
from wahy.features.telemetry.schemas import (
    HumanVerdict,
    RequestDetail,
    RequestFinding,
    RequestPage,
    RequestRow,
)
from wahy.features.verification.models import Verdict


class RequestNotFound(KeyError):
    pass


class TelemetryService:
    def __init__(self, db: Database):
        self.db = db

    @staticmethod
    def _filters(
        q: Any,
        *,
        lecture_id: int | None,
        job_id: str | None,
        provider: str | None,
        purpose: str | None,
        ok: bool | None,
    ) -> Any:
        if lecture_id is not None:
            q = q.where(AiRequest.lecture_id == lecture_id)
        if job_id is not None:
            q = q.where(AiRequest.job_id == job_id)
        if provider is not None:
            q = q.where(AiRequest.provider == provider)
        if purpose is not None:
            q = q.where(AiRequest.purpose == purpose)
        if ok is not None:
            q = q.where(AiRequest.ok == ok)
        return q

    def requests(
        self,
        *,
        lecture_id: int | None = None,
        job_id: str | None = None,
        provider: str | None = None,
        purpose: str | None = None,
        ok: bool | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> RequestPage:
        """The request log, newest first."""
        where = {
            "lecture_id": lecture_id,
            "job_id": job_id,
            "provider": provider,
            "purpose": purpose,
            "ok": ok,
        }
        with self.db.session() as s:
            total, cost = s.execute(
                self._filters(
                    select(func.count(AiRequest.id), func.coalesce(func.sum(AiRequest.cost_usd), 0.0)),
                    **where,
                )
            ).one()
            rows = list(
                s.scalars(
                    self._filters(select(AiRequest), **where)
                    .order_by(AiRequest.id.desc())
                    .limit(limit)
                    .offset(offset)
                )
            )
            found = self._findings(s, rows)
            items = [self._row(r, found.get(r.id, [])) for r in rows]
        return RequestPage(total=total, total_cost_usd=round(float(cost), 9), items=items)

    def request(self, request_id: int) -> RequestDetail:
        with self.db.session() as s:
            r = s.get(AiRequest, request_id)
            if r is None:
                raise RequestNotFound(request_id)
            row = self._row(r, self._findings(s, [r]).get(r.id, []))
            return RequestDetail(**row.model_dump(), request=r.request, response=r.response)

    def clear(self, *, lecture_id: int | None = None) -> int:
        """Delete the requests (of one lecture, or all). The verdicts they produced stay, without the link."""
        with self.db.session() as s:
            q = delete(AiRequest)
            if lecture_id is not None:
                q = q.where(AiRequest.lecture_id == lecture_id)
            return s.execute(q).rowcount or 0

    # ---- helpers ------------------------------------------------------------------------------------------

    @staticmethod
    def _row(r: AiRequest, findings: list[RequestFinding]) -> RequestRow:
        return RequestRow(
            id=r.id,
            created_at=r.created_at,
            provider=r.provider,
            model=r.model,
            purpose=r.purpose,
            job_id=r.job_id,
            lecture_id=r.lecture_id,
            ok=r.ok,
            error=r.error,
            input_tokens=r.input_tokens,
            output_tokens=r.output_tokens,
            cost_usd=r.cost_usd,
            latency_ms=r.latency_ms,
            context_chars=len(json.dumps(r.request, ensure_ascii=False)) if r.request is not None else 0,
            findings=findings,
        )

    @staticmethod
    def _findings(s: Any, rows: list[AiRequest]) -> dict[int, list[RequestFinding]]:
        """request id → the findings it judged: the ones the request names (`finding_ids`), with the verdict
        each
        got from it, and the user's newest verdict on each."""
        ids = {fid for r in rows for fid in (r.finding_ids or [])}
        request_ids = [r.id for r in rows]
        verdicts = (
            list(s.scalars(select(Verdict).where(Verdict.ai_request_id.in_(request_ids)))) if rows else []
        )
        ids |= {v.finding_id for v in verdicts}
        if not ids:
            return {}
        findings = {f.id: f for f in s.scalars(select(Finding).where(Finding.id.in_(ids)))}
        newest_human = (
            select(func.max(Verdict.id))
            .where(Verdict.finding_id.in_(ids), Verdict.verifier == "human")
            .group_by(Verdict.finding_id)
        )
        human = {v.finding_id: v for v in s.scalars(select(Verdict).where(Verdict.id.in_(newest_human)))}
        by_request: dict[tuple[int, int], Verdict] = {(v.ai_request_id, v.finding_id): v for v in verdicts}
        out: dict[int, list[RequestFinding]] = {}
        for r in rows:
            names = list(r.finding_ids or [])
            names += [v.finding_id for v in verdicts if v.ai_request_id == r.id and v.finding_id not in names]
            items = []
            for fid in names:
                f, v, h = findings.get(fid), by_request.get((r.id, fid)), human.get(fid)
                items.append(
                    RequestFinding(
                        finding_id=fid,
                        display_ref=f.display_ref if f else None,
                        source_type=f.source_type if f else None,
                        verdict=v.verdict if v else None,
                        boundary=v.boundary if v else None,
                        confidence=v.confidence if v else None,
                        probabilities=(v.details or {}).get("probabilities") if v else None,
                        human=HumanVerdict(verdict=h.verdict, boundary=h.boundary) if h else None,
                    )
                )
            out[r.id] = items
        return out
