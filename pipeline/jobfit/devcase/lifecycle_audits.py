"""Targeted LLM audits for the Dev pipeline lifecycle eval (split from lifecycle_eval).

These complement the no-LLM HEALTH signals with judged measurements:
  - judge / _quality_summary — absolute 1-5 quality + which APP-DATA LEVERS would help.
  - audit_role_fit — a low-noise BINARY "does the case match the role's function?" on
    mismatch/incoherent scenarios (robust to the judge's run-to-run variance).
  - run_submission_eval — does the EVALUATOR discriminate strong vs weak submissions?

Kept separate so lifecycle_eval.py stays a focused HEALTH-eval + CLI module (the codebase
convention is ~250 LOC per module). lifecycle_eval.main() imports these lazily.
"""

from __future__ import annotations

import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..claude_cli import ClaudeCliError, ClaudeCliProvider
from .analyze import analyze_need
from .design import design_case, design_role
from .evaluate import evaluate_submission, score_transfer
from .lifecycle_eval import LEVERS, Row, run
from .models import NeedAnalysis
from .reflect import assess_tooling, reflect_commits
from .scenarios import Scenario
from .submissions import all_submissions


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


def quality_summary(rows: list[Row]) -> dict[str, Any]:
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


# --- role-fit: a low-noise BINARY metric on mismatch/incoherent scenarios ----


def audit_role_fit(scenarios: list[Scenario], provider: ClaudeCliProvider, workers: int = 4) -> dict[str, Any]:
    """On role-vs-context MISMATCH/INCOHERENT scenarios, a BINARY judge asks whether the case's
    tasks match the ROLE's function or drift to the context's domain — far more sensitive than
    absolute 1-5 scoring (which is swamped by judge variance)."""
    subset = [s for s in scenarios if s.planted.get("mismatch") or s.planted.get("incoherent")]
    rows = run(subset, provider, workers=workers)
    prompts = []
    for r in rows:
        role, case = r.role, r.case
        prompts.append(
            f"A '{role.get('seniority')} {role.get('title')}' (function: {role.get('roleFamily')}) is being hired. "
            f"This take-home was generated:\n"
            f"{json.dumps({'title': case.get('title'), 'brief': case.get('brief'), 'tasks': case.get('tasks')}, ensure_ascii=False)[:1400]}\n\n"
            "Do the TASKS match what THIS role actually DOES, or do they drift into the provided context's "
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


# --- submission evaluation: does the evaluator DISCRIMINATE? ------------------

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
