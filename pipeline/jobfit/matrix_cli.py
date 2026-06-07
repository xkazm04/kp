"""Compute a candidate x position match-score matrix (deterministic, no LLM).

    python -m pipeline.jobfit.matrix_cli --profiles-json P [--job-ids id1,id2] [--jobs J] [--jobs-json O]

Input  --profiles-json: JSON array of { "id", "label", "archetype", "payload": <CandidateProfileV2> }.
       --jobs-json: optional JSON array of Job records used in addition to the corpus — lets
       newly-ingested DB jobs (absent from the static corpus) be scored. Mirrors recruiter_cli --job-json.
Output one JSON object:
  { candidates:[...], positions:[...], cells:[[ {score|null, blocked} ]],
    missing:[...], missingCandidates:[ {id, label, error} ] }.
Any requested --job-ids absent from both the corpus and --jobs-json land in `missing` (surfaced, not
silently dropped) so callers know which requested columns could not be produced. Symmetrically, any
profile whose CandidateProfileV2 fails to validate/transform lands in `missingCandidates` with its
id/label and the error, so a vanished row is explained — not swallowed — to the recruiter.
Rows follow the input profile order; columns follow --job-ids order (else corpus order).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ._cli import configure_stdio, emit_error
from .jobs import Job
from .matching import ko_filter, load_corpus, score_job
from .profile import CandidateProfileV2
from .transform import build_match_candidate


def main(argv: list[str] | None = None) -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(description="Candidate x position fit matrix (no LLM).")
    parser.add_argument("--profiles-json", type=Path, required=True)
    parser.add_argument("--job-ids", default="")
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument(
        "--jobs-json",
        type=Path,
        default=None,
        help="JSON array of Job records used in addition to the corpus — lets newly-ingested DB jobs (absent from the static corpus) be scored.",
    )
    args = parser.parse_args(argv)

    try:
        profiles_raw = json.loads(args.profiles_json.read_text(encoding="utf-8"))
        corpus = load_corpus(args.jobs)

        # Corpus, augmented by any inline Job overrides (e.g. freshly DB-ingested
        # jobs not yet in the static corpus). Overrides win on id collision, mirroring
        # recruiter_cli's --job-json escape hatch.
        by_id = {j.id: j for j in corpus}
        if args.jobs_json:
            for rec in json.loads(args.jobs_json.read_text(encoding="utf-8")):
                job = Job.model_validate(rec)
                by_id[job.id] = job

        missing: list[str] = []
        if args.job_ids:
            # Dedupe requested ids (first-occurrence order preserved): the grid keys
            # each column by id, so a repeated id ("id,id") would emit two identical
            # columns with duplicate React keys. Collapse it to one before scoring.
            seen: set[str] = set()
            wanted: list[str] = []
            for j in (s.strip() for s in args.job_ids.split(",")):
                if j and j not in seen:
                    seen.add(j)
                    wanted.append(j)
            jobs = [by_id[i] for i in wanted if i in by_id]  # preserve requested order
            missing = [i for i in wanted if i not in by_id]  # surfaced below, not silently dropped
        else:
            jobs = corpus

        candidates: list[dict] = []
        cells: list[list[dict]] = []
        # A profile that fails to validate/transform must not vanish from the grid
        # without a trace (success theater in a hiring tool). Record its id/label and
        # the error here — symmetric with `missing` positions — so the UI can flag it.
        missing_candidates: list[dict] = []
        for i, pr in enumerate(profiles_raw):
            if not isinstance(pr, dict):
                continue
            cid = pr.get("id") or f"profile-{i}"
            try:
                cand = build_match_candidate(CandidateProfileV2.model_validate(pr["payload"]))
            except Exception as exc:
                missing_candidates.append({"id": cid, "label": pr.get("label") or cid, "error": str(exc)})
                continue
            row = []
            for job in jobs:
                passed, _reasons = ko_filter(cand, job)
                if not passed:
                    row.append({"score": None, "blocked": True})
                else:
                    row.append({"score": score_job(cand, job).total, "blocked": False})
            # Same id fallback as the missing_candidates path above (idea-d4bd3d30):
            # a profile without an "id" must still get a unique, stable row key —
            # a null id collapses the grid's React keys so rows silently merge or
            # vanish from a matrix the recruiter trusts as complete.
            candidates.append({"id": cid, "label": pr.get("label") or cid, "archetype": pr.get("archetype")})
            cells.append(row)

        positions = [
            {"id": j.id, "title": j.title, "seniority": j.seniority, "roleFamily": j.role_family, "salaryBand": list(j.salary_band or [])}
            for j in jobs
        ]
        print(
            json.dumps(
                {
                    "candidates": candidates,
                    "positions": positions,
                    "cells": cells,
                    "missing": missing,
                    "missingCandidates": missing_candidates,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        return emit_error(exc)


if __name__ == "__main__":
    raise SystemExit(main())
