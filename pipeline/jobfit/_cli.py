"""Shared scaffolding for the jobfit CLIs (match_cli, reasoning_cli, matrix_cli).

These thin Python entry points are spawned by the Next.js API routes; before this they
each re-implemented the same three concerns. Consolidating them here means stdio/encoding
behaviour and the JSON error contract the bridge presents to the app live in ONE place:

  - configure_stdio():   force UTF-8 on stdout/stderr (Czech diacritics survive Windows cp1250).
  - load_candidate_arg():load a MatchCandidate from a CandidateProfileV2 (--profile-json,
                         transformed) or a raw MatchCandidate (--candidate-json, else stdin).
  - load_jobs_arg():     load the corpus (--jobs or the committed seed), augmented by the
                         --jobs-json overrides (DB-ingested jobs; overrides win on id collision).
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


def load_jobs_arg(jobs: Path | None, jobs_json: Path | None) -> list[Any]:
    """Corpus from ``--jobs`` (or the committed seed), augmented by any inline Job
    overrides from ``--jobs-json`` (e.g. freshly DB-ingested jobs not yet in the
    static corpus). Overrides win on id collision — the same augment matrix_cli
    applies, shared here so match_cli (Match tab) and reasoning_cli (Explain fit)
    resolve the SAME corpus the Fit Matrix scores instead of just the demo seed."""
    from .jobs import Job
    from .matching import load_corpus

    corpus = load_corpus(jobs)
    if jobs_json is None:
        return corpus
    by_id = {j.id: j for j in corpus}
    # Poison-pill isolation (bug-ui-scan 2026-07-09): the --jobs-json override is
    # the live DB corpus, and ONE row with a null/missing company, location,
    # title, or id (an underspecified/legacy/partially-ingested job) made a bare
    # `Job.model_validate(rec)` loop raise ValidationError — which aborted the
    # ENTIRE match / Explain-fit run for EVERY candidate with a hard 500. Skip the
    # bad record and keep going (recording which id failed on stderr), mirroring
    # the per-candidate isolation match/matrix already implement, so a single
    # poison row can never poison the batch: N-1 good jobs still score.
    for rec in json.loads(jobs_json.read_text(encoding="utf-8")):
        try:
            job = Job.model_validate(rec)
        except Exception as exc:  # noqa: BLE001 — one bad row must not fail the run
            job_id = rec.get("id") if isinstance(rec, dict) else None
            # Plain-text stderr note (never the JSON error envelope emit_error
            # prints): the run still exits 0, so the bridge parses stdout and
            # ignores stderr; this line is only for operator diagnosis.
            print(
                f"[jobfit] skipped malformed --jobs-json record (id={job_id!r}): {exc}",
                file=sys.stderr,
            )
            continue
        by_id[job.id] = job
    return list(by_id.values())


def emit_error(exc: Exception, status: int = 500) -> int:
    """Print the bridge's standard JSON error envelope to stderr and return the process
    exit code (1). ``status`` rides inside the JSON for the Next.js layer (parseStderrError)."""
    print(json.dumps({"error": str(exc), "status": status}, ensure_ascii=False), file=sys.stderr)
    return 1
