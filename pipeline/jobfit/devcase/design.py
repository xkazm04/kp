"""Phase D3 — artifact design: turn a need + reality analysis into a RoleSpec and a
CaseScenario. LLM path (Claude CLI) + deterministic fallback, mirroring automation.py.

The case is the heart: it ASSUMES the candidate's code is 100% LLM-generated, so it bakes
in COVERT tooling-probes (ambiguity that rewards clarifying, a legacy trap that rewards
reading-first, a verification trap) without telling the candidate they're being tested on
their AI use — and grades the five durable capabilities, not lines of code.
"""

from __future__ import annotations

import json
import logging
import math
import threading
from typing import Any

from .models import RUBRIC_DIMENSIONS, DevNeed, NeedAnalysis
from .provenance import generate_with_fallback, str_list as _str_list

_LOG = logging.getLogger(__name__)

ROLE_DESIGN_PROMPT_VERSION = "role-design-v3"  # v3: JD-first intake — full JD body anchors the role
CASE_DESIGN_PROMPT_VERSION = "case-design-v4"  # v4: ambiguity as the instrument — probes carry a decisionSpace, the case forces a visible decision log

# Hard cap on case length (UAT M8). The case's instrument is AMBIGUITY + a visible
# decision log, NOT volume — the candidate's code is assumed 100% LLM-generated — so
# a focused "real work, ≤2h" exercise is the goal at every level. A half-day
# take-home drives a 40–60% drop-off among strong seniors, the exact pool this case
# is for. Seniority scales DEPTH / ambiguity (see the prompt), not hours.
_MAX_TIMEBOX_HOURS = 2.0

# Seniority-scaled timebox, every value bounded by _MAX_TIMEBOX_HOURS.
_TIMEBOX = {"junior": 1.0, "medior": 1.5, "senior": 2.0, "lead": 2.0}


def _timebox(seniority: str) -> float:
    return _TIMEBOX.get((seniority or "medior").lower(), 1.5)


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
    # Shared LLM-or-deterministic runner: on an LLM failure it logs the cause at WARNING
    # and stashes a one-line fallbackReason on the artifact (see provenance.generate_with_fallback).
    return generate_with_fallback(provider, prompt, _SYSTEM, deterministic, coerce, _LOG)


def _human(role_family: str) -> str:
    return (role_family or "software engineering").replace("_", " ")


# --- role -------------------------------------------------------------------


def design_role(need: DevNeed, analysis: NeedAnalysis, *, provider: Any | None = None, lang: str = "en") -> tuple[dict, str]:
    real = analysis.real_stack or need.stack
    ctx = {
        "need": {
            "title": need.title,
            "statedResponsibilities": need.responsibilities,
            "seniorityTarget": need.seniority_target,
            "roleFamily": need.role_family,
            # JD-first intake: when the need came from a saved job description its body is
            # the primary statement of what they're hiring for — anchor the role to it.
            "jobDescription": need.jd_text[:4000] or None,
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
        "title, function (roleFamily) and responsibilities; when a jobDescription is supplied it is the "
        "authoritative statement of the need, so draw must-haves and responsibilities from it. Do NOT "
        "rename the role to the codebase's domain; "
        "the codebase is where this person will WORK, not what defines the role. Use the REAL stack to "
        "calibrate must-haves and to note honestly what transfers and what is a gap (e.g. a Flask codebase "
        "for a 'Backend Engineer' is fine and Python transfers; a security role on a data-pipeline codebase "
        "stays a security role). Calibrate scope to the seniority. Lightly ground against the comparable "
        "market roles.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "title": str, "seniority": "junior|medior|senior|lead", "roleFamily": str, '
        '"mustHaves": [str], "niceToHaves": [str], "responsibilities": [str], "languages": [str] }. JSON only.'
    )
    # JDL5 — the role's responsibilities/must-haves become the JD body candidates
    # read, so render that prose in the requested language; skill/role-family/
    # seniority CODE values stay verbatim per the shared directive (so matching
    # and the rubric never break). The deterministic fallback stays English.
    from ..i18n import language_directive

    prompt = f"{prompt}\n\n{language_directive(lang)}"

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
    feedback: str | None = None,
    lang: str = "en",
) -> tuple[dict, str]:
    """Design the work-sample. ``focus_probes`` (from
    :func:`soft_signals.panel_to_probe_briefs`) are CV-hypotheses to confirm —
    each becomes a TARGETED covert probe so the exercise verifies a specific
    claim (e.g. an over-claimed skill), closing the CV -> probe loop (Rec B).
    ``feedback`` (W5-4) is a human reviewer's revision note from the approval
    gate — a redesign honors it instead of forcing a full re-run from intake."""
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
    # The `repoSeed` JSON field below is the domain-neutral "starting materials" — its real,
    # canonical contract now lives on models.CaseScenario.repo_seed (kept named `repoSeed` only
    # for the TS round-trip). The prompt still steers the LLM to describe it in the role's terms.
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
        "ASSUME the candidate's code will be 100% LLM-generated — including the commits and any write-up, so "
        "NOTHING in the artifact proves authorship. The case's real instrument is AMBIGUITY: bake in 2-4 "
        "cover-probes — an underspecified/ambiguous requirement (rewards clarifying); a legacy/surprising area "
        "(rewards reading before generating); a verification trap where naive one-shot generation passes a "
        "shallow check but is subtly wrong — and design each so the submission CANNOT avoid encoding a choice. "
        "For each probe, enumerate a 'decisionSpace': the 2-3 DEFENSIBLE options it admits, each with a "
        "different trade-off (not one right answer + distractors). The candidate's path through these "
        "ambiguities is what gets evaluated and what the post-evaluation interview verifies they OWN.\n"
        "REQUIRE a visible decision trail: one task must ask the candidate to keep a short DECISIONS log — for "
        "every call they made where the brief was open: what they chose, the alternative they rejected, and "
        "what they would have asked the team. Frame it as normal engineering practice, never as a test.\n"
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
        + (
            "REVIEWER FEEDBACK — a human reviewed a previous design of this case at the approval gate and "
            "asked for these changes; honor them in this redesign:\n"
            f"{feedback.strip()}\n"
            if feedback and feedback.strip()
            else ""
        )
        + 'Return JSON: { "title": str, "brief": str, '
        '"repoSeed": str (the starting materials handed to the candidate — code, documents, data, or designs as fits the domain), '
        '"tasks": [str], '
        '"coverProbes": [ { "id": str, "kind": "ambiguity|legacy_trap|verification_trap|underspecified", '
        '"where": str, "reveals": str (REQUIRED, non-empty — what a good vs naive response implies), '
        '"decisionSpace": [str] (the 2-3 defensible options this ambiguity admits, each a different trade-off) } ], '
        '"timeboxHours": number }. The "reveals" and "decisionSpace" notes are INTERNAL. JSON only.'
    )
    # DEVP5 — the candidate reads the title/brief/tasks, so render that narrative
    # in the requested language (code/enum values + proper nouns stay verbatim
    # per the shared directive). The deterministic fallback below stays English.
    from ..i18n import language_directive

    prompt = f"{prompt}\n\n{language_directive(lang)}"

    def deterministic() -> dict:
        stack = ", ".join(real[:3]) or "the stack"
        title = role.get("title") or "Engineering"
        func = _human(role_family)
        det_probes = [
            {
                "id": "p1",
                "kind": "underspecified",
                "where": "the brief",
                "reveals": _PROBE_REVEALS_DEFAULT["underspecified"],
                "decisionSpace": ["Clarify the open requirement before building", "Pick an interpretation, state it and proceed", "Build for both readings behind a switch"],
            },
            {
                "id": "p2",
                "kind": "legacy_trap",
                "where": "the legacy file",
                "reveals": _PROBE_REVEALS_DEFAULT["legacy_trap"],
                "decisionSpace": ["Preserve the legacy behaviour and work around it", "Refactor it with a safety net first", "Replace it outright and accept the risk"],
            },
            {
                "id": "p3",
                "kind": "verification_trap",
                "where": "the thin test suite",
                "reveals": _PROBE_REVEALS_DEFAULT["verification_trap"],
                "decisionSpace": ["Extend the existing tests before changing code", "Verify manually and document the steps", "Trust the existing suite and ship"],
            },
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
                    "decisionSpace": [],
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
                # The visible decision trail — the submission must encode the candidate's path
                # through the ambiguities so the post-evaluation interview can verify they own it.
                "Keep a short DECISIONS log: for every call you made where the brief was open — what you chose, the alternative you rejected, and what you would have asked the team.",
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
                    # decisionSpace is best-effort (unlike reveals): an empty list means the
                    # probe predates / omitted the decision-space contract, and mint_followups
                    # falls back to the probe outcome alone.
                    "decisionSpace": _str_list(p.get("decisionSpace")),
                }
            )
        try:
            tb = float(payload.get("timeboxHours"))
            if not math.isfinite(tb):  # NaN would survive the min/max clamp → "~nanh"
                raise ValueError("non-finite timeboxHours")
        except (TypeError, ValueError):
            tb = timebox
        # Clamp the model's own estimate to the cap (UAT M8): left alone the LLM
        # routinely echoes a longer take-home back, and this number is shown to the
        # candidate. Floor at 0.5h so a degenerate 0 can't render "~0h".
        tb = min(max(tb, 0.5), _MAX_TIMEBOX_HOURS)
        return {
            "title": str(payload.get("title") or det["title"]),
            "brief": str(payload.get("brief") or det["brief"]),
            # Emitted as `repoSeed` for the TS round-trip; also accept the `startingMaterials`
            # alias, mirroring CaseScenario.repo_seed (whose docstring carries the real contract:
            # these are domain-neutral starting materials, not necessarily a repository).
            "repoSeed": str(payload.get("repoSeed") or payload.get("startingMaterials") or det["repoSeed"]),
            "tasks": _str_list(payload.get("tasks")) or det["tasks"],
            "coverProbes": probes or det["coverProbes"],
            "timeboxHours": tb,
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["rubricDimensions"] = _RUBRIC
    result["promptVersion"] = CASE_DESIGN_PROMPT_VERSION
    return result, source
