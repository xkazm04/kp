"""Offline tests for the multi-LLM base contract (retry, JSON guard, map) and
the adapters' client-independent plumbing (mocked clients, no SDK required)."""

from __future__ import annotations

import os
import unittest
from types import SimpleNamespace
from unittest import mock

from pipeline.jobfit.llm.adapters.anthropic_api import AnthropicProvider
from pipeline.jobfit.llm.adapters.azure_openai import AzureOpenAIProvider
from pipeline.jobfit.llm.adapters.openai_api import OpenAIProvider
from pipeline.jobfit.llm.base import (
    LLMError,
    LLMResult,
    TextProvider,
    is_transient_error,
    price_usd,
)


def _result(text: str) -> LLMResult:
    return LLMResult(text=text, provider="fake", model="fake-1")


class FakeProvider(TextProvider):
    """Scripted provider: each _call pops the next item (result or exception)."""

    name = "fake"

    def __init__(self, script):
        super().__init__(model="fake-1")
        self.script = list(script)
        self.calls: list[dict] = []

    def available(self) -> bool:
        return True

    def _call(self, prompt, *, system, timeout):
        self.calls.append({"prompt": prompt, "system": system, "timeout": timeout})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class CompleteRetryTest(unittest.TestCase):
    def test_returns_result_and_stamps_duration(self) -> None:
        fake = FakeProvider([_result("hello")])
        out = fake.complete("hi")
        self.assertEqual(out.text, "hello")
        self.assertGreaterEqual(out.duration_ms, 0)

    @mock.patch("pipeline.jobfit.llm.base.time.sleep")
    def test_retries_transient_then_succeeds(self, _sleep) -> None:
        fake = FakeProvider([TimeoutError("request timed out"), _result("ok")])
        out = fake.complete("hi")
        self.assertEqual(out.text, "ok")
        self.assertEqual(len(fake.calls), 2)

    def test_permanent_error_fails_fast(self) -> None:
        fake = FakeProvider([ValueError("invalid api key"), _result("never")])
        with self.assertRaises(LLMError):
            fake.complete("hi")
        self.assertEqual(len(fake.calls), 1)

    @mock.patch("pipeline.jobfit.llm.base.time.sleep")
    def test_exhausted_retries_raise_llm_error(self, _sleep) -> None:
        fake = FakeProvider([TimeoutError("timed out")] * 3)
        with self.assertRaises(LLMError):
            fake.complete("hi")
        self.assertEqual(len(fake.calls), 3)

    def test_empty_prompt_rejected(self) -> None:
        with self.assertRaises(ValueError):
            FakeProvider([]).complete("   ")


class CompleteJsonTest(unittest.TestCase):
    def test_appends_guard_and_parses_fenced_json(self) -> None:
        fake = FakeProvider([_result('Sure!\n```json\n{"a": 1}\n```')])
        self.assertEqual(fake.complete_json("give json"), {"a": 1})
        self.assertIn("ONLY valid JSON", fake.calls[0]["prompt"])

    def test_expected_keys_pin_the_answer_object(self) -> None:
        fake = FakeProvider([_result('{"example": true} {"verdict": "ok"} {"other": 1}')])
        self.assertEqual(
            fake.complete_json("x", expected_keys=["verdict"]), {"verdict": "ok"}
        )

    def test_junk_raises_llm_error(self) -> None:
        fake = FakeProvider([_result("no json here at all")])
        with self.assertRaises(LLMError):
            fake.complete_json("x")


class MapTest(unittest.TestCase):
    def test_preserves_order_and_wraps_errors(self) -> None:
        # max_workers=1 keeps the scripted pop order deterministic.
        fake = FakeProvider([_result("one"), ValueError("boom"), _result("three")])
        out = fake.map(["a", "b", "c"], max_workers=1)
        self.assertEqual(out[0].text, "one")
        self.assertIsInstance(out[1], LLMError)
        self.assertEqual(out[2].text, "three")

    def test_empty_input(self) -> None:
        self.assertEqual(FakeProvider([]).map([]), [])


class TransientClassificationTest(unittest.TestCase):
    def test_retryable_status_code_attr(self) -> None:
        exc = RuntimeError("server says no")
        exc.status_code = 429
        self.assertTrue(is_transient_error(exc))

    def test_auth_error_is_permanent(self) -> None:
        exc = RuntimeError("unauthorized")
        exc.status_code = 401
        self.assertFalse(is_transient_error(exc))

    def test_timeout_text_marker(self) -> None:
        self.assertTrue(is_transient_error(TimeoutError("read timed out")))

    def test_neutral_message_is_permanent(self) -> None:
        self.assertFalse(is_transient_error(ValueError("bad schema")))


class PriceTest(unittest.TestCase):
    def test_known_model(self) -> None:
        # 100 in × $1/MTok + 20 out × $5/MTok
        self.assertAlmostEqual(price_usd("claude-haiku-4-5", 100, 20), 0.0002)

    def test_unknown_model_is_none(self) -> None:
        self.assertIsNone(price_usd("gpt-5-mini", 100, 20))


class AnthropicAdapterTest(unittest.TestCase):
    def test_call_parses_text_usage_and_cost(self) -> None:
        provider = AnthropicProvider(model="claude-haiku-4-5", api_key="k")
        fake_resp = SimpleNamespace(
            id="msg_1",
            stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text='{"ok": true}')],
            usage=SimpleNamespace(
                input_tokens=100, output_tokens=20, cache_read_input_tokens=7
            ),
        )
        created: dict = {}

        def fake_create(**kwargs):
            created.update(kwargs)
            return fake_resp

        fake_client = SimpleNamespace(messages=SimpleNamespace(create=fake_create))
        with mock.patch.object(AnthropicProvider, "_make_client", return_value=fake_client):
            out = provider.complete("return ok", system="be terse")
        self.assertEqual(out.json(), {"ok": True})
        self.assertEqual(created["model"], "claude-haiku-4-5")
        self.assertEqual(created["system"], "be terse")
        self.assertEqual(created["messages"], [{"role": "user", "content": "return ok"}])
        self.assertEqual(out.usage["input_tokens"], 100)
        self.assertEqual(out.usage["cached_tokens"], 7)
        self.assertAlmostEqual(out.cost_usd, 0.0002)

    def test_system_omitted_when_none(self) -> None:
        provider = AnthropicProvider(model="claude-haiku-4-5", api_key="k")
        created: dict = {}
        fake_resp = SimpleNamespace(id="m", stop_reason="end_turn", content=[], usage=None)
        fake_client = SimpleNamespace(
            messages=SimpleNamespace(create=lambda **kw: created.update(kw) or fake_resp)
        )
        with mock.patch.object(AnthropicProvider, "_make_client", return_value=fake_client):
            provider.complete("hi")
        self.assertNotIn("system", created)

    def test_available_false_without_key(self) -> None:
        provider = AnthropicProvider(model="claude-haiku-4-5")
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch(
            "pipeline.jobfit.llm.adapters.anthropic_api.load_local_env"
        ):
            os.environ.pop("ANTHROPIC_API_KEY", None)
            self.assertFalse(provider.available())


class OpenAIAdapterTest(unittest.TestCase):
    def test_call_builds_messages_and_parses_usage(self) -> None:
        provider = OpenAIProvider(model="gpt-5-mini", api_key="k", max_tokens=512)
        fake_resp = SimpleNamespace(
            id="cmpl_1",
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content='{"b": 2}'), finish_reason="stop"
                )
            ],
            usage=SimpleNamespace(
                prompt_tokens=11,
                completion_tokens=3,
                prompt_tokens_details=SimpleNamespace(cached_tokens=4),
            ),
        )
        created: dict = {}

        def fake_create(**kwargs):
            created.update(kwargs)
            return fake_resp

        fake_client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
        )
        with mock.patch.object(OpenAIProvider, "_make_client", return_value=fake_client):
            payload = provider.complete_json("return b", system="terse")
        self.assertEqual(payload, {"b": 2})
        self.assertEqual(created["model"], "gpt-5-mini")
        self.assertEqual(created["max_completion_tokens"], 512)
        self.assertEqual(created["messages"][0], {"role": "system", "content": "terse"})
        self.assertEqual(created["messages"][1]["role"], "user")

    def test_available_false_without_key(self) -> None:
        provider = OpenAIProvider(model="gpt-5-mini")
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch(
            "pipeline.jobfit.llm.adapters.openai_api.load_local_env"
        ):
            os.environ.pop("OPENAI_API_KEY", None)
            self.assertFalse(provider.available())


class AzureAdapterTest(unittest.TestCase):
    def test_available_false_without_endpoint(self) -> None:
        # Endpoint check short-circuits before any SDK import, so this test
        # holds even where the openai package isn't installed.
        provider = AzureOpenAIProvider(model="my-deployment", api_key="k")
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch(
            "pipeline.jobfit.llm.adapters.azure_openai.load_local_env"
        ):
            os.environ.pop("AZURE_OPENAI_ENDPOINT", None)
            self.assertFalse(provider.available())

    def test_api_version_default(self) -> None:
        provider = AzureOpenAIProvider(model="dep", api_key="k", endpoint="https://x")
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AZURE_OPENAI_API_VERSION", None)
            self.assertTrue(provider._resolved_api_version())


if __name__ == "__main__":
    unittest.main()
