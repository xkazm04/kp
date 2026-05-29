"""Phase D2 — reality reflection: analyze a hiring need against the REAL codebase.

LLM path (Claude CLI) + deterministic fallback, mirroring automation.py. The point is
to ground the stated need in what the code actually is — surfacing stated-vs-real gaps.
"""

from __future__ import annotations

import json
from typing import Any

from .models import DevNeed, RepoSnapshot

ANALYZE_NEED_PROMPT_VERSION = "need-analysis-v1"

_SYSTEM = (
    "You are a senior engineering hiring analyst. Reflect a stated hiring need against the REAL "
    "codebase. Be concrete and honest about gaps between what they say they need and what the code "
    "actually is. Ground every claim in the supplied facts. Output strict JSON only."
)


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


def analyze_need(need: DevNeed, snapshot: RepoSnapshot | None = None, *, provider: Any | None = None) -> tuple[dict, str]:
    snap = snapshot.model_dump(by_alias=True) if snapshot else None
    ctx = {
        "need": {
            "title": need.title,
            "stack": need.stack,
            "responsibilities": need.responsibilities,
            "seniorityTarget": need.seniority_target,
            "roleFamily": need.role_family,
            "notes": need.notes,
        },
        "codebase": snap,
    }
    prompt = (
        "Analyze this hiring need and REFLECT it against the actual codebase below. Where the stated "
        "need and the real code diverge, say so plainly; if no codebase was supplied, say the analysis "
        "is ungrounded.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "realStack": [str], "coreResponsibilities": [str], "statedVsRealGaps": [str], '
        '"trueComplexity": "low|medium|high", "riskAreas": [str], "reflection": str, "confidence": number 0..1 }. JSON only.'
    )

    def deterministic() -> dict:
        real = (snapshot.inferred_stack if snapshot and snapshot.inferred_stack else None) or need.stack
        stated = {s.casefold() for s in need.stack}
        realset = {s.casefold() for s in real}
        gaps: list[str] = []
        if snapshot:
            missing = [s for s in need.stack if s.casefold() not in realset]
            extra = [s for s in real if s.casefold() not in stated]
            if missing:
                gaps.append(f"Stated stack not evident in the codebase: {', '.join(missing[:4])}")
            if extra:
                gaps.append(f"Codebase uses tech absent from the stated stack: {', '.join(extra[:4])}")
        loc = snapshot.loc if snapshot else 0
        complexity = "high" if loc > 50_000 else "medium" if loc > 8_000 else "low"
        reflection = (
            f"Role targets {need.seniority_target} on {', '.join(real[:4]) or 'an unspecified stack'}. "
            + (
                f"Codebase is ~{loc:,} LOC across {len(snapshot.top_dirs)} top-level areas. "
                if snapshot
                else "No codebase snapshot supplied — this analysis is ungrounded. "
            )
            + ("Reconcile the stated-vs-real gaps before sourcing." if gaps else "Stated need broadly matches the code.")
        )
        return {
            "realStack": real,
            "coreResponsibilities": need.responsibilities or [],
            "statedVsRealGaps": gaps,
            "trueComplexity": complexity,
            "riskAreas": [],
            "reflection": reflection,
            "confidence": 0.5 if snapshot else 0.3,
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        tc = str(payload.get("trueComplexity") or "").strip().lower()
        if tc not in ("low", "medium", "high"):
            tc = det["trueComplexity"]
        try:
            conf = max(0.0, min(1.0, float(payload.get("confidence"))))
        except (TypeError, ValueError):
            conf = det["confidence"]
        return {
            "realStack": _str_list(payload.get("realStack")) or det["realStack"],
            "coreResponsibilities": _str_list(payload.get("coreResponsibilities")) or det["coreResponsibilities"],
            "statedVsRealGaps": _str_list(payload.get("statedVsRealGaps")),
            "trueComplexity": tc,
            "riskAreas": _str_list(payload.get("riskAreas")),
            "reflection": str(payload.get("reflection") or det["reflection"]),
            "confidence": conf,
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = ANALYZE_NEED_PROMPT_VERSION
    return result, source
