"""Agent-fit transform (agent-candidate bridge, WP1): Job -> AgentFitSpec.

Turns a structured :class:`~pipeline.jobfit.jobs.Job` plus a connector catalog
(names + descriptions of the tools the external Personas app can wire an agent
to) into the four artifacts the bridge dispatches and tracks:

  ``fit``     — verdict ``complete|temporary|unassessed`` + a per-responsibility
                coverage list ``{item, coverage, rationale}`` + a coverage ratio
                COMPUTED here (never LLM arithmetic).
  ``spec``    — the LLM-candidate definition ``{name, mission, systemPromptDraft,
                connectors, maxTurns}``; connectors are always a subset of the
                supplied catalog.
  ``budget``  — ``{suggestedMonthlyUsd, rule, salaryBandRef}`` derived from the
                job's salary band (CZK/month) by the fixed 2%-of-midpoint rule.
                Always a suggestion, never a charge.
  ``metrics`` — 2–4 measurable expectations ``{key, label, target, unit,
                direction}`` (direction ``gte``/``lte``).

LLM path + deterministic fallback via the shared
:func:`~pipeline.jobfit.devcase.provenance.generate_with_fallback` runner, so a
keyless deployment still produces an honest spec: requirements are matched to
connectors by keyword, the budget rule still applies, and the fit verdict is
``unassessed`` (a keyword match cannot judge automatability).
"""

from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

from .devcase.provenance import generate_with_fallback, str_list as _str_list
from .i18n import language_directive
from .jobs import Job

AGENT_FIT_PROMPT_VERSION = "agent-fit-v1"

_LOG = logging.getLogger(__name__)

# Fixed CZK→USD anchor for the budget SUGGESTION. Deliberately a documented
# constant, not live FX: the suggestion must be reproducible at rest (same
# doctrine as the frozen seed corpus), and the app's stated non-goal is FX
# conversion (see salary-band.ts) — this rate exists only to express "2% of a
# CZK salary band" in the USD the Personas cost meters report in.
CZK_PER_USD = 23.0

# The single statement of the budget rule, echoed verbatim in the artifact.
BUDGET_RULE = "2% of salary-band midpoint"

FIT_VERDICTS = ("complete", "temporary", "unassessed")
COVERAGE_CLASSES = ("automatable", "assisted", "human_only")
METRIC_DIRECTIONS = ("gte", "lte")

_SYSTEM = (
    "You are an AI-workforce analyst. Given a human job description and a catalog of "
    "connectors an autonomous LLM agent could use, judge honestly which responsibilities "
    "an agent can take over. Be conservative: anything needing physical presence, legal "
    "accountability, or human judgment is human_only. Output strict JSON only."
)

# Known top-level schema keys of the answer (pins the genuine object by shape —
# same trust-boundary control as the devcase steps).
_FIT_KEYS = ("fit", "spec", "metrics")

# Cap the JD body forwarded to the prompt (mirrors devcase analyze).
_DESCRIPTION_PROMPT_CHARS = 4_000

_MAX_CONNECTORS = 8
_MAX_COVERAGE_ITEMS = 12
_MAX_METRICS = 4
_MIN_METRICS = 2

_WORD = re.compile(r"[a-z0-9+#.]{2,}")


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall(text.casefold()))


def _clean_catalog(catalog: list[dict]) -> list[dict[str, str]]:
    """Normalize the connector catalog to ``[{name, description}]``, dropping junk."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in catalog:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        out.append({"name": name, "description": str(entry.get("description") or "").strip()})
    return out


def _coverage_items(job: Job) -> list[str]:
    """The responsibility items the fit is judged over.

    The Job model carries no explicit responsibilities list, so requirements are
    the canonical itemization (musts first — jobs.py's must/nice partition:
    must_have ONLY when kind == "must_have"); detected skills, then the bare
    title, are honest degradations for thin records.
    """
    musts = [r.skill for r in job.requirements if r.kind == "must_have"]
    nices = [r.skill for r in job.requirements if r.kind != "must_have"]
    items = [*musts, *nices] or list(job.detected_skills) or [job.title]
    # De-dupe, preserve order, bound the list.
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        key = it.casefold().strip()
        if key and key not in seen:
            seen.add(key)
            out.append(it.strip())
    return out[:_MAX_COVERAGE_ITEMS]


def coverage_ratio(coverage: list[dict], *, total_items: int | None = None) -> float:
    """Fraction of the job's responsibility items an agent covers — computed in code
    for BOTH paths so the ratio is never LLM arithmetic. ``automatable`` counts 1,
    ``assisted`` 0.5.

    ``total_items`` is the canonical count of responsibility items the fit was judged
    over (:func:`_coverage_items`), and the denominator is
    ``max(len(coverage), total_items)``. Without it the denominator was whatever the
    model happened to return, so an answer that classified only the automatable slice
    — or whose remaining rows were dropped by ``coerce`` for an off-taxonomy coverage
    class — read as FULL coverage: 1 automatable row out of 12 requirements rendered
    "100%" beside a one-line list. Unclassified items count as NOT covered, the honest
    direction (no judgment was returned for them). The deterministic path always
    classifies every item, so the floor is a no-op there.
    """
    denominator = max(len(coverage), total_items or 0)
    if denominator <= 0:
        return 0.0
    score = sum(
        1.0 if c.get("coverage") == "automatable" else 0.5 if c.get("coverage") == "assisted" else 0.0
        for c in coverage
    )
    return round(score / denominator, 2)


def build_budget(job: Job) -> dict[str, Any]:
    """The budget suggestion from the salary band — pure rule, shared by both paths.

    ``salaryBand`` is the Job contract's bare [min, max] gross band, CZK/month for
    the shipped Czech market. 2% of the midpoint, converted at the fixed
    :data:`CZK_PER_USD` anchor. A band-less job yields ``suggestedMonthlyUsd:
    None`` with an honest ref rather than a fabricated figure.
    """
    band = job.salary_band or []
    if len(band) >= 2 and band[0] > 0 and band[1] > 0:
        midpoint = (band[0] + band[1]) / 2.0
        usd = round(midpoint * 0.02 / CZK_PER_USD, 2)
        ref = f"{band[0]}–{band[1]} CZK/month"
    else:
        usd = None
        ref = "no salary band stated on the job"
    return {"suggestedMonthlyUsd": usd, "rule": BUDGET_RULE, "salaryBandRef": ref}


def _deterministic_metrics(budget: dict[str, Any]) -> list[dict[str, Any]]:
    monthly = budget.get("suggestedMonthlyUsd")
    metrics: list[dict[str, Any]] = [
        {"key": "runs_per_week", "label": "Completed runs per week", "target": 5, "unit": "runs", "direction": "gte"},
        {"key": "success_rate", "label": "Run success rate", "target": 90, "unit": "%", "direction": "gte"},
    ]
    if isinstance(monthly, (int, float)) and monthly > 0:
        # ~20 runs/month at the suggested budget → a per-task cost ceiling.
        metrics.append(
            {
                "key": "cost_per_task",
                "label": "Cost per completed task",
                "target": round(monthly / 20.0, 2),
                "unit": "USD",
                "direction": "lte",
            }
        )
    return metrics


def analyze_agent_fit(
    job: Job,
    catalog: list[dict],
    *,
    provider: Any | None = None,
    lang: object | None = None,
) -> tuple[dict, str]:
    """The transform. Returns ``(result, source)`` where ``result`` carries
    ``{fit, spec, budget, metrics, promptVersion}`` and ``source`` is the usual
    ``"llm"``/``"deterministic"`` provenance."""
    connectors_catalog = _clean_catalog(catalog)
    catalog_names = {c["name"].casefold(): c["name"] for c in connectors_catalog}
    items = _coverage_items(job)
    budget = build_budget(job)

    ctx = {
        "job": {
            "title": job.title,
            "seniority": job.seniority,
            "roleFamily": job.role_family,
            "description": (job.description or "")[:_DESCRIPTION_PROMPT_CHARS],
            "requirements": [
                {"skill": r.skill, "kind": r.kind, "hardness": r.hardness} for r in job.requirements
            ],
            "detectedSkills": job.detected_skills,
        },
        "responsibilityItems": items,
        "connectorCatalog": connectors_catalog,
    }
    prompt = (
        "Judge how much of this job an autonomous LLM agent could take over, using ONLY the "
        "connectors in connectorCatalog as its hands. Classify EVERY responsibilityItem as "
        "automatable (the agent can own it end-to-end), assisted (the agent drafts/prepares, a "
        "human finishes), or human_only — with a one-line rationale each. Then define the agent "
        "worth hiring for the automatable/assisted slice.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        'Return JSON: { "fit": { "verdict": "complete|temporary", '
        '"coverage": [ { "item": str, "coverage": "automatable|assisted|human_only", "rationale": str } ] }, '
        '"spec": { "name": str (a short agent name), "mission": str (1-2 sentences), '
        '"systemPromptDraft": str (a ready-to-use system prompt, <= 1200 chars), '
        '"connectors": [str — ONLY names from connectorCatalog], "maxTurns": int|null }, '
        '"metrics": [ 2-4 of { "key": snake_case str, "label": str, "target": number, '
        '"unit": str, "direction": "gte|lte" } ] }. '
        "verdict: complete = the agent can fully replace the hire; temporary = it covers part of "
        "the role or bridges until a human is hired. JSON only.\n"
        f"{language_directive(lang)}"
    )

    def deterministic() -> dict:
        # Keyword-match each responsibility item against connector name+description
        # tokens. A keyword match can justify "assisted" (a tool exists in the
        # vicinity), never "automatable" — and the overall verdict stays
        # "unassessed": judging replaceability is exactly what needs the LLM.
        coverage: list[dict[str, Any]] = []
        matched_connectors: list[str] = []
        for item in items:
            item_tokens = _tokens(item)
            hits = [
                c["name"]
                for c in connectors_catalog
                if item_tokens & _tokens(f"{c['name']} {c['description']}")
            ]
            for h in hits:
                if h not in matched_connectors:
                    matched_connectors.append(h)
            if hits:
                coverage.append(
                    {
                        "item": item,
                        "coverage": "assisted",
                        "rationale": f"Keyword match with connector(s): {', '.join(hits[:3])}.",
                    }
                )
            else:
                coverage.append(
                    {
                        "item": item,
                        "coverage": "human_only",
                        "rationale": "No catalog connector matches this requirement by keyword.",
                    }
                )
        desc = (job.description or "").strip()
        mission = (
            f"Support the {job.title} role by automating its tool-reachable tasks."
            + (f" Role context: {desc[:160]}" if desc else "")
        )
        musts = [r.skill for r in job.requirements if r.kind == "must_have"]
        system_prompt = (
            f"You are an autonomous assistant supporting the role \"{job.title}\". "
            f"Mission: {mission} "
            + (f"Key skills in scope: {', '.join(musts[:8])}. " if musts else "")
            + "Work only through your configured connectors, report every run honestly, and "
            "escalate to a human whenever a task needs judgment, approval, or is outside your scope."
        )
        return {
            "fit": {"verdict": "unassessed", "coverage": coverage},
            "spec": {
                "name": f"{job.title} Agent",
                "mission": mission,
                "systemPromptDraft": system_prompt,
                "connectors": matched_connectors[:_MAX_CONNECTORS],
                "maxTurns": None,
            },
            "metrics": _deterministic_metrics(budget),
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        fit_in = payload.get("fit") if isinstance(payload.get("fit"), dict) else {}
        verdict = str(fit_in.get("verdict") or "").strip().lower()
        if verdict not in ("complete", "temporary"):
            verdict = "unassessed"
        coverage: list[dict[str, Any]] = []
        for c in fit_in.get("coverage") or []:
            if not isinstance(c, dict):
                continue
            item = str(c.get("item") or "").strip()
            klass = str(c.get("coverage") or "").strip().lower()
            if not item or klass not in COVERAGE_CLASSES:
                continue
            coverage.append({"item": item, "coverage": klass, "rationale": str(c.get("rationale") or "").strip()})
        if not coverage:
            coverage = det["fit"]["coverage"]
            verdict = "unassessed"

        spec_in = payload.get("spec") if isinstance(payload.get("spec"), dict) else {}
        # Connectors are ALWAYS intersected with the supplied catalog — an
        # hallucinated connector name must never reach the dispatch payload.
        connectors = [
            catalog_names[n.casefold()]
            for n in _str_list(spec_in.get("connectors"))
            if n.casefold() in catalog_names
        ][:_MAX_CONNECTORS]
        max_turns = spec_in.get("maxTurns")
        if not isinstance(max_turns, int) or isinstance(max_turns, bool) or not (0 < max_turns <= 1000):
            max_turns = None
        spec = {
            "name": str(spec_in.get("name") or "").strip() or det["spec"]["name"],
            "mission": str(spec_in.get("mission") or "").strip() or det["spec"]["mission"],
            "systemPromptDraft": str(spec_in.get("systemPromptDraft") or "").strip()[:4000]
            or det["spec"]["systemPromptDraft"],
            "connectors": connectors or det["spec"]["connectors"],
            "maxTurns": max_turns,
        }

        metrics: list[dict[str, Any]] = []
        for m in payload.get("metrics") or []:
            if not isinstance(m, dict):
                continue
            key = re.sub(r"[^a-z0-9_]", "", str(m.get("key") or "").strip().lower().replace(" ", "_"))
            label = str(m.get("label") or "").strip()
            direction = str(m.get("direction") or "").strip().lower()
            try:
                target = float(m.get("target"))
            except (TypeError, ValueError):
                continue
            if not key or not label or direction not in METRIC_DIRECTIONS or not math.isfinite(target):
                continue
            target_out: float | int = int(target) if float(target).is_integer() else round(target, 2)
            metrics.append(
                {"key": key, "label": label, "target": target_out, "unit": str(m.get("unit") or "").strip(), "direction": direction}
            )
            if len(metrics) >= _MAX_METRICS:
                break
        if len(metrics) < _MIN_METRICS:
            metrics = det["metrics"]

        return {"fit": {"verdict": verdict, "coverage": coverage}, "spec": spec, "metrics": metrics}

    result, source = generate_with_fallback(
        provider, prompt, _SYSTEM, deterministic, coerce, _LOG, expected_keys=_FIT_KEYS
    )
    # Ratio + budget are code-owned for both paths (never model output). The
    # denominator is the canonical responsibility itemization, not the rows the model
    # chose to return — a partial classification must not read as full coverage.
    result["fit"]["coverageRatio"] = coverage_ratio(result["fit"]["coverage"], total_items=len(items))
    result["budget"] = budget
    result["promptVersion"] = AGENT_FIT_PROMPT_VERSION
    return result, source
