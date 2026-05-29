"""CLI: match a candidate (JSON) against the job corpus, print ranked matches.

Invoked by the Next.js /api/match route (candidate written to a temp file):

    python -m pipeline.jobfit.match_cli --candidate-json <path> [--limit N]

Reads the candidate from --candidate-json (or stdin) and the corpus from the
committed seed (or --jobs). Output is a single JSON object (MatchResponse).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .matching import MatchCandidate, load_corpus, match


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Match a candidate against the job corpus.")
    parser.add_argument("--candidate-json", type=Path, help="Candidate JSON file. Reads stdin if omitted.")
    parser.add_argument("--jobs", type=Path, default=None, help="Override corpus path.")
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args(argv)

    try:
        if args.candidate_json:
            raw = json.loads(args.candidate_json.read_text(encoding="utf-8"))
        else:
            raw = json.loads(sys.stdin.read() or "{}")
        candidate = MatchCandidate.model_validate(raw)
        jobs = load_corpus(args.jobs)
        response = match(candidate, jobs, limit=args.limit)
    except Exception as exc:  # surface as JSON on stderr, mirroring cli.py
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(response.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
