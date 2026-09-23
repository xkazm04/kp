"""CLI: match a candidate (JSON) against the job corpus, print ranked matches.

Invoked by the Next.js /api/match route (candidate written to a temp file):

    python -m pipeline.jobfit.match_cli --candidate-json <path> [--limit N]

Reads the candidate from --candidate-json (or stdin) and the corpus from the
committed seed (or --jobs), augmented by any --jobs-json DB overrides so
recruiter-ingested jobs rank too. Output is a single JSON object (MatchResponse).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ._cli import configure_stdio, emit_error, load_candidate_arg, load_jobs_arg
from .matching import match
from .transform import apply_preferences


def main(argv: list[str] | None = None) -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(description="Match a candidate against the job corpus.")
    parser.add_argument("--candidate-json", type=Path, help="MatchCandidate JSON. Reads stdin if omitted.")
    parser.add_argument(
        "--profile-json",
        type=Path,
        help="CandidateProfileV2 JSON — transformed into a MatchCandidate (skills+provenance, potential).",
    )
    parser.add_argument(
        "--preferences-json",
        type=Path,
        default=None,
        help="Seeker JobseekerPreferences JSON (salaryFloor, locations, countries, workModes, seniority) — "
        "overlaid on the candidate. salaryFloor/locations/countries drive only the MatchResult.eligibility "
        "flags; workModes and seniority are matching inputs (transform.apply_preferences): both reach the "
        "KO filter and seniority the career score, so they can remove a job — pair with --include-blocked "
        "to see which and what it would score.",
    )
    parser.add_argument(
        "--include-blocked",
        action="store_true",
        help="Also return every job the KO filter removed as `blocked` [{jobId, koKeys, koDetails, result}], "
        "result scored as if the gate were lifted. Off by default (the recruiter /api/match payload is unchanged).",
    )
    parser.add_argument("--jobs", type=Path, default=None, help="Override corpus path.")
    parser.add_argument(
        "--jobs-json",
        type=Path,
        default=None,
        help="JSON array of Job records used in addition to the corpus — lets newly-ingested DB jobs (absent from the static corpus) be ranked.",
    )
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
        if args.preferences_json is not None:
            preferences = json.loads(args.preferences_json.read_text(encoding="utf-8"))
            # Applied to BOTH load paths (profile or raw candidate) so the seeker
            # module can pass its preferences beside either representation.
            candidate = apply_preferences(candidate, preferences if isinstance(preferences, dict) else None)
        # Corpus augmented by --jobs-json DB overrides (overrides win on id
        # collision): without it a recruiter-ingested/published job scored by the
        # Fit Matrix never appeared in the Match ranking at any rank.
        jobs = load_jobs_arg(args.jobs, args.jobs_json)
        # A malformed --weights must not abort the match — coerce a non-object to
        # None so it falls back to the archetype baseline (resolve_weights handles
        # clamping/renormalizing a valid partial vector).
        weights = None
        if args.weights:
            parsed = json.loads(args.weights)
            if isinstance(parsed, dict):
                weights = parsed
        response = match(candidate, jobs, limit=args.limit, weights=weights, include_blocked=args.include_blocked)
    except Exception as exc:  # surface as JSON on stderr, mirroring cli.py
        return emit_error(exc)

    print(json.dumps(response.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
