"""CLI for Dev-extension tasks (Phase D2+). Mirrors automation_cli / reasoning_cli.

    python -m pipeline.jobfit.devcase.devcase_cli analyze-need      --need-json N [--snapshot-json S] [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli design-artifacts  --need-json N --analysis-json A [--no-llm]
    python -m pipeline.jobfit.devcase.devcase_cli reflect-commits   --commits-json C [--probes-json P] [--no-llm]

Output: one JSON object {"result","source"} to stdout; {"error","status"} to stderr + exit 1.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..claude_cli import ClaudeCliProvider
from . import analyze as _analyze
from . import design as _design
from . import reflect as _reflect
from .models import DevNeed, NeedAnalysis, RepoSnapshot


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Dev-extension tasks (Claude CLI only).")
    parser.add_argument("command", choices=["analyze-need", "design-artifacts", "reflect-commits"])
    parser.add_argument("--need-json", type=Path)
    parser.add_argument("--snapshot-json", type=Path)
    parser.add_argument("--analysis-json", type=Path)
    parser.add_argument("--commits-json", type=Path)
    parser.add_argument("--probes-json", type=Path)
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)

    try:
        provider = None if args.no_llm else ClaudeCliProvider(timeout=120)
        if provider is not None and not provider.available():
            provider = None

        if args.command == "reflect-commits":
            if not args.commits_json:
                raise ValueError("reflect-commits requires --commits-json")
            commits = json.loads(args.commits_json.read_text(encoding="utf-8")) or []
            probes = json.loads(args.probes_json.read_text(encoding="utf-8")) if args.probes_json else []
            reflection, rsrc = _reflect.reflect_commits(commits, provider=provider)
            tooling, tsrc = _reflect.assess_tooling(reflection, commits, probes, provider=provider)
            source = "llm" if "llm" in (rsrc, tsrc) else "deterministic"
            print(json.dumps({"result": {"reflection": reflection, "tooling": tooling}, "source": source}, ensure_ascii=False))
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
            print(json.dumps({"result": result, "source": source}, ensure_ascii=False))
            return 0

        if args.command == "design-artifacts":
            if not args.analysis_json:
                raise ValueError("design-artifacts requires --analysis-json")
            analysis = NeedAnalysis.model_validate(json.loads(args.analysis_json.read_text(encoding="utf-8")))
            role, role_src = _design.design_role(need, analysis, provider=provider)
            case, case_src = _design.design_case(need, analysis, role, provider=provider)
            source = "llm" if "llm" in (role_src, case_src) else "deterministic"
            print(json.dumps({"result": {"role": role, "case": case}, "source": source}, ensure_ascii=False))
            return 0

        raise ValueError(f"unhandled command {args.command}")  # pragma: no cover
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
