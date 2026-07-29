"""CLI for Dev-extension tasks (Phase D2+). Mirrors automation_cli / reasoning_cli.

    python -m pipeline.jobfit.devcase.devcase_cli analyze-need      --need-json N [--snapshot-json S | --snapshots-json SS] [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli design-artifacts  --need-json N --analysis-json A [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli reflect-commits     --commits-json C [--probes-json P] [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli evaluate-submission --commits-json C --case-json K --role-json R [--probes-json P] [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli interview-scenario  --case-json K --role-json R [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli observed-interview  --case-json K --role-json R --scorecard-json S --profile-json P
    python -m pipeline.jobfit.devcase.devcase_cli observed-skills    --case-json K --role-json R --evaluation-json E --transfer-json T --profile-json P
    python -m pipeline.jobfit.devcase.devcase_cli materialize-seed  --case-json K --role-json R [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli session-chat      --case-json K --role-json R --channel assistant|stakeholder --message M [--chat-json T] [--current-file-json F] [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli baseline-solve    --case-json K --role-json R [--seed-json S] [--no-llm]

evaluate-submission also accepts the observed-evidence inputs (LLM-era controls; all
optional): --chat-json (captured prompt channel), --seed-json (frozen seed incl.
internal canaries), --files-json (submitted tree), --baseline-json (frozen one-shot
solutions) — each quietly no-ops when absent.

Output: one JSON object {"result","source","perStepSources"[,"fallbackReason"][,"confidence"]}
to stdout — a uniform provenance envelope every command shares. `perStepSources` maps each
pipeline step to its "llm"/"deterministic" source and `source` is their combined tri-state
verdict; single-step commands emit a one-key map, so the UI has ONE stable contract to render
a consistent provenance strip (and its degraded "partial" badge) across every command. The
optional `fallbackReason` block (present only when a step's LLM call RAISED and fell back to
its deterministic template) maps that step to a one-line "<ExceptionType>: <message>" cause —
so an operator/UI can tell a timeout from a JSON parse error from a misconfigured provider,
instead of a silent deterministic run that looks identical in every failure mode. The optional
`confidence` block (present only when a step's artifact carries a 0..1 confidence — the
self-rated analyze/reflect/tooling plus the PROPAGATED evaluate/transfer, which inherit the min of
their upstream signals) rides beside the badge so the UI can warn a reviewer not to over-trust a
thin/ungrounded step — or a decision built on one; see the confidence scale in models.py.
On failure: {"error","status","code"} to stderr, where status/code distinguish a
user-fixable input error (400 / "invalid_input", exit 2) from a genuine engine failure
(500 / "engine_error", exit 1) — mirroring jobfit/cli.py so the UI can render a precise
inline hint vs a retry/escalate toast.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .._cli import configure_stdio
from ..llm import emit_deterministic, resolve_provider
from . import analyze as _analyze
from . import design as _design
from . import evaluate as _evaluate
from . import reflect as _reflect
from .models import LOW_CONFIDENCE, DevNeed, NeedAnalysis, RepoSnapshot
from .provenance import collect_fallback_reasons, combine_source

# devcase_cli command → LLM-registry use case (capabilities.py catalog), so the
# Models config can pin a provider/model per step. design-artifacts covers both
# the role and case design steps with one provider (the case-design row, which
# carries the quality-model default).
_USE_CASE_BY_COMMAND = {
    "analyze-need": "devcase_analyze",
    "design-artifacts": "devcase_case_design",
    "reflect-commits": "devcase_reflect",
    "evaluate-submission": "devcase_evaluate",
    "interview-scenario": "devcase_interview_scenario",
    "materialize-seed": "devcase_seed",
    # LLM-era controls: the in-session chat rides the evaluate provider row (cheap,
    # frequent); the one-shot baseline solve rides the seed row (freeze-time, rare).
    "session-chat": "devcase_evaluate",
    "baseline-solve": "devcase_seed",
}

# Stable, machine-readable error codes the UI branches on. INVALID_INPUT is a
# user-correctable problem (missing/garbled --*-json arg, failed pydantic
# validation) → 400; ENGINE_ERROR is an unexpected failure in the pipeline
# itself (provider crash, bug) → 500, signalling retry/escalate.
ERR_INVALID_INPUT = "invalid_input"
ERR_ENGINE = "engine_error"


def _require_list_of_dicts(value: object, flag: str) -> list:
    """Guard a --*-json input that must be a JSON array of objects (commits/probes/candidates).
    A valid-JSON file of the WRONG SHAPE (an object instead of an array, or an array of strings)
    parses fine but blows up downstream (iterating a dict yields keys; ``c.get`` on a str raises
    AttributeError) and the bare ``except Exception`` would misroute it to 500 engine_error. Raise
    ValueError so it lands as 400 invalid_input / exit 2 — the documented 'fix your input' signal."""
    if not isinstance(value, list) or not all(isinstance(x, dict) for x in value):
        raise ValueError(f"{flag} must be a JSON array of objects")
    return value


def _require_object(value: object, flag: str) -> dict:
    """Guard a --*-json input that must be a JSON object (case/role/repo) — see
    :func:`_require_list_of_dicts` for why wrong-shape input must be 400, not 500."""
    if not isinstance(value, dict):
        raise ValueError(f"{flag} must be a JSON object")
    return value


def _confidences(**named: object) -> dict[str, float]:
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


def _fallback_reasons(**named: object) -> dict[str, str]:
    """Map step -> the reason its LLM call fell back to its deterministic template.

    The reason is stashed on each artifact by ``provenance.generate_with_fallback`` when the
    LLM path raises; here we POP it OFF the artifact so it rides in the envelope (beside
    ``perStepSources``) rather than polluting the artifact and its model round-trip. Only
    steps whose LLM call actually raised carry one — a clean LLM run or a ``--no-llm`` /
    provider-unavailable run records none — so the map (and the envelope key) is empty/omitted
    in the common case. ``named`` keys MUST match the ``per_step`` keys so the two line up.
    """
    # pop=True: lift the reason OFF the artifact so it rides in the envelope, not
    # the model round-trip (shared with both eval harnesses via provenance).
    return collect_fallback_reasons(named.items(), pop=True)


def _emit(
    result: object,
    per_step: dict[str, str],
    confidences: dict[str, float] | None = None,
    fallback_reasons: dict[str, str] | None = None,
    use_case: str | None = None,
) -> None:
    """Print the uniform provenance envelope every command shares.

    ``result`` is the command's payload; ``per_step`` maps each pipeline step to its
    ``"llm"``/``"deterministic"`` source. ``source`` is derived here as their combined
    tri-state verdict (:func:`provenance.combine_source`) so the two can never drift.
    Single-step commands pass a one-key map — the UI still gets the same
    {result, source, perStepSources} shape and one provenance component covers the
    whole pipeline.

    When a step's LLM call RAISED and fell back to its deterministic template, its cause is
    surfaced as an optional ``fallbackReason`` block (step -> "<ExceptionType>: <message>"),
    so a degraded run no longer looks identical whether the provider was down, slow, or
    returning garbage. The key is omitted when nothing fell back due to an error (a clean LLM
    run, or a deliberate ``--no-llm`` / provider-unavailable run — both already honest via
    ``source``), keeping the base envelope unchanged for those.

    When the command's artifacts carry a ``confidence`` (self-rated for analyze/reflect/tooling,
    PROPAGATED for evaluate/transfer), ``confidences`` is surfaced BESIDE the provenance badge as
    an optional ``confidence`` block — its per-step values, the threshold, and the steps at/below
    it (``low``) — so a reviewer is warned not to over-trust a thin/ungrounded or
    deterministic-fallback step, NOR a decision artifact built on one. The key is omitted entirely
    when no artifact carries a confidence (e.g. design-artifacts, source), keeping the base
    envelope unchanged for those commands.
    """
    # Usage-ledger visibility for the fallback path (item 22): each step the
    # deterministic template served (keyless --no-llm / provider-unavailable, or
    # an LLM call that RAISED and fell back) gets one source:"deterministic"
    # ledger line — mirroring the one line per real LLM call the monitor writes —
    # so keyless traffic stops being invisible to the Models usage panel.
    # ``use_case`` is passed only by the provider-backed commands; the
    # pure-deterministic ones (source, observed-*) never had an LLM to fall back
    # from, so they stay unmetered. No-op without KP_LLM_USAGE_LOG.
    if use_case:
        for step_source in per_step.values():
            if step_source == "deterministic":
                emit_deterministic(use_case)
    envelope: dict[str, object] = {
        "result": result,
        "source": combine_source(*per_step.values()),
        "perStepSources": per_step,
    }
    if fallback_reasons:
        envelope["fallbackReason"] = fallback_reasons
    if confidences:
        envelope["confidence"] = {
            "byStep": confidences,
            "threshold": LOW_CONFIDENCE,
            "low": sorted(step for step, v in confidences.items() if v <= LOW_CONFIDENCE),
        }
    print(json.dumps(envelope, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(description="Dev-extension tasks (Claude CLI only).")
    parser.add_argument("command", choices=["analyze-need", "design-artifacts", "reflect-commits", "evaluate-submission", "source", "interview-scenario", "observed-interview", "observed-skills", "materialize-seed", "session-chat", "baseline-solve"])
    parser.add_argument("--need-json", type=Path)
    parser.add_argument("--snapshot-json", type=Path)
    # Multi-repo grounding: a JSON ARRAY of RepoSnapshot objects (the role can span up
    # to a few codebases). Takes precedence over the single-object --snapshot-json,
    # which is kept for older callers.
    parser.add_argument("--snapshots-json", type=Path)
    parser.add_argument("--analysis-json", type=Path)
    parser.add_argument("--commits-json", type=Path)
    parser.add_argument("--probes-json", type=Path)
    parser.add_argument("--repo-json", type=Path)
    parser.add_argument("--events-json", type=Path)  # observed process events (Live Work Surface)
    # LLM-era controls — observed-evidence inputs for evaluate-submission (all optional):
    parser.add_argument("--chat-json", type=Path)  # captured assistant/stakeholder transcript
    parser.add_argument("--seed-json", type=Path)  # frozen materialized seed (incl. internal canaries)
    parser.add_argument("--files-json", type=Path)  # the submitted file tree (live sessions)
    parser.add_argument("--baseline-json", type=Path)  # frozen one-shot naive-LLM solutions
    # session-chat inputs:
    parser.add_argument("--channel", type=str, default="assistant")  # assistant | stakeholder
    parser.add_argument("--message", type=str, default=None)
    parser.add_argument("--current-file-json", type=Path)  # {path, contents} the candidate is viewing
    parser.add_argument("--case-json", type=Path)
    parser.add_argument("--role-json", type=Path)
    parser.add_argument("--scorecard-json", type=Path)
    parser.add_argument("--evaluation-json", type=Path)
    parser.add_argument("--transfer-json", type=Path)
    parser.add_argument("--profile-json", type=Path)
    parser.add_argument("--candidates-json", type=Path)
    parser.add_argument("--top-n", type=int, default=8)
    parser.add_argument("--floor", type=int, default=45)
    # W5-4 — a human reviewer's revision note from the approval gate; honored by
    # design-artifacts so a flawed design can be regenerated WITH the feedback
    # instead of re-running the whole lifecycle from intake.
    parser.add_argument("--feedback", type=str, default=None)
    # DEVP5 — candidate-facing artifact language (en|cs). Threaded to the case
    # design, seed materialization and interview scenario so the brief/tasks,
    # seed README/DECISIONS and spoken narration render in the candidate's
    # language. normalize_lang guards a fat-fingered value to the default.
    parser.add_argument("--lang", type=str, default="en")
    # design-artifacts only: skip the (LLM) case design and emit just the role.
    # The JD builder uses this when the recruiter didn't tick "Case analysis" — so
    # a plain description build no longer pays for a case-design call it discards.
    parser.add_argument("--role-only", action="store_true")
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)
    from ..i18n import normalize_lang

    lang = normalize_lang(args.lang)

    try:
        # `source` is deterministic (pure matching) — no provider needed.
        if args.command == "source":
            from . import source as _source

            if not args.role_json or not args.candidates_json:
                raise ValueError("source requires --role-json and --candidates-json")
            role = _require_object(json.loads(args.role_json.read_text(encoding="utf-8")), "--role-json")
            candidates = _require_list_of_dicts(json.loads(args.candidates_json.read_text(encoding="utf-8")), "--candidates-json")
            # result = {"candidates": [...], "skipped": int, "skippedReasons": [...]} — the
            # skipped count rides inside the envelope's `result` so the caller can tell an
            # empty shortlist (nobody qualified) apart from a pool that failed to parse.
            result = _source.source_candidates(role, candidates, top_n=args.top_n, floor=args.floor)
            # Pure matching — no LLM — so its single step is always deterministic.
            _emit(result, {"source": "deterministic"})
            return 0

        # Observed evidence from a case-grounded interview's scorecard — a pure
        # deterministic gate (live_case.apply_interview_case), no provider needed.
        if args.command == "observed-interview":
            from ..live_case import apply_interview_case
            from ..profile import CandidateProfileV2
            from .models import CaseScenario, RoleSpec

            if not (args.case_json and args.role_json and args.scorecard_json and args.profile_json):
                raise ValueError("observed-interview requires --case-json, --role-json, --scorecard-json and --profile-json")
            case = CaseScenario.model_validate(_require_object(json.loads(args.case_json.read_text(encoding="utf-8")), "--case-json"))
            role = RoleSpec.model_validate(_require_object(json.loads(args.role_json.read_text(encoding="utf-8")), "--role-json"))
            scorecard = _require_object(json.loads(args.scorecard_json.read_text(encoding="utf-8")), "--scorecard-json")
            profile = CandidateProfileV2.model_validate(
                _require_object(json.loads(args.profile_json.read_text(encoding="utf-8")), "--profile-json")
            )
            updated, credited = apply_interview_case(profile, role, case, scorecard)
            _emit(
                {"creditedSkills": credited, "profile": updated.model_dump(by_alias=True, exclude_none=True)},
                {"observed": "deterministic"},
            )
            return 0

        # Observed evidence from a completed TAKE-HOME evaluation — the deterministic
        # transfer gate (live_case.apply_live_case), no provider needed. The take-home
        # is the deeper read, so its evidence confidence caps higher (0.95) than the
        # case-grounded interview's (0.9).
        if args.command == "observed-skills":
            from ..live_case import apply_live_case
            from ..profile import CandidateProfileV2
            from .models import CaseEvaluation, CaseScenario, RoleSpec, TransferAssessment

            if not (args.case_json and args.role_json and args.evaluation_json and args.transfer_json and args.profile_json):
                raise ValueError(
                    "observed-skills requires --case-json, --role-json, --evaluation-json, --transfer-json and --profile-json"
                )
            case = CaseScenario.model_validate(_require_object(json.loads(args.case_json.read_text(encoding="utf-8")), "--case-json"))
            role = RoleSpec.model_validate(_require_object(json.loads(args.role_json.read_text(encoding="utf-8")), "--role-json"))
            evaluation = CaseEvaluation.model_validate(
                _require_object(json.loads(args.evaluation_json.read_text(encoding="utf-8")), "--evaluation-json")
            )
            transfer = TransferAssessment.model_validate(
                _require_object(json.loads(args.transfer_json.read_text(encoding="utf-8")), "--transfer-json")
            )
            profile = CandidateProfileV2.model_validate(
                _require_object(json.loads(args.profile_json.read_text(encoding="utf-8")), "--profile-json")
            )
            updated, credited = apply_live_case(profile, role, case, evaluation, transfer)
            _emit(
                {"creditedSkills": credited, "profile": updated.model_dump(by_alias=True, exclude_none=True)},
                {"observed": "deterministic"},
            )
            return 0

        # Per-command use case so the Models config can route (and the usage
        # ledger attribute) each dev-case step independently. Commands that
        # return before this line never construct a provider.
        use_case = _USE_CASE_BY_COMMAND.get(args.command, "devcase_case_design")
        provider = None if args.no_llm else resolve_provider(use_case, timeout=120)
        if provider is not None and not provider.available():
            provider = None

        # In-session chat (LLM-era controls #2/#5): one assistant/stakeholder reply.
        if args.command == "session-chat":
            from . import chat as _chat

            if not args.case_json or not args.role_json or not args.message:
                raise ValueError("session-chat requires --case-json, --role-json and --message")
            channel = args.channel if args.channel in ("assistant", "stakeholder") else "assistant"
            case_obj = _require_object(json.loads(args.case_json.read_text(encoding="utf-8")), "--case-json")
            role_obj = _require_object(json.loads(args.role_json.read_text(encoding="utf-8")), "--role-json")
            transcript = (
                _require_list_of_dicts(json.loads(args.chat_json.read_text(encoding="utf-8")), "--chat-json")
                if args.chat_json
                else []
            )
            current_file = (
                _require_object(json.loads(args.current_file_json.read_text(encoding="utf-8")), "--current-file-json")
                if args.current_file_json
                else None
            )
            reply, src = _chat.chat_reply(
                channel, case_obj, role_obj, transcript, args.message, current_file=current_file, lang=lang, provider=provider
            )
            _emit({"reply": reply}, {"chat": src}, fallback_reasons=_fallback_reasons(chat=reply), use_case=use_case)
            return 0

        # One-shot naive-LLM baseline solve (LLM-era controls #6): frozen per case at
        # approval; evaluation diffs every submission against it.
        if args.command == "baseline-solve":
            from . import baseline as _baseline
            from .models import CaseScenario, RoleSpec

            if not args.case_json or not args.role_json:
                raise ValueError("baseline-solve requires --case-json and --role-json")
            case = CaseScenario.model_validate(json.loads(args.case_json.read_text(encoding="utf-8")))
            role = RoleSpec.model_validate(json.loads(args.role_json.read_text(encoding="utf-8")))
            seed_obj = _require_object(json.loads(args.seed_json.read_text(encoding="utf-8")), "--seed-json") if args.seed_json else None
            result, src = _baseline.solve_baseline(case, role, seed_obj, provider=provider)
            _emit({"baseline": result}, {"baseline": src}, fallback_reasons=_fallback_reasons(baseline=result), use_case=use_case)
            return 0

        # Case -> AI-interview scenario (one per role; reused for every candidate).
        if args.command == "interview-scenario":
            from . import interview_scenario as _scenario
            from .models import CaseScenario, RoleSpec

            if not args.case_json or not args.role_json:
                raise ValueError("interview-scenario requires --case-json and --role-json")
            case = CaseScenario.model_validate(json.loads(args.case_json.read_text(encoding="utf-8")))
            role = RoleSpec.model_validate(json.loads(args.role_json.read_text(encoding="utf-8")))
            scenario, src = _scenario.scenario_from_case(case, role, lang=lang, provider=provider)
            _emit({"scenario": scenario}, {"scenario": src}, fallback_reasons=_fallback_reasons(scenario=scenario), use_case=use_case)
            return 0

        # Case -> materialized seed (real starter files; one per case, shared by
        # every candidate — see seed_materializer.py for why prose isn't enough).
        if args.command == "materialize-seed":
            from . import seed_materializer as _seed
            from .models import CaseScenario, RoleSpec

            if not args.case_json or not args.role_json:
                raise ValueError("materialize-seed requires --case-json and --role-json")
            case = CaseScenario.model_validate(json.loads(args.case_json.read_text(encoding="utf-8")))
            role = RoleSpec.model_validate(json.loads(args.role_json.read_text(encoding="utf-8")))
            seed, src = _seed.materialize_seed(case, role, lang=lang, provider=provider)
            _emit({"seed": seed}, {"seed": src}, fallback_reasons=_fallback_reasons(seed=seed), use_case=use_case)
            return 0

        if args.command in ("reflect-commits", "evaluate-submission"):
            if not args.commits_json:
                raise ValueError(f"{args.command} requires --commits-json")
            # Require the rubric + role for evaluation: defaulting them to {} runs the scorer on
            # an empty rubric and a titleless role and exits 0 with a confident-looking but
            # ungrounded evaluation (success theater). Fail loudly (400 invalid_input) instead.
            if args.command == "evaluate-submission" and (not args.case_json or not args.role_json):
                raise ValueError("evaluate-submission requires --case-json and --role-json")
            commits = _require_list_of_dicts(json.loads(args.commits_json.read_text(encoding="utf-8")), "--commits-json")
            probes = (
                _require_list_of_dicts(json.loads(args.probes_json.read_text(encoding="utf-8")), "--probes-json")
                if args.probes_json
                else []
            )
            repo = _require_object(json.loads(args.repo_json.read_text(encoding="utf-8")), "--repo-json") if args.repo_json else None
            # Live Work Surface (moonshot E): observed process events, present when the
            # candidate worked the case in-product. Present → assess_tooling uses the
            # observed path; absent → the existing commit-metadata inference.
            events = _require_list_of_dicts(json.loads(args.events_json.read_text(encoding="utf-8")), "--events-json") if args.events_json else None
            # Seed loads EARLY so the observed tooling pass can scope read-before-write
            # to files that existed in the seed (newly created files are exempt).
            seed_obj = (
                _require_object(json.loads(args.seed_json.read_text(encoding="utf-8")), "--seed-json")
                if (args.command == "evaluate-submission" and args.seed_json)
                else None
            )
            seed_paths = [str(f["path"]) for f in ((seed_obj or {}).get("files") or []) if isinstance(f, dict) and f.get("path")]
            reflection, rsrc = _reflect.reflect_commits(commits, repo, provider=provider)
            tooling, tsrc = _reflect.assess_tooling(reflection, commits, probes, repo, events=events, seed_paths=seed_paths or None, provider=provider)
            if args.command == "reflect-commits":
                _emit(
                    {"reflection": reflection, "tooling": tooling},
                    {"reflect": rsrc, "tooling": tsrc},
                    _confidences(reflect=reflection, tooling=tooling),
                    _fallback_reasons(reflect=reflection, tooling=tooling),
                    use_case=use_case,
                )
                return 0
            # evaluate-submission continues the chain — case/role are required (guarded above).
            case = _require_object(json.loads(args.case_json.read_text(encoding="utf-8")), "--case-json")
            role = _require_object(json.loads(args.role_json.read_text(encoding="utf-8")), "--role-json")
            # LLM-era controls — assemble the OBSERVED ground-truth checks (all optional;
            # each quietly no-ops on absent inputs): the captured prompt channel, the
            # planted-canary verdicts, and the distance from the one-shot baseline.
            from . import artifact_checks as _checks
            from . import prompt_signals as _psig

            chat_msgs = _require_list_of_dicts(json.loads(args.chat_json.read_text(encoding="utf-8")), "--chat-json") if args.chat_json else []
            files_list = _require_list_of_dicts(json.loads(args.files_json.read_text(encoding="utf-8")), "--files-json") if args.files_json else None
            baseline_obj = _require_object(json.loads(args.baseline_json.read_text(encoding="utf-8")), "--baseline-json") if args.baseline_json else None
            psig = _psig.derive_prompt_signals(chat_msgs, case) if chat_msgs else None
            canaries = _checks.canary_outcomes(seed_obj, files_list, chat_msgs) if seed_obj else []
            basesim = _checks.baseline_similarity(baseline_obj, seed_obj, files_list) if baseline_obj else {"available": False}
            extras: dict | None = {}
            if psig and psig.get("observed"):
                extras["promptSignals"] = psig
                extras["promptEvidence"] = _psig.prompt_evidence(psig)
            if canaries:
                extras["canaryOutcomes"] = canaries
            if basesim.get("available"):
                extras["baselineSimilarity"] = basesim
            if canaries or basesim.get("available"):
                extras["checkEvidence"] = _checks.check_evidence(canaries, basesim)
            extras = extras or None
            evaluation, esrc = _evaluate.evaluate_submission(reflection, tooling, case, role, extras=extras, provider=provider)
            transfer, xsrc = _evaluate.score_transfer(evaluation, role, provider=provider)
            # The interview hand-off: candidate-specific authorship questions minted from
            # THIS submission's observed decisions — the scores above are hypotheses the
            # live conversation verifies (the artifact alone can be wholly LLM-produced).
            followups, fsrc = _evaluate.mint_followups(reflection, tooling, evaluation, case, role, extras=extras, provider=provider)
            _emit(
                # observedChecks rides in the result so the TS bundle persists the
                # mechanical verdicts (canaries, prompt signals, baseline distance)
                # beside the LLM interpretation that consumed them.
                {"reflection": reflection, "tooling": tooling, "evaluation": evaluation, "transfer": transfer, "followups": followups, "observedChecks": extras or {}},
                {"reflect": rsrc, "tooling": tsrc, "evaluate": esrc, "transfer": xsrc, "followups": fsrc},
                # evaluate/transfer now carry a PROPAGATED confidence (min of upstream), so the
                # decision artifact is flagged alongside the thin steps it was built from — a
                # deterministic-fallback evaluation no longer reads as authoritative.
                _confidences(reflect=reflection, tooling=tooling, evaluate=evaluation, transfer=transfer),
                _fallback_reasons(reflect=reflection, tooling=tooling, evaluate=evaluation, transfer=transfer, followups=followups),
                use_case=use_case,
            )
            return 0

        if not args.need_json:
            raise ValueError(f"{args.command} requires --need-json")
        need = DevNeed.model_validate(json.loads(args.need_json.read_text(encoding="utf-8")))

        if args.command == "analyze-need":
            if args.snapshots_json:
                raw = _require_list_of_dicts(json.loads(args.snapshots_json.read_text(encoding="utf-8")), "--snapshots-json")
                snapshot: RepoSnapshot | list[RepoSnapshot] | None = [RepoSnapshot.model_validate(s) for s in raw]
            elif args.snapshot_json:
                snapshot = RepoSnapshot.model_validate(json.loads(args.snapshot_json.read_text(encoding="utf-8")))
            else:
                snapshot = None
            result, source = _analyze.analyze_need(need, snapshot, provider=provider, lang=lang)
            _emit(result, {"analyze": source}, _confidences(analyze=result), _fallback_reasons(analyze=result), use_case=use_case)
            return 0

        if args.command == "design-artifacts":
            if not args.analysis_json:
                raise ValueError("design-artifacts requires --analysis-json")
            analysis = NeedAnalysis.model_validate(json.loads(args.analysis_json.read_text(encoding="utf-8")))
            role, role_src = _design.design_role(need, analysis, provider=provider, lang=lang)
            if args.role_only:
                # Role only — the case-design LLM call is skipped entirely (no
                # wasted spend). The "case" key is simply absent from the payload.
                _emit(
                    {"role": role},
                    {"role": role_src},
                    fallback_reasons=_fallback_reasons(role=role),
                    use_case=use_case,
                )
                return 0
            case, case_src = _design.design_case(need, analysis, role, provider=provider, feedback=args.feedback, lang=lang)
            _emit(
                {"role": role, "case": case},
                {"role": role_src, "case": case_src},
                fallback_reasons=_fallback_reasons(role=role, case=case),
                use_case=use_case,
            )
            return 0

        raise ValueError(f"unhandled command {args.command}")  # pragma: no cover
    except ValueError as exc:
        # Our explicit input guards above AND pydantic's ValidationError (a
        # ValueError subclass, raised by the model_validate calls) are both
        # user-correctable, so they map to 400. Exit 2 matches jobfit/cli.py and
        # python-runner's parseStderrError fallback.
        print(json.dumps({"error": str(exc), "status": 400, "code": ERR_INVALID_INPUT}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        # Genuine engine failure — the caller should retry/escalate, not edit input.
        print(json.dumps({"error": str(exc), "status": 500, "code": ERR_ENGINE}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
