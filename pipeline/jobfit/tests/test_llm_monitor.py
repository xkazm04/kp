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
        # Neutralize the .env.local reload FOR THIS TEST's scope. The suite-wide
        # dotenv patch (tests/__init__.py) is a managed mock another test can restore
        # to the real loader mid-run; monitor._client() would then reload .env.local
        # (LIGHTTRACK_URL set in local dev) and flip telemetry back on, breaking the
        # "disabled" gating asserts order-dependently. Patching the concrete loader in
        # the fixture makes each monitor test hermetic regardless of global state.
        test.enterContext(mock.patch("pipeline.jobfit.llm.base.load_local_env", lambda *a, **k: None))
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
    def test_success_emits_one_event_with_usage_and_use_case_tag(self) -> None:
        ctx = _Ctx(self)
        provider = StubProvider([_result()], use_case="match_reasoning")
        provider.complete("hi")
        self.assertEqual(len(ctx.events), 1)
        ev = ctx.events[0]
        self.assertEqual(ev["provider"], "anthropic")
        self.assertEqual(ev["model"], "claude-haiku-4-5")
        # operation is a fixed LightTrack enum — use_case rides on a tag instead,
        # so it survives (an arbitrary operation deserializes to "other").
        self.assertEqual(ev["operation"], "chat")
        self.assertIn("use_case:match_reasoning", ev["tags"])
        # The use case now also rides LightTrack's first-class `name` field —
        # the tag above stays for back-compat.
        self.assertEqual(ev["name"], "match_reasoning")
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
        self.assertEqual(ctx.events[0]["name"], "automation")

    def test_success_with_no_use_case_sends_no_name(self) -> None:
        """An absent use case must send no `name` at all — not None as a value,
        and not a placeholder like "unknown". The use_case:/tool: tags are simply
        omitted too, same as before this change."""
        ctx = _Ctx(self)
        StubProvider([_result()]).complete("hi")  # no use_case kwarg
        self.assertEqual(len(ctx.events), 1)
        ev = ctx.events[0]
        self.assertNotIn("name", ev)
        self.assertFalse(any(t.startswith("use_case:") for t in ev["tags"]))

    def test_error_with_no_use_case_sends_no_name(self) -> None:
        ctx = _Ctx(self)
        provider = StubProvider([ValueError("boom")])  # no use_case kwarg
        with self.assertRaises(LLMError):
            provider.complete("hi")
        self.assertEqual(len(ctx.events), 1)
        self.assertNotIn("name", ctx.events[0])

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
        self.assertIn("use_case:match_reasoning", ev["tags"])
        self.assertEqual(ev["operation"], "chat")
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

    def test_ledger_line_carries_the_request_id_when_set(self) -> None:
        """The join key behind Insights → Activity's row detail. KP_LLM_REQUEST_ID
        is set per spawn by python-runner.ts from the ambient background-task
        scope; it rides the ledger line as `request_id`, which parseLedgerLine
        already maps into llm_usage. Without it the column stays the null it was
        for its whole life and no activity row can reach its output."""
        monitor.reset()
        self.addCleanup(monitor.reset)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage.ndjson")
            env = {"KP_LLM_USAGE_LOG": path, "KP_LLM_REQUEST_ID": "t_abc123"}
            with mock.patch.dict(os.environ, env, clear=False):
                os.environ.pop("LIGHTTRACK_URL", None)
                StubProvider([_result()], use_case="match_reasoning").complete("hi")
            row = json.loads(open(path, encoding="utf-8").read().splitlines()[0])
            self.assertEqual(row["request_id"], "t_abc123")

    def test_request_id_is_null_outside_a_tracked_run(self) -> None:
        """A CLI spawned outside a task scope (an inline route, a direct run, a
        test) must emit request_id: null — NOT a stale value and not a missing
        key. The TS side reads the key defensively either way, but a null is the
        honest "this call belonged to no tracked run"."""
        monitor.reset()
        self.addCleanup(monitor.reset)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage.ndjson")
            with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": path}, clear=False):
                os.environ.pop("LIGHTTRACK_URL", None)
                os.environ.pop("KP_LLM_REQUEST_ID", None)
                StubProvider([_result()], use_case="match_reasoning").complete("hi")
            row = json.loads(open(path, encoding="utf-8").read().splitlines()[0])
            self.assertIn("request_id", row)
            self.assertIsNone(row["request_id"])

    def test_blank_request_id_is_treated_as_absent(self) -> None:
        """An empty/whitespace env value is the same fact as unset — it must not
        become an empty-string request_id that the detail would then try to fetch
        a task for."""
        monitor.reset()
        self.addCleanup(monitor.reset)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage.ndjson")
            env = {"KP_LLM_USAGE_LOG": path, "KP_LLM_REQUEST_ID": "   "}
            with mock.patch.dict(os.environ, env, clear=False):
                os.environ.pop("LIGHTTRACK_URL", None)
                StubProvider([_result()], use_case="match_reasoning").complete("hi")
            row = json.loads(open(path, encoding="utf-8").read().splitlines()[0])
            self.assertIsNone(row["request_id"])

    def test_no_ledger_file_when_env_unset(self) -> None:
        monitor.reset()
        self.addCleanup(monitor.reset)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KP_LLM_USAGE_LOG", None)
            os.environ.pop("LIGHTTRACK_URL", None)
            # Must not raise and must not create any file.
            StubProvider([_result()]).complete("hi")

    def test_explicit_opt_out_token_disables_the_ledger(self) -> None:
        # Metering is ON BY DEFAULT (a real path writes); an operator opts OUT by
        # setting KP_LLM_USAGE_LOG to an off token like "0". It must then write
        # NOTHING — not attempt to open a file literally named "0".
        monitor.reset()
        self.addCleanup(monitor.reset)
        for token in ("0", "off", "false", "no"):
            with self.subTest(token=token):
                with tempfile.TemporaryDirectory() as d:
                    cwd = os.getcwd()
                    os.chdir(d)  # so a stray open("0") would land here and be visible
                    try:
                        with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": token}, clear=False):
                            os.environ.pop("LIGHTTRACK_URL", None)
                            StubProvider([_result()], use_case="match_reasoning").complete("hi")
                        self.assertEqual(os.listdir(d), [], f"opt-out token {token!r} must write no ledger")
                    finally:
                        os.chdir(cwd)

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
        # No reason given → no reason key: unknown stays unrecorded, and lines
        # emitted by pre-R6 callers stay byte-compatible.
        self.assertNotIn("reason", row)

    def test_emit_deterministic_records_the_descent_reason(self) -> None:
        """R6: a floor serve says WHY — offline policy, missing binary, --no-llm
        — so a fleet quietly living on the deterministic floor is diagnosable
        from its ledger, not from a hunch."""
        monitor.reset()
        self.addCleanup(monitor.reset)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "usage.ndjson")
            with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": path}, clear=False):
                os.environ.pop("LIGHTTRACK_URL", None)
                monitor.emit_deterministic("repo_scan", reason="offline_policy")
            with open(path, encoding="utf-8") as fh:
                rows = [json.loads(l) for l in fh.read().splitlines() if l.strip()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source"], "deterministic")
        self.assertEqual(rows[0]["reason"], "offline_policy")

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
