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

from .models import (
    DEFAULT_TIMEBOX_HOURS,
    MAX_TIMEBOX_HOURS,
    RUBRIC_DIMENSIONS,
    DevNeed,
    NeedAnalysis,
    clamp_timebox_hours,
)
from .provenance import generate_with_fallback, str_list as _str_list

_LOG = logging.getLogger(__name__)

ROLE_DESIGN_PROMPT_VERSION = "role-design-v4"  # v4: grounding rules — must-haves trace to stated input, seniority read off JD signals (2026-08-11 bench)
CASE_DESIGN_PROMPT_VERSION = "case-design-v6"  # v6: midFlightUpdate — a requirement change revealed mid-session, so one-shot generation is structurally impossible (LLM-era controls #5)

# The cap on case length (UAT M8) is a POLICY number and now lives on the model
# (models.MAX_TIMEBOX_HOURS), where every writer meets it — this designer was only the
# first enforcer, and the approve route and the model default both drifted past it.
# The reasoning stays here because this is where the pressure is: the case's instrument
# is AMBIGUITY + a visible decision log, NOT volume — the candidate's code is assumed
# 100% LLM-generated — so a focused "real work, ≤2h" exercise is the goal at every
# level. A half-day take-home drives a 40–60% drop-off among strong seniors, the exact
# pool this case is for. Seniority scales DEPTH / ambiguity (see the prompt), not hours.

# Seniority-scaled timebox, every value bounded by MAX_TIMEBOX_HOURS.
_TIMEBOX = {"junior": 1.0, "medior": DEFAULT_TIMEBOX_HOURS, "senior": MAX_TIMEBOX_HOURS, "lead": MAX_TIMEBOX_HOURS}


def _timebox(seniority: str) -> float:
    return _TIMEBOX.get((seniority or "medior").lower(), DEFAULT_TIMEBOX_HOURS)


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


def _generate(provider: Any | None, prompt: str, deterministic, coerce, expected_keys=None) -> tuple[dict, str]:
    # Shared LLM-or-deterministic runner: on an LLM failure it logs the cause at WARNING
    # and stashes a one-line fallbackReason on the artifact (see provenance.generate_with_fallback).
    # expected_keys pins the answer by shape so a trailing injected object can't win the parse (#3).
    return generate_with_fallback(provider, prompt, _SYSTEM, deterministic, coerce, _LOG, expected_keys=expected_keys)


# Known top-level schema keys per design step (bug-hunter #3).
_ROLE_KEYS = ("title", "seniority", "roleFamily", "mustHaves", "niceToHaves", "responsibilities", "languages")
_CASE_KEYS = ("title", "brief", "repoSeed", "tasks", "coverProbes", "timeboxHours", "midFlightUpdate")


def _human(role_family: str) -> str:
    return (role_family or "software engineering").replace("_", " ")


# --- role -------------------------------------------------------------------


def design_role(need: DevNeed, analysis: NeedAnalysis, *, provider: Any | None = None, lang: str = "en") -> tuple[dict, str]:
    real = analysis.real_stack or need.stack
    # Graded dealbreakers from the hiring-intake brief (empty on pre-intake
    # needs). Serialized by alias so the prompt sees the same camelCase shape
    # the TS side and the brief use.
    stated_reqs = [r.model_dump(by_alias=True) for r in need.stated_requirements]
    ctx = {
        "need": {
            "title": need.title,
            "statedResponsibilities": need.responsibilities,
            "seniorityTarget": need.seniority_target,
            "roleFamily": need.role_family,
            # JD-first intake: when the need came from a saved job description its body is
            # the primary statement of what they're hiring for — anchor the role to it.
            "jobDescription": need.jd_text[:4000] or None,
            # Role-intake grading: the requestor's OWN must/nice + prerequisite/
            # learnable split with weights — the highest-authority requirement
            # signal when present (it was read back and confirmed in dialog).
            "statedRequirements": stated_reqs or None,
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
        "authoritative statement of the need, so draw must-haves and responsibilities from it. When "
        "statedRequirements are supplied they are the requestor's OWN graded dealbreakers, read back and "
        "confirmed in the hiring intake — every kind=must_have entry must appear in mustHaves (highest "
        "weight first) unless the analysis concretely contradicts it, and kind=nice_to_have entries "
        "belong in niceToHaves, never promoted. Do NOT "
        "rename the role to the codebase's domain; "
        "the codebase is where this person will WORK, not what defines the role. Use the REAL stack to "
        "calibrate must-haves and to note honestly what transfers and what is a gap (e.g. a Flask codebase "
        "for a 'Backend Engineer' is fine and Python transfers; a security role on a data-pipeline codebase "
        "stays a security role). Calibrate scope to the seniority. Lightly ground against the comparable "
        "market roles.\n"
        "Grounding rules (a spec that inflates the need mis-hires): every mustHave must trace to "
        "something the need/JD/analysis actually STATES — never promote a named tool, product, or "
        "process the input does not mention into a requirement (illustrative examples belong in "
        "niceToHaves, phrased as 'e.g.', or nowhere). Keep the must-have list short and decisive "
        "(≤8) rather than exhaustive. Read the seniority off the JD's own signals (education asked, "
        "experience asked, scope of duties) — do not default to the seniorityTarget when the JD "
        "plainly describes a more junior or senior role; carry the JD's explicitly named candidate "
        "traits into the spec before adding anything of your own.\n"
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
        # Stated must-haves (weight-ordered) lead; real-stack fills the remainder —
        # so a keyless run still honors the intake's confirmed dealbreakers.
        stated_musts = [r.skill for r in sorted(need.stated_requirements, key=lambda r: -r.weight) if r.kind == "must_have" and r.skill]
        musts = stated_musts + [s for s in real if s.lower() not in {m.lower() for m in stated_musts}]
        stated_nices = [r.skill for r in need.stated_requirements if r.kind == "nice_to_have" and r.skill]
        return {
            "title": title,
            "seniority": need.seniority_target,
            "roleFamily": need.role_family,
            "mustHaves": musts[:6] if stated_musts else real[:5],
            "niceToHaves": stated_nices[:5],
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

    result, source = _generate(provider, prompt, deterministic, coerce, expected_keys=_ROLE_KEYS)
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
        "senior/lead = MORE AMBIGUOUS and judgment-heavy — raise the DEPTH and ambiguity, NOT the number of "
        f"deliverables. The ~{timebox}h is a HARD cap: scope the tasks so a real candidate can genuinely finish "
        "in that budget (prefer 3-4 focused tasks; depth over coverage), and never pad a senior case with extra "
        "sub-deliverables to make it 'harder'. Be concrete — name real files/symbols/materials, avoid template "
        "phrases like 'per the brief'.\n"
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
        "MID-FLIGHT UPDATE — design ONE requirement change ('midFlightUpdate') that the platform reveals to the "
        "candidate PARTWAY through the session (they are not told in advance). It must plausibly come from the "
        "stakeholder ('the team just learned that …'), genuinely affect work already likely underway (so earlier "
        "decisions deserve revisiting — not just an extra task), and stay answerable within the timebox. "
        "'afterMinutes' is when it fires (roughly a third of the timebox in); 'reveals' is the INTERNAL note on "
        "what good vs poor adaptation looks like. This makes one-shot generation structurally impossible: the "
        "brief the candidate started from is no longer the brief they must finish against.\n"
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
        '"timeboxHours": number, '
        '"midFlightUpdate": { "afterMinutes": int, "update": str (candidate-facing, in the stakeholder\'s voice), '
        '"reveals": str (INTERNAL — what good vs poor adaptation looks like) } }. '
        'The "reveals" and "decisionSpace" notes are INTERNAL. JSON only.'
    )
    # DEVP5 — the candidate reads the title/brief/tasks, so render that narrative
    # in the requested language (code/enum values + proper nouns stay verbatim
    # per the shared directive). The deterministic fallback below stays English.
    from ..i18n import language_directive

    prompt = f"{prompt}\n\n{language_directive(lang)}"

    def deterministic() -> dict:
        # Domain-NEUTRAL last-resort template — fires ONLY when the LLM call is
        # unavailable or RAISES (e.g. a generation timeout on a complex case). It must
        # never betray the role's domain: an HR / finance / sales role whose LLM call
        # timed out used to fall back to a SOFTWARE case ("assess and improve the
        # codebase", a "legacy file", a "thin test suite"), which drifts role-fit and
        # tanks quality (real-JD calibration finding). So describe the work in the
        # role's OWN terms — starting MATERIALS, not a repo — and keep the probes
        # generic (an open requirement, an under-documented area, a shallow check).
        materials = ", ".join(real[:3]) or "the role's materials"
        title = role.get("title") or _human(role_family).title()
        func = _human(role_family)
        det_probes = [
            {
                "id": "p1",
                "kind": "underspecified",
                "where": "the brief",
                "reveals": _PROBE_REVEALS_DEFAULT["underspecified"],
                "decisionSpace": ["Clarify the open requirement before starting", "Pick an interpretation, state it and proceed", "Handle both readings and flag the choice"],
            },
            {
                "id": "p2",
                "kind": "legacy_trap",
                "where": "the under-documented area in the materials",
                "reveals": _PROBE_REVEALS_DEFAULT["legacy_trap"],
                "decisionSpace": ["Preserve the existing approach and work around it", "Revise it with a safeguard in place first", "Replace it outright and accept the risk"],
            },
            {
                "id": "p3",
                "kind": "verification_trap",
                "where": "a result that passes a shallow check but is subtly wrong",
                "reveals": _PROBE_REVEALS_DEFAULT["verification_trap"],
                "decisionSpace": ["Check the result properly before relying on it", "Verify manually and document the steps", "Trust the first result and proceed"],
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
            "title": f"{title}: a representative work-sample",
            "brief": (
                f"You are handed a small set of starting materials for this {func} role ({materials}). Do a piece "
                f"of representative work on them, scoped to ~{timebox:g}h for a {seniority}. The brief is "
                "intentionally lightly specified — make and document your own calls."
            ),
            "repoSeed": "A minimal set of starting materials this role works with: a primary working item, one under-documented or legacy area, and a way to check your work.",
            "tasks": [
                f"Do a representative {func} task on the supplied materials.",
                "Engage the under-documented / legacy area you find — understand it before you change it.",
                "Make your change safe — show how you checked it before handing it on.",
                # The visible decision trail — the submission must encode the candidate's path
                # through the ambiguities so the post-evaluation interview can verify they own it.
                "Keep a short DECISIONS log: for every call you made where the brief was open — what you chose, the alternative you rejected, and what you would have asked the team.",
            ],
            "coverProbes": det_probes,
            "timeboxHours": timebox,
            # Generic but real: a scope-affecting constraint change a third of the way in.
            "midFlightUpdate": {
                "afterMinutes": max(10, int(timebox * 60 / 3)),
                "update": (
                    "Quick update from the team: one assumption in the brief has changed — a constraint you were "
                    "given is stricter than stated. Note in your DECISIONS log which of your calls this affects "
                    "and adjust the one that matters most."
                ),
                "reveals": "Do they re-plan and revisit earlier decisions, or bolt the change on without reconciling it?",
            },
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
        # candidate. The bound itself is models.clamp_timebox_hours — one rule, shared
        # with the CaseScenario validator and (via codegen) with the TS approve route.
        tb = clamp_timebox_hours(tb)
        # Mid-flight update (v6): keep only a well-formed one — a non-empty candidate-facing
        # `update` with a sane fire time (clamped inside the timebox so it can actually land).
        mfu_raw = payload.get("midFlightUpdate")
        mfu = None
        if isinstance(mfu_raw, dict) and str(mfu_raw.get("update") or "").strip():
            try:
                after = int(float(mfu_raw.get("afterMinutes")))
            except (TypeError, ValueError):
                after = max(10, int(tb * 60 / 3))
            after = min(max(after, 5), max(5, int(tb * 60) - 15))
            mfu = {
                "afterMinutes": after,
                "update": str(mfu_raw["update"]).strip(),
                "reveals": str(mfu_raw.get("reveals") or "").strip()
                or "Do they re-plan and revisit earlier decisions, or bolt the change on?",
            }
        if mfu is None:
            mfu = det["midFlightUpdate"]
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
            "midFlightUpdate": mfu,
        }

    result, source = _generate(provider, prompt, deterministic, coerce, expected_keys=_CASE_KEYS)
    result["rubricDimensions"] = _RUBRIC
    result["promptVersion"] = CASE_DESIGN_PROMPT_VERSION
    return result, source
