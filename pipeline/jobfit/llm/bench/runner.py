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
from ..capabilities import default_max_tokens, default_model
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
    # LLM-as-judge score (1-10) + per-dimension detail; None until a judge pass runs.
    judge_score: float | None = None
    judge_detail: dict[str, Any] = field(default_factory=dict)
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
    kwargs: dict[str, Any] = {"model": model, "use_case": registry_use_case}
    # Same heavy-output ceiling the production registry applies — without it the
    # bench measures 2048-token truncation, not the model (2026-08-05 artifact).
    max_tokens = default_max_tokens(registry_use_case)
    if max_tokens:
        kwargs["max_tokens"] = max_tokens
    return ADAPTERS[target.provider](**kwargs)


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
    """One row per (use case, target), with the three axes kept SEPARATE so they
    can sit next to each other without contaminating one another:

    - **judged quality** (``meanJudge``/``judged``) — LLM-as-judge over real LLM
      outputs only (judge.py skips deterministic fallbacks);
    - **measured reliability** (``errors``/``validRate``/``llmRate``) — how often
      the target actually served, with a well-shaped payload. ``validRate`` is
      scoped to the rows the MODEL answered (``source == "llm"``), the same scope
      bake_quality._cell uses: the deterministic fallback is contract-valid by
      construction, so counting it made ``validRate`` a signal that could not
      fail — a target that never once served read as "valid 100%";
    - **measured economics** (``costPerTaskUsd``/``totalCostUsd``/tokens) and
      **latency** (``p50Ms``/``p95Ms``) — deterministic facts from the envelopes.

    ``mode`` (scenarios.OP_MODES) frames which economic axis binds: an *online*
    op is judged against latency (a person is waiting), a *background* op
    against cost per task (an automation pass pays for it)."""
    from .scenarios import OP_MODES  # local import — scenarios imports nothing from here at module load

    groups: dict[tuple[str, str, str], list[BenchRecord]] = {}
    for r in records:
        groups.setdefault((r.use_case, r.provider, r.model), []).append(r)
    rows: list[dict[str, Any]] = []
    for (use_case, provider, model), group in sorted(groups.items()):
        ok = [r for r in group if r.error is None]
        # The MODEL's own rows: a deterministic fallback is the same template for
        # every target, so it can neither pass nor fail a contract on the model's
        # behalf (it always passes). Reliability of the answer belongs to llmRate.
        served = [r for r in ok if r.source == "llm"]
        latencies = [r.wall_ms for r in ok]
        costs = [r.cost_usd for r in ok if r.cost_usd is not None]
        judged = [r.judge_score for r in ok if r.judge_score is not None]
        rows.append(
            {
                "useCase": use_case,
                "mode": OP_MODES.get(use_case, "background"),
                "provider": provider,
                "model": model,
                "n": len(group),
                # judged quality (real LLM outputs only)
                "judged": len(judged),
                "meanJudge": round(sum(judged) / len(judged), 2) if judged else None,
                # measured reliability
                "errors": len(group) - len(ok),
                # Over the model's OWN answers; 0.0 when it never served one.
                "validRate": round(sum(1 for r in served if r.valid) / len(served), 3) if served else 0.0,
                "llmRate": round(len(served) / len(ok), 3) if ok else 0.0,
                # measured economics
                "costPerTaskUsd": round(sum(costs) / len(ok), 4) if costs and ok else None,
                "totalCostUsd": round(sum(costs), 4) if costs else None,
                "meanInputTokens": round(sum(r.input_tokens for r in ok) / len(ok)) if ok else 0,
                "meanOutputTokens": round(sum(r.output_tokens for r in ok) / len(ok)) if ok else 0,
                # measured latency
                "p50Ms": _percentile(latencies, 50),
                "p95Ms": _percentile(latencies, 95),
            }
        )
    return rows


def to_markdown(summary_rows: Sequence[dict[str, Any]]) -> str:
    header = (
        "| use case | mode | target | n | judge* | valid | llm | err | $/task | p50 ms | p95 ms | in tok | out tok |\n"
        "|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|"
    )
    lines = [header]
    for row in summary_rows:
        judge = f"{row['meanJudge']:.1f}" if row.get("meanJudge") is not None else "—"
        cost = f"{row['costPerTaskUsd']:.4f}" if row.get("costPerTaskUsd") is not None else "—"
        lines.append(
            f"| {row['useCase']} | {row['mode']} | {row['provider']}:{row['model']} | {row['n']} "
            f"| {judge} | {row['validRate']:.0%} | {row['llmRate']:.0%} | {row['errors']} "
            f"| {cost} | {row['p50Ms']} | {row['p95Ms']} "
            f"| {row['meanInputTokens']} | {row['meanOutputTokens']} |"
        )
    lines.append(
        "\n\\* judge scores REAL LLM outputs only (1–10); a run that degraded to the "
        "deterministic fallback counts against the llm-rate column, never against quality. "
        "`valid` is scoped the same way — the share of the model's OWN answers that passed "
        "the contract, so a target that always fell back reads 0%, not 100%. "
        "Online ops answer to p50/p95; background ops answer to $/task."
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
