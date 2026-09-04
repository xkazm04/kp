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

from ._cli import configure_stdio, emit_error, load_candidate_arg, load_jobs_arg, not_found
from .llm import emit_deterministic, provider_availability, resolve_provider
from .match_reasoning import REASONING_PROMPT_VERSION, generate, narrative_lang_for
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
    # MAT1 — output locale for the verdict/strengths/gaps narrative; the verdict's
    # canonical code value stays English (coerced downstream). Every locale in
    # i18n.LANG_NAMES (en, cs, de, fr) reaches the prompt as its OWN language — the
    # help used to say "(en, cs)", which is what still has app/_lib/reasoning-run.ts
    # collapsing a de/fr request to en before it ever gets here.
    # The deterministic fallback remains English-only whatever is requested.
    parser.add_argument("--lang", type=str, default="en", help="Narrative output locale (en, cs, de, fr).")
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
            # 404/`not_found`, not the anonymous 500 a bare ValueError became: the
            # caller named a job the resolved corpus does not carry, and the remedy
            # ("pick another job") is nothing like "the engine crashed".
            raise not_found(f"job not found: {args.job_id}")
        m = score_job(candidate, job)
        provider = None if args.no_llm else resolve_provider("match_reasoning", timeout=120)
        descent = "disabled" if args.no_llm else None
        if provider is not None:
            ok, descent = provider_availability(provider)
            if not ok:
                provider = None
        # A provider that PASSED the availability gate can still fail mid-flight
        # (timeout, unparseable JSON, a 429). `descent` then stayed None and the ledger
        # recorded a deterministic serve with no reason at all — the one descent an
        # operator can actually act on, unnamed. The engine hands the cause back.
        def note_descent(reason: str) -> None:
            nonlocal descent
            descent = reason

        reasoning, source = generate(
            candidate, job, m, lang=lang, provider=provider, on_fallback=note_descent
        )
        if source == "deterministic":
            # Keyless/failed fallback served — record it in the usage ledger so
            # template traffic stops being invisible (no-op without KP_LLM_USAGE_LOG),
            # with the descent reason naming WHY the floor served (R6).
            emit_deterministic("match_reasoning", reason=descent)
    except Exception as exc:
        return emit_error(exc)

    print(
        json.dumps(
            {
                "jobId": job.id,
                "title": job.title,
                "total": m.total,
                "source": source,
                # The language the narrative is actually IN, stated by the side that
                # produced it. The deterministic template is English-only, so a --lang cs
                # run that fell back answers narrativeLang "en" — and the panel's honest
                # "shown in English" note fires. TS used to re-derive this from `source`;
                # now it reads what the engine said (reasoning-cache-policy.ts).
                "narrativeLang": narrative_lang_for(source, lang),
                "promptVersion": REASONING_PROMPT_VERSION,
                "reasoning": reasoning,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
