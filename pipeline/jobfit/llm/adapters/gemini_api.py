"""Gemini adapter (``google-genai`` SDK, already a project dependency).

Text via the shared ``_call`` contract, plus ``complete_document`` — the
``file_input``/``grounding`` verb the CV analysis rides (Phase 3 fold-in,
docs/specs/2026-08-30-cv-analysis-fold-in.md). The document path delegates to
``gemini.grounded_answer`` with THIS adapter's model and BYOM key threaded in,
so the offline seal, bounded retry, truncation handling, and usage-ledger
metering are the same engine on both doors. Reuses gemini.py's usage extraction
so token accounting stays identical across both paths.
"""

from __future__ import annotations

from typing import Any, Sequence

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

    def complete_document(
        self,
        prompt: str,
        *,
        file: tuple[bytes, str] | None = None,
        use_grounding: bool = False,
        response_mime_type: str | None = None,
        expected_keys: Sequence[str] = (),
        temperature: float = 0.1,
        max_output_tokens: int = 8000,
    ) -> Any:
        """The ``file_input`` verb (capability DECLARED in capabilities.py).

        Delegates to ``gemini.grounded_answer`` — the proven multimodal engine —
        with this adapter's model and key threaded in, so a config row's model
        pin and BYOM key finally reach the CV analysis. The engine meters under
        this instance's ``use_case`` label and enforces KP_OFFLINE itself.
        Late module-attribute dispatch (``gemini.grounded_answer``) keeps the
        tests' patch point intact.
        """
        from google.genai import types

        from ... import gemini

        parts = [types.Part.from_bytes(data=file[0], mime_type=file[1])] if file else []
        return gemini.grounded_answer(
            prompt=prompt,
            parts=parts,
            response_mime_type=response_mime_type,
            use_grounding=use_grounding,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            parse_json=True,
            expected_keys=expected_keys,
            use_case=self.use_case,
            model=self.model,
            api_key=self.api_key,
        )
