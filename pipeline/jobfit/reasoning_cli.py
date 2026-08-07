"""CLI: generate per-match reasoning for one (candidate, job) pair.

    python -m pipeline.jobfit.reasoning_cli --candidate-json <path> --job-id <id>

Loads the candidate + corpus, scores the named job, and produces a hiring
rationale via the configured LLM provider (KP_LLM_CONFIG; Claude CLI when
unconfigured) with a deterministic fallback.
Invoked by /api/match/reasoning; the route handles caching.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ._cli import configure_stdio, emit_error, load_candidate_arg, load_jobs_arg
from .llm import emit_deterministic, resolve_provider
from .match_reasoning import REASONING_PROMPT_VERSION, generate
from .matching import score_job


def main(argv: list[str] | None = None) -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(description="Generate reasoning for one candidate-job match.")
    parser.add_argument("--candidate-json", type=Path, help="MatchCandidate JSON. Reads stdin if omitted.")
    parser.add_argument("--profile-json", type=Path, help="CandidateProfileV2 JSON — transformed first.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument(
        "--jobs-json",
        type=Path,
        default=None,
        help="JSON array of Job records used in addition to the corpus — lets a newly-ingested DB --job-id resolve instead of raising 'job not found'.",
    )
    parser.add_argument("--no-llm", action="store_true", help="Force the deterministic template.")
    # MAT1 — output locale for the verdict/strengths/gaps narrative (en|cs); the
    # verdict's canonical code value stays English (coerced downstream). The
    # deterministic fallback is English-only.
    parser.add_argument("--lang", type=str, default="en", help="Narrative output locale (en, cs).")
    args = parser.parse_args(argv)
    from .i18n import normalize_lang

    lang = normalize_lang(args.lang)

    try:
        candidate = load_candidate_arg(args.profile_json, args.candidate_json)
        # Corpus augmented by --jobs-json DB overrides (overrides win on id
        # collision): without it Explain fit raised "job not found" for any
        # recruiter-ingested job the Fit Matrix happily scored.
        jobs = load_jobs_arg(args.jobs, args.jobs_json)
        job = next((j for j in jobs if j.id == args.job_id), None)
        if job is None:
            raise ValueError(f"job not found: {args.job_id}")
        m = score_job(candidate, job)
        provider = None if args.no_llm else resolve_provider("match_reasoning", timeout=120)
        if provider is not None and not provider.available():
            provider = None
        reasoning, source = generate(candidate, job, m, lang=lang, provider=provider)
        if source == "deterministic":
            # Keyless/failed fallback served — record it in the usage ledger so
            # template traffic stops being invisible (no-op without KP_LLM_USAGE_LOG).
            emit_deterministic("match_reasoning")
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
