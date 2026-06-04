"""Phase D3 — artifact design: turn a need + reality analysis into a RoleSpec and a
CaseScenario. LLM path (Claude CLI) + deterministic fallback, mirroring automation.py.

The case is the heart: it ASSUMES the candidate's code is 100% LLM-generated, so it bakes
in COVERT tooling-probes (ambiguity that rewards clarifying, a legacy trap that rewards
reading-first, a verification trap) without telling the candidate they're being tested on
their AI use — and grades the five durable capabilities, not lines of code.
"""

from __future__ import annotations

import json
import threading
from typing import Any

from .models import RUBRIC_DIMENSIONS, DevNeed, NeedAnalysis

ROLE_DESIGN_PROMPT_VERSION = "role-design-v2"
CASE_DESIGN_PROMPT_VERSION = "case-design-v3"  # v3: domain-neutral vocabulary (non-IT)

# Seniority-scaled timebox (the lifecycle eval flagged junior/lead cases looking alike).
_TIMEBOX = {"junior": 3.0, "medior": 4.0, "senior": 6.0, "lead": 8.0}


def _timebox(seniority: str) -> float:
    return _TIMEBOX.get((seniority or "medior").lower(), 4.0)


_CORPUS_CACHE: list | None = None
# design_role runs inside lifecycle_eval / audit_role_fit ThreadPoolExecutors, so on a cold
# cache N workers could each see _CORPUS_CACHE is None and redundantly call load_corpus() (racing
# the assignment). Guard the lazy init with a lock; the outer check keeps the hot path lock-free.
_CORPUS_LOCK = threading.Lock()


def _comparable_roles(family: str, seniority: str) -> list[dict]:
    """A few real seed-corpus roles in the same family/seniority — market grounding for design_role."""
    global _CORPUS_CACHE
    try:
        if _CORPUS_CACHE is None:
            # Double-checked: re-test inside the lock so exactly one thread loads the corpus.
            with _CORPUS_LOCK:
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

# default rubric (weights sum to 1.0) — the five durable capabilities. Single source of
# truth lives in models.RUBRIC_DIMENSIONS so the case rubric and the evaluation breakdown
# can never drift apart.
_RUBRIC = RUBRIC_DIMENSIONS

PROBE_KINDS = ("ambiguity", "legacy_trap", "verification_trap", "underspecified")

# A cover-probe is meaningless without `reveals` — it IS the internal note on what a good vs
# naive response implies, so the field is MANDATORY (see CoverProbe in models.py). The producer
# (coerce, below) and the validator (lifecycle_eval._check_case) used to disagree: coerce kept a
# probe whose `reveals` the LLM left empty, then the validator failed the case for it. We close
# that gap here — coerce backfills any empty `reveals` from this kind-keyed default, so a probe is
# never emitted without one. The deterministic template draws its probe notes from the same map.
_PROBE_REVEALS_DEFAULT: dict[str, str] = {
    "ambiguity": "Do they clarify the ambiguity or silently assume?",
    "underspecified": "Do they clarify the ambiguity or silently assume?",
    "legacy_trap": "Do they read it before generating, or break it?",
    "verification_trap": "Do they add real tests / validate, or trust one-shot output?",
}


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


def design_case(
    need: DevNeed,
    analysis: NeedAnalysis,
    role: dict,
    *,
    provider: Any | None = None,
    focus_probes: list[dict] | None = None,
) -> tuple[dict, str]:
    """Design the work-sample. ``focus_probes`` (from
    :func:`soft_signals.panel_to_probe_briefs`) are CV-hypotheses to confirm —
    each becomes a TARGETED covert probe so the exercise verifies a specific
    claim (e.g. an over-claimed skill), closing the CV -> probe loop (Rec B)."""
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
        "providedContext": real,
        "trueComplexity": analysis.true_complexity,
        "riskAreas": analysis.risk_areas,
        "timeboxHours": timebox,
    }
    prompt = (
        "Design a CASE / work-sample EXERCISE for THIS role.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "DOMAIN VOCABULARY — the provided context is the body of work this role acts on: a codebase for "
        "software, but a content/campaign library for marketing, a financial model for finance, a CRM + "
        "playbooks for sales, a design system for design, etc. Use the ROLE'S OWN vocabulary throughout, and "
        "don't call it a 'codebase' or 'repo' unless the role is software — the JSON field is named 'repoSeed' "
        "for legacy reasons only, so describe the starting materials in the role's own terms (documents, "
        "spreadsheets, dashboards, designs, recordings, …).\n"
        "CRITICAL — the TASK TYPE must match what this role actually DOES (its function + responsibilities). "
        "The provided context is only the MATERIAL they act ON. Two cases:\n"
        "(a) If the role's work CAN be done on the provided context, do that — e.g. a security engineer "
        "THREAT-MODELS / hardens the given service; a performance marketer diagnoses the funnel and reallocates "
        "spend; an analyst stress-tests the model. Act ON it in the role's own way.\n"
        "(b) If the provided context is INCOMPATIBLE with the role (you genuinely cannot do the role's work on "
        "it — e.g. an iOS role but a web-only repo, or a marketing role but a finance model), DO NOT force it: "
        "design the exercise on a SYNTHETIC set of starting materials representative of the ROLE's own domain "
        "(describe them in 'repoSeed'), and note in the brief that the provided context does not fit the role. "
        "NEVER produce an exercise in the context's domain when that differs from the role being hired.\n"
        f"CALIBRATE to seniority '{seniority}': junior = narrow, well-scoped, more scaffolding, simpler probes; "
        "senior/lead = broader, more ambiguous, architectural and judgment-heavy. Fit the work to "
        f"~{timebox}h. Be concrete — name real files/symbols, avoid template phrases like 'per the brief'.\n"
        "ASSUME the candidate's code will be 100% LLM-generated, so COVERTLY probe how they DRIVE the tools and "
        "their judgment — WITHOUT telling them. Bake in 2-4 cover-probes: an underspecified/ambiguous "
        "requirement (rewards clarifying); a legacy/surprising area (rewards reading before generating); a "
        "verification trap where naive one-shot generation passes a shallow check but is subtly wrong.\n"
        + (
            "TARGETED CONFIRMATION — the candidate's CV raised these hypotheses; bake AT LEAST one cover-probe "
            "that specifically tests each (the candidate must NEVER see this):\n"
            + "\n".join(
                f"- {b.get('kind', 'verification_trap')} on '{b.get('focus', '')}': {b.get('rationale', '')}"
                for b in focus_probes
            )
            + "\n"
            if focus_probes
            else ""
        )
        + 'Return JSON: { "title": str, "brief": str, '
        '"repoSeed": str (the starting materials handed to the candidate — code, documents, data, or designs as fits the domain), '
        '"tasks": [str], '
        '"coverProbes": [ { "id": str, "kind": "ambiguity|legacy_trap|verification_trap|underspecified", '
        '"where": str, "reveals": str (REQUIRED, non-empty — what a good vs naive response implies) } ], '
        '"timeboxHours": number }. The "reveals" notes are INTERNAL. JSON only.'
    )

    def deterministic() -> dict:
        stack = ", ".join(real[:3]) or "the stack"
        title = role.get("title") or "Engineering"
        func = _human(role_family)
        det_probes = [
            {"id": "p1", "kind": "underspecified", "where": "the brief", "reveals": _PROBE_REVEALS_DEFAULT["underspecified"]},
            {"id": "p2", "kind": "legacy_trap", "where": "the legacy file", "reveals": _PROBE_REVEALS_DEFAULT["legacy_trap"]},
            {"id": "p3", "kind": "verification_trap", "where": "the thin test suite", "reveals": _PROBE_REVEALS_DEFAULT["verification_trap"]},
        ]
        for i, b in enumerate(focus_probes or []):  # targeted probes from the CV soft-signal panel
            kind = b.get("kind") or "verification_trap"
            if kind not in PROBE_KINDS:
                kind = "verification_trap"
            det_probes.append(
                {
                    "id": f"t{i + 1}",
                    "kind": kind,
                    "where": f"a task that exercises {b.get('focus') or 'the claimed strength'}",
                    "reveals": b.get("rationale") or "Confirm the CV claim with hands-on depth.",
                }
            )
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
            "coverProbes": det_probes,
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
            if kind not in PROBE_KINDS:
                kind = "ambiguity"
            # `reveals` is mandatory: backfill a kind-appropriate default when the LLM omits it
            # so a probe never reaches a case (or the lifecycle validator) with an empty note.
            reveals = str(p.get("reveals") or "").strip() or _PROBE_REVEALS_DEFAULT[kind]
            probes.append(
                {
                    "id": str(p.get("id") or f"p{len(probes) + 1}"),
                    "kind": kind,
                    "where": str(p.get("where") or ""),
                    "reveals": reveals,
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
