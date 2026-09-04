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
from ..base import DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_S, LLMError, LLMResult, TextProvider, load_local_env, price_usd, validate_base_url  # noqa: F401


class OpenAIProvider(TextProvider):
    """The OpenAI-compatible family's base. Ollama, OpenRouter, Qwen and Azure all
    subclass it, and what actually differs between them is three declarations, not
    three method bodies - each used to carry a byte-identical ``_resolved_base_url``
    (four copies) and ``available`` (two), which is how the offline gate went missing
    from one of them for a while (test_llm_offline.py's 2026-08-22 audit note).
    Declare the attributes; inherit the behaviour."""

    name = "openai"
    _env_keys = ("OPENAI_API_KEY",)
    _sdk_module = "openai"
    # Env vars an unset ``base_url`` falls back to, first-set-wins.
    _base_url_env: tuple[str, ...] = ("OPENAI_BASE_URL",)
    # Endpoint when neither config nor env names one. None = the SDK's own default
    # (api.openai.com), which is also what makes this provider key-gated below.
    _default_base_url: str | None = None
    # Whether a configured endpoint stands in for a key. True for the self-hosted
    # path (vLLM / Ollama / LM Studio authenticate nothing); False for a cloud
    # gateway that always needs one, where a base URL only moves the endpoint.
    _base_url_implies_keyless = True

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
        """Configured base URL → the adapter's env var(s) → its default endpoint.

        Every source is shape-checked HERE (``validate_base_url``), including the
        environment: the TypeScript write path validated a base URL saved through the
        Models panel, but ``OPENAI_BASE_URL`` / ``OLLAMA_BASE_URL`` / … were read raw
        and handed straight to the SDK - and an endpoint with credentials in its
        userinfo then rode into the offline-block message verbatim. Raises
        ``LLMError`` (subtype ``invalid_base_url``) for a malformed one;
        ``availability()`` turns that into a descent, ``complete()`` lets it fly."""
        if self.base_url:
            return validate_base_url(self.base_url, setting=f"{self.name} baseUrl")
        self._load_env()
        for env_key in self._base_url_env:
            value = os.getenv(env_key)
            if value:
                return validate_base_url(value, setting=env_key)
        return self._default_base_url

    def _offline_egress_url(self) -> str | None:
        # Under KP_OFFLINE the on-box check runs against THIS host: a loopback /
        # on-box base_url is allowed, a cloud one (or none → api.openai.com) is
        # sealed off. Closes the gap where a stray cloud OPENAI_BASE_URL used to
        # be trusted merely because it resolved.
        return self._resolved_base_url()

    def availability(self) -> tuple[bool, str | None]:
        """One rule for the whole family, parameterized by the declarations above.

        Hard no-egress mode gates everything that follows it: a base_url pointing
        off-box must not fire even keyless - that is the whole point of KP_OFFLINE,
        and ``_allowed_offline()`` (base) green-lights only a genuinely on-box
        endpoint. Then, for the
        self-hosted path, a configured endpoint stands in for the key (vLLM/Ollama
        authenticate nothing); the cloud gateways declare
        ``_base_url_implies_keyless = False`` and fall through to the base rule -
        which is exactly the two-line check OpenRouter and Qwen each hand-wrote.

        The endpoint is resolved ONCE, inside the guard. ``_offline_blocked()``
        resolves the same URL (via ``_offline_egress_url``), so running it before
        the ``try`` put the shape check outside the only handler that catches it:
        under KP_OFFLINE an endpoint with credentials in its userinfo threw
        ``invalid_base_url`` straight out of ``availability()``, past
        ``registry.provider_availability`` - the door every CLI reads its descent
        reason from - and into the CLI's catch-all, where a routing question became
        an engine_error and the deterministic fallback that offline mode exists to
        preserve never served. ``available()`` masked it (it swallows LLMError), so
        only the reason-carrying door was affected."""
        try:
            base_url = self._resolved_base_url()
        except LLMError as exc:
            if exc.subtype != "invalid_base_url":
                raise
            # Degrade rather than raise: availability is a routing yes/no. The
            # actionable error still fires on the call path (_make_client resolves
            # the same URL), so a misconfiguration is never silently swallowed.
            # Reported ahead of the offline policy deliberately: an unusable
            # endpoint is the operator's actual repair, and KP_OFFLINE would seal
            # it off anyway once it parses.
            return False, "invalid_base_url"
        # Hard no-egress mode, through the base's one seam (never re-implemented
        # here - a second copy of this rule is how it went missing from an adapter
        # before). Safe to call now: it re-resolves the same endpoint, which has
        # just been shown to parse.
        if self._offline_blocked():
            return False, "offline_policy"
        if self._base_url_implies_keyless and base_url:
            return (True, None) if self._import_sdk() else (False, "sdk_missing")
        return super().availability()

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
