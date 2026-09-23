"""The ONE evaluate-submission chain — shared by the CLI and the fairness gate.

Production scores two kinds of submission: a repo link (commit metadata) and a Live
Work Surface session (observed events, captured chat, the submitted tree, the frozen
seed with its planted canaries, the frozen one-shot baseline). The chain that turns
those inputs into an evaluation used to be assembled only inside devcase_cli's argv
branch, so no harness could run it without a subprocess — and the gate that certifies
fairness and discrimination (submission_eval) kept certifying the commit-message path
alone, while every observed-path scoring defect was found by a manual case-sim round.

``run_evaluation`` is that chain, verbatim, behind a typed input. devcase_cli is now a
thin argv -> :class:`EvaluationInputs` adapter over it and submission_eval.run_one
calls it directly, so the gate exercises exactly what an in-product candidate is
scored on. What stays in the CLI is what is not evaluation: argv guards, provider
resolution + the availability descent, the judge-independence stamp (install
configuration) and the envelope/ledger emit.

Returns an :class:`EvaluationRun` whose ``fallback_reasons`` is the provenance
:class:`FallbackReasons` map — its ``.codes`` (the coded descent per step, challenge-r04
tests-llm-eval/A) must survive to the CLI's ledger emit, so it is never flattened to a
plain dict here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import artifact_checks as _checks
from . import evaluate as _evaluate
from . import prompt_signals as _psig
from . import reflect as _reflect
from .provenance import FallbackReasons, collect_fallback_reasons


@dataclass
class EvaluationInputs:
    """Everything one submission is scored from. Only ``commits`` is required; every
    observed input quietly no-ops when absent (a repo-link submission has none)."""

    commits: list[dict]
    case: dict | None = None
    role: dict | None = None
    probes: list[dict] = field(default_factory=list)
    repo: dict | None = None
    # Live Work Surface (observed) evidence:
    events: list[dict] | None = None
    seed: dict | None = None
    files: list[dict] | None = None
    chat: list[dict] = field(default_factory=list)
    baseline: dict | None = None
    lang: str = "en"


@dataclass
class EvaluationRun:
    result: dict
    per_step: dict[str, str]
    confidences: dict[str, float]
    fallback_reasons: FallbackReasons


def step_confidences(**named: object) -> dict[str, float]:
    """Map step -> its artifact's ``confidence`` (0..1), skipping artifacts without one.

    NeedAnalysis, CommitReflection and ToolingSignal carry a confidence SELF-RATING, while
    CaseEvaluation and TransferAssessment carry a PROPAGATED one (the min of their upstream
    signals — see the confidence scale in models.py + evaluate._propagated_confidence). All five
    surface here so a reviewer can see the decision artifact is only as trustworthy as the evidence
    it was built from. Artifacts with no ``confidence`` (role/case) are silently omitted rather
    than reported as 0.0.
    """
    out: dict[str, float] = {}
    for step, art in named.items():
        if isinstance(art, dict) and isinstance(art.get("confidence"), (int, float)):
            out[step] = float(art["confidence"])
    return out


def observed_extras(inputs: EvaluationInputs, case: dict) -> dict | None:
    """The OBSERVED ground-truth checks (LLM-era controls; each quietly no-ops on absent
    inputs): the captured prompt channel, the planted-canary verdicts, and the distance
    from the one-shot baseline. None when nothing was observed."""
    chat = inputs.chat or []
    psig = _psig.derive_prompt_signals(chat, case) if chat else None
    canaries = _checks.canary_outcomes(inputs.seed, inputs.files, chat) if inputs.seed else []
    basesim = _checks.baseline_similarity(inputs.baseline, inputs.seed, inputs.files) if inputs.baseline else {"available": False}
    extras: dict = {}
    if psig and psig.get("observed"):
        extras["promptSignals"] = psig
        extras["promptEvidence"] = _psig.prompt_evidence(psig)
    if canaries:
        extras["canaryOutcomes"] = canaries
    if basesim.get("available"):
        extras["baselineSimilarity"] = basesim
    if canaries or basesim.get("available"):
        extras["checkEvidence"] = _checks.check_evidence(canaries, basesim)
    return extras or None


def run_evaluation(inputs: EvaluationInputs, *, provider: Any | None, reflect_only: bool = False) -> EvaluationRun:
    """reflect -> tooling [-> evaluate -> transfer -> followups] over one submission.

    ``reflect_only`` is the CLI's reflect-commits command: the chain stops after tooling.
    """
    # Seed paths scope the observed read-before-write to files that EXISTED in the seed
    # (newly created files are exempt — case-sim round 1).
    seed_paths = [str(f["path"]) for f in ((inputs.seed or {}).get("files") or []) if isinstance(f, dict) and f.get("path")]
    # W0.2 — the candidate's contributed lines feed assess_tooling as well as
    # evaluate_submission, so probe verdicts are read off the work instead of inferred
    # from commit-subject shape.
    submission_work = _checks.submission_excerpts(inputs.seed, inputs.files)
    reflection, rsrc = _reflect.reflect_commits(inputs.commits, inputs.repo, provider=provider)
    tooling, tsrc = _reflect.assess_tooling(
        reflection, inputs.commits, inputs.probes, inputs.repo, events=inputs.events,
        seed_paths=seed_paths or None, submission=submission_work or None, provider=provider,
    )
    if reflect_only:
        return EvaluationRun(
            {"reflection": reflection, "tooling": tooling},
            {"reflect": rsrc, "tooling": tsrc},
            step_confidences(reflect=reflection, tooling=tooling),
            # pop=True: lift the reason OFF the artifact so it rides in the envelope,
            # not the model round-trip.
            collect_fallback_reasons((("reflect", reflection), ("tooling", tooling)), pop=True),
        )
    case = inputs.case or {}
    role = inputs.role or {}
    extras = observed_extras(inputs, case)
    evaluation, esrc = _evaluate.evaluate_submission(reflection, tooling, case, role, extras=extras, submission=submission_work or None, provider=provider, lang=inputs.lang)
    transfer, xsrc = _evaluate.score_transfer(evaluation, role, provider=provider, lang=inputs.lang)
    # The interview hand-off: candidate-specific authorship questions minted from THIS
    # submission's observed decisions — the scores above are hypotheses the live
    # conversation verifies (the artifact alone can be wholly LLM-produced).
    followups, fsrc = _evaluate.mint_followups(reflection, tooling, evaluation, case, role, extras=extras, provider=provider, lang=inputs.lang)
    result = {
        # observedChecks rides in the result so the TS bundle persists the mechanical
        # verdicts (canaries, prompt signals, baseline distance) beside the LLM
        # interpretation that consumed them.
        "reflection": reflection,
        "tooling": tooling,
        "evaluation": evaluation,
        "transfer": transfer,
        "followups": followups,
        "observedChecks": extras or {},
    }
    return EvaluationRun(
        result,
        {"reflect": rsrc, "tooling": tsrc, "evaluate": esrc, "transfer": xsrc, "followups": fsrc},
        # evaluate/transfer carry a PROPAGATED confidence (min of upstream), so the decision
        # artifact is flagged alongside the thin steps it was built from.
        step_confidences(reflect=reflection, tooling=tooling, evaluate=evaluation, transfer=transfer),
        collect_fallback_reasons(
            (("reflect", reflection), ("tooling", tooling), ("evaluate", evaluation), ("transfer", transfer), ("followups", followups)),
            pop=True,
        ),
    )
