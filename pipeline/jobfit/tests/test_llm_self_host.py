"""E-SH-5: self-hosted OpenAI-compatible endpoints (docs/architecture/self-hosting.md).

The OpenAI adapter can target vLLM / Ollama / LiteLLM / an in-VPC proxy via a
`base_url` from KP_LLM_CONFIG (keys.openai.baseUrl) or the OPENAI_BASE_URL env, and
runs keyless (those endpoints usually need no API key). This keeps candidate data
and inference inside the customer's network — the enterprise self-host requirement.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from pipeline.jobfit.llm import resolve_provider
from pipeline.jobfit.llm.adapters import AzureOpenAIProvider, OpenAIProvider
from pipeline.jobfit.llm.config import ENV_VAR, load_config
from pipeline.jobfit.tests._helpers import env as shared_env


# The LLM vars this module isolates. Every `env(...)` below starts from all three
# unset, so a test that forgets one cannot be answered by the developer's shell.
_LLM_VARS = (ENV_VAR, "OPENAI_BASE_URL", "OPENAI_API_KEY")


def env(**overrides):
    """Isolate the LLM-related env vars for the block; None clears one."""
    return shared_env(*_LLM_VARS, **overrides)


class BaseUrlResolutionTest(unittest.TestCase):
    def test_base_url_from_config_threads_to_adapter(self) -> None:
        cfg = {
            "useCases": {"match_reasoning": {"provider": "openai", "model": "llama3"}},
            "keys": {"openai": {"apiKey": "k", "baseUrl": "http://vllm:8000/v1"}},
        }
        with env(**{ENV_VAR: json.dumps(cfg)}):
            provider = resolve_provider("match_reasoning")
            self.assertIsInstance(provider, OpenAIProvider)
            self.assertEqual(provider.base_url, "http://vllm:8000/v1")
            self.assertEqual(provider._resolved_base_url(), "http://vllm:8000/v1")

    def test_base_url_falls_back_to_env(self) -> None:
        cfg = {"useCases": {"match_reasoning": {"provider": "openai", "model": "llama3"}}}
        with env(**{ENV_VAR: json.dumps(cfg), "OPENAI_BASE_URL": "http://ollama:11434/v1"}):
            provider = resolve_provider("match_reasoning")
            self.assertIsNone(provider.base_url)
            self.assertEqual(provider._resolved_base_url(), "http://ollama:11434/v1")

    def test_config_base_url_beats_env(self) -> None:
        cfg = {
            "useCases": {"match_reasoning": {"provider": "openai", "model": "m"}},
            "keys": {"openai": {"baseUrl": "http://configured/v1"}},
        }
        with env(**{ENV_VAR: json.dumps(cfg), "OPENAI_BASE_URL": "http://env/v1"}):
            provider = resolve_provider("match_reasoning")
            self.assertEqual(provider._resolved_base_url(), "http://configured/v1")

    def test_config_parses_base_url(self) -> None:
        cfg = load_config({ENV_VAR: json.dumps({"keys": {"openai": {"baseUrl": "http://x/v1"}}})})
        self.assertEqual(cfg.keys["openai"].base_url, "http://x/v1")


class KeylessAvailabilityTest(unittest.TestCase):
    def test_available_without_key_when_base_url_set(self) -> None:
        provider = OpenAIProvider(model="m", base_url="http://ollama:11434/v1")
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True), env():
            self.assertTrue(provider.available())

    def test_not_available_without_key_or_base_url(self) -> None:
        provider = OpenAIProvider(model="m")
        with mock.patch.object(OpenAIProvider, "_import_sdk", return_value=True), env():
            self.assertFalse(provider.available())


class AzureIsolationTest(unittest.TestCase):
    def test_azure_ignores_openai_base_url_env(self) -> None:
        # A stray OPENAI_BASE_URL must never re-route Azure traffic.
        provider = AzureOpenAIProvider(model="dep", endpoint="https://r.openai.azure.com")
        with env(**{"OPENAI_BASE_URL": "http://ollama:11434/v1"}):
            self.assertIsNone(provider._resolved_base_url())


class MakeClientTest(unittest.TestCase):
    def _fake_openai(self, recorded: dict):
        module = mock.MagicMock()

        def ctor(**kwargs):
            recorded.update(kwargs)
            return mock.MagicMock()

        module.OpenAI = ctor
        return module

    def test_passes_base_url_and_placeholder_key(self) -> None:
        recorded: dict = {}
        provider = OpenAIProvider(model="m", base_url="http://ollama:11434/v1")
        with mock.patch.dict("sys.modules", {"openai": self._fake_openai(recorded)}), env():
            provider._make_client(30)
        self.assertEqual(recorded["base_url"], "http://ollama:11434/v1")
        self.assertEqual(recorded["api_key"], "not-needed")

    def test_real_key_beats_placeholder(self) -> None:
        recorded: dict = {}
        provider = OpenAIProvider(model="m", api_key="sk-real", base_url="http://x/v1")
        with mock.patch.dict("sys.modules", {"openai": self._fake_openai(recorded)}), env():
            provider._make_client(30)
        self.assertEqual(recorded["api_key"], "sk-real")


try:
    import openai as _openai_sdk  # noqa: F401

    _OPENAI_SDK = True
except ImportError:
    _OPENAI_SDK = False


@unittest.skipUnless(_OPENAI_SDK, "openai SDK not installed")
class LiveEndpointTest(unittest.TestCase):
    """End-to-end: the real openai SDK against a stub OpenAI-compatible server,
    keyless, proving base_url routing works through the whole adapter."""

    def test_completion_routes_to_self_hosted_endpoint(self) -> None:
        import http.server
        import threading

        received: dict = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):  # silence
                pass

            def do_POST(self):
                length = int(self.headers.get("content-length", 0))
                raw = self.rfile.read(length) if length else b""
                received["path"] = self.path
                received["auth"] = self.headers.get("authorization")
                received["body"] = json.loads(raw) if raw else None
                payload = json.dumps(
                    {
                        "id": "chatcmpl-stub",
                        "object": "chat.completion",
                        "model": "local-model",
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": "PONG from self-host"},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7},
                    }
                ).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            provider = OpenAIProvider(model="local-model", base_url=f"http://127.0.0.1:{port}/v1", timeout=10)
            with env():  # no OPENAI_API_KEY → exercises the keyless path
                self.assertTrue(provider.available())
                result = provider.complete("ping")
            self.assertEqual(result.text, "PONG from self-host")
            self.assertEqual(result.provider, "openai")
            self.assertEqual(result.model, "local-model")
            self.assertEqual(result.usage["input_tokens"], 3)
            self.assertEqual(received["path"], "/v1/chat/completions")
            self.assertEqual(received["body"]["model"], "local-model")
            self.assertEqual(received["auth"], "Bearer not-needed")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
