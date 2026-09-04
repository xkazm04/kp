"""CLI for HR automation tasks (Direction 2). Mirrors reasoning_cli.py.

    python -m pipeline.jobfit.automation_cli screen      --candidate-json P --job-id J [--no-llm]
    python -m pipeline.jobfit.automation_cli outreach    --profile-json P --job-id J [--strengths-json S]
    python -m pipeline.jobfit.automation_cli rejection   --candidate-json P --job-id J --stage Screened
    python -m pipeline.jobfit.automation_cli prep        --candidate-json P --job-id J
    python -m pipeline.jobfit.automation_cli scorecard   --candidate-json P --job-id J --notes-file N
    python -m pipeline.jobfit.automation_cli rematch     --candidate-json P --current-job-id J
    python -m pipeline.jobfit.automation_cli policy-pass --entries-json E      # Task 7, LLM-free

Input candidate via --candidate-json (MatchCandidate) or --profile-json (CandidateProfileV2, transformed).
Optional --github-evidence G (compact GithubEvidenceSummary JSON, GH7) enriches the screen/prep/scorecard
prompts with a "Public repo evidence" block; the other commands ignore it.
Output: one JSON object to stdout. On failure an {"error","status","code"} envelope goes to stderr with an
HONEST status — 404/not_found for a missing job or entry, 400/invalid_input for bad arguments or validation,
500/engine_error for an unexpected fault — plus a matching exit code (2 for 400, 1 otherwise), so the TS seam
and its callers can tell a bad request from a real outage instead of seeing every failure as a 500.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import automation
from ._cli import ERR_ENGINE, ERR_INVALID_INPUT, ERR_NOT_FOUND
from .llm import emit_deterministic, provider_availability, resolve_provider
from .matching import MatchCandidate, load_corpus, score_job

# Most sub-commands are the "automation" umbrella use_case, but `scorecard` has
# its own catalog use_case (interview_scorecard, capabilities.py) with its own
# config row + telemetry tag. Resolving it under "automation" (the old behavior)
# mis-attributed its cost/telemetry and dropped any interview_scorecard-specific
# KP_LLM_CONFIG routing — so map each command to the right use_case and use it for
# BOTH provider resolution and the deterministic-fallback ledger signal.
_USE_CASE_BY_COMMAND: dict[str, str] = {
    "scorecard": "interview_scorecard",
}


def _use_case_for(command: str) -> str:
    return _USE_CASE_BY_COMMAND.get(command, "automation")

# --- Honest error taxonomy --------------------------------------------------
# The stderr envelope carries a real HTTP status + a stable machine code so the
# TS seam (python-runner.parseStderrError) and its callers can tell a client
# mistake from a server fault, instead of every failure collapsing to 500:
#   404 / not_found     — a referenced job/entry doesn't exist
#   400 / invalid_input — bad arguments, malformed JSON, or pydantic validation
#   500 / engine_error  — an unexpected fault (retry/escalate, don't edit input)
# Mirrors the codes already emitted by devcase_cli.py.
#
# The WORDS are not ours to spell: they are `_cli.ERROR_CODES`, the closed set
# `app/_lib/python-runner.ts::PYTHON_ERROR_CODES` mirrors and the four catalogs
# resolve as `errors.<CODE>`. Re-declaring them here as local literals meant the
# contract was held by a test comparing strings across seven files rather than by
# the type system, and a lone typo would have shipped a code the client can never
# resolve. Imported, not copied (tests/test_cli_error_envelope.py pins that).


class NotFoundError(Exception):
    """A referenced resource (job, entry) does not exist — maps to HTTP 404.

    Deliberately NOT a ValueError subclass so it is caught before the 400 branch,
    which folds in pydantic ValidationError and json.JSONDecodeError."""


def _load_candidate(args) -> MatchCandidate:
    if args.profile_json:
        from .profile import CandidateProfileV2
        from .transform import build_match_candidate

        return build_match_candidate(CandidateProfileV2.model_validate(json.loads(args.profile_json.read_text(encoding="utf-8"))))
    if args.candidate_json:
        return MatchCandidate.model_validate(json.loads(args.candidate_json.read_text(encoding="utf-8")))
    raise ValueError("provide --candidate-json or --profile-json")


def _find_job(jobs, job_id):
    # A present-but-unknown job id is a 404 (the resource is missing), distinct
    # from a missing --job-id argument, which the caller guards as a 400.
    job = next((j for j in jobs if j.id == job_id), None)
    if job is None:
        raise NotFoundError(f"job not found: {job_id}")
    return job


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="HR automation tasks (Claude CLI only).")
    parser.add_argument("command", choices=["screen", "outreach", "rejection", "prep", "scorecard", "rematch", "offer", "policy-pass"])
    parser.add_argument("--candidate-json", type=Path)
    parser.add_argument("--profile-json", type=Path)
    parser.add_argument("--job-id")
    parser.add_argument("--current-job-id")
    parser.add_argument("--strengths-json", type=Path)
    parser.add_argument("--stage", default="Screened")
    parser.add_argument("--notes-file", type=Path)
    # GH7 — compact GitHub evidence summary written by automation-run.ts
    # (github.json). Read by screen/prep/scorecard; ignored elsewhere.
    parser.add_argument("--github-evidence", type=Path)
    parser.add_argument("--entries-json", type=Path)
    parser.add_argument("--jobs", type=Path, default=None)
    # PREP2 — output locale for the interview-prep narrative (en|cs). The LETTER
    # commands (outreach/rejection/offer) read it too: the TS seam passes the
    # entry's RESOLVED comms locale so the letter matches the chrome it ships in
    # (OO-L1-03). When omitted, prep defaults to English and the letter commands
    # fall back to the candidate's CV-language guess (_candidate_lang) — the
    # pre-existing behavior for direct CLI use.
    parser.add_argument("--lang", type=str, default=None)
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)
    from .i18n import normalize_lang

    lang = normalize_lang(args.lang) if args.lang is not None else None

    try:
        if args.command == "policy-pass":
            raw = json.loads(args.entries_json.read_text(encoding="utf-8")) if args.entries_json else json.loads(sys.stdin.read() or "[]")
            decisions = [{"entryId": e.get("id"), **automation.evaluate_entry(e)} for e in raw]
            print(json.dumps({"decisions": decisions}, ensure_ascii=False))
            return 0

        use_case = _use_case_for(args.command)
        provider = None if args.no_llm else resolve_provider(use_case, timeout=120)
        descent = "disabled" if args.no_llm else None
        if provider is not None:
            ok, descent = provider_availability(provider)
            if not ok:
                provider = None

        candidate = _load_candidate(args)
        jobs = load_corpus(args.jobs)
        # GH7 — optional evidence summary. A malformed file raises
        # json.JSONDecodeError (a ValueError) → the honest 400 below.
        github = json.loads(args.github_evidence.read_text(encoding="utf-8")) if args.github_evidence else None

        if args.command == "rematch":
            result = automation.rematch_candidate(candidate, args.current_job_id, jobs, provider=provider)
            source = result.get("source", "deterministic")
            if source == "deterministic":
                # Keyless/failed fallback served — make it ledger-visible (see
                # monitor.emit_deterministic; no-op without KP_LLM_USAGE_LOG).
                emit_deterministic(use_case, reason=descent)
            print(json.dumps({"result": result, "source": source}, ensure_ascii=False))
            return 0

        if not args.job_id:
            # Missing argument (400), not a missing job (404) — keep the two honest.
            raise ValueError(f"{args.command} requires --job-id")
        job = _find_job(jobs, args.job_id)
        m = score_job(candidate, job)

        if args.command == "screen":
            result, source = automation.screen_candidate(candidate, job, m, lang=lang or "en", provider=provider, github=github)
        elif args.command == "outreach":
            strengths = json.loads(args.strengths_json.read_text(encoding="utf-8")) if args.strengths_json else m.matched_skills
            result, source = automation.draft_outreach(candidate, job, strengths, lang=lang, provider=provider)
        elif args.command == "rejection":
            result, source = automation.draft_rejection(candidate, job, m, args.stage, lang=lang, provider=provider)
        elif args.command == "prep":
            result, source = automation.interview_prep(candidate, job, m, lang=lang or "en", provider=provider, github=github)
        elif args.command == "scorecard":
            notes = args.notes_file.read_text(encoding="utf-8") if args.notes_file else ""
            result, source = automation.interview_scorecard(candidate, job, notes, lang=lang or "en", provider=provider, github=github)
        elif args.command == "offer":
            result, source = automation.draft_offer(candidate, job, m, lang=lang, provider=provider)
        else:  # pragma: no cover
            raise ValueError(f"unhandled command {args.command}")

        if source == "deterministic":
            # The deterministic template served in place of the LLM (--no-llm,
            # missing key, or a failed call that fell back) — record it in the
            # usage ledger so keyless traffic stops being invisible (item 22),
            # with the descent reason naming WHY where known (R6).
            #
            # `descent` is set only when the AVAILABILITY gate turned the provider
            # away; it is None when the gate said yes and the call itself then
            # failed, which used to leave the ledger unable to tell a keyless
            # install from a provider that answered with prose. take_degradation_
            # reason() supplies that half (automation.DEGRADATION_REASONS), so
            # every deterministic serve now carries a reason.
            emit_deterministic(use_case, reason=descent or automation.take_degradation_reason())
        print(json.dumps({"result": result, "source": source}, ensure_ascii=False))
        return 0
    except NotFoundError as exc:
        # The caller referenced a job/entry that isn't there — a 404, not a fault.
        print(json.dumps({"error": str(exc), "status": 404, "code": ERR_NOT_FOUND}, ensure_ascii=False), file=sys.stderr)
        return 1
    except ValueError as exc:
        # Our explicit argument guards above AND pydantic's ValidationError /
        # json.JSONDecodeError (both ValueError subclasses) are user-correctable
        # → 400. Exit 2 matches jobfit/cli.py + parseStderrError's fallback.
        print(json.dumps({"error": str(exc), "status": 400, "code": ERR_INVALID_INPUT}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        # Genuine engine failure — the caller should retry/escalate, not edit input.
        print(json.dumps({"error": str(exc), "status": 500, "code": ERR_ENGINE}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
