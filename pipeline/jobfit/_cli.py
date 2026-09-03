"""Shared scaffolding for the jobfit CLIs (match_cli, reasoning_cli, matrix_cli).

These thin Python entry points are spawned by the Next.js API routes; before this they
each re-implemented the same three concerns. Consolidating them here means stdio/encoding
behaviour and the JSON error contract the bridge presents to the app live in ONE place:

  - configure_stdio():   force UTF-8 on stdout/stderr (Czech diacritics survive Windows cp1250).
  - load_candidate_arg():load a MatchCandidate from a CandidateProfileV2 (--profile-json,
                         transformed) or a raw MatchCandidate (--candidate-json, else stdin).
  - load_jobs_arg():     load the corpus (--jobs or the committed seed), augmented by the
                         --jobs-json overrides (DB-ingested jobs; overrides win on id collision).
  - emit_error():        the `{error, status, code}` envelope on stderr + the process exit code.

The failure VOCABULARY (``ERROR_CODES``) lives here too. It used to be re-declared as
bare ``ERR_INVALID_INPUT = "invalid_input"`` literals in seven CLIs while these three
emitted no ``code`` at all — so "job not found" and "that JSON is not a candidate"
left the engine as the same anonymous 500 and app/_lib/python-runner.ts had to GUESS a
code back out of the status. The code is now chosen at the raise site (:class:`CliError`,
:func:`not_found`, :func:`invalid_input`) and the runner prefers what the engine said.
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


# The engine's failure vocabulary. Closed set, mirrored by PYTHON_ERROR_CODES in
# app/_lib/python-runner.ts (pinned by test_cli_error_envelope.py) — adding a code
# means adding it on BOTH sides, or the runner keeps the status-derived guess.
ERR_INVALID_INPUT = "invalid_input"
ERR_NOT_FOUND = "not_found"
ERR_ENGINE = "engine_error"
ERR_TIMEOUT = "timeout"
ERROR_CODES: tuple[str, ...] = (ERR_INVALID_INPUT, ERR_NOT_FOUND, ERR_ENGINE, ERR_TIMEOUT)

# Default HTTP-ish status per code, so a raise site names ONE thing (the code) and the
# status follows. A caller may still override the status explicitly.
_STATUS_FOR_CODE = {
    ERR_INVALID_INPUT: 400,
    ERR_NOT_FOUND: 404,
    ERR_ENGINE: 500,
    ERR_TIMEOUT: 504,
}


class CliError(Exception):
    """A failure that names its own code at the RAISE site.

    Before this, every CLI failure reached the bridge as ``{error, status: 500}`` and
    python-runner.ts inferred a code from the status — which made "job not found"
    (the user picked a job the corpus doesn't carry, remedy: pick another) and a real
    engine fault indistinguishable on screen. Raise ``not_found(...)`` /
    ``invalid_input(...)`` instead of a bare ``ValueError`` and the distinction
    survives all the way to ``useErrorMessage``.
    """

    def __init__(self, message: str, *, code: str = ERR_ENGINE, status: int | None = None) -> None:
        super().__init__(message)
        if code not in ERROR_CODES:
            # A typo'd code would ride to the browser as an unresolvable key; fail
            # loudly here (a programming error, not a runtime condition) instead.
            raise ValueError(f"unknown CLI error code: {code!r}")
        self.code = code
        self.status = status if status is not None else _STATUS_FOR_CODE[code]


def not_found(message: str) -> CliError:
    """404 — the named job/candidate/record is not in the resolved corpus."""
    return CliError(message, code=ERR_NOT_FOUND)


def invalid_input(message: str) -> CliError:
    """400 — the caller's JSON/argument is malformed or fails validation."""
    return CliError(message, code=ERR_INVALID_INPUT)


def _classify(exc: Exception) -> tuple[str, int]:
    """Code + status for an exception that did not name its own.

    Validation failures (pydantic) and unparseable JSON are the caller's input, not an
    engine fault: they answer 400/``invalid_input`` so the route can render an inline
    hint rather than the generic "the engine failed, try again" sentence.
    """
    if isinstance(exc, CliError):
        return exc.code, exc.status
    if isinstance(exc, json.JSONDecodeError):
        return ERR_INVALID_INPUT, 400
    if isinstance(exc, TimeoutError):
        return ERR_TIMEOUT, 504
    try:
        from pydantic import ValidationError
    except Exception:  # pragma: no cover — pydantic is a hard dep; be defensive anyway
        ValidationError = ()  # type: ignore[assignment]
    if ValidationError and isinstance(exc, ValidationError):
        return ERR_INVALID_INPUT, 400
    return ERR_ENGINE, 500


def emit_error(exc: Exception, status: int | None = None, code: str | None = None) -> int:
    """Print the bridge's standard JSON error envelope to stderr and return the process
    exit code (1). ``status`` and ``code`` ride inside the JSON for the Next.js layer
    (``parseStderrError``), which prefers the emitted ``code`` over its own
    status-derived guess. Both default to what the exception itself declares
    (:class:`CliError`) or to :func:`_classify`'s reading of it."""
    derived_code, derived_status = _classify(exc)
    out_code = code or derived_code
    out_status = status if status is not None else derived_status
    print(
        json.dumps({"error": str(exc), "status": out_status, "code": out_code}, ensure_ascii=False),
        file=sys.stderr,
    )
    return 1
