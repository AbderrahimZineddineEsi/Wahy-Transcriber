"""
Multi-Run Comparison CLI & Disagreement Diff Tool for Wahy-Transcriber.
Compares performance, latency, cost, and per-segment decisions across multiple runs.
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def load_run_data(run_dir_path: Path) -> Optional[Dict[str, Any]]:
    """Loads manifest.json, report.json, and results.jsonl from a run directory."""
    manifest_file = run_dir_path / "manifest.json"
    report_file = run_dir_path / "report.json"
    results_file = run_dir_path / "results.jsonl"

    if not manifest_file.exists() or not report_file.exists():
        return None

    try:
        with open(manifest_file, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        with open(report_file, "r", encoding="utf-8") as f:
            report = json.load(f)

        results = []
        if results_file.exists():
            with open(results_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        results.append(json.loads(line))

        return {
            "dir_name": run_dir_path.name,
            "manifest": manifest,
            "report": report,
            "results": results,
        }
    except Exception:
        return None



def generate_comparison_table(runs: List[Dict[str, Any]]) -> str:
    """Generates a side-by-side Markdown comparison table."""
    headers = [
        "Metric / Configuration",
    ] + [r["dir_name"] for r in runs]

    rows = [
        ["Model Candidate"] + [r["manifest"].get("model_candidate", "unknown") for r in runs],
        ["Processing Mode"] + [r["manifest"].get("processing_mode", "unknown") for r in runs],
        ["JEV Layout"] + [r["manifest"].get("jev_layout", "N/A") for r in runs],
        ["Total Sentences"] + [str(r["manifest"].get("num_segments", len(r["results"]))) for r in runs],
        ["Wall-Clock Time (s)"] + [str(r["report"].get("wall_clock_seconds", 0.0)) for r in runs],
        ["Total Cost ($)"] + [f"${r['report'].get('total_cost_usd', 0.0):.6f}" for r in runs],
        ["Cost per 100 Sentences ($)"] + [f"${r['report'].get('cost_per_100_sentences_usd', 0.0):.4f}" for r in runs],
        ["Fallback Rate"] + [f"{r['report'].get('fallback_rate', 0.0) * 100:.1f}%" for r in runs],
        ["Failure Rate"] + [f"{r['report'].get('failure_rate', 0.0) * 100:.1f}%" for r in runs],
    ]

    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join([":---"] + [":---:" for _ in runs]) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines)


def generate_per_segment_disagreements(run_a: Dict[str, Any], run_b: Dict[str, Any]) -> str:
    """Computes and formats per-segment disagreements between two runs."""
    results_a = {r["segment_id"]: r for r in run_a["results"]}
    results_b = {r["segment_id"]: r for r in run_b["results"]}

    all_ids = sorted(set(results_a.keys()).union(results_b.keys()))
    disagreements = []

    for sid in all_ids:
        ra = results_a.get(sid)
        rb = results_b.get(sid)
        if not ra or not rb:
            disagreements.append({
                "segment_id": sid,
                "text": (ra or rb).get("original_text", "")[:40],
                "diff_type": "MISSING_SEGMENT",
                "run_a": "Present" if ra else "Missing",
                "run_b": "Present" if rb else "Missing",
            })
            continue

        tag_a = (ra.get("final_decision") or {}).get("tag")
        tag_b = (rb.get("final_decision") or {}).get("tag")

        level_a = (ra.get("final_decision") or {}).get("level")
        level_b = (rb.get("final_decision") or {}).get("level")

        typo_a = ra.get("hasTypo", False)
        typo_b = rb.get("hasTypo", False)

        diffs = []
        if tag_a != tag_b:
            diffs.append(f"tag: '{tag_a}' vs '{tag_b}'")
        if level_a != level_b:
            diffs.append(f"level: {level_a} vs {level_b}")
        if typo_a != typo_b:
            diffs.append(f"typo: {typo_a} vs {typo_b}")

        if diffs:
            disagreements.append({
                "segment_id": sid,
                "text": ra.get("original_text", "")[:40] + ("..." if len(ra.get("original_text", "")) > 40 else ""),
                "diff_type": ", ".join(diffs),
                "run_a": f"{tag_a} (L{level_a})" if level_a else str(tag_a),
                "run_b": f"{tag_b} (L{level_b})" if level_b else str(tag_b),
            })

    if not disagreements:
        return "\n### Per-Segment Disagreements\n*Zero disagreements found across all segments!*\n"

    lines = [
        f"\n### Per-Segment Disagreements ({run_a['dir_name']} vs {run_b['dir_name']})",
        f"Total Disagreements: {len(disagreements)}",
        "",
        "| Segment ID | Text Preview | Difference | Run A Decision | Run B Decision |",
        "| :--- | :--- | :--- | :--- | :--- |",
    ]
    for d in disagreements[:50]:  # Cap at 50 for readability
        lines.append(f"| `{d['segment_id']}` | {d['text']} | {d['diff_type']} | {d['run_a']} | {d['run_b']} |")

    return "\n".join(lines)


def compare_run_dirs(run_paths: List[Path], output_md_path: Optional[Path] = None) -> str:
    """Compares multiple run directories and returns the markdown report."""
    raw_runs = [load_run_data(p) for p in run_paths]
    runs = [r for r in raw_runs if r is not None]
    if not runs:
        return "No complete runs found to compare."


    md_sections = [
        "# Tafrigh Multi-Run Comparison Report",
        "",
        "## Configuration & Aggregate Performance",
        generate_comparison_table(runs),
    ]

    # Compare first two runs for per-segment diff if >= 2 runs
    if len(runs) >= 2:
        md_sections.append(generate_per_segment_disagreements(runs[0], runs[1]))

    full_md = "\n\n".join(md_sections) + "\n"

    if output_md_path:
        with open(output_md_path, "w", encoding="utf-8") as f:
            f.write(full_md)

    return full_md


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Wahy-Transcriber Tafrigh runs.")
    parser.add_argument("runs", nargs="+", help="Paths to run directories (or glob patterns)")
    parser.add_argument("--output", "-o", default=None, help="Output markdown file path")

    args = parser.parse_args()

    expanded_paths: List[Path] = []
    for r in args.runs:
        matches = glob.glob(r)
        if matches:
            expanded_paths.extend([Path(m) for m in matches if Path(m).is_dir()])
        elif Path(r).is_dir():
            expanded_paths.append(Path(r))

    if not expanded_paths:
        print("Error: No valid run directories found.", file=sys.stderr)
        sys.exit(1)

    out_p = Path(args.output) if args.output else None
    report_md = compare_run_dirs(expanded_paths, out_p)
    print(report_md)


if __name__ == "__main__":
    main()
