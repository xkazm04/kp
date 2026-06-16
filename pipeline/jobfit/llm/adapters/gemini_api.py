"""Gemini text adapter (``google-genai`` SDK, already a project dependency).

Text-in/text-out only: the multimodal + grounded CV-analysis path stays in
gemini.py until Phase 3 folds it in behind the file_input/grounding
capabilities. Reuses gemini.py's usage extraction so token accounting stays
identical across both paths.
"""

from __future__ import annotations

from typing import Any

# load_local_env imported so the base's _load_env dispatch (and the tests that
# patch it on this module) resolve it here; _resolved_key/available live in base.
from ..base import LLMResult, TextProvider, load_local_env  # noqa: F401


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

        from ...gemini import _usage_metadata

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
        return LLMResult(
            text=text,
            provider=self.name,
            model=self.model,
            usage={
                "input_tokens": int(usage.get("prompt_tokens", 0) or 0),
                "output_tokens": int(usage.get("candidate_tokens", 0) or 0),
                "cached_tokens": int(usage.get("cached_tokens", 0) or 0),
            },
        )
