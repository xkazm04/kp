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

ROLE_DESIGN_PROMPT_VERSION = "role-design-v2"
CASE_DESIGN_PROMPT_VERSION = "case-design-v2"

# Seniority-scaled timebox (the lifecycle eval flagged junior/lead cases looking alike).
_TIMEBOX = {"junior": 3.0, "medior": 4.0, "senior": 6.0, "lead": 8.0}


def _timebox(seniority: str) -> float:
    return _TIMEBOX.get((seniority or "medior").lower(), 4.0)


_CORPUS_CACHE: list | None = None


def _comparable_roles(family: str, seniority: str) -> list[dict]:
    """A few real seed-corpus roles in the same family/seniority — market grounding for design_role."""
    global _CORPUS_CACHE
    try:
        if _CORPUS_CACHE is None:
            from ..matching import load_corpus

            _CORPUS_CACHE = load_corpus()
        out = []
        for j in _CORPUS_CACHE:
            if j.role_family == family and j.seniority == seniority:
                must = [r.skill for r in j.requirements if getattr(r, "kind", "") == "must_have"][:5]
                out.append({"title": j.title, "mustHaves": must})
            if len(out) >= 3:
                break
        return out
    except Exception:
        return []

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


def _human(role_family: str) -> str:
    return (role_family or "software engineering").replace("_", " ")


# --- role -------------------------------------------------------------------


def design_role(need: DevNeed, analysis: NeedAnalysis, *, provider: Any | None = None) -> tuple[dict, str]:
    real = analysis.real_stack or need.stack
    ctx = {
        "need": {
            "title": need.title,
            "statedResponsibilities": need.responsibilities,
            "seniorityTarget": need.seniority_target,
            "roleFamily": need.role_family,
        },
        "analysis": {
            "realStack": real,
            "coreResponsibilities": analysis.core_responsibilities,
            "trueComplexity": analysis.true_complexity,
            "statedVsRealGaps": analysis.stated_vs_real_gaps,
        },
        "comparableMarketRoles": _comparable_roles(need.role_family, need.seniority_target),
    }
    prompt = (
        "Design a precise RoleSpec. ANCHOR the role's IDENTITY to what they are HIRING FOR — the stated "
        "title, function (roleFamily) and responsibilities. Do NOT rename the role to the codebase's domain; "
        "the codebase is where this person will WORK, not what defines the role. Use the REAL stack to "
        "calibrate must-haves and to note honestly what transfers and what is a gap (e.g. a Flask codebase "
        "for a 'Backend Engineer' is fine and Python transfers; a security role on a data-pipeline codebase "
        "stays a security role). Calibrate scope to the seniority. Lightly ground against the comparable "
        "market roles.\n"
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
    seniority = role.get("seniority") or need.seniority_target
    timebox = _timebox(seniority)
    role_family = role.get("roleFamily") or need.role_family
    ctx = {
        "role": {
            "title": role.get("title"),
            "function": _human(role_family),
            "seniority": seniority,
            "responsibilities": role.get("responsibilities", []),
        },
        "providedCodebaseStack": real,
        "trueComplexity": analysis.true_complexity,
        "riskAreas": analysis.risk_areas,
        "timeboxHours": timebox,
    }
    prompt = (
        "Design a take-home CASE/ASSIGNMENT for THIS role.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "CRITICAL — the TASK TYPE must match what this role actually DOES (its function + responsibilities). "
        "The provided codebase is only the MATERIAL they act ON. Two cases:\n"
        "(a) If the role's work CAN be done on the provided codebase, do that — e.g. a security engineer "
        "THREAT-MODELS / hardens the given service (does NOT build features for it); a data engineer works the "
        "pipeline; a frontend engineer works the UI.\n"
        "(b) If the provided codebase is INCOMPATIBLE with the role (you genuinely cannot do the role's work on "
        "it — e.g. an iOS role but a web-only repo), DO NOT force it: design the case on a SYNTHETIC fixture "
        "representative of the ROLE's own domain (describe that fixture in repoSeed), and note in the brief that "
        "the provided codebase does not fit the role. NEVER produce a take-home in the codebase's domain when "
        "that differs from the role being hired.\n"
        f"CALIBRATE to seniority '{seniority}': junior = narrow, well-scoped, more scaffolding, simpler probes; "
        "senior/lead = broader, more ambiguous, architectural and judgment-heavy. Fit the work to "
        f"~{timebox}h. Be concrete — name real files/symbols, avoid template phrases like 'per the brief'.\n"
        "ASSUME the candidate's code will be 100% LLM-generated, so COVERTLY probe how they DRIVE the tools and "
        "their judgment — WITHOUT telling them. Bake in 2-4 cover-probes: an underspecified/ambiguous "
        "requirement (rewards clarifying); a legacy/surprising area (rewards reading before generating); a "
        "verification trap where naive one-shot generation passes a shallow check but is subtly wrong.\n"
        'Return JSON: { "title": str, "brief": str, "repoSeed": str, "tasks": [str], '
        '"coverProbes": [ { "id": str, "kind": "ambiguity|legacy_trap|verification_trap|underspecified", '
        '"where": str, "reveals": str } ], "timeboxHours": number }. The "reveals" notes are INTERNAL. JSON only.'
    )

    def deterministic() -> dict:
        stack = ", ".join(real[:3]) or "the stack"
        title = role.get("title") or "Engineering"
        func = _human(role_family)
        return {
            "title": f"{title}: assess and improve the codebase",
            "brief": (
                f"You are handed a small {stack} codebase. Do a piece of representative {func} work on it, scoped "
                f"to ~{timebox:g}h for a {seniority}. The brief is intentionally lightly specified — make and "
                "document your own calls."
            ),
            "repoSeed": "A minimal repo fixture: a working module, one under-documented legacy file, a thin test suite.",
            "tasks": [
                f"Do a representative {func} task on this {stack} codebase.",
                "Engage the existing legacy area you find under-documented.",
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
