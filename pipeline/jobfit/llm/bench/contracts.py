"""Per-use-case validity contracts: structural checks a payload must pass to
count as a usable production answer. Each validator returns a list of
violation strings (empty = valid). These mirror the coercion layers in the
production modules — a payload that violates them would have been backfilled
from the deterministic template, i.e. the model's answer wasn't usable."""

from __future__ import annotations

from typing import Any

RECOMMENDATIONS = {"advance", "hold", "reject"}


def _require_str(payload: dict, key: str, violations: list[str], *, min_chars: int = 1) -> None:
    value = payload.get(key)
    if not isinstance(value, str) or len(value.strip()) < min_chars:
        violations.append(f"{key}: expected a non-empty string (≥{min_chars} chars)")


def _require_str_list(
    payload: dict, key: str, violations: list[str], *, min_len: int, max_len: int
) -> None:
    value = payload.get(key)
    if not isinstance(value, list) or not all(isinstance(x, str) and x.strip() for x in value):
        violations.append(f"{key}: expected a list of non-empty strings")
        return
    if not (min_len <= len(value) <= max_len):
        violations.append(f"{key}: expected {min_len}–{max_len} items, got {len(value)}")


def match_reasoning(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "verdict", violations, min_chars=10)
    _require_str_list(payload, "strengths", violations, min_len=1, max_len=6)
    _require_str_list(payload, "gaps", violations, min_len=1, max_len=6)
    _require_str_list(payload, "interviewProbes", violations, min_len=1, max_len=5)
    return violations


def automation_screen(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    if payload.get("recommendation") not in RECOMMENDATIONS:
        violations.append(f"recommendation: expected one of {sorted(RECOMMENDATIONS)}")
    confidence = payload.get("confidence")
    if not isinstance(confidence, int) or not (0 <= confidence <= 100):
        violations.append("confidence: expected an int in 0–100")
    _require_str(payload, "rationale", violations, min_chars=10)
    if not isinstance(payload.get("strengths"), list):
        violations.append("strengths: expected a list")
    if not isinstance(payload.get("redFlags"), list):
        violations.append("redFlags: expected a list")
    if payload.get("route") not in {"advance", "hold"}:
        violations.append("route: expected 'advance' or 'hold'")
    return violations


def automation_outreach(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "subject", violations, min_chars=5)
    _require_str(payload, "body", violations, min_chars=40)
    _require_str(payload, "language", violations)
    return violations


def automation_rejection(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "subject", violations, min_chars=5)
    _require_str(payload, "body", violations, min_chars=40)
    _require_str(payload, "feedback", violations)
    return violations


def automation_offer(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "subject", violations, min_chars=5)
    _require_str(payload, "body", violations, min_chars=40)
    _require_str(payload, "language", violations)
    return violations


def interview_prep(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    questions = payload.get("questions")
    if not isinstance(questions, list) or not questions:
        violations.append("questions: expected a non-empty list")
    else:
        for i, q in enumerate(questions):
            if not isinstance(q, dict) or not q.get("question"):
                violations.append(f"questions[{i}].question: missing or empty")
    if not isinstance(payload.get("focusAreas"), list):
        violations.append("focusAreas: expected a list")
    return violations


def interview_scorecard(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    ratings = payload.get("ratings")
    if not isinstance(ratings, list) or not ratings:
        violations.append("ratings: expected a non-empty list")
    else:
        for i, r in enumerate(ratings):
            rating = r.get("rating") if isinstance(r, dict) else None
            if not isinstance(rating, (int, float)) or isinstance(rating, bool):
                violations.append(f"ratings[{i}].rating: expected a number")
    _require_str(payload, "summary", violations, min_chars=10)
    _require_str(payload, "recommendation", violations)
    return violations


def weight_proposal(payload: Any) -> list[str]:
    if not isinstance(payload, dict) or not payload:
        return ["payload is not a non-empty object"]
    violations: list[str] = []
    for cid, entry in payload.items():
        if not isinstance(entry, dict):
            violations.append(f"{cid}: expected an object")
            continue
        weights = entry.get("weights")
        if not isinstance(weights, dict) or not all(k in weights for k in ("skills", "career", "personal")):
            violations.append(f"{cid}.weights: expected keys skills/career/personal")
        if not isinstance(entry.get("rationale"), list):
            violations.append(f"{cid}.rationale: expected a list")
    return violations


def jd_ingest(payload: Any) -> list[str]:
    # ingest_raw_ad returns a structured Job (model_dump by_alias). Check the load-bearing fields.
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "title", violations, min_chars=2)
    if not payload.get("seniority"):
        violations.append("seniority: missing or empty")
    # requirements OR responsibilities present as a non-empty list (alias varies by model config).
    lists = [payload.get(k) for k in ("requirements", "responsibilities", "mustHaves", "skills")]
    if not any(isinstance(v, list) and v for v in lists):
        violations.append("requirements/responsibilities: expected at least one non-empty list")
    return violations


def devcase_analyze(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    for key in ("realStack", "coreResponsibilities", "riskAreas"):
        if not isinstance(payload.get(key), list):
            violations.append(f"{key}: expected a list")
    if payload.get("trueComplexity") not in ("low", "medium", "high"):
        violations.append("trueComplexity: expected one of low/medium/high")
    _require_str(payload, "reflection", violations, min_chars=10)
    return violations


def devcase_role_design(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "title", violations, min_chars=2)
    if payload.get("seniority") not in ("junior", "medior", "senior", "lead"):
        violations.append("seniority: expected one of junior/medior/senior/lead")
    for key in ("mustHaves", "responsibilities"):
        if not isinstance(payload.get(key), list) or not payload.get(key):
            violations.append(f"{key}: expected a non-empty list")
    return violations


def devcase_case_design(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "title", violations, min_chars=2)
    _require_str(payload, "brief", violations, min_chars=20)
    if not isinstance(payload.get("tasks"), list) or not payload.get("tasks"):
        violations.append("tasks: expected a non-empty list")
    if not isinstance(payload.get("rubricDimensions"), list):
        violations.append("rubricDimensions: expected a list")
    return violations


def devcase_interview_scenario(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "caseIntro", violations, min_chars=20)
    phases = payload.get("phases")
    if not isinstance(phases, list) or not phases:
        violations.append("phases: expected a non-empty list")
    return violations


def group_compare(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    _require_str(payload, "headline", violations, min_chars=10)
    key_points = payload.get("keyPoints")
    if not isinstance(key_points, list) or not key_points:
        violations.append("keyPoints: expected a non-empty list")
    _require_str(payload, "recommendation", violations)
    return violations


def campaign_pack(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload is not an object"]
    violations: list[str] = []
    variants = payload.get("variants")
    if not isinstance(variants, list) or len(variants) < 1:
        violations.append("variants: expected a non-empty list")
        return violations
    for i, variant in enumerate(variants):
        if not isinstance(variant, dict):
            violations.append(f"variants[{i}]: expected an object")
            continue
        for key in ("hookType", "hook", "adCopy", "videoScript"):
            if not variant.get(key):
                violations.append(f"variants[{i}].{key}: missing or empty")
    if not isinstance(payload.get("warnings"), list):
        violations.append("warnings: expected a list")
    return violations
