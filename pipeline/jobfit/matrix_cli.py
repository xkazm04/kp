"""Compute a candidate x position match-score matrix (deterministic, no LLM).

    python -m pipeline.jobfit.matrix_cli --profiles-json P [--job-ids id1,id2] [--jobs J]

Input  --profiles-json: JSON array of { "id", "label", "archetype", "payload": <CandidateProfileV2> }.
Output one JSON object: { candidates:[...], positions:[...], cells:[[ {score|null, blocked} ]] }.
Rows follow the input profile order; columns follow --job-ids order (else corpus order).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .matching import ko_filter, load_corpus, score_job
from .profile import CandidateProfileV2
from .transform import build_match_candidate


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Candidate x position fit matrix (no LLM).")
    parser.add_argument("--profiles-json", type=Path, required=True)
    parser.add_argument("--job-ids", default="")
    parser.add_argument("--jobs", type=Path, default=None)
    args = parser.parse_args(argv)

    try:
        profiles_raw = json.loads(args.profiles_json.read_text(encoding="utf-8"))
        corpus = load_corpus(args.jobs)

        if args.job_ids:
            wanted = [j.strip() for j in args.job_ids.split(",") if j.strip()]
            by_id = {j.id: j for j in corpus}
            jobs = [by_id[i] for i in wanted if i in by_id]  # preserve requested order
        else:
            jobs = corpus

        candidates: list[dict] = []
        cells: list[list[dict]] = []
        for pr in profiles_raw:
            try:
                cand = build_match_candidate(CandidateProfileV2.model_validate(pr["payload"]))
            except Exception:
                continue
            row = []
            for job in jobs:
                passed, _reasons = ko_filter(cand, job)
                if not passed:
                    row.append({"score": None, "blocked": True})
                else:
                    row.append({"score": score_job(cand, job).total, "blocked": False})
            candidates.append({"id": pr.get("id"), "label": pr.get("label"), "archetype": pr.get("archetype")})
            cells.append(row)

        positions = [
            {"id": j.id, "title": j.title, "seniority": j.seniority, "roleFamily": j.role_family, "salaryBand": list(j.salary_band or [])}
            for j in jobs
        ]
        print(json.dumps({"candidates": candidates, "positions": positions, "cells": cells}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
