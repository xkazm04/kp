"""CLI: generate per-match reasoning for one (candidate, job) pair.

    python -m pipeline.jobfit.reasoning_cli --candidate-json <path> --job-id <id>

Loads the candidate + corpus, scores the named job, and produces a hiring
rationale via ClaudeCliProvider (subscription) with a deterministic fallback.
Invoked by /api/match/reasoning; the route handles caching.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ._cli import configure_stdio, emit_error, load_candidate_arg
from .claude_cli import ClaudeCliProvider
from .match_reasoning import REASONING_PROMPT_VERSION, generate
from .matching import load_corpus, score_job


def main(argv: list[str] | None = None) -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(description="Generate reasoning for one candidate-job match.")
    parser.add_argument("--candidate-json", type=Path, help="MatchCandidate JSON. Reads stdin if omitted.")
    parser.add_argument("--profile-json", type=Path, help="CandidateProfileV2 JSON — transformed first.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument("--no-llm", action="store_true", help="Force the deterministic template.")
    args = parser.parse_args(argv)

    try:
        candidate = load_candidate_arg(args.profile_json, args.candidate_json)
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
        return emit_error(exc)

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
