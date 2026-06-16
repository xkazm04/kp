"""Phase D6 — incoming evaluation: fuse the commit reflection + tooling signal + the
case rubric into a CaseEvaluation (the five durable capabilities, NOT correctness), then
score whether the demonstrated capability transfers to THIS role.

LLM path (Claude CLI) + deterministic fallback. Code is assumed LLM-generated, so scores
reward judgment / verification / tooling / architecture / transfer — never lines typed.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .models import RUBRIC_DIMENSIONS
from .provenance import generate_with_fallback, str_list as _str_list

CASE_EVAL_PROMPT_VERSION = "case-eval-v1"
TRANSFER_PROMPT_VERSION = "transfer-v1"
FOLLOWUPS_PROMPT_VERSION = "followups-v1"

_LOG = logging.getLogger(__name__)

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
    # Shared LLM-or-deterministic runner: on an LLM failure it logs the cause at WARNING
    # and stashes a one-line fallbackReason on the artifact (see provenance.generate_with_fallback).
    return generate_with_fallback(provider, prompt, _SYSTEM, deterministic, coerce, _LOG)


def _pct(x: float) -> int:
    return int(round(max(0.0, min(1.0, x)) * 100))


def _score_int(value: Any, default: int) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return default


def _propagated_confidence(*artifacts: Any) -> float:
    """Decision-confidence PROPAGATED to a final artifact from the upstream signals it is built
    from: the MIN of their 0..1 ``confidence`` self-ratings, clamped (see the confidence scale in
    models.py). The evaluation/transfer is assembled ENTIRELY from these inputs, so it can be no
    more trustworthy than its weakest one — MIN (not mean) preserves the scale's invariant that a
    degraded / deterministic-fallback run never looks more certain than an LLM one: a high-confidence
    reflection must not average away a confidence-0.2 deterministic tooling signal. Inputs without a
    numeric ``confidence`` are skipped; with none present it is 0.0 — unknown evidence strength is
    treated as untrustworthy, never silently high."""
    vals = [
        max(0.0, min(1.0, float(a["confidence"])))
        for a in artifacts
        if isinstance(a, dict) and isinstance(a.get("confidence"), (int, float))
    ]
    return round(min(vals), 4) if vals else 0.0


def _ordered_dimensions(scores: dict, rubric: list) -> list[dict]:
    """Echo the canonical rubric — ordered, with name/label/weight/description — annotated with
    each achieved score, so the UI can draw the breakdown without hardcoding order, human labels
    or weights. label/weight/description prefer the case's own rubric (so a case that overrides
    them stays in sync), falling back to the canonical defaults; order is always canonical.

    Each row's `score` is read from `scores` — i.e. CaseEvaluation.dimension_scores, the single
    source of truth for the numbers (see the canonical-score contract on models.CaseEvaluation).
    This makes `dimensions` a pure projection of `dimension_scores`; the model re-asserts the
    same invariant in `_mirror_dimension_scores` so the two can never drift. A capability absent
    from `scores` carries no signal and reads MISSING_DIMENSION_SCORE (the neutral midpoint)."""
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
        '"transfer": int }, "strengths": [str], "concerns": [str], "summary": str }. JSON only.'
    )

    def deterministic() -> dict:
        fluency = float(tooling.get("fluency") or 0.5)
        rbw = float(reflection.get("readBeforeWrite") or 0.4)
        verif = min(1.0, len(reflection.get("verificationHabits") or []) / 2.0)
        # Filter to dict outcomes (a stored / hand-built ToolingSignal may carry
        # strings or None) so `.get` can't raise — mirrors mint_followups and
        # assess_tooling, the sibling consumers that already guard.
        outcomes = [o for o in (tooling.get("probeOutcomes") or []) if isinstance(o, dict)]
        has_probes = bool(outcomes)
        handled = (sum(1 for o in outcomes if o.get("handledWell")) / len(outcomes)) if has_probes else 0.0
        dims = {
            "framing": _pct(0.55 * rbw + 0.45 * 0.5),
            "tooling": _pct(fluency),
            # With NO probes assessed, judgment rests on verification alone rather than
            # a free 0.5 "half-handled" midpoint for an assessment that never ran — the
            # deterministic path must not score success-theater on the fairness-critical
            # dimension when there was no probe signal at all.
            "judgment": _pct(0.5 * verif + 0.5 * handled) if has_probes else _pct(verif),
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
            "strengths": strengths,
            "concerns": concerns,
            "hasFindings": bool(strengths or concerns),
            "summary": str(payload.get("summary") or det["summary"]),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["dimensions"] = _ordered_dimensions(result.get("dimensionScores") or {}, rubric)
    # Propagate decision-confidence from the evidence: the evaluation is fused ENTIRELY from the
    # reflection + tooling signals, so it inherits the MIN of their confidences — an evaluation
    # resting on a confidence-0.2 deterministic-fallback signal must not look authoritative.
    result["confidence"] = _propagated_confidence(reflection, tooling)
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
    # Transfer is derived purely from the evaluation, so it INHERITS the evaluation's propagated
    # confidence — the transfer score is exactly as trustworthy as the evaluation it weights.
    result["confidence"] = _propagated_confidence(evaluation)
    result["promptVersion"] = TRANSFER_PROMPT_VERSION
    return result, source


# --- mint_followups -----------------------------------------------------------

# The interview needs a handful of sharp questions, not an exam: enough to triangulate
# authorship across the probes without turning the debrief into an interrogation.
MAX_FOLLOWUPS = 6

# Readable phrase per probe kind for the deterministic question templates.
_KIND_PHRASE = {
    "ambiguity": "an ambiguous requirement",
    "underspecified": "an underspecified requirement",
    "legacy_trap": "a surprising legacy area",
    "verification_trap": "a thin verification setup",
}


def mint_followups(reflection: dict, tooling: dict, evaluation: dict, case: dict, role: dict, *, provider: Any | None = None) -> tuple[dict, str]:
    """Mint candidate-specific interview questions FROM their evaluated submission.

    This step is the point of the whole evaluation in the LLM era: the submission —
    code, commits, decision log — may be entirely LLM-produced, so the scores above are
    HYPOTHESES, not verdicts. What the submission reliably encodes is the candidate's
    PATH through the case's deliberate ambiguities (which defensible option they shipped
    at each probe). Each followup anchors to one such observed decision and asks for the
    why / the rejected alternative / the counterfactual — things a candidate who merely
    delegated the work cannot reconstruct live. ``listen_for``/``red_flag`` are internal
    interviewer notes, never disclosed.
    """
    probes = [p for p in (case.get("coverProbes") or []) if isinstance(p, dict)]
    outcomes = [o for o in (tooling.get("probeOutcomes") or []) if isinstance(o, dict)]
    outcome_by_id = {str(o.get("probeId") or ""): o for o in outcomes}
    ctx = {
        "role": {"title": role.get("title"), "seniority": role.get("seniority")},
        "caseProbes": [
            {k: p.get(k) for k in ("id", "kind", "where", "reveals", "decisionSpace")} for p in probes
        ],
        "probeOutcomes": outcomes,
        "evaluation": {k: evaluation.get(k) for k in ("strengths", "concerns", "summary")},
        "reflection": {k: reflection.get(k) for k in ("narrative", "iterationPattern", "deadEnds", "verificationHabits")},
        "overRelianceFlags": tooling.get("overRelianceFlags") or [],
    }
    prompt = (
        "Mint 4-6 interview follow-up questions from THIS specific evaluated submission. The submission "
        "(code, commits, decision log) may be ENTIRELY LLM-produced on the candidate's behalf — treat every "
        "inference above as a hypothesis to VERIFY LIVE, not a fact. Anchor each question to ONE concrete "
        "observed decision: which defensible option they shipped at a probe's decisionSpace, an assumption "
        "they made silently, a dead end they abandoned, or a concern the evaluation raised. Ask for the WHY, "
        "the REJECTED alternative, or the COUNTERFACTUAL ('what would have to change for you to choose "
        "differently') — never anything answerable by generic preparation or by re-reading the submission "
        "aloud. listenFor = what a genuine author of that decision sounds like (specifics, trade-offs they "
        "actually hit); redFlag = the answer pattern of delegated work (restates WHAT was done but not why, "
        "defends every option equally, cannot name what they rejected). Both are internal interviewer notes.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "questions": [ { "id": str, "probeId": str ("" if general), "decision": str (the observed '
        'decision being verified), "question": str, "listenFor": str, "redFlag": str } ] }. JSON only.'
    )

    def deterministic() -> dict:
        qs: list[dict] = []
        for p in probes:
            if len(qs) >= MAX_FOLLOWUPS - 1:
                break
            pid = str(p.get("id") or "")
            where = str(p.get("where") or "the brief")
            kind = _KIND_PHRASE.get(str(p.get("kind") or ""), "an open call")
            space = [s for s in (p.get("decisionSpace") or []) if str(s).strip()]
            o = outcome_by_id.get(pid)
            handled = bool(o and o.get("handledWell"))
            if handled:
                question = (
                    f"In {where} you made a call on {kind} and it held up — what would have to change "
                    "about the situation for you to choose differently?"
                )
                decision = str((o or {}).get("note") or f"Handled the open call in {where}")
            else:
                question = (
                    f"In {where}, the brief left {kind} open. Walk me through what you decided there, "
                    "the alternative you rejected, and why."
                )
                decision = f"Shipped an undocumented/unclear call in {where}"
            listen_for = str(p.get("reveals") or "Concrete reasoning anchored in what they actually hit.")
            if space:
                listen_for += f" Defensible options were: {'; '.join(space[:3])}."
            qs.append(
                {
                    "id": f"f{len(qs) + 1}",
                    "probeId": pid,
                    "decision": decision,
                    "question": question,
                    "listenFor": listen_for,
                    "redFlag": "Restates what was done but can't say why, or names no rejected alternative — the decision may not be theirs.",
                }
            )
        for concern in _str_list(evaluation.get("concerns"))[: MAX_FOLLOWUPS - len(qs)]:
            qs.append(
                {
                    "id": f"f{len(qs) + 1}",
                    "probeId": "",
                    "decision": concern,
                    "question": f"The reviewer noted: “{concern}”. Take me through your side of that — what drove it?",
                    "listenFor": "Owns the trade-off or honestly disputes the read with specifics.",
                    "redFlag": "Surprised by their own submission, or agrees/disagrees without detail.",
                }
            )
        return {"questions": qs[:MAX_FOLLOWUPS]}

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        qs: list[dict] = []
        for q in payload.get("questions") or []:
            if not isinstance(q, dict) or not str(q.get("question") or "").strip():
                continue
            qs.append(
                {
                    "id": str(q.get("id") or f"f{len(qs) + 1}"),
                    "probeId": str(q.get("probeId") or ""),
                    "decision": str(q.get("decision") or ""),
                    "question": str(q.get("question")).strip(),
                    "listenFor": str(q.get("listenFor") or ""),
                    "redFlag": str(q.get("redFlag") or ""),
                }
            )
        return {"questions": qs[:MAX_FOLLOWUPS]} if qs else det

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = FOLLOWUPS_PROMPT_VERSION
    return result, source
