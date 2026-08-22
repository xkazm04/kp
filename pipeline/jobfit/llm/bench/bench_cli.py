"""Benchmark CLI: compare providers/models per use case on seeded data.

    python -m pipeline.jobfit.llm.bench.bench_cli \
        --use-cases match_reasoning,automation_screen,campaign_pack \
        --targets claude_cli,anthropic:claude-haiku-4-5,anthropic:claude-sonnet-4-6,gemini \
        --limit 8 --lang en --out tmp/bench

Spends REAL provider tokens — run deliberately when picking default models,
never from CI. Targets are `provider[:model]`; the model defaults to the
registry default for the use case (azure_openai always needs the deployment
name). With LIGHTTRACK_URL set, every call is also tracked per use case, so
LightTrack's judge/benchmark engine can score the traffic server-side;
`--include-payloads` keeps the payloads in records.jsonl for offline judging.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from .runner import BenchTarget, run_matrix, summarize, to_markdown, write_outputs
from .scenarios import SCENARIO_BUILDERS


def judge_scope(records: Sequence[Any]) -> tuple[int, int]:
    """``(judgeable, fell_back)`` for the ``--judge`` progress line.

    ``judgeable`` must be the rows the judge WILL look at: ``judge_records``
    scores REAL LLM outputs only, because a deterministic fallback is the same
    template for every model. Counting fallbacks in the denominator made a
    degraded run print "judged 0/40" and trip the warning below — blaming a
    healthy Claude CLI for what is actually a 0% llm-rate on the TARGET, and
    sending the operator to re-run a judge pass that was never the problem.
    """
    judgeable = sum(1 for r in records if r.error is None and r.payload is not None and r.source == "llm")
    fell_back = sum(1 for r in records if r.error is None and r.source == "deterministic")
    return judgeable, fell_back


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LLM provider/model benchmark over seeded data.")
    parser.add_argument(
        "--use-cases",
        default="match_reasoning",
        help=f"Comma-separated; known: {','.join(sorted(SCENARIO_BUILDERS))}",
    )
    parser.add_argument(
        "--targets",
        default="claude_cli",
        help="Comma-separated provider[:model] specs, e.g. anthropic:claude-haiku-4-5,gemini",
    )
    parser.add_argument("--limit", type=int, default=8, help="Scenarios per use case.")
    parser.add_argument("--lang", default="en", choices=["en", "cs"])
    parser.add_argument("--out", type=Path, default=None, help="Output dir (default tmp/bench/<timestamp>).")
    parser.add_argument(
        "--include-payloads",
        action="store_true",
        help="Store full payloads in records.jsonl (for LLM-as-judge / manual review).",
    )
    parser.add_argument(
        "--judge",
        action="store_true",
        help="Score each served output with a local LLM judge (Claude CLI) and add a 'judge' "
        "column to the scorecard. Implies --include-payloads (the judge needs the output).",
    )
    parser.add_argument(
        "--judge-model",
        default=None,
        help="Model alias for the judge CLI (default: the CLI's configured model).",
    )
    args = parser.parse_args(argv)

    use_cases = [u.strip() for u in args.use_cases.split(",") if u.strip()]
    unknown = [u for u in use_cases if u not in SCENARIO_BUILDERS]
    if unknown:
        parser.error(f"unknown use case(s) {unknown}; known: {sorted(SCENARIO_BUILDERS)}")
    targets = [BenchTarget.parse(t) for t in args.targets.split(",") if t.strip()]

    # The judge scores the served payload, so it must be kept.
    include_payloads = args.include_payloads or args.judge
    records = run_matrix(
        use_cases, targets, limit=args.limit, lang=args.lang, include_payload=include_payloads
    )
    if args.judge:
        from .judge import default_judge_provider, judge_records

        judgeable, fell_back = judge_scope(records)
        scored = judge_records(records, default_judge_provider(args.judge_model))
        print(f"judged {scored}/{judgeable} real LLM output(s) with the Claude CLI", end="")
        print(
            f" ({fell_back} row(s) degraded to the deterministic fallback — see the llm column)\n"
            if fell_back
            else "\n"
        )
        # A judge pass that scores nothing (or almost nothing) means the Claude CLI is
        # unauthenticated or usage-capped — the scorecard would ship with an empty judge
        # column that reads as "not requested". Fail loudly instead of silently.
        if judgeable and scored == 0:
            print(
                "WARNING: --judge scored 0 outputs — the Claude CLI judge produced no parseable "
                "scores (unauthenticated or usage-limited?). The judge column will be empty; "
                "re-run the judge once the CLI is healthy.",
                file=sys.stderr,
            )
    out_dir = args.out or Path("tmp") / "bench" / datetime.now().strftime("%Y%m%d-%H%M%S")
    paths = write_outputs(records, out_dir)

    print(to_markdown(summarize(records)))
    print(f"\nrecords: {paths['records']}")
    print(f"summary: {paths['summary_md']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
