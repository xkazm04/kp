"""E-SH-4: KP_OFFLINE gates cloud LLM engines (pipeline/jobfit/llm/offline.py).

Offline mode blocks the cloud adapters (→ deterministic fallback) while leaving an
explicitly-configured self-hosted endpoint (OpenAI base_url, Azure endpoint) usable.
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
)
from pipeline.jobfit.llm.offline import is_offline


@contextmanager
def offline(on: bool = True):
    with mock.patch.dict(os.environ, {}, clear=False):
        if on:
            os.environ["KP_OFFLINE"] = "1"
        else:
            os.environ.pop("KP_OFFLINE", None)
        yield


class IsOfflineTest(unittest.TestCase):
    def test_truthy_and_falsey(self) -> None:
        for value in ("1", "true", "TRUE", "yes", "on", " on "):
            self.assertTrue(is_offline({"KP_OFFLINE": value}))
        for value in ("", "0", "false", "no", "off"):
            self.assertFalse(is_offline({"KP_OFFLINE": value}))
        self.assertFalse(is_offline({}))


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

    def test_claude_cli_blocked_offline(self) -> None:
        # The CLI reaches Anthropic via a subprocess (no fetch), so the Python gate
        # must block it regardless of whether the binary is on PATH.
        provider = ClaudeCliProvider()
        with mock.patch("shutil.which", return_value="/usr/bin/claude"):
            with offline():
                self.assertFalse(provider.available())
            with offline(False):
                self.assertTrue(provider.available())


class OfflineAllowsSelfHostedTest(unittest.TestCase):
    def test_openai_with_base_url_allowed_offline(self) -> None:
        provider = OpenAIProvider(model="llama3", base_url="http://ollama:11434/v1")
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertTrue(provider.available())

    def test_azure_with_endpoint_allowed_offline(self) -> None:
        provider = AzureOpenAIProvider(
            model="my-dep", api_key="k", endpoint="https://res.openai.azure.com"
        )
        with mock.patch.object(AzureOpenAIProvider, "_import_sdk", return_value=True):
            with offline():
                self.assertTrue(provider.available())


if __name__ == "__main__":
    unittest.main()
