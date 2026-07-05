"""Offline tests for the LightTrack telemetry seam (monitor.py).

A stub `lighttrack` module is injected into sys.modules so no SDK install or
network is needed; the contract under test is: env-gated activation, one event
per logical call with the right fields, error events on failure, and the
never-breaks-the-host guarantee.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

from pipeline.jobfit.claude_cli import ClaudeCliProvider, ClaudeResult
from pipeline.jobfit.llm import LLMError, LLMResult, TextProvider
from pipeline.jobfit.llm import monitor

# Hermeticity note: activation from the developer's .env.local is neutralized
# suite-wide in tests/__init__.py, so these tests are offline unless they set
# LIGHTTRACK_URL in os.environ explicitly (the enabled cases below do).


class FakeLightTrack:
    instances: list["FakeLightTrack"] = []

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
        self.events: list[dict] = []
        FakeLightTrack.instances.append(self)

    def track(self, provider, model, **kw):
        self.events.append({"provider": provider, "model": model, **kw})


class ExplodingLightTrack(FakeLightTrack):
    def track(self, *args, **kwargs):  # noqa: ARG002 — must be swallowed
        raise RuntimeError("lighttrack down")


def _stub_module(cls) -> types.ModuleType:
    mod = types.ModuleType("lighttrack")
    mod.LightTrack = cls
    return mod


class _Ctx:
    """Enable monitoring against a stub client for the duration of a test."""

    def __init__(self, test: unittest.TestCase, cls=FakeLightTrack, url: str | None = "http://127.0.0.1:8787"):
        FakeLightTrack.instances = []
        test.addCleanup(monitor.reset)
        monitor.reset()
        test.enterContext(mock.patch.dict(sys.modules, {"lighttrack": _stub_module(cls)}))
        test.enterContext(mock.patch.dict(os.environ, {}, clear=False))
        os.environ.pop("LIGHTTRACK_URL", None)
        if url:
            os.environ["LIGHTTRACK_URL"] = url

    @property
    def events(self) -> list[dict]:
        return [e for inst in FakeLightTrack.instances for e in inst.events]


class StubProvider(TextProvider):
    name = "anthropic"

    def __init__(self, script, **kw):
        super().__init__(model="claude-haiku-4-5", **kw)
        self.script = list(script)

    def available(self) -> bool:
        return True

    def _call(self, prompt, *, system, timeout):
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _result() -> LLMResult:
    return LLMResult(
        text="{}",
        provider="anthropic",
        model="claude-haiku-4-5",
        usage={"input_tokens": 50, "output_tokens": 10, "cached_tokens": 5},
        cost_usd=0.0001,
        duration_ms=120,
    )


class AdapterEmissionTest(unittest.TestCase):
    def test_success_emits_one_event_with_operation_and_usage(self) -> None:
        ctx = _Ctx(self)
        provider = StubProvider([_result()], use_case="match_reasoning")
        provider.complete("hi")
        self.assertEqual(len(ctx.events), 1)
        ev = ctx.events[0]
        self.assertEqual(ev["provider"], "anthropic")
        self.assertEqual(ev["model"], "claude-haiku-4-5")
        self.assertEqual(ev["operation"], "match_reasoning")
        self.assertEqual(ev["input_tokens"], 50)
        self.assertEqual(ev["output_tokens"], 10)
        self.assertEqual(ev["cached_input"], 5)
        self.assertEqual(ev["latency_ms"], 120)
        self.assertEqual(ev["metadata"], {"cost_usd": 0.0001})

    def test_complete_json_emits_exactly_one_event(self) -> None:
        ctx = _Ctx(self)
        provider = StubProvider([_result()], use_case="automation")
        provider.complete_json("hi")
        self.assertEqual(len(ctx.events), 1)

    def test_error_emits_error_event_and_reraises(self) -> None:
        ctx = _Ctx(self)
        provider = StubProvider([ValueError("invalid api key")], use_case="automation")
        with self.assertRaises(LLMError):
            provider.complete("hi")
        self.assertEqual(len(ctx.events), 1)
        self.assertIn("invalid api key", ctx.events[0]["error"])

    def test_disabled_without_url(self) -> None:
        ctx = _Ctx(self, url=None)
        StubProvider([_result()]).complete("hi")
        self.assertEqual(ctx.events, [])

    def test_disabled_without_sdk(self) -> None:
        monitor.reset()
        self.addCleanup(monitor.reset)
        with mock.patch.dict(sys.modules, {"lighttrack": None}), mock.patch.dict(
            os.environ, {"LIGHTTRACK_URL": "http://127.0.0.1:8787"}
        ):
            StubProvider([_result()]).complete("hi")  # must not raise

    def test_exploding_client_never_breaks_the_call(self) -> None:
        _Ctx(self, cls=ExplodingLightTrack)
        out = StubProvider([_result()]).complete("hi")
        self.assertEqual(out.text, "{}")


class MonitoredCliTest(unittest.TestCase):
    def test_cli_envelope_emitted_as_anthropic_with_engine_tag(self) -> None:
        ctx = _Ctx(self)
        cli_result = ClaudeResult(
            text="ok",
            cost_usd=0.012,
            duration_ms=900,
            usage={"input_tokens": 200, "output_tokens": 40, "cache_read_input_tokens": 30},
        )
        provider = monitor.MonitoredClaudeCli(timeout=120, use_case="match_reasoning")
        with mock.patch.object(ClaudeCliProvider, "complete", return_value=cli_result):
            out = provider.complete("hi")
        self.assertEqual(out.text, "ok")
        self.assertEqual(len(ctx.events), 1)
        ev = ctx.events[0]
        self.assertEqual(ev["provider"], "anthropic")
        self.assertIn("engine:claude_cli", ev["tags"])
        self.assertEqual(ev["operation"], "match_reasoning")
        self.assertEqual(ev["input_tokens"], 200)
        self.assertEqual(ev["cached_input"], 30)
        self.assertEqual(ev["metadata"], {"cost_usd": 0.012})

    def test_cli_failure_emits_error(self) -> None:
        ctx = _Ctx(self)
        provider = monitor.MonitoredClaudeCli(timeout=120, use_case="automation")
        with mock.patch.object(ClaudeCliProvider, "complete", side_effect=RuntimeError("cli exploded")):
            with self.assertRaises(RuntimeError):
                provider.complete("hi")
        self.assertEqual(len(ctx.events), 1)
        self.assertIn("cli exploded", ctx.events[0]["error"])


class LedgerSidecarTest(unittest.TestCase):
    """T0.1: the durable usage ledger. emit_result appends one NDJSON line per
    metered call to KP_LLM_USAGE_LOG, INDEPENDENT of LightTrack — the headline
    fix is that spend persists even when observability is OFF (the default)."""

    def test_ledger_line_written_even_with_lighttrack_off(self) -> None:
        monitor.reset()
        self.addCleanup(monitor.reset)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage.ndjson")
            with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": path}, clear=False):
                os.environ.pop("LIGHTTRACK_URL", None)  # observability OFF
                StubProvider([_result()], use_case="match_reasoning").complete("hi")
            with open(path, encoding="utf-8") as fh:
                lines = [l for l in fh.read().splitlines() if l.strip()]
            self.assertEqual(len(lines), 1)
            row = json.loads(lines[0])
            self.assertEqual(row["use_case"], "match_reasoning")
            self.assertEqual(row["provider"], "anthropic")
            self.assertEqual(row["model"], "claude-haiku-4-5")
            self.assertEqual(row["input_tokens"], 50)
            self.assertEqual(row["output_tokens"], 10)
            self.assertEqual(row["cached_tokens"], 5)
            self.assertEqual(row["cost_usd"], 0.0001)
            self.assertEqual(row["source"], "llm")

    def test_no_ledger_file_when_env_unset(self) -> None:
        monitor.reset()
        self.addCleanup(monitor.reset)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KP_LLM_USAGE_LOG", None)
            os.environ.pop("LIGHTTRACK_URL", None)
            # Must not raise and must not create any file.
            StubProvider([_result()]).complete("hi")

    def test_emit_deterministic_writes_zero_cost_fallback_line(self) -> None:
        """Item 22: the keyless/failed deterministic fallback is ledger-visible —
        one source:"deterministic" line with zero tokens/cost, provider
        "deterministic" (its own provider row in the TS aggregate)."""
        monitor.reset()
        self.addCleanup(monitor.reset)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage.ndjson")
            with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": path}, clear=False):
                os.environ.pop("LIGHTTRACK_URL", None)
                monitor.emit_deterministic("campaign_pack")
            with open(path, encoding="utf-8") as fh:
                rows = [json.loads(l) for l in fh.read().splitlines() if l.strip()]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["source"], "deterministic")
        self.assertEqual(row["provider"], "deterministic")
        self.assertEqual(row["use_case"], "campaign_pack")
        self.assertIsNone(row["model"])
        self.assertEqual(row["input_tokens"], 0)
        self.assertEqual(row["output_tokens"], 0)
        self.assertEqual(row["cost_usd"], 0.0)

    def test_emit_deterministic_is_a_noop_without_the_sidecar_env(self) -> None:
        monitor.reset()
        self.addCleanup(monitor.reset)
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("KP_LLM_USAGE_LOG", None)
                monitor.emit_deterministic("automation")  # must not raise
            self.assertEqual(os.listdir(d), [])  # and must not create any file

    def test_monitored_cli_also_writes_ledger(self) -> None:
        monitor.reset()
        self.addCleanup(monitor.reset)
        cli_result = ClaudeResult(
            text="ok",
            cost_usd=0.012,
            duration_ms=900,
            usage={"input_tokens": 200, "output_tokens": 40, "cache_read_input_tokens": 30},
        )
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage.ndjson")
            with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": path}, clear=False):
                os.environ.pop("LIGHTTRACK_URL", None)
                provider = monitor.MonitoredClaudeCli(timeout=120, use_case="automation")
                with mock.patch.object(ClaudeCliProvider, "complete", return_value=cli_result):
                    provider.complete("hi")
            with open(path, encoding="utf-8") as fh:
                rows = [json.loads(l) for l in fh.read().splitlines() if l.strip()]
            self.assertEqual(len(rows), 1)
            # The ledger records the real engine (claude_cli), keeping subscription
            # vs metered spend distinguishable — unlike LightTrack's anthropic alias.
            self.assertEqual(rows[0]["provider"], "claude_cli")
            self.assertEqual(rows[0]["cost_usd"], 0.012)
            self.assertEqual(rows[0]["cached_tokens"], 30)


if __name__ == "__main__":
    unittest.main()
