"""Phase D3 — artifact design: turn a need + reality analysis into a RoleSpec and a
CaseScenario. LLM path (Claude CLI) + deterministic fallback, mirroring automation.py.

The case is the heart: it ASSUMES the candidate's code is 100% LLM-generated, so it bakes
in COVERT tooling-probes (ambiguity that rewards clarifying, a legacy trap that rewards
reading-first, a verification trap) without telling the candidate they're being tested on
their AI use — and grades the five durable capabilities, not lines of code.
"""

from __future__ import annotations

import json
from typing import Any

from .models import DevNeed, NeedAnalysis

ROLE_DESIGN_PROMPT_VERSION = "role-design-v1"
CASE_DESIGN_PROMPT_VERSION = "case-design-v1"

_SYSTEM = (
    "You design engineering hiring artifacts for the LLM era. Assume the candidate's code can be "
    "100% LLM-generated, so you probe judgment, tooling fluency, verification, architecture and "
    "transfer — never raw typing. Ground everything in the supplied reality. Output strict JSON only."
)

# default rubric (weights sum to 1.0) — the five durable capabilities
_RUBRIC = [
    {"name": "framing", "weight": 0.2, "description": "Turns an ambiguous need into a sound plan."},
    {"name": "tooling", "weight": 0.25, "description": "Drives the model/tools well; iterates and verifies."},
    {"name": "judgment", "weight": 0.25, "description": "Catches model mistakes; validates; pushes back."},
    {"name": "architecture", "weight": 0.15, "description": "Structure + trade-offs that fit the real codebase."},
    {"name": "transfer", "weight": 0.15, "description": "Capability transfers to THIS role's stack/responsibilities."},
]


def _generate(provider: Any | None, prompt: str, deterministic, coerce) -> tuple[dict, str]:
    if provider is None:
        return deterministic(), "deterministic"
    try:
        payload = provider.complete_json(prompt, system=_SYSTEM)
        return coerce(payload), "llm"
    except Exception:
        return deterministic(), "deterministic"


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x).strip() for x in value if str(x).strip()]


# --- role -------------------------------------------------------------------


def design_role(need: DevNeed, analysis: NeedAnalysis, *, provider: Any | None = None) -> tuple[dict, str]:
    real = analysis.real_stack or need.stack
    ctx = {
        "need": {"title": need.title, "seniorityTarget": need.seniority_target, "roleFamily": need.role_family},
        "analysis": {
            "realStack": real,
            "coreResponsibilities": analysis.core_responsibilities,
            "trueComplexity": analysis.true_complexity,
            "statedVsRealGaps": analysis.stated_vs_real_gaps,
        },
    }
    prompt = (
        "Design a precise RoleSpec grounded in the REAL stack (prefer it over the stated one where they "
        "differ). Be specific and honest.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "title": str, "seniority": "junior|medior|senior|lead", "roleFamily": str, '
        '"mustHaves": [str], "niceToHaves": [str], "responsibilities": [str], "languages": [str] }. JSON only.'
    )

    def deterministic() -> dict:
        title = need.title or f"{need.seniority_target.title()} {real[0] if real else 'Software'} Engineer"
        return {
            "title": title,
            "seniority": need.seniority_target,
            "roleFamily": need.role_family,
            "mustHaves": real[:5],
            "niceToHaves": [],
            "responsibilities": analysis.core_responsibilities or need.responsibilities or [],
            "languages": ["English"],
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        sen = str(payload.get("seniority") or "").strip().lower()
        if sen not in ("junior", "medior", "senior", "lead"):
            sen = det["seniority"]
        return {
            "title": str(payload.get("title") or det["title"]),
            "seniority": sen,
            "roleFamily": str(payload.get("roleFamily") or det["roleFamily"]),
            "mustHaves": _str_list(payload.get("mustHaves")) or det["mustHaves"],
            "niceToHaves": _str_list(payload.get("niceToHaves")),
            "responsibilities": _str_list(payload.get("responsibilities")) or det["responsibilities"],
            "languages": _str_list(payload.get("languages")) or det["languages"],
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = ROLE_DESIGN_PROMPT_VERSION
    return result, source


# --- case (the heart) -------------------------------------------------------


def design_case(need: DevNeed, analysis: NeedAnalysis, role: dict, *, provider: Any | None = None) -> tuple[dict, str]:
    real = analysis.real_stack or need.stack
    timebox = 4.0
    ctx = {
        "role": {"title": role.get("title"), "seniority": role.get("seniority"), "responsibilities": role.get("responsibilities", [])},
        "realStack": real,
        "trueComplexity": analysis.true_complexity,
        "riskAreas": analysis.risk_areas,
        "timeboxHours": timebox,
    }
    prompt = (
        "Design a take-home CASE/ASSIGNMENT for this role, grounded in the real stack below.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "ASSUME the candidate's code will be 100% LLM-generated. So the assignment must COVERTLY probe how "
        "they DRIVE the tools and their judgment — WITHOUT telling them they are being tested on AI use. Bake "
        "in 2-4 cover-probes, e.g.: an underspecified/ambiguous requirement (rewards clarifying vs assuming); a "
        "legacy/broken or surprising area (rewards reading before generating); a verification trap where naive "
        "one-shot generation passes a shallow check but is subtly wrong (rewards testing/validation). Tasks must "
        f"be doable in ~{timebox}h and grounded in {', '.join(real[:4]) or 'the stack'}.\n"
        'Return JSON: { "title": str, "brief": str, "repoSeed": str, "tasks": [str], '
        '"coverProbes": [ { "id": str, "kind": "ambiguity|legacy_trap|verification_trap|underspecified", '
        '"where": str, "reveals": str } ], "timeboxHours": number }. The "reveals" notes are INTERNAL (what a '
        "good vs naive response implies). JSON only."
    )

    def deterministic() -> dict:
        stack = ", ".join(real[:3]) or "the stack"
        return {
            "title": f"Extend the {real[0] if real else 'service'} ingest path",
            "brief": (
                f"You are handed a small {stack} service. Add a feature and harden an existing area. "
                "The brief is intentionally lightly specified — make and document your calls."
            ),
            "repoSeed": "A minimal repo fixture: a working module, one under-documented legacy file, a thin test suite.",
            "tasks": [
                f"Add an endpoint/feature in {stack} per the brief.",
                "Improve the existing legacy area you find under-documented.",
                "Make the change safe — show how you verified it.",
            ],
            "coverProbes": [
                {"id": "p1", "kind": "underspecified", "where": "the brief", "reveals": "Do they clarify the ambiguity or silently assume?"},
                {"id": "p2", "kind": "legacy_trap", "where": "the legacy file", "reveals": "Do they read it before generating, or break it?"},
                {"id": "p3", "kind": "verification_trap", "where": "the thin test suite", "reveals": "Do they add real tests / validate, or trust one-shot output?"},
            ],
            "timeboxHours": timebox,
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        probes = []
        for p in payload.get("coverProbes") or []:
            if not isinstance(p, dict) or not p.get("kind"):
                continue
            kind = str(p["kind"]).strip().lower()
            if kind not in ("ambiguity", "legacy_trap", "verification_trap", "underspecified"):
                kind = "ambiguity"
            probes.append(
                {
                    "id": str(p.get("id") or f"p{len(probes) + 1}"),
                    "kind": kind,
                    "where": str(p.get("where") or ""),
                    "reveals": str(p.get("reveals") or ""),
                }
            )
        try:
            tb = float(payload.get("timeboxHours"))
        except (TypeError, ValueError):
            tb = timebox
        return {
            "title": str(payload.get("title") or det["title"]),
            "brief": str(payload.get("brief") or det["brief"]),
            "repoSeed": str(payload.get("repoSeed") or det["repoSeed"]),
            "tasks": _str_list(payload.get("tasks")) or det["tasks"],
            "coverProbes": probes or det["coverProbes"],
            "timeboxHours": tb,
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["rubricDimensions"] = _RUBRIC
    result["promptVersion"] = CASE_DESIGN_PROMPT_VERSION
    return result, source
