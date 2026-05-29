"""CLI: generate per-match reasoning for one (candidate, job) pair.

    python -m pipeline.jobfit.reasoning_cli --candidate-json <path> --job-id <id>

Loads the candidate + corpus, scores the named job, and produces a hiring
rationale via ClaudeCliProvider (subscription) with a deterministic fallback.
Invoked by /api/match/reasoning; the route handles caching.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .claude_cli import ClaudeCliProvider
from .match_reasoning import REASONING_PROMPT_VERSION, generate
from .matching import MatchCandidate, load_corpus, score_job


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Generate reasoning for one candidate-job match.")
    parser.add_argument("--candidate-json", type=Path, help="MatchCandidate JSON. Reads stdin if omitted.")
    parser.add_argument("--profile-json", type=Path, help="CandidateProfileV2 JSON — transformed first.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument("--no-llm", action="store_true", help="Force the deterministic template.")
    args = parser.parse_args(argv)

    try:
        if args.profile_json:
            from .profile import CandidateProfileV2
            from .transform import build_match_candidate

            profile = CandidateProfileV2.model_validate(json.loads(args.profile_json.read_text(encoding="utf-8")))
            candidate = build_match_candidate(profile)
        else:
            raw = (
                json.loads(args.candidate_json.read_text(encoding="utf-8"))
                if args.candidate_json
                else json.loads(sys.stdin.read() or "{}")
            )
            candidate = MatchCandidate.model_validate(raw)
        jobs = load_corpus(args.jobs)
        job = next((j for j in jobs if j.id == args.job_id), None)
        if job is None:
            raise ValueError(f"job not found: {args.job_id}")
        m = score_job(candidate, job)
        provider = None if args.no_llm else ClaudeCliProvider(timeout=120)
        if provider is not None and not provider.available():
            provider = None
        reasoning, source = generate(candidate, job, m, provider=provider)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "jobId": job.id,
                "title": job.title,
                "total": m.total,
                "source": source,
                "promptVersion": REASONING_PROMPT_VERSION,
                "reasoning": reasoning,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
