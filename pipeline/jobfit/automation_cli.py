"""CLI for HR automation tasks (Direction 2). Mirrors reasoning_cli.py.

    python -m pipeline.jobfit.automation_cli screen      --candidate-json P --job-id J [--no-llm]
    python -m pipeline.jobfit.automation_cli outreach    --profile-json P --job-id J [--strengths-json S]
    python -m pipeline.jobfit.automation_cli rejection   --candidate-json P --job-id J --stage Screening
    python -m pipeline.jobfit.automation_cli prep        --candidate-json P --job-id J
    python -m pipeline.jobfit.automation_cli scorecard   --candidate-json P --job-id J --notes-file N
    python -m pipeline.jobfit.automation_cli rematch     --candidate-json P --current-job-id J
    python -m pipeline.jobfit.automation_cli policy-pass --entries-json E      # Task 7, LLM-free

Input candidate via --candidate-json (MatchCandidate) or --profile-json (CandidateProfileV2, transformed).
Output: one JSON object to stdout; {"error","status"} to stderr + exit 1 on failure.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import automation
from .claude_cli import ClaudeCliProvider
from .matching import MatchCandidate, load_corpus, score_job


def _load_candidate(args) -> MatchCandidate:
    if args.profile_json:
        from .profile import CandidateProfileV2
        from .transform import build_match_candidate

        return build_match_candidate(CandidateProfileV2.model_validate(json.loads(args.profile_json.read_text(encoding="utf-8"))))
    if args.candidate_json:
        return MatchCandidate.model_validate(json.loads(args.candidate_json.read_text(encoding="utf-8")))
    raise ValueError("provide --candidate-json or --profile-json")


def _find_job(jobs, job_id):
    job = next((j for j in jobs if j.id == job_id), None)
    if job is None:
        raise ValueError(f"job not found: {job_id}")
    return job


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="HR automation tasks (Claude CLI only).")
    parser.add_argument("command", choices=["screen", "outreach", "rejection", "prep", "scorecard", "rematch", "offer", "policy-pass"])
    parser.add_argument("--candidate-json", type=Path)
    parser.add_argument("--profile-json", type=Path)
    parser.add_argument("--job-id")
    parser.add_argument("--current-job-id")
    parser.add_argument("--strengths-json", type=Path)
    parser.add_argument("--stage", default="Screening")
    parser.add_argument("--notes-file", type=Path)
    parser.add_argument("--entries-json", type=Path)
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.command == "policy-pass":
            raw = json.loads(args.entries_json.read_text(encoding="utf-8")) if args.entries_json else json.loads(sys.stdin.read() or "[]")
            decisions = [{"entryId": e.get("id"), **automation.evaluate_entry(e)} for e in raw]
            print(json.dumps({"decisions": decisions}, ensure_ascii=False))
            return 0

        provider = None if args.no_llm else ClaudeCliProvider(timeout=120)
        if provider is not None and not provider.available():
            provider = None

        candidate = _load_candidate(args)
        jobs = load_corpus(args.jobs)

        if args.command == "rematch":
            result = automation.rematch_candidate(candidate, args.current_job_id, jobs, provider=provider)
            print(json.dumps({"result": result, "source": result.get("source", "deterministic")}, ensure_ascii=False))
            return 0

        job = _find_job(jobs, args.job_id)
        m = score_job(candidate, job)

        if args.command == "screen":
            result, source = automation.screen_candidate(candidate, job, m, provider=provider)
        elif args.command == "outreach":
            strengths = json.loads(args.strengths_json.read_text(encoding="utf-8")) if args.strengths_json else m.matched_skills
            result, source = automation.draft_outreach(candidate, job, strengths, provider=provider)
        elif args.command == "rejection":
            result, source = automation.draft_rejection(candidate, job, m, args.stage, provider=provider)
        elif args.command == "prep":
            result, source = automation.interview_prep(candidate, job, m, provider=provider)
        elif args.command == "scorecard":
            notes = args.notes_file.read_text(encoding="utf-8") if args.notes_file else ""
            result, source = automation.interview_scorecard(candidate, job, notes, provider=provider)
        elif args.command == "offer":
            result, source = automation.draft_offer(candidate, job, m, provider=provider)
        else:  # pragma: no cover
            raise ValueError(f"unhandled command {args.command}")

        print(json.dumps({"result": result, "source": source}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
