"""Targeted LLM audits for the Dev pipeline DESIGN-half lifecycle eval.

Complements the no-LLM HEALTH signals in lifecycle_eval.py with judged measurements:
  - judge / quality_summary — absolute 1-5 quality + which APP-DATA LEVERS would help.
  - audit_role_fit — a low-noise BINARY "does the case match the role's function?" on
    mismatch/incoherent scenarios (robust to the judge's run-to-run variance).

The EVALUATION-half (does the evaluator discriminate + stay fair?) lives in submission_eval.py.
Kept separate so lifecycle_eval.py stays a focused HEALTH-eval + CLI module; lifecycle_eval.main()
imports these lazily to avoid an import cycle.
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from ..claude_cli import ClaudeCliError, ClaudeCliProvider
from .lifecycle_eval import LEVERS, Row, run
from .scenarios import Scenario


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
