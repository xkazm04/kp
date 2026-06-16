"""Benchmark matrix runner: scenarios × targets → records → summary.

Each record carries contract validity, the source that actually answered
(``llm`` vs ``deterministic`` — production swallows provider failures into the
fallback, so a flaky provider shows up as a low llm-rate, not as errors), wall
latency, and token/cost sums captured from the provider envelopes."""

from __future__ import annotations

import dataclasses
import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence

from ...claude_cli import ClaudeCliProvider
from ..adapters import ADAPTERS
from ..capabilities import default_model
from ..monitor import MonitoredClaudeCli
from .scenarios import REGISTRY_USE_CASE, Scenario, scenarios_for


@dataclass(frozen=True)
class BenchTarget:
    """One column of the comparison matrix: a provider, optionally pinned to a
    model (otherwise the registry default for the use case applies)."""

    provider: str
    model: str | None = None

    @classmethod
    def parse(cls, spec: str) -> "BenchTarget":
        provider, _, model = spec.strip().partition(":")
        if not provider:
            raise ValueError(f"empty bench target in {spec!r}")
        return cls(provider=provider, model=model or None)

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model or 'default'}"


@dataclass
class BenchRecord:
    scenario_id: str
    use_case: str
    provider: str
    model: str
    source: str = ""
    valid: bool = False
    violations: list[str] = field(default_factory=list)
    wall_ms: int = 0
    llm_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    error: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    payload: Any = None


def build_provider(target: BenchTarget, use_case: str) -> Any:
    """Provider instance for one matrix column. Built directly (not via
    KP_LLM_CONFIG) so the matrix is explicit; keys come from env/.env.local.
    use_case is stamped for LightTrack so bench traffic is attributable."""
    registry_use_case = REGISTRY_USE_CASE.get(use_case, use_case)
    if target.provider == "claude_cli":
        return MonitoredClaudeCli(model=target.model, timeout=180, use_case=registry_use_case)
    if target.provider not in ADAPTERS:
        raise ValueError(f"unknown bench provider {target.provider!r} (known: {sorted(ADAPTERS)} + claude_cli)")
    model = target.model or default_model(registry_use_case, target.provider)
    if not model:
        raise ValueError(f"target {target.label!r} needs an explicit model (e.g. azure_openai:<deployment>)")
    return ADAPTERS[target.provider](model=model, use_case=registry_use_case)


def record_calls(provider: Any) -> list[Any]:
    """Capture every completion envelope a provider produces.

    Production functions call ``complete_json`` and keep only the parsed
    payload — the envelope (usage, cost, per-call latency) is dropped. We
    shadow the instance's ``complete`` with a recording wrapper; since
    ``complete_json`` dispatches through ``self.complete``, both paths are
    captured, on TextProvider adapters and ClaudeCliProvider alike."""
    calls: list[Any] = []
    inner = provider.complete

    def recorded(prompt: str, **kwargs: Any) -> Any:
        result = inner(prompt, **kwargs)
        calls.append(result)
        return result

    provider.complete = recorded
    return calls


def _model_label(target: BenchTarget, provider: Any) -> str:
    return target.model or getattr(provider, "model", None) or "default"


def run_matrix(
    use_cases: Sequence[str],
    targets: Sequence[BenchTarget],
    *,
    limit: int = 8,
    lang: str = "en",
    include_payload: bool = False,
    provider_factory: Callable[[BenchTarget, str], Any] = build_provider,
) -> list[BenchRecord]:
    records: list[BenchRecord] = []
    for use_case in use_cases:
        scenarios: list[Scenario] = scenarios_for(use_case, limit=limit, lang=lang)
        for target in targets:
            provider = provider_factory(target, use_case)
            model = _model_label(target, provider)
            if not provider.available():
                records.append(
                    BenchRecord(
                        scenario_id="-",
                        use_case=use_case,
                        provider=target.provider,
                        model=model,
                        error="provider unavailable (missing key/SDK) — skipped",
                    )
                )
                continue
            calls = record_calls(provider)
            for scenario in scenarios:
                calls.clear()
                started = time.monotonic()
                record = BenchRecord(
                    scenario_id=scenario.id,
                    use_case=use_case,
                    provider=target.provider,
                    model=model,
                    meta=dict(scenario.meta),
                )
                try:
                    payload, source = scenario.run(provider)
                except Exception as exc:  # noqa: BLE001 — a bench row, not a crash
                    record.error = f"{type(exc).__name__}: {exc}"
                else:
                    violations = scenario.contract(payload)
                    record.source = source
                    record.valid = not violations
                    record.violations = violations
                    if include_payload:
                        record.payload = payload
                record.wall_ms = int((time.monotonic() - started) * 1000)
                record.llm_calls = len(calls)
                record.input_tokens = sum(int((c.usage or {}).get("input_tokens", 0) or 0) for c in calls)
                record.output_tokens = sum(int((c.usage or {}).get("output_tokens", 0) or 0) for c in calls)
                costs = [c.cost_usd for c in calls if getattr(c, "cost_usd", None)]
                record.cost_usd = round(sum(costs), 6) if costs else None
                records.append(record)
    return records


def _percentile(values: list[int], pct: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    idx = max(0, math.ceil(pct / 100 * len(ordered)) - 1)
    return ordered[idx]


def summarize(records: Sequence[BenchRecord]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str], list[BenchRecord]] = {}
    for r in records:
        groups.setdefault((r.use_case, r.provider, r.model), []).append(r)
    rows: list[dict[str, Any]] = []
    for (use_case, provider, model), group in sorted(groups.items()):
        ok = [r for r in group if r.error is None]
        latencies = [r.wall_ms for r in ok]
        costs = [r.cost_usd for r in ok if r.cost_usd is not None]
        rows.append(
            {
                "useCase": use_case,
                "provider": provider,
                "model": model,
                "n": len(group),
                "errors": len(group) - len(ok),
                "validRate": round(sum(1 for r in ok if r.valid) / len(ok), 3) if ok else 0.0,
                "llmRate": round(sum(1 for r in ok if r.source == "llm") / len(ok), 3) if ok else 0.0,
                "p50Ms": _percentile(latencies, 50),
                "p95Ms": _percentile(latencies, 95),
                "meanInputTokens": round(sum(r.input_tokens for r in ok) / len(ok)) if ok else 0,
                "meanOutputTokens": round(sum(r.output_tokens for r in ok) / len(ok)) if ok else 0,
                "totalCostUsd": round(sum(costs), 4) if costs else None,
            }
        )
    return rows


def to_markdown(summary_rows: Sequence[dict[str, Any]]) -> str:
    header = (
        "| use case | target | n | err | valid | llm | p50 ms | p95 ms | in tok | out tok | cost $ |\n"
        "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|"
    )
    lines = [header]
    for row in summary_rows:
        lines.append(
            f"| {row['useCase']} | {row['provider']}:{row['model']} | {row['n']} | {row['errors']} "
            f"| {row['validRate']:.0%} | {row['llmRate']:.0%} | {row['p50Ms']} | {row['p95Ms']} "
            f"| {row['meanInputTokens']} | {row['meanOutputTokens']} "
            f"| {row['totalCostUsd'] if row['totalCostUsd'] is not None else '—'} |"
        )
    return "\n".join(lines)


def write_outputs(records: Sequence[BenchRecord], out_dir: Path) -> dict[str, Path]:
    """records.jsonl (one row per scenario×target — LightTrack-judgeable when
    payloads are included), summary.json, summary.md."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "records": out_dir / "records.jsonl",
        "summary_json": out_dir / "summary.json",
        "summary_md": out_dir / "summary.md",
    }
    with paths["records"].open("w", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(dataclasses.asdict(r), ensure_ascii=False) + "\n")
    rows = summarize(records)
    paths["summary_json"].write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    paths["summary_md"].write_text(to_markdown(rows) + "\n", encoding="utf-8")
    return paths


__all__ = [
    "BenchRecord",
    "BenchTarget",
    "ClaudeCliProvider",  # re-export for tests that stub the CLI column
    "build_provider",
    "record_calls",
    "run_matrix",
    "summarize",
    "to_markdown",
    "write_outputs",
]
