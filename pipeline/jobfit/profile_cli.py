"""CLI: normalize an intake draft into a routed, scored CandidateProfileV2.

Input JSON (stdin or --input-json): { "profile": {<draft>}, "signals": {...} }.
Runs the archetype router (signals.selfDeclared is primary; "auto"/absent ->
heuristic) and the completeness model, then emits the normalized profile plus
archetype/confidence/reasons/completeness/missing. Pure logic — no LLM — so the
intake stays fast. Invoked by /api/profile.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .archetype import ARCHETYPES, detect_archetype
from .profile import CandidateProfileV2, normalize_profile


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

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

        archetype, confidence, reasons = detect_archetype(
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
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "profile": profile.model_dump(by_alias=True, exclude_none=True),
                "archetype": archetype,
                "confidence": confidence,
                "reasons": reasons,
                "completeness": score,
                "missing": missing,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
