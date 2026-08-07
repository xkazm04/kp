"""CLI: draft a CandidateProfileV2 intake from free-text recruiter notes (AI).

Input JSON (stdin or --input-json): { "text": "<free text: notes, a pasted
LinkedIn blurb, an email…>" }. Calls Gemini once to extract the structured intake
the Profile editor uses (basics + skill provenance + evidence + the
archetype-routing signals a thin note omits), then runs the SAME deterministic
archetype router as the manual intake so the AI draft and a hand-built profile
route identically. Emits { profile, signals, archetype, confidence, reasons }.

The recruiter reviews/edits the draft before saving — this fills the form, it
does not persist. Invoked by /api/profile/draft. The LLM call is isolated from
the pure ``build_draft`` assembly so the mapping/routing is unit-tested without a
network or API key (see tests/test_profile_draft.py).

On failure an {"error","status","code"} envelope goes to stderr with an HONEST
status — 400/invalid_input for malformed input JSON or a draft that fails
validation (exit 2, the editor can show a field-level hint), 500/engine_error for
an AI/engine fault (exit 1, retry/escalate) — mirroring profile_cli.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .archetype import detect_archetype
from .profile import EVIDENCE_KINDS, SKILL_LEVELS
from .taxonomy import PROVENANCE_WEIGHTS, ROLE_FAMILIES

# --- Honest error taxonomy (mirrors profile_cli.py) --------------------------
#   400 / invalid_input — malformed input JSON (json.JSONDecodeError) or a draft
#                         that fails validation (pydantic ValidationError); both
#                         ValueError subclasses and user-correctable
#   500 / engine_error  — an unexpected fault / AI outage (retry/escalate)
ERR_INVALID_INPUT = "invalid_input"
ERR_ENGINE = "engine_error"

# Sanitization vocabularies — sourced from the single source of truth (profile.py
# / taxonomy.py) so a kind/level/provenance added there is accepted here too,
# instead of a hand-kept copy that silently rejects new values (idea-ba28f11b).
_SKILL_LEVELS = set(SKILL_LEVELS)
_EDU_LEVELS = {"phd", "master", "bachelor", "university", "unknown"}
_EVIDENCE_KINDS = set(EVIDENCE_KINDS)

# The shape we ask Gemini to return. Mirrors the manual intake fields so the
# resulting draft loads straight into the editor.
DRAFT_SCHEMA: dict[str, Any] = {
    "display_name": "candidate name, or null",
    "role_family": f"one of: {' | '.join(ROLE_FAMILIES)}",
    "education_level": "one of: phd | master | bachelor | university | unknown",
    "education_detail": "study programme / specialisation / expected graduation, or ''",
    "languages": ["spoken/working languages"],
    "location": "city or null",
    "availability": "availability note or null",
    "years_experience": "number of relevant years, or null",
    "aspirations": ["target roles the candidate wants"],
    "skill_claims": [
        {
            "skill": "...",
            "level": "one of: foundational | working | strong",
            "provenance": "one of: professional | internship | personal_project | open_source | coursework | certification | self_declared",
        }
    ],
    "experiences": [
        {
            "kind": "one of: job | internship | project | thesis | course | extracurricular | certification | other",
            "title": "...",
            "text": "one line on what they did",
            "skills": ["..."],
            "link": "url to code/demo, or null",
        }
    ],
    "is_enrolled": "true if currently a student / enrolled, else false",
    "expected_graduation": "expected graduation year like '2026', or null",
    "wants_domain_change": "true if switching field/industry, else false",
    "has_substantial_experience": "true if 3+ years professional experience in any field, else false",
}


def _clean_str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [s.strip() for s in value if isinstance(s, str) and s.strip()]


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1"}
    return False


def _one_of(value: Any, allowed: set[str], default: str) -> str:
    v = value.strip().lower() if isinstance(value, str) else ""
    return v if v in allowed else default


def build_draft(payload: dict[str, Any]) -> dict[str, Any]:
    """Pure: map a Gemini extraction payload into a routed intake draft.

    Sanitizes every enum (role_family / education_level / skill level+provenance /
    evidence kind) to a known value so a hallucinated label can't poison the
    profile, then runs the deterministic router. No network, no I/O.
    """
    role_family = _one_of(payload.get("role_family"), set(ROLE_FAMILIES), "software_engineering")
    education_level = _one_of(payload.get("education_level"), _EDU_LEVELS, "unknown")

    skill_claims: list[dict[str, str]] = []
    for raw in payload.get("skill_claims") or []:
        if not isinstance(raw, dict):
            continue
        skill = _clean_str(raw.get("skill"))
        if not skill:
            continue
        skill_claims.append(
            {
                "skill": skill,
                "level": _one_of(raw.get("level"), _SKILL_LEVELS, "working"),
                "provenance": _one_of(raw.get("provenance"), set(PROVENANCE_WEIGHTS), "self_declared"),
            }
        )

    evidence: list[dict[str, Any]] = []
    for raw in payload.get("experiences") or []:
        if not isinstance(raw, dict):
            continue
        title = _clean_str(raw.get("title"))
        text = _clean_str(raw.get("text"))
        if not (title or text):
            continue
        item: dict[str, Any] = {
            "kind": _one_of(raw.get("kind"), _EVIDENCE_KINDS, "other"),
            "title": title,
            "text": text,
            "skills": _str_list(raw.get("skills")),
        }
        link = _clean_str(raw.get("link"))
        if link:
            item["link"] = link
        evidence.append(item)

    years_raw = payload.get("years_experience")
    years = years_raw if isinstance(years_raw, (int, float)) and not isinstance(years_raw, bool) else None

    profile: dict[str, Any] = {
        "displayName": _clean_str(payload.get("display_name")) or None,
        "roleFamily": role_family,
        "educationLevel": education_level,
        "educationDetail": _clean_str(payload.get("education_detail")),
        "languages": _str_list(payload.get("languages")),
        "location": _clean_str(payload.get("location")) or None,
        "availability": _clean_str(payload.get("availability")) or None,
        "aspirations": _str_list(payload.get("aspirations")),
        "skillClaims": skill_claims,
        "evidence": evidence,
    }
    if years is not None:
        profile["yearsExperience"] = years

    expected_graduation = _clean_str(payload.get("expected_graduation")) or None
    is_enrolled = _as_bool(payload.get("is_enrolled"))
    wants_domain_change = _as_bool(payload.get("wants_domain_change"))
    has_substantial = _as_bool(payload.get("has_substantial_experience"))

    signals = {
        "selfDeclared": "auto",
        "isEnrolled": is_enrolled,
        "expectedGraduation": expected_graduation,
        "wantsDomainChange": wants_domain_change,
        "hasSubstantialExperience": has_substantial,
    }

    archetype, confidence, reasons = detect_archetype(
        self_declared=None,
        years_relevant_experience=years,
        is_enrolled=is_enrolled,
        expected_graduation=expected_graduation,
        wants_domain_change=wants_domain_change,
        has_substantial_experience=has_substantial,
    )

    return {
        "profile": profile,
        "signals": signals,
        "archetype": archetype,
        "confidence": confidence,
        "reasons": reasons,
    }


def _extract(text: str, lang: str = "en") -> dict[str, Any]:
    """Single Gemini call: free text -> DRAFT_SCHEMA payload.

    ``lang`` localizes only the free-form text fields; archetype/provenance
    enum values stay canonical (they are coerced downstream)."""
    from .gemini import grounded_answer
    from .i18n import language_directive

    schema_text = json.dumps(DRAFT_SCHEMA, ensure_ascii=False, indent=2)
    prompt = (
        "You are a recruiter's assistant building a structured candidate profile from informal notes.\n"
        "Read the notes below and return ONE strict JSON object matching this shape exactly:\n\n"
        f"{schema_text}\n\n"
        "Rules:\n"
        "- Output JSON only, no markdown fences, no commentary.\n"
        "- Infer the archetype-routing signals (is_enrolled, expected_graduation, wants_domain_change, "
        "has_substantial_experience) honestly from the notes; use false/null when unclear rather than guessing.\n"
        "- Tag each skill's provenance from how the notes describe it (a school project is coursework/personal_project, "
        "not professional). Default to self_declared when unstated.\n"
        "- Do not invent facts that are not supported by the notes. Empty lists are fine.\n"
        f"- {language_directive(lang)}\n\n"
        f"Notes:\n{text.strip()}\n"
    )
    # Multi-provider routing (docs/architecture/llm-provider-layer.md): ONLY an explicit
    # KP_LLM_CONFIG row for profile_draft re-routes this call — the
    # unconfigured default stays the direct Gemini path below, byte-for-byte
    # the pre-registry behavior (resolve_provider's fallback is the Claude
    # CLI, which would silently change this Gemini-default use case).
    from .llm.config import load_config

    cfg = load_config()
    entry = cfg.for_use_case("profile_draft") if cfg else None
    if entry is not None:
        from .llm import resolve_provider

        provider = resolve_provider("profile_draft", timeout=120)
        if provider.available():
            payload = provider.complete_json(prompt, expected_keys=tuple(DRAFT_SCHEMA.keys()))
            if not isinstance(payload, dict) or not payload:
                raise RuntimeError("AI returned no structured draft. Try adding more detail to the notes.")
            return payload

    answer = grounded_answer(
        prompt=prompt,
        response_mime_type="application/json",
        temperature=0.1,
        max_output_tokens=4000,
        parse_json=True,
        expected_keys=tuple(DRAFT_SCHEMA.keys()),
        use_case="profile_draft",
    )
    if not answer.payload:
        raise RuntimeError("AI returned no structured draft. Try adding more detail to the notes.")
    return answer.payload


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Draft a candidate intake from free-text notes via AI.")
    parser.add_argument("--input-json", type=Path, help="Input JSON file. Reads stdin if omitted.")
    parser.add_argument("--lang", default="en", help="Output locale for free-form fields (en, cs).")
    args = parser.parse_args(argv)

    try:
        raw = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        text = _clean_str(raw.get("text"))
        if not text:
            # bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #5): empty notes are
            # user-correctable, so emit the same 400/invalid_input + exit 2 as the
            # ValueError branch below — the prior exit-1/status-400 mismatch made the TS
            # seam (parseStderrError) read exit 1 as a 500.
            print(json.dumps({"error": "No notes supplied.", "status": 400, "code": ERR_INVALID_INPUT}, ensure_ascii=False), file=sys.stderr)
            return 2
        payload = _extract(text, lang=args.lang)
        draft = build_draft(payload)
    except ValueError as exc:
        # bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #5): a malformed input
        # JSON (json.JSONDecodeError) or a draft that fails validation (pydantic
        # ValidationError) — both ValueError subclasses — is user-correctable, so map it
        # to 400/invalid_input (exit 2) as profile_cli does, instead of collapsing every
        # failure into a scary engine_error 500 the recruiter can't act on.
        print(json.dumps({"error": str(exc), "status": 400, "code": ERR_INVALID_INPUT}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        # Genuine engine/AI fault (Gemini outage, empty structured draft) — retry/escalate.
        print(json.dumps({"error": str(exc), "status": 500, "code": ERR_ENGINE}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(draft, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
