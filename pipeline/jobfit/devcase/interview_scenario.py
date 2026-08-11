"""Case -> AI-interview scenario (the case-designed interview).

Takes a designed CaseScenario + RoleSpec and instantiates the canonical six-phase
early-career skeleton (pipeline/jobfit/interview-script.json — the SAME file the
TS brief renderer reads) with case-specific material: mechanism probes about the
case's brief/tasks, a counterfactual that flips a real case constraint, and a
coachability hint derived from a cover probe's internal ``reveals``. Personal
phases (anchor / stuck-and-recovered / calibration) pass through unchanged — the
metacognitive read stays about the candidate, the substance phases stay on shared
material so every candidate on the role is rated against the same case.

LLM path (Claude CLI) + deterministic template fallback, mirroring design.py.
One scenario per ROLE: generated once after case approval, reused for every
candidate, so comparability is structural rather than aspirational.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from .models import CaseScenario, InterviewScenario, RoleSpec, ScenarioPhase
from .provenance import generate_with_fallback

_LOG = logging.getLogger(__name__)

INTERVIEW_SCENARIO_PROMPT_VERSION = "interview-scenario-v2"

# The shared skeleton — also imported by app/_lib/student-interview.ts, so the
# phase structure can never drift between the generator and the agent brief.
def _load_script() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "interview-script.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        # A missing/corrupt asset used to surface as a raw FileNotFoundError /
        # JSONDecodeError at import time (before any CLI try/except) → an opaque 500.
        # The skeleton is required — the "never fails" deterministic fallback also
        # reads its phases — so there's no safe silent default; raise a legible,
        # actionable error instead of a stack-trace-ish one.
        raise RuntimeError(
            f"interview-scenario skeleton missing or invalid at {path} "
            f"({type(exc).__name__}: {exc}). This shared asset (also read by the TS "
            "brief renderer) is required for the interview-scenario command."
        ) from exc
    if not isinstance(data.get("phases"), list) or not data["phases"]:
        raise RuntimeError(f"interview-scenario skeleton at {path} has no non-empty 'phases' array.")
    return data


_SCRIPT: dict[str, Any] = _load_script()

# Keep the narrated intro tight — roughly two minutes of speech.
_INTRO_MAX = 600


def _clip_intro(text: str) -> str:
    """Cap the intro WITHOUT chopping mid-sentence. The old hard slice shipped
    intros ending "…step away for a short" — a spoken artifact cut mid-word is
    unusable, and the 2026-08-11 bench judge flagged it on every scenario. Cut at
    the last sentence end inside the cap; only when a single sentence overflows
    the whole cap fall back to a word-boundary ellipsis."""
    text = text.strip()
    if len(text) <= _INTRO_MAX:
        return text
    window = text[:_INTRO_MAX]
    cut = max(window.rfind("."), window.rfind("!"), window.rfind("?"))
    if cut > _INTRO_MAX // 3:
        return window[: cut + 1]
    trimmed = window[: _INTRO_MAX - 1]
    if " " in trimmed:
        trimmed = trimmed[: trimmed.rfind(" ")]
    return trimmed.rstrip() + "…"

_SYSTEM = (
    "You turn a designed work-sample case into the material for a live, AI-led interview with an "
    "EARLY-CAREER candidate. Keep the canonical phase structure exactly; instantiate ONLY the "
    "case-grounded phases with concrete probes drawn from the supplied case, in plain spoken "
    "language a voice agent can deliver. The candidate must never be able to tell which questions "
    "are scripted probes. Output strict JSON only."
)


def _skeleton_phases() -> list[ScenarioPhase]:
    return [
        ScenarioPhase(
            phase=p["phase"],
            minutes=p["minutes"],
            goal=p["goal"],
            probe=p["probe"],
            listen_for=p["listenFor"],
            feeds=list(p["feeds"]),
            case_grounded=bool(p.get("caseGrounded")),
        )
        for p in _SCRIPT["phases"]
    ]


def deterministic_scenario(case: CaseScenario, role: RoleSpec) -> InterviewScenario:
    """Template instantiation from the case fields — never fails.

    Mechanism anchors on the first task, the counterfactual flips scale/deadline on
    the brief, and the coachability hint points at the first cover probe's location
    with its ``reveals`` as the listen-for. Crude next to the LLM path, but every
    probe still references the SHARED case, which is what buys comparability."""
    phases = _skeleton_phases()
    task = (case.tasks[0].strip() if case.tasks else "the scenario's first task")
    probe0 = case.cover_probes[0] if case.cover_probes else None
    for p in phases:
        if not p.case_grounded:
            continue
        if p.phase.startswith("Mechanism"):
            p.probe = (
                f"“Looking at the scenario — {task} — why might it be set up this way, "
                "and what breaks first if we change it?”"
            )
            p.case_ref = "tasks[0]" if case.tasks else "brief"
        elif p.phase.startswith("Counterfactual"):
            p.probe = (
                "“Same scenario, but the volume is 100× and the deadline is half — "
                "what changes first in your approach?”"
            )
            p.case_ref = "brief"
        elif p.phase.startswith("Coachability"):
            where = (probe0.where.strip() if probe0 and probe0.where.strip() else "one constraint they have not questioned")
            p.probe = f"Mid-discussion, offer ONE gentle hint pointing at {where} and observe whether they integrate it."
            if probe0 and probe0.reveals.strip():
                p.listen_for = probe0.reveals.strip()
            p.case_ref = f"coverProbes[{probe0.id}]" if probe0 and probe0.id else ("coverProbes[0]" if probe0 else "")
    intro = _clip_intro(f"{case.title or 'A short scenario'}: {(case.brief or 'a short work scenario').strip()}")
    return InterviewScenario(
        case_id=case.id,
        role_title=role.title,
        case_intro=intro,
        phases=phases,
        duration_min=int(_SCRIPT["durationMin"]),
        prompt_version=INTERVIEW_SCENARIO_PROMPT_VERSION,
    )


def build_prompt(case: CaseScenario, role: RoleSpec) -> str:
    skeleton = [
        {"phase": p.phase, "goal": p.goal, "listenFor": p.listen_for, "feeds": p.feeds}
        for p in _skeleton_phases()
        if p.case_grounded
    ]
    ctx = {
        "role": {"title": role.title, "seniority": role.seniority, "mustHaves": role.must_haves},
        "case": {
            "title": case.title,
            "brief": case.brief,
            "tasks": case.tasks,
            # `reveals` is INTERNAL agent material — it shapes the hint and the
            # listen-for, and must never surface to the candidate.
            "coverProbes": [
                {"id": cp.id, "kind": cp.kind, "where": cp.where, "reveals": cp.reveals}
                for cp in case.cover_probes
            ],
        },
        "caseGroundedPhases": skeleton,
    }
    return (
        "Instantiate the case-grounded interview phases for this role from this case. Use ONLY these facts:\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "Write (1) caseIntro: plain spoken narration introducing the scenario to the candidate — context "
        f"and the problem, NO solutions, NO mention of probes, UNDER {_INTRO_MAX} characters ending on a "
        "complete sentence (it is delivered verbatim by a voice agent); and (2) for EACH phase in "
        "caseGroundedPhases, a concrete probe drawn from the case: Mechanism = why the case is shaped the way "
        "it is / what breaks; Counterfactual = flip one REAL constraint of the case; Coachability = the ONE "
        "hint the agent should offer mid-discussion, derived from a cover probe, plus what good uptake looks "
        "like. Match each phase's goal; keep the candidate unaware anything is scripted.\n"
        'Return JSON: { "caseIntro": str, "phases": [ { "phase": str (exactly one of the listed phase names), '
        '"probe": str (spoken, concrete), "listenFor": str, "caseRef": str (which case element, e.g. "tasks[1]" '
        'or "coverProbes[p2]") } ] }. Cover every listed phase. JSON only.'
    )


def _coerce(payload: Any, case: CaseScenario, role: RoleSpec) -> InterviewScenario:
    out = deterministic_scenario(case, role)
    if not isinstance(payload, dict):
        return out
    intro = str(payload.get("caseIntro") or "").strip()
    if intro:
        out.case_intro = _clip_intro(intro)
    by_phase: dict[str, dict] = {}
    for p in payload.get("phases") or []:
        if isinstance(p, dict) and p.get("phase"):
            by_phase[str(p["phase"]).strip()] = p
    # Merge LLM probes onto the skeleton; any phase the model missed or garbled
    # keeps its deterministic instantiation, so the scenario is always complete.
    for phase in out.phases:
        if not phase.case_grounded:
            continue
        got = by_phase.get(phase.phase)
        if not got:
            continue
        probe = str(got.get("probe") or "").strip()
        if probe:
            phase.probe = probe
        listen = str(got.get("listenFor") or "").strip()
        if listen:
            phase.listen_for = listen
        ref = str(got.get("caseRef") or "").strip()
        if ref:
            phase.case_ref = ref
    return out


def scenario_from_case(
    case: CaseScenario, role: RoleSpec, *, lang: str = "en", provider: Any | None = None
) -> tuple[dict, str]:
    """Return (scenario as a by-alias dict, source 'llm'|'deterministic').

    ``lang`` is the spoken language of the interview the voice agent delivers
    (en | cs); the canonical phase structure stays fixed. The deterministic
    fallback is English-only."""
    from ..i18n import language_directive

    prompt = f"{build_prompt(case, role)}\n\n{language_directive(lang)}"
    # Shared LLM-or-deterministic runner (provenance.generate_with_fallback): the bare
    # ``except Exception`` here used to swallow the cause, so template probes shipped while
    # the run still read as healthy. The model-returning closures dump to the by-alias dict
    # so the runner can stash its one-line fallbackReason on the artifact for devcase_cli
    # to lift into the envelope, like every other generation step.
    return generate_with_fallback(
        provider,
        prompt,
        _SYSTEM,
        lambda: deterministic_scenario(case, role).model_dump(by_alias=True),
        lambda payload: _coerce(payload, case, role).model_dump(by_alias=True),
        _LOG,
        # Pin the answer by shape so a trailing injected object can't win the parse (#3).
        expected_keys=("caseIntro", "phases"),
    )
