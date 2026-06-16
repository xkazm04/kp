"""Lifecycle scenario eval for the Dev pipeline (D3 hardening) — HEALTH eval + CLI.

Runs the need -> reality-reflection -> role+case pipeline over a landscape of synthetic
scenarios (scenarios.py), in parallel, and reports HEALTH: reliability (well-formed +
fairness/integrity invariants) and quality SIGNALS computed without an LLM (gap-detection
on planted mismatches, probe diversity/specificity, clarify-probe presence on ambiguous needs,
case-title uniqueness).

The LLM-based DESIGN-half measurements (--judge quality + app-data levers, --audit role-fit)
live in lifecycle_audits.py (imported lazily by main). The EVALUATION half (does the evaluator
discriminate + stay fair?) is submission_eval.py.

    python -m pipeline.jobfit.devcase.lifecycle_eval --count 100 --no-llm
    python -m pipeline.jobfit.devcase.lifecycle_eval --count 24 --judge --workers 6 --json
    python -m pipeline.jobfit.devcase.lifecycle_eval --count 42 --domain mixed --audit role-fit
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from .._cli import configure_stdio
from ..claude_cli import ClaudeCliProvider
from .analyze import analyze_need
from .design import design_case, design_role
from .models import RUBRIC_DIMENSIONS, NeedAnalysis
from .provenance import collect_fallback_reasons, combine_source
from .scenarios import DOMAINS, Scenario, generate_mixed, generate_scenarios

PROBE_KINDS = {"ambiguity", "legacy_trap", "verification_trap", "underspecified"}
# Derived from the canonical rubric so _check_case validates against the single source of
# truth (models.RUBRIC_DIMENSIONS) rather than a hardcoded copy that could silently go stale.
RUBRIC_NAMES = {d["name"] for d in RUBRIC_DIMENSIONS}
LEVERS = [
    "salary/market benchmarks",
    "skill taxonomy",
    "comparable roles (jobs corpus)",
    "company/team context",
    "example assignments",
    "deeper repo signals",
    "seniority calibration",
    "none",
]


# --- reliability + integrity validators ------------------------------------


def _check_analysis(a: dict, scn: Scenario) -> list[str]:
    issues = []
    if not a.get("realStack"):
        issues.append("analysis: empty realStack")
    if a.get("trueComplexity") not in ("low", "medium", "high"):
        issues.append("analysis: bad trueComplexity")
    c = a.get("confidence")
    if not isinstance(c, (int, float)) or not (0.0 <= c <= 1.0):
        issues.append("analysis: confidence out of range")
    return issues


def _check_role(r: dict, scn: Scenario) -> list[str]:
    issues = []
    if r.get("seniority") not in ("junior", "medior", "senior", "lead"):
        issues.append("role: bad seniority")
    if not r.get("mustHaves"):
        issues.append("role: empty mustHaves")
    return issues


def _check_case(c: dict, scn: Scenario) -> list[str]:
    issues = []
    probes = c.get("coverProbes") or []
    if len(probes) < 2:
        issues.append("case: <2 cover probes")
    if any(p.get("kind") not in PROBE_KINDS for p in probes):
        issues.append("case: invalid probe kind")
    if any(not p.get("reveals") for p in probes):
        issues.append("case: probe missing 'reveals'")
    rub = c.get("rubricDimensions") or []
    if {d.get("name") for d in rub} != RUBRIC_NAMES:
        issues.append("case: rubric dimensions off")
    elif abs(sum(d.get("weight", 0) for d in rub) - 1.0) > 0.02:
        issues.append("case: rubric weights != 1")
    if not c.get("tasks"):
        issues.append("case: no tasks")
    if (c.get("timeboxHours") or 0) <= 0:
        issues.append("case: bad timebox")
    return issues


@dataclass
class Row:
    id: str
    label: str
    planted: dict
    source: str = "deterministic"
    issues: list[str] = field(default_factory=list)
    analysis: dict = field(default_factory=dict)
    role: dict = field(default_factory=dict)
    case: dict = field(default_factory=dict)
    quality: dict = field(default_factory=dict)  # task -> {score, levers, note}
    # Per-step reasons the LLM path fell back to deterministic — provenance stashes
    # these ONLY when a call RAISED (empty for a clean LLM run or a --no-llm run).
    fallback_reasons: dict = field(default_factory=dict)

    @property
    def reliable(self) -> bool:
        return not self.issues


def run_one(scn: Scenario, provider: Any | None) -> Row:
    try:
        a, asrc = analyze_need(scn.need, scn.snapshot, provider=provider)
        na = NeedAnalysis.model_validate(a)
        r, rsrc = design_role(scn.need, na, provider=provider)
        c, csrc = design_case(scn.need, na, r, provider=provider)
    except Exception as exc:  # pragma: no cover
        return Row(id=scn.id, label=scn.label, planted=scn.planted, source="error", issues=[f"raised: {type(exc).__name__}: {exc}"])
    # One shared tri-state collapse (provenance.combine_source): a mixed run reads as
    # "partial" everywhere, so llm_rows reflects only fully-LLM designs, not any-LLM ones.
    src = combine_source(asrc, rsrc, csrc)
    # Capture WHY any step fell back (provenance stashes FALLBACK_REASON_KEY on the
    # artifact ONLY when the LLM RAISED) so an all-error-fallback run can't read as a
    # healthy deterministic one — see submission_eval.run_one for the full rationale.
    fallback_reasons = collect_fallback_reasons((("analyze", a), ("role", r), ("case", c)))
    issues = _check_analysis(a, scn) + _check_role(r, scn) + _check_case(c, scn)
    return Row(id=scn.id, label=scn.label, planted=scn.planted, source=src, issues=issues, analysis=a, role=r, case=c, fallback_reasons=fallback_reasons)


def run(scenarios: list[Scenario], provider: Any | None, workers: int = 4) -> list[Row]:
    w = max(1, workers) if provider is not None else 1
    with ThreadPoolExecutor(max_workers=w) as pool:
        return list(pool.map(lambda s: run_one(s, provider), scenarios))


# --- quality SIGNALS (no LLM) ----------------------------------------------


def signals(rows: list[Row]) -> dict[str, Any]:
    done = [r for r in rows if r.source != "error" and r.case]
    mism = [r for r in done if r.planted.get("mismatch")]
    ambig = [r for r in done if r.planted.get("ambiguous")]

    # on a planted MISMATCH, a grounded analysis should flag stated-vs-real gaps
    gap_caught = sum(1 for r in mism if r.analysis.get("statedVsRealGaps")) / len(mism) if mism else None
    clarify_on_ambig = (
        sum(1 for r in ambig if any(p.get("kind") in ("ambiguity", "underspecified") for p in (r.case.get("coverProbes") or []))) / len(ambig)
        if ambig
        else None
    )
    all_kinds = Counter(p.get("kind") for r in done for p in (r.case.get("coverProbes") or []))
    titles = [r.case.get("title", "") for r in done]
    probe_counts = Counter(len(r.case.get("coverProbes") or []) for r in done)
    return {
        "scenarios": len(rows),
        "reliable": sum(1 for r in rows if r.reliable),
        "reliability": round(sum(1 for r in rows if r.reliable) / len(rows), 3) if rows else 0,
        "llm_rows": sum(1 for r in rows if r.source == "llm"),
        "error_fallbacks": sum(1 for r in rows if r.fallback_reasons),
        "gap_caught_on_mismatch": round(gap_caught, 3) if gap_caught is not None else None,
        "clarify_probe_on_ambiguous": round(clarify_on_ambig, 3) if clarify_on_ambig is not None else None,
        "probe_kind_diversity": round(len([k for k in all_kinds if k in PROBE_KINDS]) / len(PROBE_KINDS), 2),
        "probe_kind_counts": dict(all_kinds),
        "probe_count_dist": dict(probe_counts),
        "case_title_uniqueness": round(len(set(titles)) / len(titles), 3) if titles else None,
    }


# --- report -----------------------------------------------------------------


def _report_md(rows: list[Row], sig: dict, qual: dict | None) -> str:
    L = [
        "# Dev pipeline — lifecycle scenario eval\n",
        f"Scenarios: {sig['scenarios']} · reliable: {sig['reliable']}/{sig['scenarios']} ({sig['reliability']:.0%}) · LLM rows: {sig['llm_rows']} · error-fallbacks: {sig['error_fallbacks']}\n",
    ]
    if sig["error_fallbacks"]:
        L.append(
            f"> **WARNING: {sig['error_fallbacks']} row(s) ran in LLM mode but ERROR-fell-back to deterministic** — "
            "the LLM path is degraded; the health signals below reflect the deterministic baseline, not the LLM path.\n"
        )
    L += [
        "## Health signals (no-LLM)\n",
        f"- gap caught on planted MISMATCH: {sig['gap_caught_on_mismatch']}",
        f"- clarify-probe present on AMBIGUOUS needs: {sig['clarify_probe_on_ambiguous']}",
        f"- probe-kind diversity: {sig['probe_kind_diversity']} · counts {sig['probe_kind_counts']}",
        f"- probe-count distribution: {sig['probe_count_dist']}",
        f"- case-title uniqueness: {sig['case_title_uniqueness']}",
    ]
    fails = [r for r in rows if not r.reliable]
    if fails:
        L.append("\n## Reliability failures\n")
        for r in fails[:20]:
            L.append(f"- **{r.id}** ({r.source}): {'; '.join(r.issues)}")
    if qual:
        L.append("\n## LLM-judge quality\n")
        L.append(f"- mean by task: {qual['mean_by_task']} · overall {qual['overall']}")
        L.append(f"- most-requested app-data levers: {qual['top_levers']}")
        if qual["low_score_notes"]:
            L.append("\n### Low-score notes\n")
            for n in qual["low_score_notes"]:
                L.append(f"- {n}")
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")
    p = argparse.ArgumentParser(description="Lifecycle scenario eval for the Dev pipeline.")
    p.add_argument("--count", type=int, default=100)
    p.add_argument("--no-llm", action="store_true")
    p.add_argument("--judge", action="store_true")
    p.add_argument("--audit", choices=["role-fit"], help="targeted audit (design-half role-fit)")
    p.add_argument("--domain", default="it", help="it | marketing | finance | sales | design | mixed")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)

    if args.domain != "mixed" and args.domain not in DOMAINS:
        sys.stderr.write(f"lifecycle_eval: unknown domain '{args.domain}' (have: {list(DOMAINS)} | mixed)\n")
        return 2

    # The LLM-based audits live in a sibling module; import lazily to avoid a cycle.
    from .lifecycle_audits import audit_role_fit, judge, quality_summary

    provider = None
    if not args.no_llm:
        provider = ClaudeCliProvider(timeout=150)
        if not provider.available():
            sys.stderr.write("lifecycle_eval: Claude CLI unavailable -> deterministic mode\n")
            provider = None

    scenarios = generate_mixed(args.count) if args.domain == "mixed" else generate_scenarios(args.count, args.domain)

    if args.audit == "role-fit":
        if provider is None:
            sys.stderr.write("lifecycle_eval: --audit role-fit needs the Claude CLI\n")
            return 1
        res = audit_role_fit(scenarios, provider, workers=args.workers)
        if args.json:
            print(json.dumps(res, indent=2, ensure_ascii=False))
        else:
            print(f"# Role-fit audit\n\nmismatch/incoherent scenarios: {res['subset']} · judged: {res['judged']}")
            print(f"**role-fit rate: {res['role_fit_rate']}** (tasks match the ROLE's function, not the context's domain)\n")
            for v in res["verdicts"]:
                mark = "OK " if v["matchesRole"] else ("?? " if v["matchesRole"] is None else "XX ")
                print(f"- {mark} {v['id']}: {v['note']}")
        return 0

    rows = run(scenarios, provider, workers=args.workers)
    sig = signals(rows)
    qual = None
    if args.judge:
        if provider is None:
            sys.stderr.write("lifecycle_eval: --judge needs the Claude CLI; skipping\n")
        else:
            judge(rows, provider, workers=args.workers)
            qual = quality_summary(rows)

    if args.json:
        print(
            json.dumps(
                {
                    "signals": sig,
                    "quality": qual,
                    "rows": [
                        {"id": r.id, "label": r.label, "source": r.source, "reliable": r.reliable, "issues": r.issues, "quality": r.quality}
                        for r in rows
                    ],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print(_report_md(rows, sig, qual))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
