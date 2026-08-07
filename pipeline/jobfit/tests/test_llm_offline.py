"""E-SH-4: KP_OFFLINE gates cloud LLM engines (pipeline/jobfit/llm/offline.py).

Offline mode blocks the cloud adapters (→ deterministic fallback) while leaving a
genuinely **on-box / private** endpoint (a loopback / unix-socket / private-network
OpenAI-compatible base_url, e.g. Ollama or vLLM) usable. Crucially, a base_url — or
Azure endpoint — that resolves to a *public* cloud host is NOT trusted merely because
it was configured: it is sealed off exactly like the default cloud path, so a stray
``OPENAI_BASE_URL=https://api.openai.com/v1`` can never defeat the no-egress seal.
"""

from __future__ import annotations

import os
import unittest
from contextlib import contextmanager
from unittest import mock

from pipeline.jobfit.claude_cli import ClaudeCliProvider
from pipeline.jobfit.llm.adapters import (
    AnthropicProvider,
    AzureOpenAIProvider,
    GeminiProvider,
    OpenAIProvider,
    OpenRouterProvider,
)
from pipeline.jobfit.llm.base import LLMError
from pipeline.jobfit.llm.offline import is_local_url, is_offline


@contextmanager
def offline(on: bool = True, **env):
    """KP_OFFLINE on/off, plus optional extra env vars (None clears one)."""
    with mock.patch.dict(os.environ, {}, clear=False):
        # Isolate the base-URL env so ambient .env values can't skew resolution.
        for key in ("OPENAI_BASE_URL", "OPENROUTER_BASE_URL", "AZURE_OPENAI_ENDPOINT"):
            os.environ.pop(key, None)
        if on:
            os.environ["KP_OFFLINE"] = "1"
        else:
            os.environ.pop("KP_OFFLINE", None)
        for key, value in env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield


class IsOfflineTest(unittest.TestCase):
    def test_truthy_and_falsey(self) -> None:
        for value in ("1", "true", "TRUE", "yes", "on", " on "):
            self.assertTrue(is_offline({"KP_OFFLINE": value}))
        for value in ("", "0", "false", "no", "off"):
            self.assertFalse(is_offline({"KP_OFFLINE": value}))
        self.assertFalse(is_offline({}))


class IsLocalUrlTest(unittest.TestCase):
    """The host classifier the offline seal turns on — on-box/private vs. cloud."""

    def test_loopback_and_private_are_local(self) -> None:
        for url in (
            "http://localhost:11434/v1",
            "http://127.0.0.1:8000/v1",
            "http://127.5.5.5/v1",
            "http://[::1]:11434/v1",
            "http://10.1.2.3:8000/v1",
            "http://192.168.0.9/v1",
            "http://172.16.4.4:9000/v1",
            "http://169.254.1.1/v1",
            "localhost:11434",  # bare host:port, no scheme
            "http://ollama:11434/v1",  # single-label container/service name
            "http://vllm:8000/v1",
            "http://inference.internal/v1",
            "http://box.local:8080/v1",
            "unix:///var/run/ollama.sock",
            "http+unix://%2Fvar%2Frun%2Follama.sock/v1",
        ):
            self.assertTrue(is_local_url(url), url)

    def test_public_hosts_are_not_local(self) -> None:
        for url in (
            "https://api.openai.com/v1",
            "https://openrouter.ai/api/v1",
            "https://res.openai.azure.com",
            "https://generativelanguage.googleapis.com",
            "https://8.8.8.8/v1",
            "https://evil-proxy.example.com/v1",
            None,
            "",
            "   ",
        ):
            self.assertFalse(is_local_url(url), url)


class OfflineBlocksCloudTest(unittest.TestCase):
    """With a key present + the SDK importable, the ONLY reason available() is False
    is the offline gate — so these assertions isolate KP_OFFLINE's effect."""

    def test_gemini_blocked_offline(self) -> None:
        provider = GeminiProvider(model="gemini-3-flash-preview", api_key="k")
        with mock.patch.object(GeminiProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertFalse(provider.available())
            with offline(False):
                self.assertTrue(provider.available())

    def test_anthropic_blocked_offline(self) -> None:
        provider = AnthropicProvider(model="claude-haiku-4-5", api_key="k")
        with mock.patch.object(AnthropicProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertFalse(provider.available())
            with offline(False):
                self.assertTrue(provider.available())

    def test_openai_cloud_blocked_offline(self) -> None:
        # No base_url → would call api.openai.com → blocked offline.
        provider = OpenAIProvider(model="gpt-5-mini", api_key="k")
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertFalse(provider.available())

    def test_openrouter_blocked_offline(self) -> None:
        # OpenRouter's default endpoint is openrouter.ai (cloud) → blocked offline.
        provider = OpenRouterProvider(model="x/y", api_key="k")
        with mock.patch.object(OpenRouterProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertFalse(provider.available())
            with offline(False):
                self.assertTrue(provider.available())

    def test_claude_cli_blocked_offline(self) -> None:
        # The CLI reaches Anthropic via a subprocess (no fetch), so the Python gate
        # must block it regardless of whether the binary is on PATH.
        provider = ClaudeCliProvider()
        with mock.patch("shutil.which", return_value="/usr/bin/claude"):
            with offline():
                self.assertFalse(provider.available())
            with offline(False):
                self.assertTrue(provider.available())


class OfflineCloudBaseUrlIsSealedTest(unittest.TestCase):
    """Finding #1: a cloud base_url must NOT defeat the seal (the load-bearing gap).

    Against the pre-fix code OpenAIProvider.available() short-circuited to
    _import_sdk() whenever a base_url resolved, so every assertFalse below returned
    True and the complete() calls fired a real request to api.openai.com — this is
    exactly what these tests now catch.
    """

    def test_cloud_base_url_arg_refused_offline(self) -> None:
        provider = OpenAIProvider(
            model="gpt-5-mini", api_key="k", base_url="https://api.openai.com/v1"
        )
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                # available() must fail closed (pre-fix: returned True).
                self.assertFalse(provider.available())
                # ...and a direct complete() must raise a clear KP_OFFLINE error
                # BEFORE building any client (pre-fix: no guard → real egress).
                with mock.patch.object(OpenAIProvider, "_call") as call:
                    with self.assertRaises(LLMError) as ctx:
                        provider.complete("leak my CV please")
                    self.assertIn("KP_OFFLINE", str(ctx.exception))
                    self.assertEqual(ctx.exception.subtype, "offline_egress_blocked")
                    call.assert_not_called()  # never reached the network seam

    def test_cloud_base_url_from_env_refused_offline(self) -> None:
        # The exact finding scenario: a leftover OPENAI_BASE_URL in the environment.
        provider = OpenAIProvider(model="gpt-5-mini", api_key="k")
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline(OPENAI_BASE_URL="https://api.openai.com/v1"):
                self.assertEqual(
                    provider._resolved_base_url(), "https://api.openai.com/v1"
                )
                self.assertFalse(provider.available())

    def test_forwarding_proxy_refused_offline(self) -> None:
        # A public forwarding proxy is not on-box either.
        provider = OpenAIProvider(
            model="m", api_key="k", base_url="https://proxy.example.com/v1"
        )
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertFalse(provider.available())


class OfflineAllowsOnBoxEndpointTest(unittest.TestCase):
    def test_openai_localhost_allowed_offline(self) -> None:
        # The task's on-box allowed case: a genuinely local model server.
        provider = OpenAIProvider(model="llama3", base_url="http://localhost:11434/v1")
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertTrue(provider.available())

    def test_openai_container_hostname_allowed_offline(self) -> None:
        # A Docker/K8s service name (single label) is on-box, too.
        provider = OpenAIProvider(model="llama3", base_url="http://ollama:11434/v1")
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertTrue(provider.available())

    def test_openrouter_local_proxy_allowed_offline(self) -> None:
        provider = OpenRouterProvider(model="x/y", api_key="k")
        with mock.patch.object(OpenRouterProvider, "_import_sdk", return_value=True):
            with offline(OPENROUTER_BASE_URL="http://127.0.0.1:4000/v1"):
                self.assertTrue(provider.available())

    def test_azure_cloud_endpoint_blocked_offline(self) -> None:
        # A public *.openai.azure.com endpoint IS off-box egress → sealed off (the
        # same host rule as any other adapter; pre-fix Azure allowed it).
        provider = AzureOpenAIProvider(
            model="my-dep", api_key="k", endpoint="https://res.openai.azure.com"
        )
        with mock.patch.object(AzureOpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertFalse(provider.available())

    def test_azure_loopback_endpoint_allowed_offline(self) -> None:
        provider = AzureOpenAIProvider(
            model="my-dep", api_key="k", endpoint="http://localhost:8080"
        )
        with mock.patch.object(AzureOpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertTrue(provider.available())


class NonOfflineUnchangedTest(unittest.TestCase):
    """With KP_OFFLINE unset the seal is inert — the cloud path works as before."""

    def test_cloud_base_url_available_when_not_offline(self) -> None:
        provider = OpenAIProvider(
            model="gpt-5-mini", api_key="k", base_url="https://api.openai.com/v1"
        )
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline(False):
                self.assertTrue(provider.available())

    def test_complete_reaches_call_when_not_offline(self) -> None:
        from pipeline.jobfit.llm.base import LLMResult

        provider = OpenAIProvider(
            model="gpt-5-mini", api_key="k", base_url="https://api.openai.com/v1"
        )
        sentinel = LLMResult(text="ok", provider="openai", model="gpt-5-mini")
        with offline(False):
            with mock.patch.object(OpenAIProvider, "_call", return_value=sentinel) as call:
                result = provider.complete("hello")
        self.assertEqual(result.text, "ok")
        call.assert_called_once()


if __name__ == "__main__":
    unittest.main()
