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
