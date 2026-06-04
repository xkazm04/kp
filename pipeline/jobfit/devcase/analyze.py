"""Phase D2 — reality reflection: analyze a hiring need against the REAL codebase.

LLM path (Claude CLI) + deterministic fallback, mirroring automation.py. The point is
to ground the stated need in what the code actually is — surfacing stated-vs-real gaps.
"""

from __future__ import annotations

import json
from typing import Any

from .models import DevNeed, RepoSnapshot

ANALYZE_NEED_PROMPT_VERSION = "need-analysis-v2"  # v2: JD-first intake + multi-codebase reflection

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


# Cap the JD body forwarded to the prompt — enough for any real JD, bounded so a
# pasted novel can't blow the context. The analyze step EXTRACTS stack/responsibilities
# from it, so the JD-first intake can leave need.stack/responsibilities empty.
_JD_PROMPT_CHARS = 6_000


def analyze_need(
    need: DevNeed,
    snapshot: RepoSnapshot | list[RepoSnapshot] | None = None,
    *,
    provider: Any | None = None,
) -> tuple[dict, str]:
    # Multi-repo: a role can span up to a few codebases. Accept one snapshot (legacy
    # callers/tests) or a list; everything below reasons over the list.
    snapshots: list[RepoSnapshot] = snapshot if isinstance(snapshot, list) else ([snapshot] if snapshot else [])
    snaps = [s.model_dump(by_alias=True) for s in snapshots]
    ctx = {
        "need": {
            "title": need.title,
            "stack": need.stack,
            "responsibilities": need.responsibilities,
            "seniorityTarget": need.seniority_target,
            "roleFamily": need.role_family,
            "notes": need.notes,
            # The full JD body (when the need was built from a saved job description) —
            # the primary statement of the need; stack/responsibilities may be empty.
            "jobDescription": need.jd_text[:_JD_PROMPT_CHARS],
        },
        "codebases": snaps or None,
    }
    prompt = (
        "Analyze this hiring need and REFLECT it against the actual codebase(s) below. If a "
        "jobDescription is supplied it is the primary statement of the need — extract the stated "
        "stack and responsibilities from it. If MULTIPLE codebases are supplied, the role works "
        "across ALL of them: reflect the need against the whole set and call out per-repo "
        "divergences. Where the stated need and the real code diverge, say so plainly; if no "
        "codebase was supplied, say the analysis is ungrounded.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "realStack": [str], "coreResponsibilities": [str], "statedVsRealGaps": [str], '
        '"trueComplexity": "low|medium|high", "riskAreas": [str], "reflection": str, "confidence": number 0..1 }. JSON only.'
    )

    def deterministic() -> dict:
        # Merge the inferred stacks across all snapshots, preserving order of appearance.
        merged: list[str] = []
        for s in snapshots:
            for tech in s.inferred_stack:
                if tech.casefold() not in {m.casefold() for m in merged}:
                    merged.append(tech)
        real = merged or need.stack
        stated = {s.casefold() for s in need.stack}
        realset = {s.casefold() for s in real}
        gaps: list[str] = []
        if snapshots:
            missing = [s for s in need.stack if s.casefold() not in realset]
            extra = [s for s in real if s.casefold() not in stated]
            if missing:
                gaps.append(f"Stated stack not evident in the codebase: {', '.join(missing[:4])}")
            if extra:
                gaps.append(f"Codebase uses tech absent from the stated stack: {', '.join(extra[:4])}")
        loc = sum(s.loc for s in snapshots)
        complexity = "high" if loc > 50_000 else "medium" if loc > 8_000 else "low"
        dirs = sum(len(s.top_dirs) for s in snapshots)
        grounding = (
            f"Codebase is ~{loc:,} LOC across {dirs} top-level areas. "
            if len(snapshots) == 1
            else f"{len(snapshots)} codebases totalling ~{loc:,} LOC across {dirs} top-level areas. "
            if snapshots
            else "No codebase snapshot supplied — this analysis is ungrounded. "
        )
        reflection = (
            f"Role targets {need.seniority_target} on {', '.join(real[:4]) or 'an unspecified stack'}. "
            + grounding
            + ("Reconcile the stated-vs-real gaps before sourcing." if gaps else "Stated need broadly matches the code.")
        )
        return {
            "realStack": real,
            "coreResponsibilities": need.responsibilities or [],
            "statedVsRealGaps": gaps,
            "trueComplexity": complexity,
            "riskAreas": [],
            "reflection": reflection,
            "confidence": 0.5 if snapshots else 0.3,
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
