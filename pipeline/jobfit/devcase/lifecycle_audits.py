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

from ..claude_cli import ClaudeCliProvider
from .lifecycle_eval import LEVERS, Row, run
from .llm_judge import judge_independence, run_judge
from .scenarios import Scenario


# --- LLM-as-judge (--judge): quality + which app-data levers would help -----


def judge(rows: list[Row], provider: ClaudeCliProvider, workers: int = 4) -> None:
    # Each non-error row yields two judge jobs (one per artifact task).
    jobs: list[tuple[Row, str]] = [
        (r, task) for r in rows if r.source != "error" for task in ("analysis", "case")
    ]

    def _prompt(job: tuple[Row, str]) -> str:
        r, task = job
        payload = r.analysis if task == "analysis" else r.case
        return (
            f"You QA AI hiring artifacts. Rate this '{task}' output 1-5 for being specific, grounded, fair, and useful.\n"
            f"Scenario: {r.label}\nOutput:\n{json.dumps(payload, ensure_ascii=False)[:1800]}\n\n"
            f"Then choose from this list which would MOST improve it (0-3 items): {LEVERS}.\n"
            'Return JSON: { "score": int 1-5, "levers": [str], "note": str }. JSON only.'
        )

    def _shape(job: tuple[Row, str], payload: dict) -> None:
        r, task = job
        r.quality[task] = {
            "score": max(1, min(5, int(payload.get("score", 0)))),
            "levers": [str(x) for x in (payload.get("levers") or []) if str(x) in LEVERS],
            "note": str(payload.get("note") or "")[:200],
        }

    run_judge(jobs, _prompt, _shape, provider, workers)


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


def role_fit_verdicts(rows: list[Row], provider: ClaudeCliProvider, workers: int = 4) -> list[dict[str, Any]]:
    """Binary "do the case's TASKS match the role's function, or drift to the context's
    domain?" judgments for already-run rows.

    The low-noise industry-lock metric, factored out of :func:`audit_role_fit` so two
    callers share ONE judge prompt + shaping: ``audit_role_fit`` runs it on the planted
    mismatch/incoherent subset (synthetic eval), and the real-JD calibration harness
    (``calibrate.py``) runs it on EVERY row — a real office JD has no planted flags, but
    "does an HR/legal/ops case stay in the HR/legal/ops domain?" is exactly the question
    that surfaces the bank/tech industry-lock. Returns one verdict per row, in row order;
    an unjudged row (error / parse failure) keeps ``matchesRole=None`` so a caller can
    tell None ("couldn't judge") from False ("drifted")."""

    def _prompt(r: Row) -> str:
        role, case = r.role, r.case
        return (
            f"A '{role.get('seniority')} {role.get('title')}' (function: {role.get('roleFamily')}) is being hired. "
            f"This take-home was generated:\n"
            f"{json.dumps({'title': case.get('title'), 'brief': case.get('brief'), 'tasks': case.get('tasks')}, ensure_ascii=False)[:1400]}\n\n"
            "Do the TASKS match what THIS role actually DOES, or do they drift into the provided context's "
            'unrelated domain? Return JSON: { "matchesRole": bool, "note": str }. JSON only.'
        )

    # Keyed by object identity so an unjudged row (error/parse failure) keeps its
    # None verdict in row order — the report distinguishes None ("??") from False.
    shaped: dict[int, tuple[bool, str]] = {}

    def _shape(r: Row, payload: dict) -> None:
        shaped[id(r)] = (bool(payload.get("matchesRole")), str(payload.get("note") or "")[:160])

    run_judge(rows, _prompt, _shape, provider, workers)

    verdicts = []
    for r in rows:
        ok, note = shaped.get(id(r), (None, ""))
        verdicts.append({"id": r.id, "label": r.label, "matchesRole": ok, "note": note})
    return verdicts


def audit_role_fit(
    scenarios: list[Scenario],
    provider: ClaudeCliProvider,
    workers: int = 4,
    *,
    judge_provider: Any | None = None,
) -> dict[str, Any]:
    """On role-vs-context MISMATCH/INCOHERENT scenarios, a BINARY judge asks whether the case's
    tasks match the ROLE's function or drift to the context's domain — far more sensitive than
    absolute 1-5 scoring (which is swamped by judge variance).

    ``provider`` GENERATES the cases; ``judge_provider`` grades them. They default to the same
    object for backwards compatibility, but that is the self-grading case — the returned
    ``independence`` block reports it so a caller can refuse to certify the number."""
    judge_provider = judge_provider or provider
    subset = [s for s in scenarios if s.planted.get("mismatch") or s.planted.get("incoherent")]
    rows = run(subset, provider, workers=workers)
    verdicts = role_fit_verdicts(rows, judge_provider, workers=workers)
    judged = [v for v in verdicts if v["matchesRole"] is not None]
    rate = sum(1 for v in judged if v["matchesRole"]) / len(judged) if judged else None
    return {
        "subset": len(subset),
        "judged": len(judged),
        "role_fit_rate": round(rate, 3) if rate is not None else None,
        "independence": judge_independence(provider, judge_provider),
        "verdicts": verdicts,
    }
