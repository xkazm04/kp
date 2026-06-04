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

from .claude_cli import ClaudeCliProvider
from .jobs import Job
from .matching import MatchCandidate, load_corpus
from .profile import CandidateProfileV2
from .recruiter import fairness_check, rank_candidates_for_job
from .transform import build_match_candidate


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Rank candidates against one job.")
    parser.add_argument("--input-json", type=Path, help="Input JSON file. Reads stdin if omitted.")
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument("--job-json", type=Path, default=None, help="A single Job record — used directly instead of the corpus lookup (lets newly-ingested DB jobs rank).")
    parser.add_argument("--weights-llm", action="store_true", help="Use the LLM weight proposer for the fairness matrix (default: deterministic, no LLM).")
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

        candidates: list[tuple[str, MatchCandidate]] = []
        skipped: list[dict[str, str]] = []
        for i, entry in enumerate(raw.get("candidates") or []):
            if not isinstance(entry, dict):
                continue
            entry_id = entry.get("id") or f"cand-{i}"
            try:
                if entry.get("profile"):
                    cand = build_match_candidate(CandidateProfileV2.model_validate(entry["profile"]))
                elif entry.get("candidate"):
                    cand = MatchCandidate.model_validate(entry["candidate"])
                else:
                    continue
            except Exception as exc:
                # One malformed entry (a partially-extracted CV, a bad field) must not
                # abort the whole ranking — skip it with a recorded reason so every other
                # valid candidate still ranks, mirroring matrix_cli's row-level isolation.
                skipped.append({"id": entry_id, "label": entry.get("label") or entry_id, "reason": str(exc)})
                continue
            if entry.get("label"):
                cand.label = entry["label"]
            candidates.append((entry_id, cand))

        rows = rank_candidates_for_job(candidates, job)
        # Cross-scheme fairness matrix (bounded dynamic weights). Opt into the LLM
        # weight proposer with --weights-llm (the group eval does; the cheap
        # candidate-list endpoint stays deterministic). Best-effort: a failure here
        # must not break the primary ranking, so degrade to null.
        weights_provider = None
        if args.weights_llm:
            weights_provider = ClaudeCliProvider(timeout=120)
            if not weights_provider.available():
                weights_provider = None
        try:
            fairness = fairness_check(candidates, job, provider=weights_provider) if candidates else None
        except Exception:
            fairness = None
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    # Source field names/casing from the single Pydantic definition: pick the
    # recruiter-view keys straight out of Job.model_dump(by_alias=True) — the same
    # camelCase aliasing jobs_cli emits — so they can't drift from the Job model,
    # then overlay the derived entryEligible (flattened from entry_profile).
    job_dump = job.model_dump(by_alias=True)
    job_out = {
        key: job_dump[key]
        for key in ("id", "title", "company", "location", "workMode", "seniority", "roleFamily", "salaryBand")
    }
    job_out["entryEligible"] = bool(job.entry_profile and job.entry_profile.is_entry_eligible)

    print(
        json.dumps(
            {
                "job": job_out,
                "candidates": rows,
                "fairness": fairness,
                "skipped": skipped,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
