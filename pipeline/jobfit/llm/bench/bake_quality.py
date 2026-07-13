"""Bake a judged bench run into the TS quality-scores the Models tab reads.

Reads one or more bench output dirs (each a ``records.jsonl`` from bench_cli,
with ``--judge`` scores attached) and writes ``app/_lib/llm-quality-scores.ts`` —
the generated data behind `app/_lib/llm-quality.ts`. Aggregates each
(bench op × model) cell across the run's scenarios: median judge dimensions +
overall, majority structural validity, judged-scenario count, median latency.

Usage:
    python -m pipeline.jobfit.llm.bench.bake_quality tmp/l6-a tmp/l6-b tmp/l6-c
    # then commit app/_lib/llm-quality-scores.ts (do NOT hand-edit it)

Re-bake after every fresh matrix run; the TS is generated, not source of truth.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

# Repo root = five parents up from this file (pipeline/jobfit/llm/bench/bake_quality.py).
_ROOT = Path(__file__).resolve().parents[4]
_OUT = _ROOT / "app" / "_lib" / "llm-quality-scores.ts"

_DIMS = ("relevance", "correctness", "adherence")


def _load(dirs: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for d in dirs:
        path = Path(d)
        if not path.is_absolute():
            path = _ROOT / path
        recs = path / "records.jsonl"
        for line in recs.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _med_dim(records: list[dict[str, Any]], key: str) -> float | None:
    vals = [
        d[key]
        for r in records
        if isinstance((d := r.get("judge_detail")), dict) and isinstance(d.get(key), (int, float))
    ]
    return round(median(vals), 1) if vals else None


def _cell(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Aggregate one (op, model) group into a QualityCell, or None when the model
    produced no judged LLM output here (all attempts errored or fell back).

    Quality is measured from the model's REAL LLM output only — a deterministic
    fallback is the identical template for every model, so judging it would measure
    nothing about this model. Failed/fell-back attempts still count against
    ``llmRate`` (reliability), and latency uses LLM rows only so the near-instant
    fallback can't fake a fast p50."""
    served = [r for r in records if not r.get("error")]
    llm = [r for r in served if r.get("source") == "llm"]
    judged = [r for r in llm if r.get("judge_score") is not None]
    if not judged:
        return None
    scores = [r["judge_score"] for r in judged]
    # bug-ui-scan-2026-07-09 (llm-provider-layer-python #4): the overall judge_score
    # parsed fine, so the model genuinely ran and was judged — keep the cell. A
    # per-dimension median that is missing (the judge formatted that one dim
    # non-numerically, e.g. "8/10"/"high") is imputed from the overall median rather
    # than voiding the whole column, which used to make a real, working model look
    # like it produced nothing on the committed model-selection scorecard.
    score_med = round(median(scores), 1)
    dims = {k: (m if (m := _med_dim(judged, k)) is not None else score_med) for k in _DIMS}
    valids = [bool(r.get("valid")) for r in llm]
    p50s = [int(r.get("wall_ms") or 0) for r in llm]
    return {
        **dims,
        "score": score_med,
        "valid": (sum(valids) >= len(valids) / 2) if valids else False,
        "judges": len(judged),
        # Reliability over ALL attempts (errors + fallbacks in the denominator).
        "llmRate": round(len(llm) / len(records), 2) if records else 0.0,
        "p50Ms": int(median(p50s)) if p50s else 0,
    }


def bake(dirs: list[str], *, judge: str = "claude-cli") -> str:
    rows = _load(dirs)
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    models_seen: list[str] = []
    for r in rows:
        model = r["model"]
        if model not in models_seen:
            models_seen.append(model)
        groups[(r["use_case"], model)].append(r)

    cells: dict[str, dict[str, Any]] = defaultdict(dict)
    for (op, model), recs in groups.items():
        cell = _cell(recs)
        if cell is not None:
            cells[op][model] = cell

    # The source run's scenarios-per-cell (the confidence caveat), inferred as the
    # max served rows in any cell.
    limit = max((len(v) for v in groups.values()), default=0)

    payload = {
        "measuredAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "judge": judge,
        "limit": limit,
        "models": models_seen,
        # dict() to drop the defaultdict type; sorted ops for a stable diff.
        "cells": {op: cells[op] for op in sorted(cells)},
    }
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    return (
        "/** Measured LLM quality scores — the output of the Python bench matrix\n"
        " *  (`pipeline/jobfit/llm/bench`), judged by the Claude CLI, baked by\n"
        " *  `bake_quality.py`. GENERATED — re-bake, don't hand-edit. See\n"
        " *  docs/LLM_MODEL_MATRIX.md.\n"
        f" *  Baked from a run at {payload['measuredAt']}. */\n"
        'import type { QualityScores } from "./llm-quality";\n\n'
        f"export const QUALITY_SCORES: QualityScores = {body};\n\n"
        "/** True once a matrix run has been baked in (so the UI can hide the scorecard\n"
        " *  before any measurement exists). */\n"
        "export function hasQualityScores(): boolean {\n"
        "  return QUALITY_SCORES.models.length > 0 && Object.keys(QUALITY_SCORES.cells).length > 0;\n"
        "}\n"
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dirs", nargs="+", help="Bench output dirs (each with records.jsonl).")
    ap.add_argument("--judge", default="claude-cli", help="Judge engine label baked into the file.")
    args = ap.parse_args(argv)
    ts = bake(args.dirs, judge=args.judge)
    _OUT.write_text(ts, encoding="utf-8")
    print(f"wrote {_OUT.relative_to(_ROOT)} ({len(ts)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
