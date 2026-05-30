"""Lifecycle scenario eval for the Dev pipeline (D3 hardening).

Runs the need -> reality-reflection -> role+case pipeline over a landscape of synthetic
IT scenarios (scenarios.py), in parallel, and reports two things:

  HEALTH   — reliability (well-formed + fairness/integrity invariants) and quality SIGNALS
             computed without an LLM (gap-detection on planted mismatches, grounding fidelity,
             probe diversity/specificity, clarify-probe presence on ambiguous needs).
  CRITIQUE — with --judge, an LLM rates each artifact AND picks which APP-DATA LEVERS would
             most improve it (salary/market, skill taxonomy, comparable roles, company context,
             example assignments, deeper repo signals, seniority calibration). Aggregated, this
             tells us — with evidence — where to invest: prompts, app-data wiring, or UI config.

    python -m pipeline.jobfit.devcase.lifecycle_eval --count 100 --no-llm
    python -m pipeline.jobfit.devcase.lifecycle_eval --count 24 --judge --workers 6 --json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from ..claude_cli import ClaudeCliError, ClaudeCliProvider
from .analyze import analyze_need
from .design import design_case, design_role
from .evaluate import evaluate_submission, score_transfer
from .models import NeedAnalysis
from .reflect import assess_tooling, reflect_commits
from .scenarios import DOMAINS, Scenario, generate_mixed, generate_scenarios
from .submissions import all_submissions

PROBE_KINDS = {"ambiguity", "legacy_trap", "verification_trap", "underspecified"}
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
    if {d.get("name") for d in rub} != {"framing", "tooling", "judgment", "architecture", "transfer"}:
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
    src = "llm" if "llm" in (asrc, rsrc, csrc) else "deterministic"
    issues = _check_analysis(a, scn) + _check_role(r, scn) + _check_case(c, scn)
    return Row(id=scn.id, label=scn.label, planted=scn.planted, source=src, issues=issues, analysis=a, role=r, case=c)


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
        "gap_caught_on_mismatch": round(gap_caught, 3) if gap_caught is not None else None,
        "clarify_probe_on_ambiguous": round(clarify_on_ambig, 3) if clarify_on_ambig is not None else None,
        "probe_kind_diversity": round(len([k for k in all_kinds if k in PROBE_KINDS]) / len(PROBE_KINDS), 2),
        "probe_kind_counts": dict(all_kinds),
        "probe_count_dist": dict(probe_counts),
        "case_title_uniqueness": round(len(set(titles)) / len(titles), 3) if titles else None,
    }


# --- LLM-as-judge (--judge): quality + which app-data levers would help -----


def judge(rows: list[Row], provider: ClaudeCliProvider, workers: int = 4) -> None:
    jobs: list[tuple[Row, str, str]] = []
    for r in rows:
        if r.source == "error":
            continue
        for task, payload in (("analysis", r.analysis), ("case", r.case)):
            jobs.append(
                (
                    r,
                    task,
                    f"You QA AI hiring artifacts. Rate this '{task}' output 1-5 for being specific, grounded, fair, and useful.\n"
                    f"Scenario: {r.label}\nOutput:\n{json.dumps(payload, ensure_ascii=False)[:1800]}\n\n"
                    f"Then choose from this list which would MOST improve it (0-3 items): {LEVERS}.\n"
                    'Return JSON: { "score": int 1-5, "levers": [str], "note": str }. JSON only.',
                )
            )
    results = provider.map([p for _, _, p in jobs], max_workers=workers)
    for (r, task, _), res in zip(jobs, results):
        if isinstance(res, ClaudeCliError):
            continue
        try:
            payload = res.json()
            if isinstance(payload, dict):
                r.quality[task] = {
                    "score": max(1, min(5, int(payload.get("score", 0)))),
                    "levers": [str(x) for x in (payload.get("levers") or []) if str(x) in LEVERS],
                    "note": str(payload.get("note") or "")[:200],
                }
        except Exception:
            continue


def audit_role_fit(scenarios: list[Scenario], provider: ClaudeCliProvider, workers: int = 4) -> dict[str, Any]:
    """Targeted, low-noise metric: on role-vs-codebase MISMATCH/INCOHERENT scenarios, a BINARY judge
    asks whether the case's tasks match the ROLE's function or drift to the codebase's domain.
    Far more sensitive than absolute 1-5 scoring (which is swamped by judge variance)."""
    subset = [s for s in scenarios if s.planted.get("mismatch") or s.planted.get("incoherent")]
    rows = run(subset, provider, workers=workers)
    prompts = []
    for r in rows:
        role, case = r.role, r.case
        prompts.append(
            f"A '{role.get('seniority')} {role.get('title')}' (function: {role.get('roleFamily')}) is being hired. "
            f"This take-home was generated:\n"
            f"{json.dumps({'title': case.get('title'), 'brief': case.get('brief'), 'tasks': case.get('tasks')}, ensure_ascii=False)[:1400]}\n\n"
            "Do the TASKS match what THIS role actually DOES, or do they drift into the provided codebase's "
            'unrelated domain? Return JSON: { "matchesRole": bool, "note": str }. JSON only.'
        )
    results = provider.map(prompts, max_workers=workers)
    verdicts = []
    for r, res in zip(rows, results):
        ok, note = None, ""
        if not isinstance(res, ClaudeCliError):
            try:
                p = res.json()
                if isinstance(p, dict):
                    ok, note = bool(p.get("matchesRole")), str(p.get("note") or "")[:160]
            except Exception:
                pass
        verdicts.append({"id": r.id, "label": r.label, "matchesRole": ok, "note": note})
    judged = [v for v in verdicts if v["matchesRole"] is not None]
    rate = sum(1 for v in judged if v["matchesRole"]) / len(judged) if judged else None
    return {"subset": len(subset), "judged": len(judged), "role_fit_rate": round(rate, 3) if rate is not None else None, "verdicts": verdicts}


# --- Part 2: submission evaluation — does the evaluator DISCRIMINATE? ---------

_EVAL_DIMS = {"framing", "tooling", "judgment", "architecture", "transfer"}


def _overall(dims: dict) -> float:
    vals = [v for v in dims.values() if isinstance(v, (int, float))]
    return round(sum(vals) / len(vals), 1) if vals else 0.0


def _check_eval(ev: dict) -> list[str]:
    dims = ev.get("dimensionScores") or {}
    if set(dims) != _EVAL_DIMS:
        return ["eval: dimensions off"]
    if any(not isinstance(v, int) or not (0 <= v <= 100) for v in dims.values()):
        return ["eval: score out of range"]
    return []


def _eval_chain(case: dict, role: dict, commits: list[dict], provider: Any | None) -> dict:
    refl, _ = reflect_commits(commits, provider=provider)
    tool, _ = assess_tooling(refl, commits, case.get("coverProbes") or [], provider=provider)
    ev, _ = evaluate_submission(refl, tool, case, role, provider=provider)
    tr, _ = score_transfer(ev, role, provider=provider)
    return {
        "overall": _overall(ev.get("dimensionScores") or {}),
        "readBeforeWrite": refl.get("readBeforeWrite"),
        "fluency": tool.get("fluency"),
        "transfer": tr.get("transferScore"),
        "issues": _check_eval(ev),
    }


def run_submission_eval(scenarios: list[Scenario], provider: Any | None, workers: int = 4, subset: int = 6) -> dict[str, Any]:
    """Plant strong / naive / AI-over-reliant / thrasher submissions against designed cases and
    check the evaluator ranks the strong one above the weak ones (and isn't fooled by the
    'productive-looking but never verifies' AI-over-reliant trace). Cases are designed
    deterministically to isolate the EVALUATOR under test. Submission traces follow each
    scenario's domain (IT vs non-IT work/process log)."""
    scns = [s for s in scenarios if not s.planted["sparse"]][:subset]
    prepared = []
    for s in scns:
        a, _ = analyze_need(s.need, s.snapshot, provider=None)
        na = NeedAnalysis.model_validate(a)
        role, _ = design_role(s.need, na, provider=None)
        case, _ = design_case(s.need, na, role, provider=None)
        prepared.append((s, case, role))

    jobs = [
        (i, s, case, role, arch, commits)
        for i, (s, case, role) in enumerate(prepared)
        for (arch, commits) in all_submissions(s.planted.get("domain", "it"))
    ]

    def _one(job):
        i, s, case, role, arch, commits = job
        return {"scenario": i, "label": s.label, "archetype": arch.name, "expected": arch.expected, **_eval_chain(case, role, commits, provider)}

    w = max(1, workers) if provider is not None else 1
    with ThreadPoolExecutor(max_workers=w) as pool:
        rows = list(pool.map(_one, jobs))

    by_scn: dict[int, list[dict]] = {}
    for r in rows:
        by_scn.setdefault(r["scenario"], []).append(r)
    strong_first = 0
    margins = []
    ai_below = 0
    ai_total = 0
    for rs in by_scn.values():
        strong = next(r for r in rs if r["archetype"] == "strong")
        weak = [r for r in rs if r["expected"] == "weak"]
        if strong["overall"] >= max(r["overall"] for r in rs):
            strong_first += 1
        if weak:
            margins.append(round(strong["overall"] - sum(r["overall"] for r in weak) / len(weak), 1))
        ai = next((r for r in rs if r["archetype"] == "ai_overreliant"), None)
        if ai:
            ai_total += 1
            ai_below += 1 if ai["overall"] < strong["overall"] else 0
    n = len(by_scn)
    return {
        "scenarios": n,
        "reliability": round(sum(1 for r in rows if not r["issues"]) / len(rows), 3) if rows else 0,
        "strong_ranks_first_rate": round(strong_first / n, 3) if n else None,
        "mean_margin_strong_vs_weak": round(sum(margins) / len(margins), 1) if margins else None,
        "ai_overreliant_below_strong_rate": round(ai_below / ai_total, 3) if ai_total else None,
        "rows": rows,
    }


def _quality_summary(rows: list[Row]) -> dict[str, Any]:
    by_task: dict[str, list[int]] = {}
    levers = Counter()
    notes: list[str] = []
    for r in rows:
        for task, q in r.quality.items():
            by_task.setdefault(task, []).append(q["score"])
            for lv in q["levers"]:
                if lv != "none":
                    levers[lv] += 1
            if q["score"] <= 2 and q["note"]:
                notes.append(f"[{task}/{r.id}] {q['note']}")
    means = {t: round(sum(v) / len(v), 2) for t, v in by_task.items() if v}
    overall = round(sum(s for v in by_task.values() for s in v) / max(1, sum(len(v) for v in by_task.values())), 2) if by_task else None
    return {"mean_by_task": means, "overall": overall, "top_levers": levers.most_common(), "low_score_notes": notes[:12]}


# --- report -----------------------------------------------------------------


def _report_md(rows: list[Row], sig: dict, qual: dict | None) -> str:
    L = [
        "# Dev pipeline — lifecycle scenario eval\n",
        f"Scenarios: {sig['scenarios']} · reliable: {sig['reliable']}/{sig['scenarios']} ({sig['reliability']:.0%}) · LLM rows: {sig['llm_rows']}\n",
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
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description="Lifecycle scenario eval for the Dev pipeline.")
    p.add_argument("--count", type=int, default=100)
    p.add_argument("--no-llm", action="store_true")
    p.add_argument("--judge", action="store_true")
    p.add_argument("--audit", choices=["role-fit", "submission-eval"], help="targeted audit")
    p.add_argument("--domain", default="it", help="it | marketing | finance | sales | design | mixed")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)

    if args.domain != "mixed" and args.domain not in DOMAINS:
        sys.stderr.write(f"lifecycle_eval: unknown domain '{args.domain}' (have: {list(DOMAINS)} | mixed)\n")
        return 2

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
            print(f"**role-fit rate: {res['role_fit_rate']}** (tasks match the ROLE's function, not the codebase's domain)\n")
            for v in res["verdicts"]:
                mark = "OK " if v["matchesRole"] else ("?? " if v["matchesRole"] is None else "XX ")
                print(f"- {mark} {v['id']}: {v['note']}")
        return 0

    if args.audit == "submission-eval":
        res = run_submission_eval(scenarios, provider, workers=args.workers)
        if args.json:
            print(json.dumps(res, indent=2, ensure_ascii=False))
        else:
            print(f"# Submission-evaluation discrimination\n\ncases: {res['scenarios']} · eval reliability: {res['reliability']:.0%}")
            print(f"**strong ranks #1: {res['strong_ranks_first_rate']}** · mean margin (strong − weak): "
                  f"{res['mean_margin_strong_vs_weak']} · AI-over-reliant below strong: {res['ai_overreliant_below_strong_rate']}\n")
            for i in sorted({r['scenario'] for r in res['rows']}):
                rs = sorted([r for r in res['rows'] if r['scenario'] == i], key=lambda r: -r['overall'])
                print(f"- case {i}: " + ", ".join(f"{r['archetype']}={r['overall']}" for r in rs))
        return 0
    rows = run(scenarios, provider, workers=args.workers)
    sig = signals(rows)
    qual = None
    if args.judge:
        if provider is None:
            sys.stderr.write("lifecycle_eval: --judge needs the Claude CLI; skipping\n")
        else:
            judge(rows, provider, workers=args.workers)
            qual = _quality_summary(rows)

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
