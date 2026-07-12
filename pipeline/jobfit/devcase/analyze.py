"""Phase D2 — reality reflection: analyze a hiring need against the REAL codebase.

LLM path (Claude CLI) + deterministic fallback, mirroring automation.py. The point is
to ground the stated need in what the code actually is — surfacing stated-vs-real gaps.
"""

from __future__ import annotations

import json
import logging
import math
from typing import Any

from .models import DevNeed, RepoSnapshot
from .provenance import generate_with_fallback, str_list as _str_list
from ..i18n import language_directive

ANALYZE_NEED_PROMPT_VERSION = "need-analysis-v3"  # v3: de-industry-locked — non-software roles reflected in their OWN terms (realStack = the role's tools/materials), no codebase hand-wringing

_LOG = logging.getLogger(__name__)

_SYSTEM = (
    "You are a senior hiring analyst. Reflect a stated hiring need against the REAL body of work the "
    "role acts on — a codebase for software, but the role's own materials (documents, models, "
    "campaigns, a CRM, spreadsheets, …) for any other function. Be concrete and honest about gaps "
    "between what they say they need and what the evidence actually shows. Ground every claim in the "
    "supplied facts. Output strict JSON only."
)


def _generate(provider: Any | None, prompt: str, deterministic, coerce, expected_keys=None) -> tuple[dict, str]:
    # Shared LLM-or-deterministic runner: on an LLM failure it logs the cause at WARNING
    # and stashes a one-line fallbackReason on the artifact (see provenance.generate_with_fallback).
    # expected_keys pins the answer by shape so a trailing injected object can't win the parse (#3).
    return generate_with_fallback(provider, prompt, _SYSTEM, deterministic, coerce, _LOG, expected_keys=expected_keys)


# Known top-level schema keys of the need-analysis answer (bug-hunter #3).
_ANALYZE_KEYS = ("realStack", "coreResponsibilities", "statedVsRealGaps", "trueComplexity", "riskAreas", "reflection", "confidence")


# Cap the JD body forwarded to the prompt — enough for any real JD, bounded so a
# pasted novel can't blow the context. The analyze step EXTRACTS stack/responsibilities
# from it, so the JD-first intake can leave need.stack/responsibilities empty.
_JD_PROMPT_CHARS = 6_000


def analyze_need(
    need: DevNeed,
    snapshot: RepoSnapshot | list[RepoSnapshot] | None = None,
    *,
    provider: Any | None = None,
    lang: object | None = None,
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
        "Analyze this hiring need and REFLECT it against the actual body of work below. If a "
        "jobDescription is supplied it is the primary statement of the need — extract the stated "
        "tools/skills and responsibilities from it. If MULTIPLE codebases are supplied, the role works "
        "across ALL of them: reflect the need against the whole set and call out per-repo "
        "divergences. Where the stated need and the real evidence diverge, say so plainly.\n"
        "NON-SOFTWARE roles: many office roles (admin, HR, finance, sales, legal, ops, …) have NO "
        "codebase and no tech stack — that is normal, not a defect. Do NOT dwell on the absence of "
        "code; instead populate realStack with the role's REAL tools/systems/materials (e.g. an ATS, "
        "an ERP, Excel models, a CRM, policy docs) drawn from the JD, and judge trueComplexity in the "
        "role's OWN terms. Only call the analysis ungrounded when the JD itself is too thin to extract "
        "responsibilities.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "realStack": [str] (the role\'s real tools/skills/materials — a tech stack for '
        'software, the role\'s systems/documents otherwise), "coreResponsibilities": [str], '
        '"statedVsRealGaps": [str], "trueComplexity": "low|medium|high", "riskAreas": [str], '
        '"reflection": str, "confidence": number 0..1 }. JSON only.\n'
        # DEVP5/#6 — the free-text fields (reflection, gaps, responsibilities) feed
        # the downstream role/case design, so write them in the JD's language for a
        # consistent artifact; enum values (trueComplexity) stay verbatim per the directive.
        f"{language_directive(lang)}"
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
        # A snapshot can carry stack/dir signal but loc<=0 (the LOC probe failed on a
        # private repo). Such repos vanish from a pure LOC sum, so call them out rather
        # than letting an under-measured multi-repo role read as fully grounded.
        unmeasured = sum(1 for s in snapshots if s.loc <= 0)
        unmeasured_note = f" {unmeasured} repo(s) of unmeasured size — the LOC total is a floor." if unmeasured else ""
        grounding = (
            f"Codebase is ~{loc:,} LOC across {dirs} top-level areas.{unmeasured_note} "
            if len(snapshots) == 1
            else f"{len(snapshots)} codebases totalling ~{loc:,} LOC across {dirs} top-level areas.{unmeasured_note} "
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
            conf = float(payload.get("confidence"))
            if not math.isfinite(conf):  # NaN/inf slips past min/max → use the baseline
                raise ValueError("non-finite confidence")
            conf = max(0.0, min(1.0, conf))
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

    result, source = _generate(provider, prompt, deterministic, coerce, expected_keys=_ANALYZE_KEYS)
    result["promptVersion"] = ANALYZE_NEED_PROMPT_VERSION
    return result, source
