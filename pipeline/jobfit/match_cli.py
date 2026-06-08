"""CLI: match a candidate (JSON) against the job corpus, print ranked matches.

Invoked by the Next.js /api/match route (candidate written to a temp file):

    python -m pipeline.jobfit.match_cli --candidate-json <path> [--limit N]

Reads the candidate from --candidate-json (or stdin) and the corpus from the
committed seed (or --jobs). Output is a single JSON object (MatchResponse).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ._cli import configure_stdio, emit_error, load_candidate_arg
from .matching import load_corpus, match


def main(argv: list[str] | None = None) -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(description="Match a candidate against the job corpus.")
    parser.add_argument("--candidate-json", type=Path, help="MatchCandidate JSON. Reads stdin if omitted.")
    parser.add_argument(
        "--profile-json",
        type=Path,
        help="CandidateProfileV2 JSON — transformed into a MatchCandidate (skills+provenance, potential).",
    )
    parser.add_argument("--jobs", type=Path, default=None, help="Override corpus path.")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument(
        "--weights",
        type=str,
        default=None,
        help='Recruiter weight override, JSON object {"skills","career","personal"} (MAT1). '
        "Clamped to the archetype's bounds server-side; ignored if not a JSON object.",
    )
    args = parser.parse_args(argv)

    try:
        candidate = load_candidate_arg(args.profile_json, args.candidate_json)
        jobs = load_corpus(args.jobs)
        # A malformed --weights must not abort the match — coerce a non-object to
        # None so it falls back to the archetype baseline (resolve_weights handles
        # clamping/renormalizing a valid partial vector).
        weights = None
        if args.weights:
            parsed = json.loads(args.weights)
            if isinstance(parsed, dict):
                weights = parsed
        response = match(candidate, jobs, limit=args.limit, weights=weights)
    except Exception as exc:  # surface as JSON on stderr, mirroring cli.py
        return emit_error(exc)

    print(json.dumps(response.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
