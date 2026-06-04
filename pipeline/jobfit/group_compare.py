"""Layer D of the matching engine: comparative ("compare all") summary.

Given the per-candidate scoring already computed for ONE role, produce a
scannable, EMPHASIS-FORMATTED head-to-head read a recruiter can absorb at a
glance: a bold headline, a few comparative key points (each bolding its decisive
fact), and a recommended next action. Bold spans are marked with **double
asterisks**; the UI renders them as <strong>. Uses an LLM provider
(ClaudeCliProvider by default) and falls back to a deterministic synthesis so the
Decisions group evaluation always has formatted prose. Consumed by
group_compare_cli; the group evaluation persists the result, so this is not
separately cached.
"""

from __future__ import annotations

from typing import Any

from . import registry

GROUP_COMPARE_PROMPT_VERSION = "group-compare-v2"

_SYSTEM = (
    "You are a precise technical recruiter for the Czech tech market. Compare the "
    "candidates for one role honestly and specifically, grounded ONLY in the supplied "
    "facts. Write in English."
)

# Single-sourced from the shared registry (archetypes.json) so the fairness branch
# below can't drift from the scorer's early-career set.
_EARLY_CAREER = registry.early_career_archetypes()


def _candidates(context: dict[str, Any]) -> list[dict[str, Any]]:
    cands = context.get("candidates")
    if not isinstance(cands, list):
        return []
    return [c for c in cands if isinstance(c, dict)]


def build_prompt(context: dict[str, Any]) -> str:
    import json

    return (
        "Compare these candidates for the role. Use ONLY these facts:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        "Write a scannable comparative read for the hiring manager. Mark the decisive facts in "
        "**double asterisks** to bold them — candidate names, the key numbers, and the single "
        "deciding factor.\n\n"
        "Return JSON with exactly these keys:\n"
        '{ "headline": str (ONE sentence — who leads and the single clearest reason),\n'
        '  "keyPoints": [str] (3-5 short comparative points; cover the closest tradeoff, must-have '
        "coverage, budget fit when a candidate's salaryExpectation sits outside roleSalaryBand, "
        "and a standout strength or risk; each point bolds its decisive fact),\n"
        '  "recommendation": str (ONE sentence — the concrete next action) }\n'
        "Name candidates, cite the numbers, be honest. JSON only."
    )


def _fmt(value: Any) -> str:
    try:
        return str(int(round(float(value))))
    except (TypeError, ValueError):
        return "?"


def _bold(text: str) -> str:
    return f"**{text}**"


def deterministic_comparison(context: dict[str, Any]) -> dict[str, Any]:
    """Always-useful, bold-formatted comparison synthesized from structured deltas."""
    role = str(context.get("roleTitle") or "the role")
    cands = sorted(_candidates(context), key=lambda c: c.get("total") or 0, reverse=True)
    if not cands:
        return {"headline": f"No candidates to compare for {role}.", "keyPoints": [], "recommendation": ""}

    n = len(cands)
    top = cands[0]
    headline = (
        f"{_bold(str(top.get('label')))} leads {n} candidate{'s' if n != 1 else ''} "
        f"for {role} on overall fit ({_bold(_fmt(top.get('total')))})."
    )

    points: list[str] = []

    def leader(key: str) -> dict[str, Any] | None:
        scored = [c for c in cands if isinstance(c.get(key), (int, float))]
        return max(scored, key=lambda c: c.get(key)) if scored else None

    skills_leader = leader("skills")
    if skills_leader and skills_leader.get("label") != top.get("label"):
        points.append(
            f"{_bold(str(skills_leader.get('label')))} has the strongest skills match "
            f"({_bold(_fmt(skills_leader.get('skills')))})."
        )

    def coverage(c: dict[str, Any]) -> tuple[int, int]:
        matched = len(c.get("matchedSkills") or [])
        missing = len(c.get("missingSkills") or [])
        return matched, matched + missing

    best_cov = max(cands, key=lambda c: coverage(c)[0])
    bm, bt = coverage(best_cov)
    if bt:
        points.append(f"{_bold(str(best_cov.get('label')))} covers the most required skills ({_bold(f'{bm}/{bt}')}).")

    if n > 1:
        runner = cands[1]
        points.append(f"Closest alternative is {_bold(str(runner.get('label')))} (fit {_bold(_fmt(runner.get('total')))}).")

    early = [c for c in cands if c.get("archetype") in _EARLY_CAREER]
    if early:
        names = ", ".join(str(c.get("label")) for c in early)
        verb = "is" if len(early) == 1 else "are"
        points.append(f"{_bold(names)} {verb} **early-career** — judge on potential and trajectory on a separate track.")

    weakest = cands[-1]
    if (weakest.get("total") or 0) < 55 and weakest.get("label") != top.get("label"):
        points.append(
            f"{_bold(str(weakest.get('label')))} is the weakest fit ({_bold(_fmt(weakest.get('total')))}) — confirm must-haves at interview."
        )

    if n > 1:
        recommendation = f"Advance {_bold(str(top.get('label')))} first; keep the rest warm pending interview."
    else:
        recommendation = f"Advance {_bold(str(top.get('label')))} — the only candidate in this role."

    return {"headline": headline, "keyPoints": points, "recommendation": recommendation}


def _coerce(payload: Any, context: dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload, dict):
        headline = str(payload.get("headline") or "").strip()
        raw_points = payload.get("keyPoints")
        key_points = (
            [str(x).strip() for x in raw_points if str(x).strip()] if isinstance(raw_points, list) else []
        )
        recommendation = str(payload.get("recommendation") or "").strip()
        # A usable answer needs at least a headline and one comparative point;
        # otherwise backfill the whole thing from the deterministic synthesis.
        if headline and key_points:
            return {"headline": headline, "keyPoints": key_points, "recommendation": recommendation}
    return deterministic_comparison(context)


def generate(context: dict[str, Any], *, provider: Any | None = None) -> tuple[dict[str, Any], str]:
    """Return (comparison, source) where source is 'llm' or 'deterministic'."""
    if provider is None:
        return deterministic_comparison(context), "deterministic"
    try:
        payload = provider.complete_json(build_prompt(context), system=_SYSTEM)
        return _coerce(payload, context), "llm"
    except Exception:
        return deterministic_comparison(context), "deterministic"
