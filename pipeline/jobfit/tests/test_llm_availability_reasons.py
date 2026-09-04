"""The provider layer names its descent, validates every endpoint, and reads .env once.

Three properties that were prose (or nothing) before:

1. ``availability()`` on the metered adapters. The bare ``available()`` bool made
   ``registry.provider_availability`` answer a generic "unavailable" for every one
   of them, so an air-gapped install recorded its DELIBERATE offline seal in the
   usage ledger — and printed it from the Test CLI — as "missing key or SDK/CLI".
   Those are repaired in four different places; a diagnosis that names the wrong
   one is worse than none.
2. ``validate_base_url``. TypeScript shape-checked a base URL saved through the
   Models panel; the five adapters that read one from the ENVIRONMENT used it raw,
   and the offline-block error echoed it verbatim — userinfo, query string and all.
3. One .env read per provider instance. ``_load_env`` ran on every key and every
   base-URL resolution, i.e. on every availability check and every retry, and
   ``map()`` drives those from a thread pool.
"""

from __future__ import annotations

import io
import json
import os
import threading
import unittest
from contextlib import contextmanager, redirect_stdout
from unittest import mock

from ..llm import test_cli
from ..llm.adapters import ADAPTERS
from ..llm.base import (
    AVAILABILITY_REASONS,
    LLMError,
    LLMResult,
    TextProvider,
    endpoint_host,
    validate_base_url,
)
from ..llm.registry import provider_availability


@contextmanager
def env(**values: str | None):
    previous = {k: os.environ.get(k) for k in values}
    try:
        for k, v in values.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        yield
    finally:
        for k, v in previous.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _adapter(name: str, **kwargs):
    kw = {"model": "m"}
    if name == "azure_openai":
        kw["endpoint"] = "https://res.openai.azure.com"
    kw.update(kwargs)
    return ADAPTERS[name](**kw)


class AvailabilityReasonTests(unittest.TestCase):
    """Every adapter answers WHY, from the one closed vocabulary."""

    def test_every_adapter_reports_missing_key_not_a_bare_false(self) -> None:
        # ollama is the exception by design: it authenticates nothing, so a missing
        # key is not a descent for it (its endpoint always resolves).
        for name in sorted(ADAPTERS):
            if name == "ollama":
                continue
            with self.subTest(provider=name), env(
                OPENAI_API_KEY=None, ANTHROPIC_API_KEY=None, GEMINI_API_KEY=None,
                GOOGLE_API_KEY=None, OPENROUTER_API_KEY=None, QWEN_API_KEY=None,
                DASHSCOPE_API_KEY=None, AZURE_OPENAI_API_KEY=None, OPENAI_BASE_URL=None,
            ):
                provider = _adapter(name)
                with mock.patch.object(TextProvider, "_load_env", lambda self: None):
                    self.assertEqual(provider.availability(), (False, "missing_key"))
                    self.assertFalse(provider.available())

    def test_a_missing_sdk_is_told_apart_from_a_missing_key(self) -> None:
        provider = _adapter("anthropic", api_key="k")
        with mock.patch.object(type(provider), "_import_sdk", return_value=False):
            self.assertEqual(provider.availability(), (False, "sdk_missing"))

    def test_the_offline_seal_reads_offline_policy_on_every_cloud_adapter(self) -> None:
        """THE case this exists for: a fully-credentialed cloud adapter under
        KP_OFFLINE must report the policy, not a missing key."""
        for name in sorted(ADAPTERS):
            if name == "ollama":  # on-box by default — stays usable offline
                continue
            with self.subTest(provider=name):
                provider = _adapter(name, api_key="k")
                with mock.patch.object(type(provider), "_import_sdk", return_value=True), \
                        mock.patch.object(TextProvider, "_load_env", lambda self: None), \
                        env(KP_OFFLINE="1"):
                    self.assertEqual(provider.availability(), (False, "offline_policy"))
                with mock.patch.object(type(provider), "_import_sdk", return_value=True), \
                        mock.patch.object(TextProvider, "_load_env", lambda self: None), \
                        env(KP_OFFLINE=None):
                    # Non-vacuity: the same adapter is usable with the flag off, so
                    # the assertion above isolates the policy and nothing else.
                    self.assertEqual(provider.availability(), (True, None))

    def test_azure_names_its_missing_endpoint_instead_of_blaming_the_key(self) -> None:
        provider = ADAPTERS["azure_openai"](model="dep", api_key="k")
        with mock.patch.object(TextProvider, "_load_env", lambda self: None), env(
            AZURE_OPENAI_ENDPOINT=None
        ):
            self.assertEqual(provider.availability(), (False, "missing_endpoint"))

    def test_an_unusable_base_url_degrades_with_its_own_reason(self) -> None:
        provider = _adapter("openai", api_key="k", base_url="https://user:secret@gw.example.com/v1")
        self.assertEqual(provider.availability(), (False, "invalid_base_url"))
        self.assertFalse(provider.available())
        # …and the call path still fails LOUDLY: a call that was actually made must
        # not degrade silently into a deterministic answer.
        with self.assertRaises(LLMError) as ctx:
            provider._make_client(10)
        self.assertEqual(ctx.exception.subtype, "invalid_base_url")

    def test_every_reason_an_adapter_can_return_is_in_the_declared_vocabulary(self) -> None:
        observed = {
            "missing_key", "sdk_missing", "offline_policy", "missing_endpoint", "invalid_base_url",
        }
        self.assertTrue(observed.issubset(set(AVAILABILITY_REASONS)))
        # not_installed is claude_cli's; it belongs to the same closed set.
        self.assertIn("not_installed", AVAILABILITY_REASONS)

    def test_provider_availability_threads_the_adapter_reason_through(self) -> None:
        provider = _adapter("openrouter", api_key="k")
        with mock.patch.object(type(provider), "_import_sdk", return_value=True), \
                mock.patch.object(TextProvider, "_load_env", lambda self: None), env(KP_OFFLINE="1"):
            self.assertEqual(provider_availability(provider), (False, "offline_policy"))


class TestCliDiagnosisTests(unittest.TestCase):
    def test_the_canary_prints_the_reason_and_keeps_the_classifier_phrase(self) -> None:
        buffer = io.StringIO()
        with mock.patch.object(TextProvider, "_load_env", lambda self: None), env(KP_OFFLINE="1"):
            with redirect_stdout(buffer):
                self.assertEqual(test_cli.main(["--provider", "openrouter", "--model", "x"]), 0)
        payload = json.loads(buffer.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["reason"], "offline_policy")
        self.assertIn("KP_OFFLINE", payload["error"])
        # app/api/llm/test/verdict.ts classifies on this exact phrase; changing it
        # would silently re-bucket the verdict the panel shows.
        self.assertIn("provider unavailable", payload["error"])
        # The old line named the one repair that cannot help here.
        self.assertNotIn("missing key or SDK/CLI", payload["error"])


class BaseUrlValidationTests(unittest.TestCase):
    def test_a_credentialed_endpoint_is_refused_and_never_echoed(self) -> None:
        with self.assertRaises(LLMError) as ctx:
            validate_base_url("https://user:hunter2@gw.example.com/v1", setting="OPENAI_BASE_URL")
        message = str(ctx.exception)
        self.assertEqual(ctx.exception.subtype, "invalid_base_url")
        self.assertNotIn("hunter2", message)
        self.assertNotIn("user", message)

    def test_the_shape_rules_match_the_typescript_half(self) -> None:
        for bad in ("", "   ", "not-a-url", "ftp://example.com", "file:///etc/passwd", "https://"):
            with self.subTest(url=bad), self.assertRaises(LLMError):
                validate_base_url(bad, setting="OPENAI_BASE_URL")
        self.assertEqual(
            validate_base_url("http://localhost:11434/v1/", setting="OLLAMA_BASE_URL"),
            "http://localhost:11434/v1",
        )
        # A unix-domain socket is as on-box as an endpoint gets — offline.py already
        # blesses these schemes, so the shape check must not seal them off.
        self.assertTrue(validate_base_url("http+unix://%2Ftmp%2Fvllm.sock", setting="x"))

    def test_env_supplied_base_urls_are_validated_too(self) -> None:
        """The gap this closes: only the TS write path checked, so an endpoint set
        through the environment reached the SDK unexamined."""
        cases = {
            "openai": "OPENAI_BASE_URL",
            "ollama": "OLLAMA_BASE_URL",
            "qwen": "QWEN_BASE_URL",
            "openrouter": "OPENROUTER_BASE_URL",
        }
        for name, var in cases.items():
            with self.subTest(provider=name), env(**{var: "https://k:secret@proxy.example.com/v1"}):
                provider = _adapter(name, api_key="k")
                with mock.patch.object(TextProvider, "_load_env", lambda self: None):
                    self.assertEqual(provider.availability(), (False, "invalid_base_url"))

    def test_azure_validates_its_resource_endpoint(self) -> None:
        provider = ADAPTERS["azure_openai"](model="dep", api_key="k", endpoint="res.openai.azure.com")
        self.assertEqual(provider.availability(), (False, "invalid_base_url"))

    def test_endpoint_host_keeps_only_the_host(self) -> None:
        self.assertEqual(
            endpoint_host("https://user:pw@api.openai.com:8443/v1?key=abc"),
            "https://api.openai.com:8443",
        )
        self.assertIsNone(endpoint_host(None))

    def test_the_offline_block_message_prints_the_host_only(self) -> None:
        provider = _adapter("ollama", base_url="https://cloud.example.com/v1?token=sekrit")
        with env(KP_OFFLINE="1"), mock.patch.object(TextProvider, "_load_env", lambda self: None):
            with self.assertRaises(LLMError) as ctx:
                provider.complete("hello")
        message = str(ctx.exception)
        self.assertEqual(ctx.exception.subtype, "offline_egress_blocked")
        self.assertNotIn("sekrit", message)
        # The endpoint is quoted as scheme://host and nothing else — no path, no
        # query string (the loopback example later in the message keeps its path).
        self.assertIn("'https://cloud.example.com'", message)


class SharedResolverTests(unittest.TestCase):
    def test_the_openai_family_resolves_base_urls_from_one_implementation(self) -> None:
        """Four byte-identical ``_resolved_base_url`` copies is how the offline gate
        went missing from one adapter once — the difference is declarations now."""
        for name in ("ollama", "qwen", "openrouter", "azure_openai"):
            with self.subTest(provider=name):
                self.assertNotIn("_resolved_base_url", vars(ADAPTERS[name]) if name != "azure_openai" else {})
        defaults = {
            "openai": None,
            "ollama": "http://localhost:11434/v1",
            "qwen": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            "openrouter": "https://openrouter.ai/api/v1",
        }
        for name, expected in defaults.items():
            with self.subTest(provider=name), env(
                OPENAI_BASE_URL=None, OLLAMA_BASE_URL=None, QWEN_BASE_URL=None, OPENROUTER_BASE_URL=None
            ):
                provider = _adapter(name)
                with mock.patch.object(TextProvider, "_load_env", lambda self: None):
                    self.assertEqual(provider._resolved_base_url(), expected)

    def test_the_keyless_rule_is_declared_not_re_implemented(self) -> None:
        keyless = {name: ADAPTERS[name]._base_url_implies_keyless for name in ("openai", "ollama", "qwen", "openrouter")}
        self.assertEqual(keyless, {"openai": True, "ollama": True, "qwen": False, "openrouter": False})


class EnvLoadedOncePerInstanceTests(unittest.TestCase):
    def _counting_provider(self):
        calls: list[int] = []

        class Counting(TextProvider):
            name = "counting"
            _env_keys = ("NOPE_KEY",)

            def _call(self, prompt, *, system, timeout):  # pragma: no cover - never reached
                raise AssertionError("not used")

        provider = Counting(model="m")
        original = TextProvider._load_env

        def counted(self):
            calls.append(1)
            return original(self)

        return provider, calls, counted

    def test_the_env_is_read_once_however_often_a_key_is_resolved(self) -> None:
        provider, calls, _ = self._counting_provider()
        with mock.patch(
            "pipeline.jobfit.llm.base.load_local_env", side_effect=lambda: calls.append(1)
        ):
            for _ in range(5):
                provider._resolved_key()
        self.assertEqual(len(calls), 1, "the .env file cannot change mid-process; read it once")

    def test_concurrent_resolution_loads_the_env_exactly_once(self) -> None:
        """map() resolves keys from a ThreadPoolExecutor, so the memo has to hold
        under threads, not just in a loop."""
        provider, calls, _ = self._counting_provider()
        lock = threading.Lock()

        def slow_loader():
            with lock:
                calls.append(1)

        with mock.patch("pipeline.jobfit.llm.base.load_local_env", side_effect=slow_loader):
            threads = [threading.Thread(target=provider._resolved_key) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(len(calls), 1)

    def test_azure_resolves_its_endpoint_through_the_patchable_seam(self) -> None:
        """azure_openai called module-level load_local_env() directly, so it neither
        memoized nor honoured the per-adapter patch point every other adapter uses."""
        provider = ADAPTERS["azure_openai"](model="dep", api_key="k")
        seen: list[int] = []
        with mock.patch(
            "pipeline.jobfit.llm.adapters.azure_openai.load_local_env", side_effect=lambda: seen.append(1)
        ), env(AZURE_OPENAI_ENDPOINT=None):
            provider._resolved_endpoint()
            provider._resolved_endpoint()
        self.assertEqual(len(seen), 1)


class ResultShapeGuard(unittest.TestCase):
    """Non-vacuity for the module: LLMResult still imports and the adapters are real."""

    def test_adapters_are_the_registered_ones(self) -> None:
        self.assertTrue(issubclass(ADAPTERS["openai"], TextProvider))
        self.assertEqual(LLMResult(text="t", provider="p", model="m").text, "t")


if __name__ == "__main__":
    unittest.main()
