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

GROUP_COMPARE_PROMPT_VERSION = "group-compare-v3"


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
        "Name candidates, cite the numbers, be honest.\n"
        "A null score (total/skills/career/personal) means the candidate was NEVER MEASURED on "
        "that dimension — it is not a zero and not a low score. Never rank, crown, or compare a "
        "candidate on a null value, and never call anyone the strongest/weakest on a dimension "
        "fewer than two candidates were scored on; say the score is missing instead. An empty "
        "matchedSkills/missingSkills means the same: not scored on skills, NOT 'no gaps'.\n"
        "JSON only."
    )


def _fmt(value: Any) -> str:
    try:
        return str(int(round(float(value))))
    except (TypeError, ValueError):
        return "?"


def _bold(text: str) -> str:
    return f"**{text}**"


def _num(value: Any) -> float | None:
    """A dimension's value, or ``None`` when the candidate was never MEASURED on it.

    An absent score is not a zero and not a low score. group-eval-run passes
    ``total: null`` for every candidate the recruiter ranker could not resolve (a
    manually added pipeline row with no candidateId, a candidateId whose profile AND
    analysis are both gone, a row recruiter_cli skipped) and ``skills/career/personal:
    null`` whenever there is no recruiter breakdown at all — and those candidates are
    still part of the compared field. The old ``c.get("total") or 0`` folded absent
    into a real 0, so an unscored candidate ranked, could be crowned lead, and had
    their fit printed as "?" — the same absent-vs-empty conflation the TS half fixed
    for differentiators. ``bool`` is rejected explicitly (it is an ``int`` subclass).
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _label(c: dict[str, Any]) -> str:
    return str(c.get("label"))


def deterministic_comparison(context: dict[str, Any]) -> dict[str, Any]:
    """Always-useful, bold-formatted comparison synthesized from structured deltas.

    Every claim is bounded by what was actually MEASURED: an unscored candidate is
    disclosed, never ranked or crowned; a superlative ("the strongest skills match",
    "the fewest unmet must-haves") needs two measured candidates to be a comparison at
    all; and a one-candidate field asserts no leadership (the same
    GROUP_EVAL_MIN_COHORT floor app/_lib/group-eval-cohort.ts enforces on the caller
    side — mirrored here so the module cannot hand a crown to any other caller).
    """
    role = str(context.get("roleTitle") or "the role")
    field = _candidates(context)
    if not field:
        return {"headline": f"No candidates to compare for {role}.", "keyPoints": [], "recommendation": ""}

    # Rank the MEASURED candidates only; the unscored keep their input order at the
    # bottom and are disclosed as a key point instead of silently ranking as 0.
    scored = sorted(
        (c for c in field if _num(c.get("total")) is not None),
        key=lambda c: _num(c.get("total")) or 0.0,
        reverse=True,
    )
    unscored = [c for c in field if _num(c.get("total")) is None]
    cands = scored + unscored
    n = len(cands)
    top = scored[0] if scored else None

    points: list[str] = []

    def leader(key: str) -> dict[str, Any] | None:
        """The dimension leader — but only when at least TWO candidates carry the
        dimension. "X has the strongest skills match" is a claim about the field, and
        a field of one is not a comparison: with the rivals unmeasured on that
        dimension the superlative credits X with beating nobody."""
        dim = [c for c in cands if _num(c.get(key)) is not None]
        if len(dim) < 2:
            return None
        return max(dim, key=lambda c: _num(c.get(key)) or 0.0)

    skills_leader = leader("skills")
    if skills_leader and (top is None or _label(skills_leader) != _label(top)):
        points.append(
            f"{_bold(_label(skills_leader))} has the strongest skills match "
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

    # …and it must rank only over candidates who were SCORED on skills. Both lists are
    # empty for a candidate the ranker never resolved, which reads as "0 unmet
    # must-haves" — so the old field-wide ``min`` handed the coverage crown to the one
    # person nobody had checked ("**Bára** has **no unmet must-haves**" about a
    # manually added row with no profile), beating a candidate who genuinely covered
    # 3 of 4. The whole-field guard below could not catch it: it passes as soon as ONE
    # other candidate carries skill data.
    covered = [c for c in cands if matched_count(c) or unmet_musts(c)]
    if covered:
        best_cov = min(covered, key=lambda c: (unmet_musts(c), -matched_count(c)))
        gap = unmet_musts(best_cov)
        name = _bold(_label(best_cov))
        if gap == 0:
            claim = f"{name} has **no unmet must-haves**"
        elif len(covered) >= 2:
            claim = f"{name} has the fewest unmet must-haves ({_bold(f'{gap} missing')})"
        else:  # one datum is not a "fewest" — state the gap without the superlative
            claim = f"{name} has {_bold(f'{gap} unmet must-have' + ('' if gap == 1 else 's'))}"
        if len(covered) < n:
            claim += " — the other candidates were not scored on skills"
        points.append(claim + ".")

    if len(scored) > 1:
        runner = scored[1]
        points.append(f"Closest alternative is {_bold(_label(runner))} (fit {_bold(_fmt(runner.get('total')))}).")

    if unscored and scored:
        names = ", ".join(_label(c) for c in unscored)
        verb = "carries" if len(unscored) == 1 else "carry"
        points.append(f"{_bold(names)} {verb} **no fit score** — not ranked in this comparison.")

    early = [c for c in cands if c.get("archetype") in _EARLY_CAREER]
    if early:
        names = ", ".join(_label(c) for c in early)
        verb = "is" if len(early) == 1 else "are"
        points.append(f"{_bold(names)} {verb} **early-career** — judge on potential and trajectory on a separate track.")

    # "Weakest fit" ranks the field, so it is claimed only about a MEASURED candidate
    # in a measured field — an unscored candidate used to land here (fit "?") purely
    # because absent read as 0.
    if len(scored) > 1:
        weakest = scored[-1]
        if (_num(weakest.get("total")) or 0.0) < 55 and _label(weakest) != _label(top):
            points.append(
                f"{_bold(_label(weakest))} is the weakest fit ({_bold(_fmt(weakest.get('total')))}) — confirm must-haves at interview."
            )

    if n == 1:
        solo = cands[0]
        fit = f" (fit {_bold(_fmt(solo.get('total')))})" if _num(solo.get("total")) is not None else ""
        headline = f"{_bold(_label(solo))} is the {_bold('only candidate')} for {role}{fit} — nothing to compare."
        recommendation = f"Assess {_bold(_label(solo))} on their own merits; one candidate is not a comparison."
    elif top is None:
        headline = f"None of the {n} candidates for {role} carries a {_bold('comparable fit score')}."
        recommendation = "Score the field before ranking anyone — no candidate here has a fit score to compare."
    elif len(scored) == n:
        headline = (
            f"{_bold(_label(top))} leads {n} candidates "
            f"for {role} on overall fit ({_bold(_fmt(top.get('total')))})."
        )
        recommendation = f"Advance {_bold(_label(top))} first; keep the rest warm pending interview."
    elif len(scored) == 1:
        # "Leads" over a field of one measured candidate is the n==1 crown wearing a
        # bigger cohort: the rivals were never scored, so nobody was out-ranked.
        headline = (
            f"{_bold(_label(top))} is the {_bold('only scored candidate')} of {n} "
            f"for {role} (fit {_bold(_fmt(top.get('total')))})."
        )
        recommendation = (
            f"Advance {_bold(_label(top))} — the only candidate with a fit score; "
            "score the rest before ruling them out."
        )
    else:
        headline = (
            f"{_bold(_label(top))} leads the {len(scored)} scored of {n} candidates "
            f"for {role} on overall fit ({_bold(_fmt(top.get('total')))})."
        )
        recommendation = f"Advance {_bold(_label(top))} first; keep the rest warm pending interview."

    return {"headline": headline, "keyPoints": points, "recommendation": recommendation}


def _coerce(payload: Any, context: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Validate the model payload; returns (comparison, degraded).

    ``degraded`` is True when the answer on the wire is the deterministic synthesis
    rather than the model's — the caller reports that as source="deterministic". The
    LLM call succeeding is not the same as the LLM writing the answer: an
    under-delivered payload (no keyPoints) is replaced WHOLESALE here, and reporting
    "llm" for it billed the template's words to the model. That lie is user-visible —
    the Decisions modal's AiVerdict pill reads comparisonSource === "llm" and stamps
    template prose "AI-backed" (useGroupEval.ts) — and it also suppressed the CLI's
    ``emit_deterministic`` ledger entry, so the fallback traffic stayed invisible.
    Mirrors match_reasoning._coerce, which fixed the identical green lie."""
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
            return {"headline": headline, "keyPoints": key_points, "recommendation": recommendation}, False
    return deterministic_comparison(context), True


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
        comparison, degraded = _coerce(payload, context)
        # A backfilled comparison IS the deterministic synthesis — say so instead of
        # billing the template's words to the model (the tokens were spent, but the
        # answer on the wire is not the model's).
        return comparison, ("deterministic" if degraded else "llm")
    except Exception:
        return deterministic_comparison(context), "deterministic"
