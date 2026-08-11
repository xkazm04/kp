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
match score, language), an INPUT-EVIDENCE excerpt (``meta["judgeInput"]``, stamped
by scenarios.py — the JD text, transcript, or candidate facts the model was given,
truncated) and the output — so correctness is scored against evidence, not vibes.
The scale is anchored (see _JUDGE_SYSTEM): bands are defined by the decision a
recruiter would make with the output, and the judge is told a flawless output MUST
land 9-10 — the earlier unanchored rubric compressed the whole matrix into 5-8."""

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
    "weight_proposal": "propose per-candidate scoring weights (skills/career/personal, summing to 1.0 within each candidate's stated bounds) + a one-sentence evidence-citing rationale per candidate, for ranking a group against a role",
    "jd_ingest": "parse a prose job posting into a structured job (title, seniority, requirements, responsibilities)",
    "devcase_analyze": "from a job ad, analyze the role's real technical stack, core responsibilities, stated-vs-real gaps, complexity and risk areas",
    "devcase_role_design": "design a role spec (title, seniority, must-haves, nice-to-haves, responsibilities) from the need + its analysis",
    "devcase_case_design": "design a hands-on work-sample case (brief, tasks, covert probes, rubric) grounded in the role's real stack",
    "devcase_interview_scenario": (
        "turn a designed case into a live interview scenario: a spoken case intro plus concrete "
        "probes for the CASE-GROUNDED phases only — phases marked caseGrounded:false are the "
        "canonical fixed skeleton the tool merges in unchanged, NOT this model's output; do not "
        "score them"
    ),
    "group_compare": "write a scannable head-to-head comparison of a role's candidates (a decisive headline, 3-5 comparative key points, a concrete next-action recommendation)",
    # Matches the REAL deliverable (campaign.py): hook-typed feed-ad variants +
    # 4-beat 15s video scripts, built from supplied job facts only. The earlier
    # description ("channels, copy, targeting") graded every model against a
    # deliverable the op never asks for — a judge artifact, not model weakness.
    "campaign_pack": (
        "draft ~8 short social-feed job-ad variants, each with a hook (typed number/location/"
        "problem/skills), 2-4 sentences of ad copy ending in a low-friction CTA, and a 4-beat "
        "15-second video script (hook/offer/proof/cta) — using ONLY the supplied job facts, "
        "never inventing pay, benefits or testimonials"
    ),
}

# Anchored rubric (bench round 2026-08-11). The unanchored "1-10, be critical"
# judge compressed everything into the 5-8 band — the whole seven-model matrix
# averaged ~7 with no cell above 8.6, which reads as "all models are mediocre"
# when it is actually the JUDGE refusing the tails. Bands are defined by the
# decision a recruiter would make with the output in hand, the judge is told the
# full range is expected across a matrix, and each dimension is scored against
# its own question rather than a shared vibe.
_JUDGE_SYSTEM = (
    "You are a strict senior reviewer scoring the QUALITY of an AI recruiting tool's output. "
    "Score ONLY the given output against the task, context and input evidence.\n"
    "\n"
    "Use this anchored scale for every dimension AND the overall score — the anchors are "
    "decisions, not adjectives:\n"
    "  9-10  ship as-is: a senior recruiter would send/use this without edits; nothing "
    "missing, nothing invented, exactly the asked deliverable.\n"
    "  7-8   ship after a small edit: right substance and structure, one or two specifics "
    "you would tweak.\n"
    "  5-6   usable as a draft: real rework needed — a missing deliverable, generic filler, "
    "or a claim the input does not support.\n"
    "  3-4   misleading or badly incomplete: wrong emphasis, contradicts the input, or "
    "skips a required part of the task.\n"
    "  1-2   unusable: off-task, incoherent, or fabricated.\n"
    "\n"
    "Dimensions, each scored on that scale against its OWN question:\n"
    "  relevance   — does it address THIS candidate/job/case, or could it be pasted onto any?\n"
    "  correctness — is every claim supported by the provided input evidence? Penalize "
    "inventions and contradictions; when evidence is provided, USE it.\n"
    "  adherence   — is every part of the asked deliverable present, in the asked shape?\n"
    "\n"
    "Use the full range: a flawless output MUST score 9-10 — do not withhold the top band "
    "on principle — and a broken one MUST score 1-3. Across a matrix of models most outputs "
    "should NOT land on the same number. Be critical and concrete. Return ONLY a JSON object."
)

# Cap on the input-evidence excerpt embedded in the judge prompt — enough to
# ground correctness, small enough to keep 100+ judge calls cheap. Matches
# scenarios._JI_MAX: an excerpt narrower than the model's real input makes the
# judge read grounded facts as fabrications (calib-a artifact).
_EVIDENCE_MAX = 4000


def _judge_prompt(record: BenchRecord) -> str:
    task = _USE_CASE_TASK.get(record.use_case, record.use_case)
    meta = dict(record.meta or {})
    # The scenario's real input evidence (scenarios.py stamps judgeInput) is shown
    # under its own heading so the judge can check claims against it, instead of
    # being told "you cannot verify correctness" and levelling every output.
    evidence = str(meta.pop("judgeInput", "") or "")[:_EVIDENCE_MAX]
    contract = (
        "Structural contract: PASSED"
        if record.valid
        else "Structural contract violations: " + json.dumps(record.violations, ensure_ascii=False)
    )
    parts = [
        f"Task: {task}",
        "",
        "Context (the seeded scenario the output was produced from):",
        json.dumps(meta, ensure_ascii=False),
    ]
    if evidence:
        parts += [
            "",
            "Input evidence (a TRUNCATED excerpt of what the model was given — check claims "
            "against it; a claim outside the excerpt's scope is UNVERIFIABLE, not fabricated — "
            "penalize only direct contradictions and inventions of fact kinds the task forbids):",
            evidence,
        ]
    parts += [
        "",
        contract,
        "",
        "Model output to score (JSON):",
        json.dumps(record.payload, ensure_ascii=False, default=str),
        "",
        "Return ONLY this JSON object:",
        '{"score": <1-10>, "relevance": <1-10>, "correctness": <1-10>, '
        '"adherence": <1-10>, "verdict": "<one sentence>", "issues": ["<specific issue>"]}',
    ]
    return "\n".join(parts)


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
    """Attach an LLM-judge score to every REAL LLM output (mutated in place).

    Judged quality and measured reliability are deliberately separate axes:
    a record that degraded to the deterministic fallback is the SAME template
    for every model, so judging it measures the fallback, not the model — and
    it drags the model's quality cell down for what is actually a reliability
    failure (already reported as ``llmRate``). The 2026-08-05 expanded run hit
    exactly this: interview_scorecard fallback stubs were scored ~2 and
    contaminated three models' quality cells. Rows that errored, produced no
    payload, or were served deterministically are left unscored. Returns the
    number scored."""

    judgeable = [r for r in records if r.error is None and r.payload is not None and r.source == "llm"]
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
