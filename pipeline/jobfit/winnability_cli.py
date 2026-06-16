"""CLI: grade a (draft) job's winnability against the candidate pool.

Input JSON (stdin or --input-json):
  { "jobId": str,
    "candidates": [ { "label": str, "profile": {<CandidateProfileV2>} }     # v2 profile (transformed)
                  | { "label": str, "candidate": {<MatchCandidate>} } ] }   # already a match candidate

Output: the assess_winnability() dict (eligible/qualified counts, loosen-gate and
demote-must-have deltas, salary vs market). Invoked by /api/jobs/[id]/winnability.
The candidate-entry parsing mirrors recruiter_cli (row-level isolation: one
malformed CV is skipped, not fatal) so the coach scores the exact same pool the
recruiter ranking does.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .jobs import Job
from .matching import MatchCandidate, load_corpus
from .profile import CandidateProfileV2
from .transform import build_match_candidate
from .winnability import assess_winnability


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Grade a job's winnability against the pool.")
    parser.add_argument("--input-json", type=Path, help="Input JSON file. Reads stdin if omitted.")
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument("--job-json", type=Path, default=None, help="A single Job record — used directly instead of the corpus lookup (lets newly-ingested DB jobs grade).")
    args = parser.parse_args(argv)

    try:
        raw = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        job_id = raw.get("jobId")
        if args.job_json:
            job = Job.model_validate(json.loads(args.job_json.read_text(encoding="utf-8")))
        else:
            jobs = load_corpus(args.jobs)
            job = next((j for j in jobs if j.id == job_id), None)
        if job is None:
            raise ValueError(f"job not found: {job_id}")

        candidates: list[MatchCandidate] = []
        for i, entry in enumerate(raw.get("candidates") or []):
            if not isinstance(entry, dict):
                continue
            try:
                if entry.get("profile"):
                    cand = build_match_candidate(CandidateProfileV2.model_validate(entry["profile"]))
                elif entry.get("candidate"):
                    cand = MatchCandidate.model_validate(entry["candidate"])
                else:
                    continue
            except Exception:
                # One malformed entry (a partially-extracted CV) must not abort the
                # whole assessment — skip it, mirroring recruiter_cli's isolation.
                continue
            if entry.get("label"):
                cand.label = entry["label"]
            candidates.append(cand)

        result = assess_winnability(candidates, job)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
