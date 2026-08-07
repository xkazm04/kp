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
from .i18n import language_directive
from .market_config import ACTIVE_MARKET, MarketConfig

GROUP_COMPARE_PROMPT_VERSION = "group-compare-v2"


def _system_prompt(market: MarketConfig = ACTIVE_MARKET) -> str:
    """The comparative-read system prompt, with the target market named from config
    instead of a hardcoded "Czech" (the lone reasoning persona still hardcoded after
    match_reasoning/campaign were de-Czech'd). For the Czech default (descriptor
    "Czech") this is byte-identical to the literal it replaced; a re-homed market
    tells the model the RIGHT market instead of biasing every comparison Czech."""
    market_phrase = market.market_descriptor or ACTIVE_MARKET.market_descriptor
    return (
        f"You are a precise technical recruiter for the {market_phrase} tech market. Compare the "
        "candidates for one role honestly and specifically, grounded ONLY in the supplied "
        "facts. Write in the requested language."
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

    # "Most required-skill coverage" must rank by the FEWEST unmet must-haves — not
    # by the count of matched skills. ``missingSkills`` is must-have-only (score_skills
    # only files a must-have there), while ``matchedSkills`` counts must-haves AND
    # nice-to-haves. The old metric divided that mixed numerator by a must-only
    # denominator — a candidate with 2 musts + 3 nice-to-haves and 1 must missing read
    # as "covers the most required skills (5/6)" though the role's must-haves were
    # 2/3 — and ``max(..., key=matched)`` could crown whoever merely matched the most
    # nice-to-haves. Rank on the must-have gap alone (tie-break by matched breadth) and
    # state that gap honestly rather than a fabricated fraction that mixes populations.
    # bug-ui-scan-2026-07-09 (matching-transformation-engine #4).
    def unmet_musts(c: dict[str, Any]) -> int:
        return len(c.get("missingSkills") or [])

    def matched_count(c: dict[str, Any]) -> int:
        return len(c.get("matchedSkills") or [])

    best_cov = min(cands, key=lambda c: (unmet_musts(c), -matched_count(c)))
    # Emit the point only when the field carries real skill data (the old ``if bt:``
    # guard) — a job-less role with no matched/missing skills makes no coverage claim.
    if any(matched_count(c) or unmet_musts(c) for c in cands):
        gap = unmet_musts(best_cov)
        if gap == 0:
            points.append(f"{_bold(str(best_cov.get('label')))} has **no unmet must-haves**.")
        else:
            points.append(
                f"{_bold(str(best_cov.get('label')))} has the fewest unmet must-haves "
                f"({_bold(f'{gap} missing')})."
            )

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


def generate(
    context: dict[str, Any],
    *,
    lang: str = "en",
    provider: Any | None = None,
    market: MarketConfig = ACTIVE_MARKET,
) -> tuple[dict[str, Any], str]:
    """Return (comparison, source) where source is 'llm' or 'deterministic'.
    ``lang`` is the output locale for the narrative; the deterministic fallback is
    English-only. ``market`` names the recruiter persona's market (defaults to the
    ACTIVE market)."""
    if provider is None:
        return deterministic_comparison(context), "deterministic"
    try:
        prompt = f"{build_prompt(context)}\n\n{language_directive(lang)}"
        payload = provider.complete_json(prompt, system=_system_prompt(market))
        return _coerce(payload, context), "llm"
    except Exception:
        return deterministic_comparison(context), "deterministic"
