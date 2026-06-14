"""Shared scaffolding for the jobfit CLIs (match_cli, reasoning_cli, matrix_cli).

These thin Python entry points are spawned by the Next.js API routes; before this they
each re-implemented the same three concerns. Consolidating them here means stdio/encoding
behaviour and the JSON error contract the bridge presents to the app live in ONE place:

  - configure_stdio():   force UTF-8 on stdout/stderr (Czech diacritics survive Windows cp1250).
  - load_candidate_arg():load a MatchCandidate from a CandidateProfileV2 (--profile-json,
                         transformed) or a raw MatchCandidate (--candidate-json, else stdin).
  - emit_error():        the `{error, status}` envelope on stderr + the process exit code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def configure_stdio(errors: str = "strict") -> None:
    """Force UTF-8 on stdout/stderr so non-ASCII (e.g. Czech diacritics) survives the
    Windows default code page. No-op where the streams can't be reconfigured.

    ``errors`` selects the codec error policy (``"strict"`` by default; pass
    ``"replace"`` for harnesses that prefer a substitution char over a crash on an
    un-encodable byte). Both streams are always reconfigured together."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors=errors)
        sys.stderr.reconfigure(encoding="utf-8", errors=errors)


def load_candidate_arg(profile_json: Path | None, candidate_json: Path | None) -> Any:
    """Build a MatchCandidate from either a CandidateProfileV2 (``--profile-json``, run through
    transform.build_match_candidate) or a raw MatchCandidate (``--candidate-json``, else stdin).
    Mirrors the load both match_cli and reasoning_cli previously hand-rolled."""
    from .matching import MatchCandidate

    if profile_json is not None:
        from .profile import CandidateProfileV2
        from .transform import build_match_candidate

        profile = CandidateProfileV2.model_validate(json.loads(profile_json.read_text(encoding="utf-8")))
        return build_match_candidate(profile)
    raw = (
        json.loads(candidate_json.read_text(encoding="utf-8"))
        if candidate_json is not None
        else json.loads(sys.stdin.read() or "{}")
    )
    return MatchCandidate.model_validate(raw)


def emit_error(exc: Exception, status: int = 500) -> int:
    """Print the bridge's standard JSON error envelope to stderr and return the process
    exit code (1). ``status`` rides inside the JSON for the Next.js layer (parseStderrError)."""
    print(json.dumps({"error": str(exc), "status": status}, ensure_ascii=False), file=sys.stderr)
    return 1
