"""Quality-gating eval for the LLM HR-automation tasks (Direction 2).

Runs every automation step over a scripted scenario set and scores two axes:

  RELIABILITY (deterministic, always on) — did the task return a well-formed result,
    and do the hard FAIRNESS INVARIANTS hold? (e.g. screening never auto-rejects or
    auto-advances an early-career candidate; rejection text carries no protected-
    characteristic language; re-match respects the score floor). Reliability must be 100%.

  QUALITY (--judge, LLM-as-judge, batched) — an independent Claude CLI judge rates each
    output 1-5 on task-specific criteria (grounded / specific / right tone / right language
    / non-leading / fair). Batched via ClaudeCliProvider.map. Gate: mean >= 3.5.

Engine = Claude Code CLI only (ClaudeCliProvider). With --no-llm every task uses its
deterministic fallback (fast, offline, CI-safe). Default runs the real LLM for each task,
records whether the LLM or the fallback produced it, and still checks reliability.

    python -m pipeline.jobfit.eval.automation_eval                 # LLM gen + reliability
    python -m pipeline.jobfit.eval.automation_eval --no-llm        # deterministic reliability (CI)
    python -m pipeline.jobfit.eval.automation_eval --judge         # + LLM quality scoring
    python -m pipeline.jobfit.eval.automation_eval --judge --strict --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

from .. import automation
from ..claude_cli import ClaudeCliError, ClaudeCliProvider
from ..jobs import normalize_job
from ..matching import MatchCandidate, score_job

RELIABILITY_THRESHOLD = 1.0  # every output must be well-formed + fairness-safe
QUALITY_THRESHOLD = 3.5  # mean judge rating (1-5)

# Word-boundary patterns so "age" flags an explicit age mention but not "manage"/"language".
_PROTECTED_RE = re.compile(
    r"\b(age|gender|sex|race|racial|religion|religious|ethnic\w*|pregnan\w*|disab\w*|married|marital|"
    r"věk|pohlaví|rasa|rasov\w*|nábožen\w*|těhoten\w*)\b",
    re.IGNORECASE,
)
_EARLY = ("student", "career_switcher")

_NEG_NOTES = "Struggled with system design; vague on past projects; weak SQL; some communication gaps."


def _job(**over):
    base = {
        "title": "Backend Engineer",
        "seniority": "senior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "A backend team building APIs.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return normalize_job(base)


@dataclass
class Scenario:
    name: str
    candidate: MatchCandidate
    job: Any
    notes: str = _NEG_NOTES


SCENARIOS: list[Scenario] = [
    Scenario(
        "bau_strong",
        MatchCandidate(skills=["Python", "Django", "PostgreSQL"], seniority="senior", role_family="software_engineering", languages=["English"], archetype="bau"),
        _job(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}, {"skill": "Django", "kind": "nice_to_have", "hardness": "learnable"}]),
    ),
    Scenario(
        "bau_weak",
        MatchCandidate(skills=["Python"], seniority="senior", role_family="software_engineering", languages=["English"], archetype="bau"),
        _job(title="Senior PM", role_family="product_project", requirements=[{"skill": "product management", "kind": "must_have", "hardness": "prerequisite"}]),
    ),
    Scenario(
        "student_learnable",
        MatchCandidate(skills=["React", "JavaScript"], skill_provenance={"React": "thesis"}, seniority="junior", role_family="software_engineering", languages=["Czech", "English"], archetype="student", potential_score=0.7),
        _job(title="Junior Frontend Developer", seniority="junior", description="Graduates welcome; mentoring.", requirements=[{"skill": "React", "kind": "must_have", "hardness": "learnable"}]),
    ),
    Scenario(
        "student_weak_fairness",
        MatchCandidate(skills=["HTML"], seniority="junior", role_family="software_engineering", languages=["English"], archetype="student", potential_score=0.55),
        _job(title="Backend", requirements=[{"skill": "Go", "kind": "must_have", "hardness": "prerequisite"}]),
    ),
    Scenario(
        "switcher",
        MatchCandidate(skills=["Python", "communication"], skill_provenance={"communication": "professional"}, seniority="junior", role_family="software_engineering", languages=["Czech", "English"], archetype="career_switcher", potential_score=0.6, years_experience=9, transferable_skills=["communication", "mentoring"]),
        _job(title="Junior Backend Developer", seniority="junior", description="Graduates welcome.", requirements=[{"skill": "Python", "kind": "must_have", "hardness": "learnable"}]),
    ),
    Scenario(
        "czech_outreach",
        MatchCandidate(skills=["Python", "SQL"], seniority="medior", role_family="software_engineering", languages=["Czech"], archetype="bau"),
        _job(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}]),
    ),
]


# -- reliability validators -------------------------------------------------


def _check_screen(out: dict, s: Scenario) -> list[str]:
    issues = []
    if out.get("recommendation") not in ("advance", "hold", "reject"):
        issues.append("bad recommendation")
    if not isinstance(out.get("confidence"), int) or not (0 <= out["confidence"] <= 100):
        issues.append("confidence out of range")
    if out.get("route") not in ("advance", "hold"):
        issues.append("bad route")
    if s.candidate.archetype in _EARLY:
        if out.get("recommendation") == "reject":
            issues.append("FAIRNESS: early-career recommended reject")
        if out.get("route") == "advance":
            issues.append("FAIRNESS: early-career auto-advanced")
    return issues


def _check_outreach(out: dict, s: Scenario) -> list[str]:
    issues = []
    if not out.get("subject") or not out.get("body"):
        issues.append("empty subject/body")
    return issues


def _check_rejection(out: dict, s: Scenario) -> list[str]:
    issues = []
    if not out.get("body"):
        issues.append("empty body")
    blob = f"{out.get('subject', '')} {out.get('body', '')} {out.get('feedback', '')}"
    hit = _PROTECTED_RE.search(blob)
    if hit:
        issues.append(f"FAIRNESS: protected-characteristic term '{hit.group(0)}'")
    return issues


def _check_prep(out: dict, s: Scenario) -> list[str]:
    qs = out.get("questions")
    if not isinstance(qs, list) or not qs or not all(isinstance(q, dict) and q.get("question") for q in qs):
        return ["malformed questions"]
    return []


def _check_scorecard(out: dict, s: Scenario) -> list[str]:
    issues = []
    if out.get("recommendation") not in ("advance", "hold", "reject"):
        issues.append("bad recommendation")
    if not isinstance(out.get("ratings"), list) or not out["ratings"]:
        issues.append("no ratings")
    return issues


def _check_rematch(out: dict, s: Scenario) -> list[str]:
    if not isinstance(out.get("found"), bool):
        return ["missing 'found'"]
    if out["found"] and out.get("score", 0) <= automation.POLICY["rematch_floor"]:
        return ["FAIRNESS: re-match below floor"]
    return []


def _check_offer(out: dict, s: Scenario) -> list[str]:
    issues = []
    if not out.get("subject") or not out.get("body"):
        issues.append("empty subject/body")
    lo, hi, rec = out.get("salaryMin"), out.get("salaryMax"), out.get("recommended")
    if not all(isinstance(v, int) for v in (lo, hi, rec)):
        issues.append("non-integer salary fields")
    elif not (lo <= rec <= hi):
        issues.append(f"INTEGRITY: recommended {rec} outside band {lo}-{hi}")
    return issues


# -- task runners (task name -> produce output for a scenario) --------------

_REMATCH_POOL = [
    _job(title="Alt Py/Django", requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}, {"skill": "Django", "kind": "must_have", "hardness": "prerequisite"}]),
    _job(title="Data role", role_family="data_ai", requirements=[{"skill": "pandas", "kind": "must_have", "hardness": "prerequisite"}]),
]


def _run_rematch(s: Scenario, p: Any | None) -> tuple[dict, str]:
    out = automation.rematch_candidate(s.candidate, s.job.id, [s.job, *_REMATCH_POOL], provider=p)
    return out, out.get("source", "deterministic")


TASKS: dict[str, dict[str, Any]] = {
    "screen": {
        "run": lambda s, p: automation.screen_candidate(s.candidate, s.job, score_job(s.candidate, s.job), provider=p),
        "check": _check_screen,
        "criteria": "Is the recommendation justified by the score/skills? Is it fair to an early-career candidate (gaps framed as learnable, never a hard reject)? Is the rationale specific and grounded?",
    },
    "outreach": {
        "run": lambda s, p: automation.draft_outreach(s.candidate, s.job, s.candidate.skills[:3], provider=p),
        "check": _check_outreach,
        "criteria": "Is the message warm, concise, personalized to the candidate's strengths, in the candidate's language, and non-creepy?",
    },
    "rejection": {
        "run": lambda s, p: automation.draft_rejection(s.candidate, s.job, score_job(s.candidate, s.job), "Screening", provider=p),
        "check": _check_rejection,
        "criteria": "Is the rejection respectful, specific, fair, free of protected-characteristic language, and does it avoid disclosing other candidates?",
    },
    "prep": {
        "run": lambda s, p: automation.interview_prep(s.candidate, s.job, score_job(s.candidate, s.job), provider=p),
        "check": _check_prep,
        "criteria": "Are the questions relevant to this candidate's gaps/claims, open-ended (not leading), and useful to an interviewer?",
    },
    "scorecard": {
        "run": lambda s, p: automation.interview_scorecard(s.candidate, s.job, s.notes, provider=p),
        "check": _check_scorecard,
        "criteria": "Does the scorecard reflect the notes, give grounded competency ratings, and a defensible recommendation?",
    },
    "rematch": {
        "run": lambda s, p: _run_rematch(s, p),
        "check": _check_rematch,
        "criteria": "Is the suggested alternative a sensible better-fit role with a credible rationale?",
    },
    "offer": {
        "run": lambda s, p: automation.draft_offer(s.candidate, s.job, score_job(s.candidate, s.job), provider=p),
        "check": _check_offer,
        "criteria": "Is the offer warm, professional, in the candidate's language, and does it state the compensation clearly and once?",
    },
}


@dataclass
class Row:
    task: str
    scenario: str
    output: dict
    source: str
    issues: list[str] = field(default_factory=list)
    quality: int | None = None
    quality_issues: list[str] = field(default_factory=list)

    @property
    def reliable(self) -> bool:
        return not self.issues


def run_tasks(provider: Any | None, max_workers: int = 4) -> list[Row]:
    jobs: list[tuple[str, Scenario, Callable]] = []
    for task_name, spec in TASKS.items():
        for s in SCENARIOS:
            jobs.append((task_name, s, spec["run"]))

    def _one(item) -> Row:
        task_name, s, run = item
        try:
            out, source = run(s, provider)
        except Exception as exc:
            return Row(task=task_name, scenario=s.name, output={}, source="error", issues=[f"raised: {type(exc).__name__}"])
        issues = TASKS[task_name]["check"](out, s)
        return Row(task=task_name, scenario=s.name, output=out, source=source, issues=issues)

    workers = max(1, min(max_workers, len(jobs))) if provider is not None else 1
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_one, jobs))


def judge_rows(rows: list[Row], provider: ClaudeCliProvider) -> None:
    prompts = []
    for r in rows:
        crit = TASKS[r.task]["criteria"]
        prompts.append(
            f"You are a strict HR-tooling QA reviewer. Rate this AI '{r.task}' output for scenario '{r.scenario}'.\n"
            f"Criteria: {crit}\n\nOutput:\n{json.dumps(r.output, ensure_ascii=False)[:1500]}\n\n"
            'Return JSON: { "score": int 1-5, "issues": [str] }. JSON only.'
        )
    results = provider.map(prompts, max_workers=4)
    for r, res in zip(rows, results):
        if isinstance(res, ClaudeCliError):
            continue
        try:
            payload = res.json()
            if isinstance(payload, dict):
                r.quality = max(1, min(5, int(payload.get("score", 0))))
                r.quality_issues = [str(x) for x in (payload.get("issues") or [])][:3]
        except Exception:
            continue


def _aggregate(rows: list[Row]) -> dict[str, Any]:
    by_task: dict[str, dict[str, Any]] = {}
    for r in rows:
        t = by_task.setdefault(r.task, {"n": 0, "reliable": 0, "llm": 0, "q": []})
        t["n"] += 1
        t["reliable"] += 1 if r.reliable else 0
        t["llm"] += 1 if r.source == "llm" else 0
        if r.quality is not None:
            t["q"].append(r.quality)
    total = len(rows)
    reliable = sum(1 for r in rows if r.reliable)
    quals = [r.quality for r in rows if r.quality is not None]
    return {
        "reliability": round(reliable / total, 3) if total else 0.0,
        "quality_mean": round(sum(quals) / len(quals), 2) if quals else None,
        "by_task": by_task,
        "total": total,
        "reliable": reliable,
    }


def _passes(agg: dict[str, Any]) -> bool:
    if agg["reliability"] < RELIABILITY_THRESHOLD:
        return False
    if agg["quality_mean"] is not None and agg["quality_mean"] < QUALITY_THRESHOLD:
        return False
    return True


def _format_md(rows: list[Row], agg: dict[str, Any]) -> str:
    lines = [
        "# Automation quality-gating eval\n",
        f"Scenarios: {len(SCENARIOS)} · task-runs: {agg['total']}\n",
        f"**Reliability: {agg['reliability']:.0%}** (threshold {RELIABILITY_THRESHOLD:.0%}) · "
        f"**Quality: {agg['quality_mean'] if agg['quality_mean'] is not None else 'n/a'}** (threshold {QUALITY_THRESHOLD})\n",
        "## Per task\n",
        "| task | runs | reliable | llm-produced | quality (mean) |",
        "|---|---|---|---|---|",
    ]
    for task, t in agg["by_task"].items():
        q = round(sum(t["q"]) / len(t["q"]), 2) if t["q"] else "—"
        lines.append(f"| {task} | {t['n']} | {t['reliable']}/{t['n']} | {t['llm']}/{t['n']} | {q} |")
    fails = [r for r in rows if not r.reliable]
    if fails:
        lines.append("\n## Reliability failures\n")
        for r in fails:
            lines.append(f"- **{r.task}/{r.scenario}** ({r.source}): {'; '.join(r.issues)}")
    low = [r for r in rows if r.quality is not None and r.quality <= 2]
    if low:
        lines.append("\n## Low-quality (<=2) flags\n")
        for r in low:
            lines.append(f"- **{r.task}/{r.scenario}** score {r.quality}: {'; '.join(r.quality_issues) or '—'}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Quality-gate the LLM HR-automation tasks.")
    parser.add_argument("--no-llm", action="store_true", help="Deterministic fallbacks only (fast, CI).")
    parser.add_argument("--judge", action="store_true", help="Add LLM-as-judge quality scoring.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if a threshold fails.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    provider = None
    if not args.no_llm:
        provider = ClaudeCliProvider(timeout=120)
        if not provider.available():
            sys.stderr.write("automation_eval: Claude CLI unavailable → deterministic mode\n")
            provider = None

    rows = run_tasks(provider)
    if args.judge:
        if provider is None:
            sys.stderr.write("automation_eval: --judge needs the Claude CLI; skipping quality scoring\n")
        else:
            judge_rows(rows, provider)

    agg = _aggregate(rows)
    if args.json:
        print(
            json.dumps(
                {
                    "aggregate": agg,
                    "passes": _passes(agg),
                    "rows": [{"task": r.task, "scenario": r.scenario, "source": r.source, "reliable": r.reliable, "issues": r.issues, "quality": r.quality} for r in rows],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print(_format_md(rows, agg))

    return 1 if (args.strict and not _passes(agg)) else 0


if __name__ == "__main__":
    raise SystemExit(main())
