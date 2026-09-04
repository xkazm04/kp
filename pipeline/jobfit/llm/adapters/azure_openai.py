"""Azure OpenAI adapter. Same wire surface as OpenAI, different client: the
``model`` is the customer's *deployment name*, and the client needs the
resource endpoint + api-version (from provider_keys.meta_json via
KP_LLM_CONFIG, or AZURE_OPENAI_* env vars)."""

from __future__ import annotations

import os
from typing import Any

# load_local_env re-exported so the base's ``_load_env`` dispatch (and the tests that
# patch it on this module) resolve it HERE - it used to be called directly, which
# bypassed the patchable seam and re-read .env on every endpoint resolution.
from ..base import DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_S, LLMError, load_local_env, validate_base_url  # noqa: F401
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
        """The resource endpoint, shape-checked like any other configured URL.

        Through ``self._load_env()`` (the memoized, per-adapter-patchable seam), not
        a direct ``load_local_env()``: this was the one adapter that bypassed it, so
        it re-read .env on every resolution and ignored the test patch point."""
        if self.endpoint:
            return validate_base_url(self.endpoint, setting="azure_openai endpoint")
        self._load_env()
        value = os.getenv("AZURE_OPENAI_ENDPOINT")
        return validate_base_url(value, setting="AZURE_OPENAI_ENDPOINT") if value else None

    def _resolved_api_version(self) -> str:
        """Through ``self._load_env()``, like its sibling above.

        This was the last env read in the adapter that did not. It happens to work
        today only because ``_make_client`` evaluates ``api_key=self._resolved_key()``
        first and Python evaluates arguments left to right, so .env is already
        loaded by the time this runs — reorder those kwargs and an api-version set
        only in .env.local silently becomes the hardcoded default below, with
        nothing naming the version in the failure."""
        if self.api_version:
            return self.api_version
        self._load_env()
        return os.getenv("AZURE_OPENAI_API_VERSION") or _DEFAULT_API_VERSION

    def _offline_egress_url(self) -> str | None:
        # Azure egresses to its resource endpoint (never the OpenAI base_url), so
        # the KP_OFFLINE on-box check (base._allowed_offline → is_local_url) runs
        # against THAT. A public *.openai.azure.com endpoint is a cloud host →
        # sealed off; only a loopback/on-box endpoint stays usable under offline.
        return self._resolved_endpoint()

    def availability(self) -> tuple[bool, str | None]:
        """Endpoint first, and named: an Azure deployment with a perfectly good key
        cannot route without its resource endpoint, and reporting that as a missing
        key sends the operator to re-check the one thing that was already right.

        Shape-check BEFORE the offline gate, for the reason the OpenAI parent
        documents at length: ``_offline_blocked()`` resolves this same endpoint, so
        running it first threw ``invalid_base_url`` out of a method whose contract
        is to return a reason, past ``registry.provider_availability`` and into the
        caller's catch-all. The reason PRIORITY is unchanged by that reordering -
        invalid_base_url, then offline_policy, then missing_endpoint - because a
        seal that would refuse the call anyway is the honest repair to name, and an
        absent endpoint still reads as offline_policy under the flag (``is_local_url``
        answers False for None, so the seal holds)."""
        try:
            endpoint = self._resolved_endpoint()
        except LLMError as exc:
            if exc.subtype != "invalid_base_url":
                raise
            return False, "invalid_base_url"
        if self._offline_blocked():
            return False, "offline_policy"
        if not endpoint:
            return False, "missing_endpoint"
        return super().availability()

    def _make_client(self, timeout: int) -> Any:
        import openai

        return openai.AzureOpenAI(
            api_key=self._resolved_key(),
            azure_endpoint=self._resolved_endpoint(),
            api_version=self._resolved_api_version(),
            timeout=float(timeout),
            max_retries=0,
        )
