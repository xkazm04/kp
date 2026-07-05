"""Azure OpenAI adapter. Same wire surface as OpenAI, different client: the
``model`` is the customer's *deployment name*, and the client needs the
resource endpoint + api-version (from provider_keys.meta_json via
KP_LLM_CONFIG, or AZURE_OPENAI_* env vars)."""

from __future__ import annotations

import os
from typing import Any

from ..base import DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_S, load_local_env
from .openai_api import OpenAIProvider

_DEFAULT_API_VERSION = "2024-10-21"


class AzureOpenAIProvider(OpenAIProvider):
    name = "azure_openai"
    # Endpoint + key override stays bespoke (see available()/_make_client below);
    # only the env-key list differs from the OpenAI base.
    _env_keys = ("AZURE_OPENAI_API_KEY",)

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        endpoint: str | None = None,
        api_version: str | None = None,
        use_case: str | None = None,
    ) -> None:
        super().__init__(model=model, api_key=api_key, timeout=timeout, max_tokens=max_tokens, use_case=use_case)
        self.endpoint = endpoint
        self.api_version = api_version

    def _resolved_base_url(self) -> str | None:
        # Azure routes through azure_endpoint (below), never the generic OpenAI
        # base_url. Override to None so it can't pick up OPENAI_BASE_URL from the
        # env and mis-route Azure traffic to a self-hosted OpenAI endpoint.
        return None

    def _resolved_endpoint(self) -> str | None:
        if self.endpoint:
            return self.endpoint
        load_local_env()
        return os.getenv("AZURE_OPENAI_ENDPOINT") or None

    def _resolved_api_version(self) -> str:
        if self.api_version:
            return self.api_version
        return os.getenv("AZURE_OPENAI_API_VERSION") or _DEFAULT_API_VERSION

    def _allowed_offline(self) -> bool:
        # Azure routes to the operator's own configured resource endpoint, so it
        # counts as an explicitly-configured private endpoint under KP_OFFLINE.
        return bool(self._resolved_endpoint())

    def available(self) -> bool:
        return bool(self._resolved_endpoint()) and super().available()

    def _make_client(self, timeout: int) -> Any:
        import openai

        return openai.AzureOpenAI(
            api_key=self._resolved_key(),
            azure_endpoint=self._resolved_endpoint(),
            api_version=self._resolved_api_version(),
            timeout=float(timeout),
            max_retries=0,
        )
