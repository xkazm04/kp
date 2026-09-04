"""CLI: grade a (draft) job's winnability against the candidate pool.

Input JSON (stdin or --input-json):
  { "jobId": str,
    "candidates": [ { "label": str, "profile": {<CandidateProfileV2>} }     # v2 profile (transformed)
                  | { "label": str, "candidate": {<MatchCandidate>} } ] }   # already a match candidate

Output: the assess_winnability() dict (eligible/qualified counts, loosen-gate and
demote-must-have deltas, salary vs market) plus a `skipped` list of any dropped
entries ({id, label, reason}). Invoked by /api/jobs/[id]/winnability.
The candidate-entry parsing mirrors recruiter_cli (row-level isolation: one
malformed CV is skipped — but RECORDED, not silently dropped — so the coach scores,
and honestly reports, the exact same pool the recruiter ranking does.

On failure an {"error","status","code"} envelope goes to stderr with an HONEST status
— 404/not_found for a job the corpus doesn't carry, 400/invalid_input for malformed
input or a Job that fails validation, 500/engine_error for an unexpected fault — plus
a matching exit code (2 for 400, 1 otherwise). Every failure used to leave as a bare
500 with no code at all, so "you picked a job that isn't there" and a real outage were
the same red box.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ._cli import CliError, configure_stdio, emit_error, invalid_input, not_found
from .jobs import Job
from .matching import MatchCandidate, load_corpus
from .profile import CandidateProfileV2
from .transform import build_match_candidate
from .winnability import assess_winnability


def main(argv: list[str] | None = None) -> int:
    # The guarded scaffold: the open-coded pair this replaced tested sys.stdout and
    # then reconfigured sys.stderr unconditionally, so a harness (or a test) that
    # captured one stream died with an AttributeError before the CLI ran a line.
    configure_stdio()

    parser = argparse.ArgumentParser(description="Grade a job's winnability against the pool.")
    parser.add_argument("--input-json", type=Path, help="Input JSON file. Reads stdin if omitted.")
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument("--job-json", type=Path, default=None, help="A single Job record — used directly instead of the corpus lookup (lets newly-ingested DB jobs grade).")
    args = parser.parse_args(argv)

    try:
        raw = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        job_id = raw.get("jobId")
        if args.job_json:
            job = Job.model_validate(json.loads(args.job_json.read_text(encoding="utf-8")))
        else:
            jobs = load_corpus(args.jobs)
            job = next((j for j in jobs if j.id == job_id), None)
        if job is None:
            # 404/not_found, NOT the anonymous 500 this used to raise: the recruiter
            # named a job the corpus no longer carries, and "pick another job" is a
            # remedy they can act on. An engine fault is not.
            raise not_found(f"job not found: {job_id}")

        candidates: list[MatchCandidate] = []
        skipped: list[dict[str, str]] = []
        for i, entry in enumerate(raw.get("candidates") or []):
            if not isinstance(entry, dict):
                continue
            entry_id = entry.get("id") or f"cand-{i}"
            try:
                if entry.get("profile"):
                    cand = build_match_candidate(CandidateProfileV2.model_validate(entry["profile"]))
                elif entry.get("candidate"):
                    cand = MatchCandidate.model_validate(entry["candidate"])
                else:
                    continue
            except Exception as exc:
                # bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #4): a malformed
                # entry (partially-extracted CV) must not abort the whole assessment —
                # but dropping it SILENTLY computes the winnability grade over a smaller
                # pool than the recruiter sees. Record id+label+reason (the exact shape
                # recruiter_cli emits) so the denominator is honest and the UI can flag
                # "N not assessed", instead of a bare `except: continue`.
                skipped.append({"id": entry_id, "label": entry.get("label") or entry_id, "reason": str(exc)})
                continue
            if entry.get("label"):
                cand.label = entry["label"]
            candidates.append(cand)

        result = assess_winnability(candidates, job)
        # Surface the dropped entries alongside the assessment so the pool the coach
        # scored is auditable (bug-ui-scan-2026-07-09 #4).
        result["skipped"] = skipped
    except CliError as exc:
        # A raise site that named its own code (not_found for a job the corpus lacks).
        emit_error(exc)
        return 2 if exc.status == 400 else 1
    except ValueError as exc:
        # Malformed --input-json / --job-json (json.JSONDecodeError) or a Job/candidate
        # that fails validation (pydantic ValidationError) — both ValueError subclasses,
        # both the caller's payload. 400/invalid_input, exit 2, so the coach can say
        # WHAT to fix instead of showing the generic "the engine failed" sentence.
        emit_error(invalid_input(str(exc)))
        return 2
    except Exception as exc:
        # A genuine engine fault — retry/escalate.
        return emit_error(exc)

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
