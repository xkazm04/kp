"""CLI for Dev-extension tasks (Phase D2+). Mirrors automation_cli / reasoning_cli.

    python -m pipeline.jobfit.devcase.devcase_cli analyze-need      --need-json N [--snapshot-json S] [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli design-artifacts  --need-json N --analysis-json A [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli reflect-commits     --commits-json C [--probes-json P] [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli evaluate-submission --commits-json C --case-json K --role-json R [--probes-json P] [--no-llm]

Output: one JSON object {"result","source","perStepSources"} to stdout — a uniform
provenance envelope every command shares. `perStepSources` maps each pipeline step to
its "llm"/"deterministic" source and `source` is their combined tri-state verdict;
single-step commands emit a one-key map, so the UI has ONE stable contract to render a
consistent provenance strip (and its degraded "partial" badge) across every command.
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

from ..claude_cli import ClaudeCliProvider
from . import analyze as _analyze
from . import design as _design
from . import evaluate as _evaluate
from . import reflect as _reflect
from .models import DevNeed, NeedAnalysis, RepoSnapshot

# Stable, machine-readable error codes the UI branches on. INVALID_INPUT is a
# user-correctable problem (missing/garbled --*-json arg, failed pydantic
# validation) → 400; ENGINE_ERROR is an unexpected failure in the pipeline
# itself (provider crash, bug) → 500, signalling retry/escalate.
ERR_INVALID_INPUT = "invalid_input"
ERR_ENGINE = "engine_error"


def _combine_source(*srcs: str) -> str:
    """Collapse per-step sources into one verdict.

    The old `"llm" if "llm" in srcs else "deterministic"` reported a fully-LLM
    run whenever a *single* step used the LLM, hiding that the rest fell back to
    deterministic templates. We return a tri-state instead — ``"partial"`` for a
    mix — so the UI can flag a degraded evaluation (and gate promotion on it).
    """
    uniq = {s for s in srcs if s}
    if uniq == {"llm"}:
        return "llm"
    if uniq <= {"deterministic"}:  # all deterministic (or empty)
        return "deterministic"
    return "partial"


def _emit(result: object, per_step: dict[str, str]) -> None:
    """Print the uniform provenance envelope every command shares.

    ``result`` is the command's payload; ``per_step`` maps each pipeline step to
    its ``"llm"``/``"deterministic"`` source. ``source`` is derived here as their
    combined tri-state verdict (:func:`_combine_source`) so the two can never
    drift. Single-step commands pass a one-key map — the UI still gets the same
    {result, source, perStepSources} shape and one provenance component covers
    the whole pipeline.
    """
    print(
        json.dumps(
            {"result": result, "source": _combine_source(*per_step.values()), "perStepSources": per_step},
            ensure_ascii=False,
        )
    )


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Dev-extension tasks (Claude CLI only).")
    parser.add_argument("command", choices=["analyze-need", "design-artifacts", "reflect-commits", "evaluate-submission", "source"])
    parser.add_argument("--need-json", type=Path)
    parser.add_argument("--snapshot-json", type=Path)
    parser.add_argument("--analysis-json", type=Path)
    parser.add_argument("--commits-json", type=Path)
    parser.add_argument("--probes-json", type=Path)
    parser.add_argument("--repo-json", type=Path)
    parser.add_argument("--case-json", type=Path)
    parser.add_argument("--role-json", type=Path)
    parser.add_argument("--candidates-json", type=Path)
    parser.add_argument("--top-n", type=int, default=8)
    parser.add_argument("--floor", type=int, default=45)
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)

    try:
        # `source` is deterministic (pure matching) — no provider needed.
        if args.command == "source":
            from . import source as _source

            if not args.role_json or not args.candidates_json:
                raise ValueError("source requires --role-json and --candidates-json")
            role = json.loads(args.role_json.read_text(encoding="utf-8"))
            candidates = json.loads(args.candidates_json.read_text(encoding="utf-8")) or []
            # result = {"candidates": [...], "skipped": int, "skippedReasons": [...]} — the
            # skipped count rides inside the envelope's `result` so the caller can tell an
            # empty shortlist (nobody qualified) apart from a pool that failed to parse.
            result = _source.source_candidates(role, candidates, top_n=args.top_n, floor=args.floor)
            # Pure matching — no LLM — so its single step is always deterministic.
            _emit(result, {"source": "deterministic"})
            return 0

        provider = None if args.no_llm else ClaudeCliProvider(timeout=120)
        if provider is not None and not provider.available():
            provider = None

        if args.command in ("reflect-commits", "evaluate-submission"):
            if not args.commits_json:
                raise ValueError(f"{args.command} requires --commits-json")
            commits = json.loads(args.commits_json.read_text(encoding="utf-8")) or []
            probes = json.loads(args.probes_json.read_text(encoding="utf-8")) if args.probes_json else []
            repo = json.loads(args.repo_json.read_text(encoding="utf-8")) if args.repo_json else None
            reflection, rsrc = _reflect.reflect_commits(commits, repo, provider=provider)
            tooling, tsrc = _reflect.assess_tooling(reflection, commits, probes, repo, provider=provider)
            if args.command == "reflect-commits":
                _emit({"reflection": reflection, "tooling": tooling}, {"reflect": rsrc, "tooling": tsrc})
                return 0
            # evaluate-submission continues the chain
            case = json.loads(args.case_json.read_text(encoding="utf-8")) if args.case_json else {}
            role = json.loads(args.role_json.read_text(encoding="utf-8")) if args.role_json else {}
            evaluation, esrc = _evaluate.evaluate_submission(reflection, tooling, case, role, provider=provider)
            transfer, xsrc = _evaluate.score_transfer(evaluation, role, provider=provider)
            _emit(
                {"reflection": reflection, "tooling": tooling, "evaluation": evaluation, "transfer": transfer},
                {"reflect": rsrc, "tooling": tsrc, "evaluate": esrc, "transfer": xsrc},
            )
            return 0

        if not args.need_json:
            raise ValueError(f"{args.command} requires --need-json")
        need = DevNeed.model_validate(json.loads(args.need_json.read_text(encoding="utf-8")))

        if args.command == "analyze-need":
            snapshot = (
                RepoSnapshot.model_validate(json.loads(args.snapshot_json.read_text(encoding="utf-8")))
                if args.snapshot_json
                else None
            )
            result, source = _analyze.analyze_need(need, snapshot, provider=provider)
            _emit(result, {"analyze": source})
            return 0

        if args.command == "design-artifacts":
            if not args.analysis_json:
                raise ValueError("design-artifacts requires --analysis-json")
            analysis = NeedAnalysis.model_validate(json.loads(args.analysis_json.read_text(encoding="utf-8")))
            role, role_src = _design.design_role(need, analysis, provider=provider)
            case, case_src = _design.design_case(need, analysis, role, provider=provider)
            _emit({"role": role, "case": case}, {"role": role_src, "case": case_src})
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
