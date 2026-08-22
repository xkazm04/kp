"""Offline tests for KP_LLM_CONFIG parsing + use case → provider resolution."""

from __future__ import annotations

import json
import os
import unittest
from contextlib import contextmanager
from unittest import mock

from pipeline.jobfit.claude_cli import ClaudeCliProvider
from pipeline.jobfit.llm import LLMError, resolve_provider
from pipeline.jobfit.llm.adapters import (
    AnthropicProvider,
    AzureOpenAIProvider,
    GeminiProvider,
    OllamaProvider,
    OpenAIProvider,
    QwenProvider,
)
from pipeline.jobfit.llm.config import ENV_VAR, load_config


@contextmanager
def llm_config(value):
    """Set (or clear, with None) KP_LLM_CONFIG for the duration of the block."""
    payload = json.dumps(value) if isinstance(value, (dict, list)) else value
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop(ENV_VAR, None)
        if payload is not None:
            os.environ[ENV_VAR] = payload
        yield


class DefaultPathTest(unittest.TestCase):
    def test_no_config_returns_claude_cli(self) -> None:
        with llm_config(None):
            provider = resolve_provider("match_reasoning", timeout=120)
        self.assertIsInstance(provider, ClaudeCliProvider)
        self.assertEqual(provider.timeout, 120)
        self.assertIsNone(provider.model)

    def test_unlisted_use_case_falls_back_to_cli(self) -> None:
        with llm_config({"useCases": {"automation": {"provider": "openai"}}}):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, ClaudeCliProvider)

    def test_explicit_claude_cli_row(self) -> None:
        cfg = {
            "useCases": {
                "match_reasoning": {
                    "provider": "claude_cli",
                    "model": "sonnet",
                    "params": {"timeoutS": 90},
                }
            }
        }
        with llm_config(cfg):
            provider = resolve_provider("match_reasoning", timeout=120)
        self.assertIsInstance(provider, ClaudeCliProvider)
        self.assertEqual(provider.model, "sonnet")
        self.assertEqual(provider.timeout, 90)


class RoutingTest(unittest.TestCase):
    def test_anthropic_gets_default_model(self) -> None:
        with llm_config({"useCases": {"match_reasoning": {"provider": "anthropic"}}}):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, AnthropicProvider)
        self.assertEqual(provider.model, "claude-haiku-4-5")

    def test_explicit_model_wins(self) -> None:
        cfg = {"useCases": {"match_reasoning": {"provider": "anthropic", "model": "claude-sonnet-4-6"}}}
        with llm_config(cfg):
            provider = resolve_provider("match_reasoning")
        self.assertEqual(provider.model, "claude-sonnet-4-6")

    def test_quality_use_case_steps_up_default_model(self) -> None:
        with llm_config({"useCases": {"campaign_pack": {"provider": "anthropic"}}}):
            provider = resolve_provider("campaign_pack")
        self.assertEqual(provider.model, "claude-sonnet-4-6")

    def test_wildcard_routes_unlisted_use_cases(self) -> None:
        with llm_config({"useCases": {"*": {"provider": "openai"}}}):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, OpenAIProvider)
        self.assertEqual(provider.model, "gpt-5.4-mini")

    def test_specific_row_beats_wildcard(self) -> None:
        cfg = {
            "useCases": {
                "*": {"provider": "openai"},
                "match_reasoning": {"provider": "gemini"},
            }
        }
        with llm_config(cfg):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, GeminiProvider)
        self.assertEqual(provider.model, "gemini-3.6-flash")

    def test_params_and_keys_flow_into_adapter(self) -> None:
        cfg = {
            "useCases": {
                "match_reasoning": {
                    "provider": "anthropic",
                    "params": {"maxTokens": 4096, "timeoutS": 60},
                }
            },
            "keys": {"anthropic": {"apiKey": "sk-test"}},
        }
        with llm_config(cfg):
            provider = resolve_provider("match_reasoning", timeout=120)
        self.assertEqual(provider.max_tokens, 4096)
        self.assertEqual(provider.timeout, 60)
        self.assertEqual(provider.api_key, "sk-test")

    def test_ollama_requires_explicit_model(self) -> None:
        # Ollama models are addressed by local tag — no built-in default.
        with llm_config({"useCases": {"match_reasoning": {"provider": "ollama"}}}):
            with self.assertRaises(LLMError):
                resolve_provider("match_reasoning")

    def test_ollama_routes_with_tag_and_base_url(self) -> None:
        cfg = {
            "useCases": {"match_reasoning": {"provider": "ollama", "model": "lfm2.5:8b"}},
            "keys": {"ollama": {"baseUrl": "http://gpu-box:11434/v1"}},
        }
        with llm_config(cfg):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, OllamaProvider)
        self.assertEqual(provider.model, "lfm2.5:8b")
        self.assertEqual(provider._resolved_base_url(), "http://gpu-box:11434/v1")

    def test_ollama_defaults_to_local_server(self) -> None:
        with llm_config({"useCases": {"match_reasoning": {"provider": "ollama", "model": "lfm2.5:8b"}}}):
            provider = resolve_provider("match_reasoning")
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OLLAMA_BASE_URL", None)
            with mock.patch.object(OllamaProvider, "_load_env", lambda self: None):
                self.assertEqual(provider._resolved_base_url(), "http://localhost:11434/v1")

    def test_qwen_requires_explicit_model_and_routes_by_slug(self) -> None:
        # Qwen Cloud models are addressed by slug — no built-in default.
        with llm_config({"useCases": {"match_reasoning": {"provider": "qwen"}}}):
            with self.assertRaises(LLMError):
                resolve_provider("match_reasoning")
        cfg = {
            "useCases": {"match_reasoning": {"provider": "qwen", "model": "deepseek-v4-flash-0731"}},
            "keys": {"qwen": {"apiKey": "sk-test"}},
        }
        with llm_config(cfg):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, QwenProvider)
        self.assertEqual(provider.model, "deepseek-v4-flash-0731")
        self.assertEqual(provider.api_key, "sk-test")

    def test_azure_requires_explicit_model(self) -> None:
        with llm_config({"useCases": {"match_reasoning": {"provider": "azure_openai"}}}):
            with self.assertRaises(LLMError):
                resolve_provider("match_reasoning")

    def test_azure_endpoint_and_version_from_keys(self) -> None:
        cfg = {
            "useCases": {"match_reasoning": {"provider": "azure_openai", "model": "my-dep"}},
            "keys": {
                "azure_openai": {
                    "apiKey": "k",
                    "endpoint": "https://res.openai.azure.com",
                    "apiVersion": "2024-10-21",
                }
            },
        }
        with llm_config(cfg):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, AzureOpenAIProvider)
        self.assertEqual(provider.model, "my-dep")
        self.assertEqual(provider.endpoint, "https://res.openai.azure.com")
        self.assertEqual(provider.api_version, "2024-10-21")


class ProductionDefaultTest(unittest.TestCase):
    """Non-dev (NODE_ENV=production) prefers the Gemini Flash tier when no
    use-case config exists AND Gemini can actually serve — a cloud box rarely
    has the Claude CLI. Keyless deployments keep the unchanged CLI default."""

    def test_production_defaults_to_gemini_when_available(self) -> None:
        with llm_config(None):
            with mock.patch.dict(os.environ, {"NODE_ENV": "production"}):
                with mock.patch.object(GeminiProvider, "available", lambda self: True):
                    provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, GeminiProvider)
        self.assertEqual(provider.model, "gemini-3.6-flash")

    def test_production_keyless_keeps_claude_cli(self) -> None:
        with llm_config(None):
            with mock.patch.dict(os.environ, {"NODE_ENV": "production"}):
                with mock.patch.object(GeminiProvider, "available", lambda self: False):
                    provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, ClaudeCliProvider)

    def test_production_explicit_claude_cli_row_wins(self) -> None:
        cfg = {"useCases": {"match_reasoning": {"provider": "claude_cli"}}}
        with llm_config(cfg):
            with mock.patch.dict(os.environ, {"NODE_ENV": "production"}):
                with mock.patch.object(GeminiProvider, "available", lambda self: True):
                    provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, ClaudeCliProvider)

    def test_dev_never_consults_gemini(self) -> None:
        with llm_config(None):
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("NODE_ENV", None)
                with mock.patch.object(GeminiProvider, "available", lambda self: True):
                    provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, ClaudeCliProvider)

    def _production_default(self, use_case: str):
        with llm_config(None):
            with mock.patch.dict(os.environ, {"NODE_ENV": "production"}):
                with mock.patch.object(GeminiProvider, "available", lambda self: True):
                    return resolve_provider(use_case)

    def test_production_default_carries_the_use_case_max_tokens(self) -> None:
        """The heavy-output headroom (capabilities.USE_CASE_MAX_TOKENS) must apply on
        the config-less production default too.

        Pre-fix _production_gemini_default built the adapter without max_tokens, so a
        cloud deployment with GEMINI_API_KEY and no KP_LLM_CONFIG row ran EVERY use
        case at the base 2048 cost cap — exactly the truncation USE_CASE_MAX_TOKENS
        exists to prevent (the payload is cut, complete_json burns its one repair
        re-prompt, and the deterministic template ships after two paid calls)."""
        from pipeline.jobfit.llm.capabilities import USE_CASE_MAX_TOKENS

        for use_case, expected in (
            ("weight_proposal", USE_CASE_MAX_TOKENS["weight_proposal"]),
            ("jd_ingest", USE_CASE_MAX_TOKENS["jd_ingest"]),
            ("campaign_pack", USE_CASE_MAX_TOKENS["campaign_pack"]),
        ):
            with self.subTest(use_case=use_case):
                provider = self._production_default(use_case)
                self.assertIsInstance(provider, GeminiProvider)
                self.assertEqual(provider.max_tokens, expected)

    def test_production_default_keeps_the_base_cap_for_light_use_cases(self) -> None:
        # No USE_CASE_MAX_TOKENS row → the base cost cap stays in force.
        from pipeline.jobfit.llm.base import DEFAULT_MAX_TOKENS

        provider = self._production_default("match_reasoning")
        self.assertEqual(provider.max_tokens, DEFAULT_MAX_TOKENS)


class ValidationTest(unittest.TestCase):
    def test_invalid_json_raises(self) -> None:
        with llm_config("{not json"):
            with self.assertRaises(LLMError):
                resolve_provider("match_reasoning")

    def test_unknown_provider_raises(self) -> None:
        with llm_config({"useCases": {"match_reasoning": {"provider": "mistral"}}}):
            with self.assertRaises(LLMError):
                resolve_provider("match_reasoning")

    def test_missing_provider_field_raises(self) -> None:
        with llm_config({"useCases": {"match_reasoning": {}}}):
            with self.assertRaises(LLMError):
                resolve_provider("match_reasoning")

    def test_capability_mismatch_raises(self) -> None:
        # cv_analysis needs file_input; the text-only CLI can't serve it even
        # when explicitly configured.
        with llm_config({"useCases": {"cv_analysis": {"provider": "claude_cli"}}}):
            with self.assertRaises(LLMError):
                resolve_provider("cv_analysis")

    def test_cv_analysis_raises_for_text_only_adapters(self) -> None:
        # llm-provider-layer #1: openai/anthropic/gemini adapters in this layer are
        # text-only (the real multimodal path lives in gemini.py), so routing the
        # file-input cv_analysis case to them must fail loud, not silently drop the CV
        # and analyze an empty prompt. Previously they advertised file_input and were
        # waved through.
        for provider in ("openai", "anthropic", "gemini", "azure_openai"):
            with self.subTest(provider=provider):
                with llm_config({"useCases": {"cv_analysis": {"provider": provider}}}):
                    with self.assertRaises(LLMError):
                        resolve_provider("cv_analysis")

    def test_wildcard_cannot_silently_degrade_multimodal(self) -> None:
        with llm_config({"useCases": {"*": {"provider": "claude_cli"}}}):
            with self.assertRaises(LLMError):
                resolve_provider("cv_analysis")
        # …while text use cases still resolve through the same wildcard.
        with llm_config({"useCases": {"*": {"provider": "claude_cli"}}}):
            provider = resolve_provider("match_reasoning")
        self.assertIsInstance(provider, ClaudeCliProvider)


class LoadConfigTest(unittest.TestCase):
    def test_absent_env_is_none(self) -> None:
        self.assertIsNone(load_config({}))

    def test_blank_env_is_none(self) -> None:
        self.assertIsNone(load_config({ENV_VAR: "   "}))

    def test_param_coercion(self) -> None:
        cfg = load_config(
            {
                ENV_VAR: json.dumps(
                    {
                        "useCases": {
                            "x": {"provider": "openai", "params": {"maxTokens": "2048", "timeoutS": -5}}
                        }
                    }
                )
            }
        )
        entry = cfg.for_use_case("x")
        self.assertEqual(entry.max_tokens, 2048)
        self.assertIsNone(entry.timeout_s)


if __name__ == "__main__":
    unittest.main()
