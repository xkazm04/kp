"""Gemini text adapter (``google-genai`` SDK, already a project dependency).

Text-in/text-out only: the multimodal + grounded CV-analysis path stays in
gemini.py until Phase 3 folds it in behind the file_input/grounding
capabilities. Reuses gemini.py's usage extraction so token accounting stays
identical across both paths.
"""

from __future__ import annotations

from typing import Any

from .. import monitor

# load_local_env imported so the base's _load_env dispatch (and the tests that
# patch it on this module) resolve it here; _resolved_key/available live in base.
from ..base import LLMError, LLMResult, TextProvider, load_local_env, price_usd  # noqa: F401


class GeminiProvider(TextProvider):
    name = "gemini"
    _env_keys = ("GEMINI_API_KEY", "GOOGLE_API_KEY")
    _sdk_module = "google.genai"

    def _make_client(self, timeout: int) -> Any:
        from google import genai
        from google.genai import types

        return genai.Client(
            api_key=self._resolved_key(),
            http_options=types.HttpOptions(timeout=timeout * 1000),
        )

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        from google.genai import types

        from ...gemini import _finish_reason, _usage_metadata

        client = self._make_client(timeout)
        config_kwargs: dict[str, Any] = {"max_output_tokens": self.max_tokens}
        if system and system.strip():
            config_kwargs["system_instruction"] = system.strip()
        resp = client.models.generate_content(
            model=self.model,
            contents=[prompt],
            config=types.GenerateContentConfig(**config_kwargs),
        )

        try:
            text = resp.text or ""
        except ValueError:  # blocked/empty candidates make .text raise
            text = ""
        usage = _usage_metadata(resp)
        input_tokens = int(usage.get("prompt_tokens", 0) or 0)
        output_tokens = int(usage.get("candidate_tokens", 0) or 0)
        normalized_usage = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cached_tokens": int(usage.get("cached_tokens", 0) or 0),
        }
        cost_usd = price_usd(self.model, input_tokens, output_tokens)

        if not text.strip():
            # No usable output — a safety/recitation block, or a stop with no parts.
            # Returning text="" here handed the base a SUCCESSFUL LLMResult, so the
            # blocked call was metered as a healthy completion and every plain
            # complete() caller (intake.run_voice_turn, the eval personas) took the
            # empty string as the model's real answer. Same class the OpenAI
            # adapter's _raise_on_error_response already closes for empty choices
            # and content filters — raise a typed error instead.
            #
            # Google bills the prompt for a blocked response, so record the spend
            # BEFORE failing (the ordering gemini.py's production path uses:
            # _meter_success runs before parsing). The base then emits the error on
            # top — the same success-then-error pair complete_json emits when a
            # paid completion comes back unusable.
            monitor.emit_result(
                provider=self.name,
                model=self.model,
                use_case=self.use_case,
                usage=normalized_usage,
                cost_usd=cost_usd,
            )
            reason = _finish_reason(resp) or "no candidates"
            raise LLMError(
                f"{self.name} returned no text (finish_reason={reason}) — the "
                f"response was blocked or empty, not an answer",
                provider=self.name,
                subtype="empty_response",
            )

        return LLMResult(
            text=text,
            provider=self.name,
            model=self.model,
            usage=normalized_usage,
            cost_usd=cost_usd,
        )
