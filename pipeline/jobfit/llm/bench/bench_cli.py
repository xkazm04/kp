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
from datetime import datetime
from pathlib import Path

from .runner import BenchTarget, run_matrix, summarize, to_markdown, write_outputs
from .scenarios import SCENARIO_BUILDERS


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
    args = parser.parse_args(argv)

    use_cases = [u.strip() for u in args.use_cases.split(",") if u.strip()]
    unknown = [u for u in use_cases if u not in SCENARIO_BUILDERS]
    if unknown:
        parser.error(f"unknown use case(s) {unknown}; known: {sorted(SCENARIO_BUILDERS)}")
    targets = [BenchTarget.parse(t) for t in args.targets.split(",") if t.strip()]

    records = run_matrix(
        use_cases, targets, limit=args.limit, lang=args.lang, include_payload=args.include_payloads
    )
    out_dir = args.out or Path("tmp") / "bench" / datetime.now().strftime("%Y%m%d-%H%M%S")
    paths = write_outputs(records, out_dir)

    print(to_markdown(summarize(records)))
    print(f"\nrecords: {paths['records']}")
    print(f"summary: {paths['summary_md']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
