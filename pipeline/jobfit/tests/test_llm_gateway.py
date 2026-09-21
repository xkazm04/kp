"""The lt-gateway adapter (pipeline/jobfit/llm/adapters/gateway.py).

What the gateway takes over — seat failover and the LightTrack event per attempt —
must not be duplicated here, and what the app keeps — the JSON guard, expected_keys
pinning, the ledger — must still run. Every test drives the real base/registry code
with the OpenAI client faked at ``_make_client``.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from pipeline.jobfit.llm import monitor
from pipeline.jobfit.llm.adapters import ADAPTERS
from pipeline.jobfit.llm.adapters.gateway import USE_CASE_SCHEMAS, GatewayProvider
from pipeline.jobfit.llm.base import TextProvider
from pipeline.jobfit.llm.capabilities import default_model
from pipeline.jobfit.llm.config import ENV_VAR
from pipeline.jobfit.llm.registry import resolve_provider


def _reply(text: str, *, model: str = "anthropic/haiku@low", cost: float | None = 0.02):
    return SimpleNamespace(
        id="c",
        model=model,
        choices=[SimpleNamespace(message=SimpleNamespace(content=text), finish_reason="stop")],
        usage=SimpleNamespace(prompt_tokens=100, completion_tokens=20, prompt_tokens_details=None),
        lighttrack={"served_by": model, "fell_back": model != "anthropic/haiku@low", "cost_usd": cost},
    )


class _Recorder:
    """A fake OpenAI client that records every ``create`` kwargs and answers ``reply``."""

    def __init__(self, reply):
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self._reply = reply

    def _create(self, **kw):
        self.calls.append(kw)
        return self._reply


class RoutingTests(unittest.TestCase):
    def test_registered_and_keyless(self) -> None:
        self.assertIs(ADAPTERS["gateway"], GatewayProvider)
        with mock.patch.object(TextProvider, "_load_env", lambda self: None), mock.patch.dict(
            os.environ, {"LIGHTTRACK_GATEWAY_URL": ""}, clear=False
        ):
            provider = GatewayProvider(use_case="match_reasoning")
            with mock.patch.object(GatewayProvider, "_import_sdk", return_value=True):
                self.assertEqual(provider.availability(), (True, None))
            self.assertEqual(provider._resolved_base_url(), "http://127.0.0.1:8792/v1")

    def test_the_route_is_the_use_case(self) -> None:
        self.assertEqual(default_model("match_reasoning", "gateway"), "match_reasoning")
        self.assertEqual(GatewayProvider(use_case="jd_ingest").model, "jd_ingest")
        self.assertEqual(GatewayProvider(model="codex/gpt-5.5@low", use_case="jd_ingest").model, "codex/gpt-5.5@low")

    def test_registry_resolves_a_model_less_row(self) -> None:
        cfg = {"useCases": {"match_reasoning": {"provider": "gateway"}}}
        with mock.patch.dict(os.environ, {ENV_VAR: json.dumps(cfg)}, clear=False):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, GatewayProvider)
        self.assertEqual(provider.model, "match_reasoning")
        self.assertEqual(provider.use_case, "match_reasoning")


class WireTests(unittest.TestCase):
    def setUp(self) -> None:
        monitor.reset()
        self._ledger = tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False)
        self._ledger.close()
        self._env = mock.patch.dict(
            os.environ, {"KP_LLM_USAGE_LOG": self._ledger.name, "LIGHTTRACK_URL": "http://lt.test"}, clear=False
        )
        self._env.start()
        self.addCleanup(self._env.stop)
        self.addCleanup(lambda: os.unlink(self._ledger.name))
        self.addCleanup(monitor.reset)

    def _provider(self, reply) -> tuple[GatewayProvider, _Recorder]:
        provider = GatewayProvider(use_case="match_reasoning", timeout=5)
        client = _Recorder(reply)
        provider._make_client = lambda timeout: client  # type: ignore[method-assign]
        return provider, client

    def _ledger_rows(self) -> list[dict]:
        with open(self._ledger.name, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]

    def test_complete_json_sends_the_use_case_schema_and_pins_keys(self) -> None:
        answer = {"verdict": "strong fit at 77/100", "strengths": ["a"], "gaps": ["b"], "interviewProbes": ["c?"]}
        provider, client = self._provider(_reply(json.dumps(answer)))
        with mock.patch.object(monitor, "_client", return_value=None):
            out = provider.complete_json("assess", system="you are a recruiter", expected_keys=("verdict", "gaps"))
        self.assertEqual(out, answer)
        (call,) = client.calls
        self.assertEqual(call["model"], "match_reasoning")
        self.assertEqual(call["response_format"]["type"], "json_schema")
        self.assertEqual(call["response_format"]["json_schema"]["schema"], USE_CASE_SCHEMAS["match_reasoning"])
        self.assertEqual(call["messages"][0], {"role": "system", "content": "you are a recruiter"})
        # The app's own JSON guard still rides the prompt: the gateway enforces shape,
        # the guard keeps a schema-less CLI answer parseable.
        self.assertIn("ONLY valid JSON", call["messages"][1]["content"])
        # The format is per call, never sticky: a plain complete() after it sends none.
        provider.complete("hi")
        self.assertNotIn("response_format", client.calls[1])

    def test_a_use_case_without_a_schema_asks_for_json_object(self) -> None:
        provider = GatewayProvider(use_case="assistant", timeout=5)
        client = _Recorder(_reply('{"reply": "x"}'))
        provider._make_client = lambda timeout: client  # type: ignore[method-assign]
        with mock.patch.object(monitor, "_client", return_value=None):
            provider.complete_json("say x")
        self.assertEqual(client.calls[0]["response_format"], {"type": "json_object"})

    def test_ledger_names_the_seat_that_answered_and_lighttrack_is_not_double_counted(self) -> None:
        provider, _ = self._provider(_reply('{"ok": true}', model="codex/gpt-5.5@low", cost=None))
        tracker = mock.Mock()
        with mock.patch.object(monitor, "_client", return_value=tracker):
            result = provider.complete("hi")
        # The reply's `model` is the target that served (x-lighttrack-served-by), and
        # the gateway's cost (null on a Codex seat) replaces the price-book lookup.
        self.assertEqual(result.model, "codex/gpt-5.5@low")
        self.assertEqual(result.provider, "gateway")
        self.assertIsNone(result.cost_usd)
        rows = self._ledger_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["provider"], rows[0]["model"], rows[0]["outcome"]), ("gateway", "codex/gpt-5.5@low", "ok"))
        # The gateway already filed this call's events under the use case.
        tracker.track.assert_not_called()

    def test_a_failure_still_lands_in_the_ledger_without_a_lighttrack_row(self) -> None:
        provider = GatewayProvider(use_case="match_reasoning", timeout=5)

        def boom(timeout):
            raise RuntimeError("gateway: 503 all targets failed")

        # The client factory is a bound method upstream; the test swaps it for a stub.
        provider._make_client = boom  # type: ignore[method-assign]
        tracker = mock.Mock()
        with mock.patch.object(monitor, "_client", return_value=tracker), mock.patch("time.sleep"):
            with self.assertRaises(Exception):
                provider.complete("hi")
        rows = self._ledger_rows()
        self.assertEqual([r["outcome"] for r in rows], ["failed"])
        tracker.track.assert_not_called()

    def test_other_adapters_still_emit_to_lighttrack(self) -> None:
        """Non-vacuity for the suppression: the same monitor path, a normal adapter."""
        from pipeline.jobfit.llm.adapters.ollama import OllamaProvider

        provider = OllamaProvider(model="m", use_case="match_reasoning", timeout=5)
        # Same swap as above: a stub in place of the bound client factory.
        provider._make_client = lambda timeout: _Recorder(_reply("x", model="m", cost=None))  # type: ignore[method-assign]
        tracker = mock.Mock()
        with mock.patch.object(monitor, "_client", return_value=tracker):
            provider.complete("hi")
        tracker.track.assert_called_once()


class GatewayPolicyTests(unittest.TestCase):
    """The loopback hop is not the model: the two policies that stop the seat CLIs
    stop this route too."""

    def test_offline_seal_blocks_the_gateway_even_though_it_is_loopback(self) -> None:
        provider = GatewayProvider(use_case="match_reasoning", timeout=5)
        with mock.patch.dict(os.environ, {"KP_OFFLINE": "1", "NODE_ENV": "development"}):
            usable, reason = provider.availability()
        self.assertFalse(usable)
        self.assertEqual(reason, "offline_policy")

    def test_production_refuses_the_gateway_unless_the_cli_engine_is_unlocked(self) -> None:
        provider = GatewayProvider(use_case="match_reasoning", timeout=5)
        with mock.patch.dict(os.environ, {"NODE_ENV": "production", "KP_ALLOW_CLI_ENGINE": ""}, clear=False):
            os.environ.pop("KP_OFFLINE", None)
            usable, reason = provider.availability()
            self.assertFalse(usable)
            self.assertEqual(reason, "consumer_terms_policy")
        with mock.patch.dict(os.environ, {"NODE_ENV": "production", "KP_ALLOW_CLI_ENGINE": "1"}):
            os.environ.pop("KP_OFFLINE", None)
            self.assertTrue(provider.available())

    def test_a_claude_served_reply_is_still_unpriced_in_the_ledger(self) -> None:
        provider = GatewayProvider(use_case="match_reasoning", timeout=5)
        self.assertIsNone(provider._cost_of(_reply("x", model="anthropic/sonnet@low", cost=0.02), 10, 3))


if __name__ == "__main__":
    unittest.main()
