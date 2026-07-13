"""LLM-as-judge scoring for the bench matrix.

The matrix (runner.py) scores structural CONTRACTS (is the payload well-shaped);
this adds SEMANTIC quality — an independent judge scores each served output 1-10 on
relevance / correctness / adherence + an overall score, so the scorecard answers
"which model writes the best output for each op", not just "which produced valid
JSON". The judge is the Claude CLI (via MonitoredClaudeCli, so its own traffic is
also tracked in LightTrack) — a different engine than the OpenRouter/API targets, so
a target's own family doesn't grade itself. Reuses the shared devcase.llm_judge
scaffold (map → parse → skip-malformed).

The judge sees the task, the scenario CONTEXT (the record's ``meta`` — seed ids,
match score, language) and the output. That is enough to rank output quality across
models on the same seeded scenario; it does not see the full rendered input, so it
weights coherence / adherence / completeness and should not over-claim factual
correctness it cannot verify (the prompt says so)."""

from __future__ import annotations

import json
from typing import Any, Sequence

from ...claude_cli import ClaudeCliProvider
from ...devcase.llm_judge import run_judge
from ..monitor import MonitoredClaudeCli
from .runner import BenchRecord

# One-line task descriptions per bench use case (recruiter-domain framing for the judge).
_USE_CASE_TASK: dict[str, str] = {
    "match_reasoning": "explain why a candidate does or doesn't fit a job — a recruiter-facing rationale",
    "automation_screen": "screen a candidate for a job — a concise screening decision with rationale",
    "automation_outreach": "draft a personalized, on-brand candidate-outreach message",
    "automation_rejection": "draft a considerate, specific candidate rejection message",
    "automation_offer": "draft a warm, professional job-offer message with the compensation figure",
    "interview_prep": "build an interviewer prep pack — competency-targeted questions + focus areas",
    "interview_scorecard": "synthesize a structured interview scorecard (per-competency ratings + a recommendation) from an interview transcript",
    "weight_proposal": "propose per-candidate scoring weights (skills/career/personal) + rationale for ranking a group against a role",
    "jd_ingest": "parse a prose job posting into a structured job (title, seniority, requirements, responsibilities)",
    "devcase_analyze": "from a job ad, analyze the role's real technical stack, core responsibilities, stated-vs-real gaps, complexity and risk areas",
    "devcase_role_design": "design a role spec (title, seniority, must-haves, nice-to-haves, responsibilities) from the need + its analysis",
    "devcase_case_design": "design a hands-on work-sample case (brief, tasks, covert probes, rubric) grounded in the role's real stack",
    "devcase_interview_scenario": "turn a designed case into a live interview scenario (case intro + comparable, case-grounded phases)",
    "group_compare": "write a scannable head-to-head comparison of a role's candidates (a decisive headline, 3-5 comparative key points, a concrete next-action recommendation)",
    "campaign_pack": "draft a job-ad campaign pack (channels, copy, targeting)",
}

_JUDGE_SYSTEM = (
    "You are a strict senior reviewer scoring the QUALITY of an AI recruiting tool's output. "
    "Score ONLY the given output against the task and context. Score 1-10 in each dimension "
    "(10 = excellent, 1 = unusable). You are given a summary of the seeded context, not the full "
    "raw input, so weight coherence, task adherence and completeness; do not assert factual "
    "correctness you cannot verify. Be critical and concrete. Return ONLY a JSON object."
)


def _judge_prompt(record: BenchRecord) -> str:
    task = _USE_CASE_TASK.get(record.use_case, record.use_case)
    return "\n".join(
        [
            f"Task: {task}",
            "",
            "Context (the seeded scenario the output was produced from):",
            json.dumps(record.meta or {}, ensure_ascii=False),
            "",
            "Model output to score (JSON):",
            json.dumps(record.payload, ensure_ascii=False, default=str),
            "",
            "Return ONLY this JSON object:",
            '{"score": <1-10>, "relevance": <1-10>, "correctness": <1-10>, '
            '"adherence": <1-10>, "verdict": "<one sentence>", "issues": ["<specific issue>"]}',
        ]
    )


def _coerce_dim(value: Any) -> float | None:
    """Coerce a judge dimension to a float when the judge emits one in a slightly
    off shape (a numeric string like ``"8"``); genuinely non-numeric formats
    (``"8/10"``, ``"high"``) or a missing value become ``None``. Rescues a numeric
    string that ``bake_quality._med_dim`` would otherwise discard as non-numeric,
    while keeping a truly unparseable dim out of the median.
    bug-ui-scan-2026-07-09 (llm-provider-layer-python #4)."""
    if isinstance(value, bool):  # bool is an int subclass; True/False isn't a 1-10 score
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def default_judge_provider(model: str | None = None, *, timeout: int = 120) -> ClaudeCliProvider:
    """The default bench judge: the Claude CLI, stamped so its calls are attributable
    in LightTrack under the ``bench_judge`` operation."""
    return MonitoredClaudeCli(model=model, timeout=timeout, use_case="bench_judge")


def judge_records(
    records: Sequence[BenchRecord],
    provider: ClaudeCliProvider,
    *,
    workers: int = 2,
) -> int:
    """Attach an LLM-judge score to every SERVED record (mutated in place). Rows that
    errored or produced no payload are left unscored. Returns the number scored."""

    judgeable = [r for r in records if r.error is None and r.payload is not None]
    if not judgeable:
        return 0

    scored = 0

    def prompt_fn(record: BenchRecord) -> str:
        return _judge_prompt(record)

    def parse_fn(record: BenchRecord, payload: dict) -> None:
        nonlocal scored
        # float() raises on a missing/None/non-numeric score → run_judge's parse_fn
        # guard skips just this row (verdict left unscored), never the whole pass.
        record.judge_score = float(payload["score"])
        record.judge_detail = {
            # Coerce each dim (bug-ui-scan-2026-07-09 #4): a numeric string is
            # rescued to a float, a non-numeric one becomes None (skipped by the
            # median) — so one soft dim can't later void the whole judged cell.
            "relevance": _coerce_dim(payload.get("relevance")),
            "correctness": _coerce_dim(payload.get("correctness")),
            "adherence": _coerce_dim(payload.get("adherence")),
            "verdict": payload.get("verdict"),
            "issues": payload.get("issues"),
        }
        scored += 1

    # run_judge injects the judge's own JSON-only guard; we pass the system prompt via
    # the provider's map (Claude CLI reads it per-call), so prepend it to each prompt.
    run_judge(
        judgeable,
        lambda r: f"{_JUDGE_SYSTEM}\n\n{prompt_fn(r)}",
        parse_fn,
        provider,
        workers=workers,
    )
    return scored


__all__ = ["default_judge_provider", "judge_records"]
