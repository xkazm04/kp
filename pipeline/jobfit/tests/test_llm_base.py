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
    _MAX_ATTEMPTS,
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


class _ClockedProvider(TextProvider):
    """Provider whose _call advances a fake monotonic clock (never sleeps for real)
    then raises a transient timeout — so the retry loop's treatment of `timeout` as
    a TOTAL wall-clock deadline can be asserted deterministically. Each _call
    consumes ``min(per_call_s, timeout)`` seconds (a real call can't outlast the
    per-attempt timeout it was handed)."""

    name = "clocked"

    def __init__(self, clock: dict, per_call_s: float) -> None:
        super().__init__(model="clocked-1", timeout=100)
        self.clock = clock
        self.per_call_s = per_call_s
        self.timeouts: list[int] = []

    def available(self) -> bool:
        return True

    def _call(self, prompt, *, system, timeout):
        self.timeouts.append(timeout)
        self.clock["t"] += min(self.per_call_s, timeout)
        raise TimeoutError("upstream timed out")


class OverallDeadlineTest(unittest.TestCase):
    """The configured timeout is an OVERALL wall-clock ceiling across retries, not a
    per-attempt one (bug-ui-scan 2026-07-09 #2). Asserted with a stubbed clock — no
    real sleeps — so total wall-clock never reaches ~_MAX_ATTEMPTS × timeout."""

    def _run(self, per_call_s: float):
        clock = {"t": 1000.0}
        prov = _ClockedProvider(clock, per_call_s=per_call_s)
        with mock.patch("pipeline.jobfit.llm.base.time.monotonic", lambda: clock["t"]), \
            mock.patch(
                "pipeline.jobfit.llm.base.time.sleep",
                lambda s: clock.__setitem__("t", clock["t"] + s),
            ), \
            mock.patch("pipeline.jobfit.llm.base.random.uniform", lambda _a, _b: 0.0), \
            mock.patch("pipeline.jobfit.llm.base.monitor") as monitor:
            try:
                prov.complete("hi")
                raised = None
            except LLMError as exc:
                raised = exc
        return prov, clock, monitor, raised

    def test_per_attempt_timeout_is_the_remaining_budget(self) -> None:
        # 40s per attempt against a 100s total budget → all 3 attempts fit, but the
        # per-attempt timeout SHRINKS toward the deadline (100 → 59 → 18).
        prov, clock, _monitor, raised = self._run(per_call_s=40.0)
        self.assertIsInstance(raised, LLMError)
        self.assertEqual(len(prov.timeouts), _MAX_ATTEMPTS)
        # Strictly decreasing — pre-fix every attempt got the full budget [100,100,100].
        self.assertGreater(prov.timeouts[0], prov.timeouts[1])
        self.assertGreater(prov.timeouts[1], prov.timeouts[2])
        # Total wall-clock never exceeds the configured ceiling — pre-fix it was ~3×.
        self.assertLessEqual(clock["t"] - 1000.0, 100.0)

    def test_deadline_caps_attempts_and_meters_before_abort(self) -> None:
        # 60s per attempt: after two attempts (~99s) too little budget remains for a
        # third, so the loop STOPS early instead of running a 3rd full-budget attempt
        # that would blow the deadline.
        prov, clock, monitor, raised = self._run(per_call_s=60.0)
        self.assertIsInstance(raised, LLMError)
        # Fewer than _MAX_ATTEMPTS attempts — pre-fix always ran all 3.
        self.assertLess(len(prov.timeouts), _MAX_ATTEMPTS)
        self.assertLessEqual(clock["t"] - 1000.0, 100.0)
        # The deadline stop is a distinct, labelled failure (pre-fix: bare LLMError
        # with no subtype)…
        self.assertEqual(raised.subtype, "deadline_exceeded")
        # …and the ledger error is emitted BEFORE the raise, so a wall-clock stop
        # never loses the metering line the way a SIGKILL past the deadline would.
        self.assertTrue(monitor.emit_error.called)


class _SlowJsonProvider(TextProvider):
    """Advances a fake clock by ``first_call_s`` on the FIRST call and answers with
    unparseable prose; any later call is instant and returns valid JSON. Lets the
    shared complete_json deadline be asserted without real sleeps."""

    name = "slowjson"

    def __init__(self, clock: dict, first_call_s: float) -> None:
        super().__init__(model="slowjson-1", timeout=100)
        self.clock = clock
        self.first_call_s = first_call_s
        self.timeouts: list[float] = []

    def available(self) -> bool:
        return True

    def _call(self, prompt, *, system, timeout):
        self.timeouts.append(timeout)
        if len(self.timeouts) == 1:
            self.clock["t"] += self.first_call_s
            return _result("Sure! but this is not json")
        return _result('{"verdict": "ok"}')


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

    def test_self_repair_reprompt_recovers(self) -> None:
        # First response is unparseable; the one corrective re-prompt returns valid
        # JSON → complete_json recovers instead of dropping to a deterministic
        # fallback. Exactly two model calls (T0.3).
        fake = FakeProvider(
            [_result("Sure, here you go: not actually json"), _result('{"verdict": "ok"}')]
        )
        self.assertEqual(fake.complete_json("x"), {"verdict": "ok"})
        self.assertEqual(len(fake.calls), 2)
        self.assertIn("could not be parsed as JSON", fake.calls[1]["prompt"])

    def test_junk_raises_llm_error(self) -> None:
        # Both the initial response AND the repair re-prompt return junk → raise,
        # after exactly two attempts (no infinite repair loop).
        fake = FakeProvider([_result("no json here at all"), _result("still no json")])
        with self.assertRaises(LLMError):
            fake.complete_json("x")
        self.assertEqual(len(fake.calls), 2)

    def test_the_repair_reprompt_shares_the_deadline_it_does_not_restart_it(self) -> None:
        """The deadline spans BOTH calls, so a JSON call cannot cost 2× its budget.

        ``complete()`` treats the timeout as a total wall-clock ceiling exactly so
        the Python side stays inside the TS spawn's SIGKILL window; the repair used
        to get a FRESH full budget, which put every call site past its ceiling
        (role_intake pins 120s against a 120_000ms spawn timeout). Assert the
        repair is handed only the REMAINING time."""
        clock = {"t": 5000.0}
        # First call burns 60 of a 100s budget, then answers unparseably.
        fake = _SlowJsonProvider(clock, first_call_s=60.0)
        with mock.patch("pipeline.jobfit.llm.base.time.monotonic", lambda: clock["t"]):
            self.assertEqual(fake.complete_json("x", timeout=100), {"verdict": "ok"})
        self.assertEqual(len(fake.timeouts), 2)
        # The repair got what was LEFT (~40s), not another 100.
        self.assertLess(fake.timeouts[1], 100)
        self.assertLessEqual(fake.timeouts[1], 40)

    def test_a_deadline_with_no_room_left_refuses_the_repair_instead_of_overrunning(self) -> None:
        """When the first call consumed the whole budget, starting the repair would
        be killed by the host's wall clock mid-flight — losing both the answer and
        the ledger line. Refuse with the reason instead of overrunning."""
        clock = {"t": 5000.0}
        fake = _SlowJsonProvider(clock, first_call_s=100.0)
        with mock.patch("pipeline.jobfit.llm.base.time.monotonic", lambda: clock["t"]), \
                mock.patch("pipeline.jobfit.llm.base.monitor") as monitor:
            with self.assertRaises(LLMError) as ctx:
                fake.complete_json("x", timeout=100)
        # Exactly ONE model call — the repair was never issued.
        self.assertEqual(len(fake.timeouts), 1)
        self.assertEqual(ctx.exception.subtype, "unparseable_json")
        self.assertIn("no room for a repair", str(ctx.exception))
        # …and the failure still reaches the ledger, as every other descent does.
        self.assertTrue(monitor.emit_error.called)


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
        self.assertIsNone(price_usd("some-model-we-never-route-to", 100, 20))

    def test_non_anthropic_defaults_are_priced(self) -> None:
        # T0.2: the openai + gemini default models must carry a price so their
        # traffic doesn't escape cost accounting with cost_usd=None.
        self.assertIsNotNone(price_usd("gpt-5-mini", 1000, 1000))
        self.assertIsNotNone(price_usd("gemini-3-flash-preview", 1000, 1000))

    def test_dated_variant_inherits_family_price(self) -> None:
        # Prefix match: a dated/suffixed model id inherits its family's price.
        self.assertEqual(
            price_usd("claude-haiku-4-5-20251001", 100, 20),
            price_usd("claude-haiku-4-5", 100, 20),
        )

    def test_every_routed_default_model_is_priced(self) -> None:
        # The regression guard the _plumbing finding asked for: every model the
        # registry can route to by default must resolve a price (Azure deployments
        # and the CLI's own default are customer-/engine-named → intentionally None).
        from pipeline.jobfit.llm.capabilities import (
            DEFAULT_MODELS,
            USE_CASE_MODEL_OVERRIDES,
        )

        routed = {m for m in DEFAULT_MODELS.values() if m} | set(
            USE_CASE_MODEL_OVERRIDES.values()
        )
        unpriced = sorted(m for m in routed if price_usd(m, 1, 1) is None)
        self.assertEqual(unpriced, [], f"unpriced routed models: {unpriced}")


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

    def test_call_stamps_cost_for_priced_model(self) -> None:
        # T0.2: the OpenAI adapter (and Azure, which inherits this _call) now
        # stamps cost_usd from MTOK_PRICES instead of leaving it None.
        provider = OpenAIProvider(model="gpt-5-mini", api_key="k")
        fake_resp = SimpleNamespace(
            id="c",
            choices=[SimpleNamespace(message=SimpleNamespace(content="{}"), finish_reason="stop")],
            usage=SimpleNamespace(prompt_tokens=1000, completion_tokens=1000, prompt_tokens_details=None),
        )
        fake_client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: fake_resp))
        )
        with mock.patch.object(OpenAIProvider, "_make_client", return_value=fake_client):
            out = provider.complete("hi")
        # 1000 in × $0.25/MTok + 1000 out × $2.00/MTok
        self.assertAlmostEqual(out.cost_usd, 0.00225)

    def _complete_with_resp(self, resp) -> None:
        provider = OpenAIProvider(model="gpt-5-mini", api_key="k")
        fake_client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: resp))
        )
        with mock.patch.object(OpenAIProvider, "_make_client", return_value=fake_client):
            provider.complete("hi")

    def test_top_level_error_body_raises_not_metered(self) -> None:
        # bug-ui-scan-2026-07-09 (#3): OpenRouter/OpenAI idiom — HTTP 200 whose body
        # carries {"error": ...} and no usable choices. Pre-fix this coerced to
        # text="" and the base metered it as a PAID success; now it raises.
        resp = SimpleNamespace(
            error={"message": "Provider returned error", "code": 502}, choices=[], usage=None
        )
        with self.assertRaises(LLMError) as ctx:
            self._complete_with_resp(resp)
        self.assertEqual(ctx.exception.subtype, "provider_error")

    def test_empty_choices_raises(self) -> None:
        # A 200 with no error object but an empty choices array is a failed proxied
        # call, not an empty-prose answer — pre-fix it returned a text="" success.
        resp = SimpleNamespace(choices=[], usage=None)
        with self.assertRaises(LLMError) as ctx:
            self._complete_with_resp(resp)
        self.assertEqual(ctx.exception.subtype, "empty_choices")

    def test_content_filter_finish_reason_raises(self) -> None:
        # finish_reason=content_filter → no usable output; must surface as an error.
        resp = SimpleNamespace(
            choices=[
                SimpleNamespace(message=SimpleNamespace(content=None), finish_reason="content_filter")
            ],
            usage=None,
        )
        with self.assertRaises(LLMError) as ctx:
            self._complete_with_resp(resp)
        self.assertEqual(ctx.exception.subtype, "content_filter")

    def test_available_false_without_key(self) -> None:
        provider = OpenAIProvider(model="gpt-5-mini")
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch(
            "pipeline.jobfit.llm.adapters.openai_api.load_local_env"
        ):
            os.environ.pop("OPENAI_API_KEY", None)
            self.assertFalse(provider.available())


class GeminiAdapterTest(unittest.TestCase):
    def test_call_stamps_cost_for_priced_model(self) -> None:
        # T0.2: the Gemini text adapter now stamps cost_usd too. Skipped where the
        # SDK isn't installed (types.GenerateContentConfig is built inside _call).
        try:
            import google.genai  # noqa: F401
        except ImportError:
            self.skipTest("google-genai SDK not installed")
        from pipeline.jobfit.llm.adapters.gemini_api import GeminiProvider

        provider = GeminiProvider(model="gemini-3-flash-preview", api_key="k")
        fake_resp = SimpleNamespace(text="{}")
        fake_client = SimpleNamespace(
            models=SimpleNamespace(generate_content=lambda **kw: fake_resp)
        )
        with mock.patch.object(GeminiProvider, "_make_client", return_value=fake_client), mock.patch(
            "pipeline.jobfit.gemini._usage_metadata",
            return_value={"prompt_tokens": 1000, "candidate_tokens": 1000, "cached_tokens": 0},
        ):
            out = provider.complete("hi")
        # 1000 in × $0.30/MTok + 1000 out × $2.50/MTok
        self.assertAlmostEqual(out.cost_usd, 0.0028)


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


class _BlockedResponse:
    """A google-genai response whose ``.text`` raises — what the SDK does when the
    only candidate carries no parts (safety block / recitation / an empty stop)."""

    def __init__(self, finish_reason: str | None) -> None:
        self.candidates = (
            [SimpleNamespace(finish_reason=SimpleNamespace(name=finish_reason))]
            if finish_reason
            else []
        )

    @property
    def text(self):
        raise ValueError("response has no candidates with text parts")


class GeminiEmptyResponseTest(unittest.TestCase):
    """A Gemini response with NO usable text must fail loudly, not return ``""``.

    Pre-fix the adapter swallowed both shapes (``.text`` raising, and ``.text`` None)
    into ``text=""`` and handed the base a *successful* LLMResult: the blocked call
    was metered as a healthy completion and every plain ``complete()`` caller
    (intake.run_voice_turn, the interview/intake eval personas) took the empty string
    as the model's real answer. This is the same class the OpenAI adapter's
    ``_raise_on_error_response`` already closed for empty choices / content filters.
    """

    def _run(self, resp):
        try:
            import google.genai  # noqa: F401
        except ImportError:
            self.skipTest("google-genai SDK not installed")
        from pipeline.jobfit.llm.adapters.gemini_api import GeminiProvider

        provider = GeminiProvider(model="gemini-3.6-flash", api_key="k")
        fake_client = SimpleNamespace(
            models=SimpleNamespace(generate_content=lambda **kw: resp)
        )
        with mock.patch.object(GeminiProvider, "_make_client", return_value=fake_client), \
            mock.patch(
                "pipeline.jobfit.gemini._usage_metadata",
                return_value={"prompt_tokens": 1200, "candidate_tokens": 0, "cached_tokens": 0},
            ), \
            mock.patch("pipeline.jobfit.llm.adapters.gemini_api.monitor") as adapter_monitor, \
            mock.patch("pipeline.jobfit.llm.base.monitor"):
            with self.assertRaises(LLMError) as ctx:
                provider.complete("summarise this CV")
        return ctx.exception, adapter_monitor

    def test_safety_block_raises_with_the_finish_reason(self) -> None:
        exc, _ = self._run(_BlockedResponse("SAFETY"))
        self.assertEqual(exc.subtype, "empty_response")
        self.assertIn("SAFETY", str(exc))

    def test_none_text_raises(self) -> None:
        # The other SDK shape: `.text` returns None rather than raising.
        exc, _ = self._run(SimpleNamespace(text=None, candidates=[]))
        self.assertEqual(exc.subtype, "empty_response")

    def test_whitespace_only_text_raises(self) -> None:
        exc, _ = self._run(SimpleNamespace(text="   \n ", candidates=[]))
        self.assertEqual(exc.subtype, "empty_response")

    def test_paid_input_tokens_still_land_in_the_ledger(self) -> None:
        # Google bills the prompt for a blocked response, so the spend record must
        # survive the failure — the same ordering gemini.py's production path uses
        # (_meter_success before parsing) and the same success-then-error pair
        # complete_json emits for an unusable-but-paid completion.
        _exc, adapter_monitor = self._run(_BlockedResponse("PROHIBITED_CONTENT"))
        self.assertTrue(adapter_monitor.emit_result.called)
        kwargs = adapter_monitor.emit_result.call_args.kwargs
        self.assertEqual(kwargs["usage"]["input_tokens"], 1200)
        self.assertEqual(kwargs["provider"], "gemini")
        # 1200 in × $1.50/MTok + 0 out × $7.00/MTok
        self.assertAlmostEqual(kwargs["cost_usd"], 0.0018)


if __name__ == "__main__":
    unittest.main()
