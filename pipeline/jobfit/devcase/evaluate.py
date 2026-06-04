"""Phase D6 — incoming evaluation: fuse the commit reflection + tooling signal + the
case rubric into a CaseEvaluation (the five durable capabilities, NOT correctness), then
score whether the demonstrated capability transfers to THIS role.

LLM path (Claude CLI) + deterministic fallback. Code is assumed LLM-generated, so scores
reward judgment / verification / tooling / architecture / transfer — never lines typed.
"""

from __future__ import annotations

import json
from typing import Any

from .models import RUBRIC_DIMENSIONS

CASE_EVAL_PROMPT_VERSION = "case-eval-v1"
TRANSFER_PROMPT_VERSION = "transfer-v1"

_SYSTEM = (
    "You score a take-home submission for the LLM era. The code is assumed to be LLM-generated, so you "
    "grade the durable, transferable skills (problem framing, tooling fluency, judgment/verification, "
    "architecture, transfer) — never raw correctness or volume. Be fair: using AI is not a negative. "
    "Ground scores in the supplied reflection + tooling signal. Output strict JSON only."
)

# Canonical order, derived from the single rubric source of truth (models.RUBRIC_DIMENSIONS)
# rather than hardcoded here, so order/labels/weights stay in lockstep with the rubric.
_DIMS = tuple(d["name"] for d in RUBRIC_DIMENSIONS)

# Policy for a dimension ABSENT from a dimensionScores dict — which is NOT the same as a dimension
# scored zero. A missing dimension carries no signal, so it is treated as ONE neutral midpoint
# everywhere: it pulls the transfer average toward the middle and, being neither high nor low,
# counts as neither a strength nor a gap. (Previously the same absent dimension silently read as
# 50 in the average, 0 for the strong-list, 100 for the gap-list and 0 in the ordered breakdown —
# so "not scored" was conflated with "scored zero" and a gap was both not-a-strength and not-a-gap.)
MISSING_DIMENSION_SCORE = 50


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


def _pct(x: float) -> int:
    return int(round(max(0.0, min(1.0, x)) * 100))


def _score_int(value: Any, default: int) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return default


def _ordered_dimensions(scores: dict, rubric: list) -> list[dict]:
    """Echo the canonical rubric — ordered, with name/label/weight/description — annotated with
    each achieved score, so the UI can draw the breakdown without hardcoding order, human labels
    or weights. label/weight/description prefer the case's own rubric (so a case that overrides
    them stays in sync), falling back to the canonical defaults; order is always canonical."""
    by_name = {d.get("name"): d for d in rubric if isinstance(d, dict) and d.get("name")}
    out = []
    for meta in RUBRIC_DIMENSIONS:
        name = meta["name"]
        rd = by_name.get(name) or {}
        weight = rd.get("weight")
        out.append(
            {
                "name": name,
                "label": str(rd.get("label") or meta["label"]),
                "weight": float(weight) if isinstance(weight, (int, float)) else meta["weight"],
                "score": _score_int(scores.get(name), MISSING_DIMENSION_SCORE),
                "description": str(rd.get("description") or meta["description"]),
            }
        )
    return out


# --- evaluate_submission ----------------------------------------------------


def evaluate_submission(reflection: dict, tooling: dict, case: dict, role: dict, *, provider: Any | None = None) -> tuple[dict, str]:
    rubric = case.get("rubricDimensions") or []
    ctx = {
        "role": {"title": role.get("title"), "seniority": role.get("seniority")},
        "rubric": rubric,
        "reflection": {k: reflection.get(k) for k in ("narrative", "iterationPattern", "readBeforeWrite", "verificationHabits", "deadEnds")},
        "tooling": {k: tooling.get(k) for k in ("fluency", "probeOutcomes", "overRelianceFlags")},
    }
    prompt = (
        "Score this submission on the five durable capabilities (framing, tooling, judgment, architecture, "
        "transfer), 0-100 each, using the rubric + the evidence below. Code is assumed LLM-generated — grade "
        "judgment + verification + how they drove the work, not correctness.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "dimensionScores": { "framing": int, "tooling": int, "judgment": int, "architecture": int, '
        '"transfer": int }, "structureScore": int, "judgmentScore": int, "architectureScore": int, "strengths": [str], '
        '"concerns": [str], "summary": str }. JSON only.'
    )

    def deterministic() -> dict:
        fluency = float(tooling.get("fluency") or 0.5)
        rbw = float(reflection.get("readBeforeWrite") or 0.4)
        verif = min(1.0, len(reflection.get("verificationHabits") or []) / 2.0)
        outcomes = tooling.get("probeOutcomes") or []
        handled = (sum(1 for o in outcomes if o.get("handledWell")) / len(outcomes)) if outcomes else 0.5
        dims = {
            "framing": _pct(0.55 * rbw + 0.45 * 0.5),
            "tooling": _pct(fluency),
            "judgment": _pct(0.5 * verif + 0.5 * handled),
            "architecture": _pct(0.4 + 0.35 * fluency),
            "transfer": _pct(0.5 * fluency + 0.5 * verif),
        }
        strengths, concerns = [], []
        if verif > 0.4:
            strengths.append("Shows verification habits in the trace")
        if handled > 0.5:
            strengths.append("Detected/handled the embedded probes")
        if rbw < 0.45:
            concerns.append("Little evidence of reading before generating")
        if not outcomes or handled <= 0.5:
            concerns.append("Probe handling unclear from the trace")
        # Empty findings stay empty (no '—' sentinel) — `hasFindings` lets the UI render a
        # deliberate empty state instead of a bare em-dash bullet that reads as a render bug.
        return {
            "dimensionScores": dims,
            "structureScore": dims["architecture"],
            "judgmentScore": dims["judgment"],
            "architectureScore": dims["architecture"],
            "strengths": strengths,
            "concerns": concerns,
            "hasFindings": bool(strengths or concerns),
            "summary": f"Deterministic estimate from the trace: tooling {dims['tooling']}, judgment {dims['judgment']}, framing {dims['framing']}.",
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        raw = payload.get("dimensionScores") or {}
        dims = {d: _score_int(raw.get(d), det["dimensionScores"][d]) for d in _DIMS}
        strengths = _str_list(payload.get("strengths")) or det["strengths"]
        concerns = _str_list(payload.get("concerns")) or det["concerns"]
        return {
            "dimensionScores": dims,
            "structureScore": _score_int(payload.get("structureScore"), dims["architecture"]),
            "judgmentScore": _score_int(payload.get("judgmentScore"), dims["judgment"]),
            "architectureScore": _score_int(payload.get("architectureScore"), dims["architecture"]),
            "strengths": strengths,
            "concerns": concerns,
            "hasFindings": bool(strengths or concerns),
            "summary": str(payload.get("summary") or det["summary"]),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["dimensions"] = _ordered_dimensions(result.get("dimensionScores") or {}, rubric)
    result["promptVersion"] = CASE_EVAL_PROMPT_VERSION
    return result, source


# --- score_transfer ---------------------------------------------------------


def score_transfer(evaluation: dict, role: dict, *, provider: Any | None = None) -> tuple[dict, str]:
    ctx = {
        "role": {
            "title": role.get("title"),
            "seniority": role.get("seniority"),
            "mustHaves": role.get("mustHaves", []),
            "responsibilities": role.get("responsibilities", []),
        },
        "evaluation": {"dimensionScores": evaluation.get("dimensionScores"), "summary": evaluation.get("summary")},
    }
    prompt = (
        "Does the demonstrated capability transfer to THIS role (its stack + responsibilities)? Weight the "
        "evaluation by relevance to the role — a strong showing on irrelevant skills transfers less.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "transferScore": int 0-100, "transfers": [str], "gaps": [str], "roleFitRationale": str }. JSON only.'
    )

    def deterministic() -> dict:
        dims = evaluation.get("dimensionScores") or {}
        vals = [dims.get(d, MISSING_DIMENSION_SCORE) for d in _DIMS]
        score = int(round(sum(vals) / len(vals))) if vals else MISSING_DIMENSION_SCORE
        strong = [d for d in _DIMS if dims.get(d, MISSING_DIMENSION_SCORE) >= 65]
        gaps = [d for d in _DIMS if dims.get(d, MISSING_DIMENSION_SCORE) < 45]
        # No '—' sentinel — empty transfers stay empty; `hasTransfers` signals the empty state.
        transfers = [f"Strong {d}" for d in strong]
        return {
            "transferScore": score,
            "transfers": transfers,
            "gaps": [f"Weak {d}" for d in gaps],
            "hasTransfers": bool(transfers),
            "roleFitRationale": f"Average of the five capability scores ({score}); transfer weighted equally in the deterministic fallback.",
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        transfers = _str_list(payload.get("transfers")) or det["transfers"]
        return {
            "transferScore": _score_int(payload.get("transferScore"), det["transferScore"]),
            "transfers": transfers,
            "gaps": _str_list(payload.get("gaps")),
            "hasTransfers": bool(transfers),
            "roleFitRationale": str(payload.get("roleFitRationale") or det["roleFitRationale"]),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = TRANSFER_PROMPT_VERSION
    return result, source
