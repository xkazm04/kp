"""OpenAI Chat Completions adapter (official ``openai`` SDK).

Also serves any **OpenAI-compatible** endpoint via ``base_url`` — the enterprise
self-host path (docs/architecture/self-hosting.md, E-SH-5): point it at Azure OpenAI's
OpenAI-compatible gateway, vLLM, Ollama (``/v1``), LiteLLM, or an in-VPC proxy so
inference never leaves the customer's network. The base URL comes from
``KP_LLM_CONFIG`` (keys.<provider>.baseUrl) or the ``OPENAI_BASE_URL`` env var; such
endpoints frequently need no API key, so availability rides on the endpoint, not a
key (a placeholder key is supplied to the SDK, which requires a non-empty value)."""

from __future__ import annotations

import os
from typing import Any

# load_local_env imported so the base's _load_env dispatch (and the tests that
# patch it on this module) resolve it here; _resolved_key/available live in base.
from ..base import DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_S, LLMError, LLMResult, TextProvider, load_local_env, price_usd  # noqa: F401


class OpenAIProvider(TextProvider):
    name = "openai"
    _env_keys = ("OPENAI_API_KEY",)
    _sdk_module = "openai"

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        base_url: str | None = None,
        use_case: str | None = None,
    ) -> None:
        super().__init__(model=model, api_key=api_key, timeout=timeout, max_tokens=max_tokens, use_case=use_case)
        # Optional OpenAI-compatible endpoint (self-hosted / in-VPC inference).
        self.base_url = base_url

    def _resolved_base_url(self) -> str | None:
        """Configured base URL → OPENAI_BASE_URL env → None (api.openai.com)."""
        if self.base_url:
            return self.base_url
        self._load_env()
        return os.getenv("OPENAI_BASE_URL") or None

    def _offline_egress_url(self) -> str | None:
        # Under KP_OFFLINE the on-box check runs against THIS host: a loopback /
        # on-box base_url is allowed, a cloud one (or none → api.openai.com) is
        # sealed off. Closes the gap where a stray cloud OPENAI_BASE_URL used to
        # be trusted merely because it resolved.
        return self._resolved_base_url()

    def available(self) -> bool:
        # Hard no-egress mode FIRST: a base_url that points off-box must not fire
        # even keyless — that is the whole point of KP_OFFLINE. _allowed_offline()
        # (base) green-lights only a genuinely on-box base_url.
        if self._offline_blocked():
            return False
        # A self-hosted OpenAI-compatible endpoint may require no key (vLLM/Ollama),
        # so when one is configured, availability rides on the SDK being importable
        # rather than a resolved key. The default OpenAI path still requires a key.
        if self._resolved_base_url():
            return self._import_sdk()
        return super().available()

    def _make_client(self, timeout: int) -> Any:
        import openai

        base_url = self._resolved_base_url()
        # max_retries=0: TextProvider.complete owns the retry policy. The SDK rejects
        # a missing api_key even for keyless local endpoints, so pass a placeholder
        # when none is configured and a base_url is in play.
        return openai.OpenAI(
            api_key=self._resolved_key() or ("not-needed" if base_url else None),
            base_url=base_url,
            timeout=float(timeout),
            max_retries=0,
        )

    @staticmethod
    def _error_message(err_obj: Any) -> str:
        """Best-effort human message from a gateway's top-level error (dict from a
        raw body, or an SDK/pydantic object exposing ``.message``/``.code``)."""
        if isinstance(err_obj, dict):
            return str(err_obj.get("message") or err_obj.get("code") or err_obj)
        msg = getattr(err_obj, "message", None) or getattr(err_obj, "code", None)
        return str(msg or err_obj)

    def _raise_on_error_response(self, resp: Any) -> None:
        """Raise a typed LLMError for a 200-with-error / empty-choices / filtered
        response instead of letting the base meter it as a paid success.
        bug-ui-scan-2026-07-09 (llm-provider-layer-python #3)."""
        err_obj = getattr(resp, "error", None)
        if err_obj:
            raise LLMError(
                f"{self.name} returned a 200 with a provider error: "
                f"{self._error_message(err_obj)}",
                provider=self.name,
                subtype="provider_error",
            )
        choices = getattr(resp, "choices", None)
        if not choices:
            # No content AND no explicit error object — a proxied model that failed
            # without populating `choices`. Not a real empty-prose answer.
            raise LLMError(
                f"{self.name} returned no choices (empty response body)",
                provider=self.name,
                subtype="empty_choices",
            )
        finish_reason = getattr(choices[0], "finish_reason", None)
        if finish_reason in ("error", "content_filter"):
            raise LLMError(
                f"{self.name} finished with reason {finish_reason!r} (no usable output)",
                provider=self.name,
                subtype=finish_reason,
            )

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        client = self._make_client(timeout)
        messages: list[dict[str, str]] = []
        if system and system.strip():
            messages.append({"role": "system", "content": system.strip()})
        messages.append({"role": "user", "content": prompt})

        resp = client.chat.completions.create(
            model=self.model,
            messages=messages,
            # max_completion_tokens (not the legacy max_tokens) — required by
            # reasoning-class models and accepted by the rest.
            max_completion_tokens=self.max_tokens,
        )

        # bug-ui-scan-2026-07-09 (llm-provider-layer-python #3): an OpenAI-compatible
        # gateway — notably OpenRouter — can answer HTTP 200 whose body carries a
        # top-level {"error": ...} and/or no usable choices when the proxied model
        # errors (provider outage, moderation, credit issue). The old code coerced
        # that to text="" and the base then recorded a metered SUCCESS + ledger line,
        # so a provider-side error read as a healthy (billed) completion and only
        # tripped later as a downstream parse failure — after also burning the
        # complete_json self-repair re-prompt. Detect it and raise a typed LLMError so
        # it emits as an error (never metered as paid) and complete_json skips repair.
        self._raise_on_error_response(resp)

        choice = resp.choices[0] if getattr(resp, "choices", None) else None
        text = (getattr(getattr(choice, "message", None), "content", None) or "") if choice else ""
        usage = getattr(resp, "usage", None)
        input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        details = getattr(usage, "prompt_tokens_details", None)
        cached = int(getattr(details, "cached_tokens", 0) or 0)
        return LLMResult(
            text=text,
            provider=self.name,
            model=self.model,
            usage={
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cached_tokens": cached,
            },
            # Stamp cost when the model is priced (base.MTOK_PRICES). Azure
            # subclasses this _call but its deployment-name models don't prefix-
            # match, so they stay cost_usd=None by design (priced server-side).
            cost_usd=price_usd(self.model, input_tokens, output_tokens),
        )
