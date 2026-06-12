"""Phase 3 benchmark suite for the multi-provider LLM layer.

Purpose: compare providers/models per use case on SEEDED data so default
models in capabilities.py are picked from measurements, not vibes. Scenarios
drive the REAL production functions (match_reasoning.generate,
automation.screen_candidate, campaign.draft_campaign_pack, …) so a benchmark
measures exactly the prompt + coercion path production runs.

Run deliberately (spends provider tokens — never wired into CI)::

    python -m pipeline.jobfit.llm.bench.bench_cli \
        --use-cases match_reasoning,automation_screen,campaign_pack \
        --targets claude_cli,anthropic:claude-haiku-4-5,anthropic:claude-sonnet-4-6,gemini \
        --limit 8 --out tmp/bench

Scoring beyond contract validity (LLM-as-judge) deliberately lives in
LightTrack — its judge/benchmark engine scores traces server-side; with
LIGHTTRACK_URL set, bench traffic is auto-tracked per use case by monitor.py
and `records.jsonl` carries the payloads for offline judging.
"""

from .runner import BenchRecord, BenchTarget, run_matrix, summarize, to_markdown, write_outputs
from .scenarios import SCENARIO_BUILDERS, Scenario, scenarios_for

__all__ = [
    "BenchRecord",
    "BenchTarget",
    "SCENARIO_BUILDERS",
    "Scenario",
    "run_matrix",
    "scenarios_for",
    "summarize",
    "to_markdown",
    "write_outputs",
]
