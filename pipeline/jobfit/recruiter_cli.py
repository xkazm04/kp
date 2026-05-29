"""CLI: rank a set of candidates against one job (recruiter view).

Input JSON (stdin or --input-json):
  { "jobId": str,
    "candidates": [ { "label": str, "profile": {<CandidateProfileV2>} }     # v2 profile (transformed)
                  | { "label": str, "candidate": {<MatchCandidate>} } ] }   # already a match candidate

Output: { "job": {...}, "candidates": [ <ranked rows> ] }. Invoked by
/api/jobs/[id]/candidates.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .matching import MatchCandidate, load_corpus
from .profile import CandidateProfileV2
from .recruiter import rank_candidates_for_job
from .transform import build_match_candidate


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Rank candidates against one job.")
    parser.add_argument("--input-json", type=Path, help="Input JSON file. Reads stdin if omitted.")
    parser.add_argument("--jobs", type=Path, default=None)
    args = parser.parse_args(argv)

    try:
        raw = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        job_id = raw.get("jobId")
        jobs = load_corpus(args.jobs)
        job = next((j for j in jobs if j.id == job_id), None)
        if job is None:
            raise ValueError(f"job not found: {job_id}")

        candidates: list[MatchCandidate] = []
        for entry in raw.get("candidates") or []:
            if not isinstance(entry, dict):
                continue
            if entry.get("profile"):
                cand = build_match_candidate(CandidateProfileV2.model_validate(entry["profile"]))
            elif entry.get("candidate"):
                cand = MatchCandidate.model_validate(entry["candidate"])
            else:
                continue
            if entry.get("label"):
                cand.label = entry["label"]
            candidates.append(cand)

        rows = rank_candidates_for_job(candidates, job)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "job": {
                    "id": job.id,
                    "title": job.title,
                    "company": job.company,
                    "location": job.location,
                    "workMode": job.work_mode,
                    "seniority": job.seniority,
                    "roleFamily": job.role_family,
                    "salaryBand": job.salary_band,
                    "entryEligible": bool(job.entry_profile and job.entry_profile.is_entry_eligible),
                },
                "candidates": rows,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
