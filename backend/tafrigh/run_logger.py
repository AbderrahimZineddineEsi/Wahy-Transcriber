"""
Run Logger for Wahy-Transcriber AI Tafrigh Phase.
Creates immutable run directories under runs/ and writes:
- manifest.json
- requests.jsonl
- results.jsonl
- report.json & report.md
"""

from __future__ import annotations

import json
import math
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import TranscriptSegment


def compute_percentiles(values: List[float]) -> Dict[str, float]:
    """Computes p50, p95, and max for a list of floats."""
    if not values:
        return {"p50": 0.0, "p95": 0.0, "max": 0.0}
    s = sorted(values)
    n = len(s)
    p50_idx = min(n - 1, max(0, int(0.50 * n)))
    p95_idx = min(n - 1, max(0, int(0.95 * n)))
    return {
        "p50": round(s[p50_idx], 2),
        "p95": round(s[p95_idx], 2),
        "max": round(s[-1], 2),
    }


class RunLogger:
    """Manages per-run artifacts and metrics calculation."""

    def __init__(
        self,
        lecture_slug: str = "lecture",
        label: str = "default",
        base_runs_dir: Optional[str] = None,
    ) -> None:
        self.lecture_slug = lecture_slug
        self.label = label
        self.base_dir = Path(base_runs_dir or "runs")
        self.base_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        dir_name = f"{timestamp}_{lecture_slug}_{label}"
        self.run_dir = self.base_dir / dir_name
        if self.run_dir.exists():
            self.run_dir = self.base_dir / f"{dir_name}_{uuid.uuid4().hex[:6]}"
        self.run_dir.mkdir(parents=True, exist_ok=True)

        self.requests_log_file = self.run_dir / "requests.jsonl"
        self.results_log_file = self.run_dir / "results.jsonl"
        self.manifest_file = self.run_dir / "manifest.json"
        self.report_json_file = self.run_dir / "report.json"
        self.report_md_file = self.run_dir / "report.md"

        self.requests: List[Dict[str, Any]] = []

    def log_request(self, record: Dict[str, Any]) -> None:
        """Appends one request record to requests.jsonl."""
        self.requests.append(record)
        with open(self.requests_log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def finalize_run(
        self,
        manifest: Dict[str, Any],
        segments: List[TranscriptSegment],
        gold_metrics: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Finalizes run by writing results.jsonl, manifest.json, and computing report."""
        # 1. Write manifest
        manifest["run_dir"] = str(self.run_dir)
        manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
        with open(self.manifest_file, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        # 2. Write results.jsonl
        with open(self.results_log_file, "w", encoding="utf-8") as f:
            for s in segments:
                item = {
                    "segment_id": s.id,
                    "parent_segment_id": s.parent_segment_id,
                    "original_text": s.original_text,
                    "active_text": s.active_text,
                    "source_pos": s.source_pos.model_dump(),
                    "proposed_decision": s.proposed_decision.model_dump() if s.proposed_decision else None,
                    "final_decision": s.final_decision.model_dump() if s.final_decision else None,
                    "hasTypo": bool(s.versions),
                    "edits": [ed.model_dump() for ed in s.versions[-1].edits] if s.versions else [],
                    "review_flags": s.review_flags,
                    "matn_match": s.matn_evidence.model_dump() if s.matn_evidence else None,
                    "cut_reason": s.cut_reason,
                    "detections": s.detection_signals,
                    "trace": s.trace,
                }
                f.write(json.dumps(item, ensure_ascii=False) + "\n")

        # 3. Compute Metrics
        total_requests = len(self.requests)
        total_input_tokens = sum(r.get("input_tokens", 0) for r in self.requests)
        total_output_tokens = sum(r.get("output_tokens", 0) for r in self.requests)
        total_cached_tokens = sum(r.get("cached_tokens", 0) for r in self.requests)
        total_cost = sum(r.get("cost_estimate_usd", 0.0) for r in self.requests)
        wall_clock = manifest.get("wall_clock_seconds", 0.0)

        latencies_by_purpose: Dict[str, List[float]] = {}
        for r in self.requests:
            purp = r.get("purpose", "general")
            lat = float(r.get("latency_ms", 0.0))
            latencies_by_purpose.setdefault(purp, []).append(lat)

        latency_metrics = {
            purp: compute_percentiles(lats) for purp, lats in latencies_by_purpose.items()
        }

        num_sentences = max(1, len(segments))
        cost_per_100 = round((total_cost / num_sentences) * 100, 4)
        time_per_100 = round((wall_clock / num_sentences) * 100, 2)

        # Failure & Fallback Rates
        fallback_count = sum(1 for r in self.requests if r.get("fallback_triggered"))
        retry_count = sum(r.get("retries", 0) for r in self.requests)
        error_count = sum(1 for r in self.requests if r.get("errors"))

        fallback_rate = round(fallback_count / max(1, total_requests), 4)
        retry_rate = round(retry_count / max(1, total_requests), 4)
        failure_rate = round(error_count / max(1, total_requests), 4)

        # Review Flags Distribution
        flag_counts: Dict[str, int] = {}
        tag_counts: Dict[str, int] = {}
        for s in segments:
            for flg in s.review_flags:
                flag_counts[flg] = flag_counts.get(flg, 0) + 1
            if s.final_decision:
                t_val = s.final_decision.tag.value
                tag_counts[t_val] = tag_counts.get(t_val, 0) + 1

        report_data = {
            "run_id": manifest.get("run_id"),
            "lecture_slug": self.lecture_slug,
            "label": self.label,
            "total_requests": total_requests,
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_cached_tokens": total_cached_tokens,
            "total_cost_usd": round(total_cost, 6),
            "wall_clock_seconds": wall_clock,
            "cost_per_100_sentences_usd": cost_per_100,
            "time_per_100_sentences_sec": time_per_100,
            "failure_rate": failure_rate,
            "retry_rate": retry_rate,
            "fallback_rate": fallback_rate,
            "latency_by_purpose_ms": latency_metrics,
            "structural_tag_distribution": tag_counts,
            "review_flag_counts": flag_counts,
            "evaluation_metrics": gold_metrics,
        }

        # Write report.json
        with open(self.report_json_file, "w", encoding="utf-8") as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)

        # Write report.md
        md_text = self._generate_markdown_report(report_data, manifest)
        with open(self.report_md_file, "w", encoding="utf-8") as f:
            f.write(md_text)

        return report_data

    def _generate_markdown_report(self, report: Dict[str, Any], manifest: Dict[str, Any]) -> str:
        lines = [
            f"# Tafrigh Run Report: {report['lecture_slug']} ({report['label']})",
            "",
            f"- **Run ID:** `{report['run_id']}`",
            f"- **Processing Mode:** `{manifest.get('processing_mode')}`",
            f"- **Model Candidate:** `{manifest.get('model_candidate')}`",
            f"- **Segments Count:** {manifest.get('num_segments')}",
            f"- **Wall Clock Time:** {report['wall_clock_seconds']}s",
            f"- **Total Cost:** ${report['total_cost_usd']:.6f}",
            f"- **Cost per 100 Sentences:** ${report['cost_per_100_sentences_usd']:.4f}",
            "",
            "## Latency Breakdown (ms)",
            "| Purpose | p50 | p95 | Max |",
            "| :--- | :--- | :--- | :--- |",
        ]
        for purp, lats in report["latency_by_purpose_ms"].items():
            lines.append(f"| {purp} | {lats['p50']} | {lats['p95']} | {lats['max']} |")

        lines.extend([
            "",
            "## Tag Distribution",
            "| Structural Tag | Count |",
            "| :--- | :--- |",
        ])
        for tag, count in report["structural_tag_distribution"].items():
            lines.append(f"| {tag} | {count} |")

        lines.extend([
            "",
            "## Review Flags Summary",
            "| Flag | Count |",
            "| :--- | :--- |",
        ])
        for flg, count in report["review_flag_counts"].items():
            lines.append(f"| {flg} | {count} |")

        return "\n".join(lines) + "\n"
