"""Phase 3 benchmark suite for the multi-provider LLM layer.

Compares providers/models per use case on SEEDED data (driving the REAL
production functions) so the default models in capabilities.py are picked from
measurements, not vibes. Spends provider tokens — never wired into CI. Run via
``bench_cli`` (the runnable example + flags live in its docstring); see
``docs/LLM_PROVIDER_LAYER.md`` for the wider design.
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
