"""Offline tests for the LightTrack telemetry seam (monitor.py).

A stub `lighttrack` module is injected into sys.modules so no SDK install or
network is needed; the contract under test is: env-gated activation, one event
per logical call with the right fields, error events on failure, and the
never-breaks-the-host guarantee.
"""

from __future__ import annotations

import os
import sys
import types
import unittest
from unittest import mock

from pipeline.jobfit.claude_cli import ClaudeCliProvider, ClaudeResult
from pipeline.jobfit.llm import LLMError, LLMResult, TextProvider
from pipeline.jobfit.llm import monitor


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


if __name__ == "__main__":
    unittest.main()
