"""CLI: normalize an intake draft into a routed, scored CandidateProfileV2.

Input JSON (stdin or --input-json): { "profile": {<draft>}, "signals": {...} }.
Runs the archetype router (signals.selfDeclared is primary; "auto"/absent ->
heuristic) and the completeness model, then emits the normalized profile plus
archetype/confidence/reasons/completeness/missing. Pure logic — no LLM — so the
intake stays fast. Invoked by /api/profile.

On failure an {"error","status","code"} envelope goes to stderr with an HONEST
status — 400/invalid_input for a malformed draft or bad JSON (the editor can show
a field-level hint), 500/engine_error for an unexpected fault — plus a matching
exit code (2 for 400, 1 otherwise), so the TS seam (python-runner.parseStderrError)
and /api/profile can tell user-fixable bad input from a real engine outage instead
of seeing every failure as a 500. Mirrors automation_cli.py / devcase_cli.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import registry
from ._cli import configure_stdio, emit_error, invalid_input
from .archetype import ARCHETYPES
from .profile import CandidateProfileV2, completeness_gaps, normalize_profile

# --- Honest error taxonomy (mirrors automation_cli.py / devcase_cli.py) ------
#   400 / invalid_input — a malformed intake draft (pydantic ValidationError) or
#                         bad JSON (json.JSONDecodeError); user-correctable
#   500 / engine_error  — an unexpected fault (retry/escalate, don't edit input)
# The WORDS are `_cli.ERROR_CODES`, imported rather than re-spelled: a local literal
# is a divergence waiting to happen (a lone "notfound" resolves to no errors.<CODE>
# catalog key), and the ratchet in tests/test_cli_error_envelope.py shrank by this file.


def main(argv: list[str] | None = None) -> int:
    # The guarded scaffold, not the open-coded pair: the old form tested only
    # sys.stdout and then called sys.stderr.reconfigure unconditionally, so a harness
    # (or a test) capturing one stream died with an AttributeError before line one.
    configure_stdio()

    parser = argparse.ArgumentParser(description="Route + score a candidate intake draft.")
    parser.add_argument("--input-json", type=Path, help="Input JSON file. Reads stdin if omitted.")
    args = parser.parse_args(argv)

    try:
        raw = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        profile = CandidateProfileV2.model_validate(raw.get("profile") or {})
        signals = raw.get("signals") or {}

        declared = signals.get("selfDeclared")
        self_declared = declared if declared in ARCHETYPES else None

        # detect_detailed, not detect_archetype: the 4th element is the LOCALIZABLE
        # twin of `reasons` ({kind, params} codes the catalogs translate). The English
        # sentences still ship beside it — same additive shape as missingGaps/missing.
        archetype, confidence, reasons, reason_codes = registry.detect_detailed(
            self_declared=self_declared,
            years_relevant_experience=signals.get("yearsRelevantExperience", profile.years_experience),
            is_enrolled=signals.get("isEnrolled"),
            expected_graduation=signals.get("expectedGraduation"),
            education_is_dominant=signals.get("educationIsDominant"),
            wants_domain_change=signals.get("wantsDomainChange"),
            has_substantial_experience=signals.get("hasSubstantialExperience"),
        )
        profile.archetype = archetype
        profile.archetype_confidence = confidence
        profile.archetype_reasons = reasons
        # Resolves evidence provenance + stamps completeness, and returns the
        # (score, missing) it computed — no second checklist pass.
        score, missing = normalize_profile(profile)
    except ValueError as exc:
        # A malformed intake draft (pydantic ValidationError) and bad JSON
        # (json.JSONDecodeError) are both ValueError subclasses and both
        # user-correctable, so they map to 400 invalid_input — the editor can
        # surface a field-level hint instead of a scary 500. Exit 2 matches
        # jobfit/cli.py and python-runner's parseStderrError fallback.
        emit_error(invalid_input(str(exc)))
        return 2
    except Exception as exc:
        # Genuine engine failure — the caller should retry/escalate, not edit input.
        return emit_error(exc)

    print(
        json.dumps(
            {
                "profile": profile.model_dump(by_alias=True, exclude_none=True),
                "archetype": archetype,
                "confidence": confidence,
                "reasons": reasons,
                # Machine-readable twin of `reasons`, same order: each routing reason
                # as {kind, params}. ADDITIVE — `reasons` (rendered English) stays for
                # back-compat; the panel renders the codes through the four catalogs
                # and falls back to the string at the same index for a result built
                # before this field existed.
                "reasonCodes": reason_codes,
                "completeness": score,
                "missing": missing,
                # Machine-readable twin of `missing`, same biggest-gap-first order:
                # each unmet checklist item as {check, label}. ADDITIVE — `missing`
                # (raw registry labels) stays for back-compat; the frontend joins on
                # the stable `check` id to localize the label AND route the clickable
                # "Add next" gap, so an unmatched EN label is no longer dead text.
                "missingGaps": completeness_gaps(profile),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
