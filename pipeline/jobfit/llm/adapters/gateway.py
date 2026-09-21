"""LightTrack gateway adapter — ``lt-gateway``, the OpenAI-compatible endpoint on
localhost that fronts the seat-metered CLIs (``claude -p`` on a Claude seat,
``codex exec`` on a ChatGPT seat) and fails over between them on a usage limit.

The model on the wire is a ROUTE NAME, and the route is named after the use case
(``gateway.toml`` at the repo root: ``[routes.match_reasoning]``), so a config row
``{"provider": "gateway"}`` needs no model — ``capabilities.default_model`` hands
back the use-case key. The gateway ignores the api key (any non-empty string), so
the adapter is keyless like Ollama; ``LIGHTTRACK_GATEWAY_URL`` moves the endpoint.

What stays with the app: the prompt-embedded JSON guard, ``expected_keys`` pinning,
``_extract_json`` and the one repair re-prompt (all inherited). What moves to the
gateway: retry-and-fallback across seats, and the LightTrack event per attempt —
so this adapter does NOT emit to LightTrack itself (``_emits_lighttrack = False``);
two rows per call would be a double count. The durable usage ledger is still
written, with ``model`` = the target that actually answered (the gateway's
``x-lighttrack-served-by``), never the route name.

Two policies the loopback hop must NOT slip past, because the seats behind it
are Anthropic's and OpenAI's clouds:

- ``KP_OFFLINE``: the endpoint is on-box, the egress is not. ``_allowed_offline``
  answers False, so an air-gapped install drops to the deterministic fallback
  exactly as it does for the cloud adapters.
- Consumer terms: ``claude -p`` bills a consumer Claude seat and ``codex exec`` a
  ChatGPT seat — the engines ``claude_cli.consumer_terms_blocked`` refuses in
  production. This adapter is another route to them and meets the same veto,
  with the same reason and the same ``KP_ALLOW_CLI_ENGINE`` unlock.

The gateway's own contract (what it routes, records and fails over) is documented
in the LightTrack repo: https://github.com/xkazm04/lighttrack/blob/main/docs/GATEWAY.md"""

from __future__ import annotations

import threading
from typing import Any, Sequence

# Re-exported so the base's ``_load_env`` dispatch (and tests that patch it on this
# module) resolve it here — same reason openai_api re-exports it.
from ...claude_cli import CONSUMER_TERMS_REASON, cli_engine_unlocked, is_production_deployment
from ..base import load_local_env  # noqa: F401
from .openai_api import OpenAIProvider

_DEFAULT_BASE_URL = "http://127.0.0.1:8792/v1"

# Typed output schemas per use case, sent as ``response_format: json_schema`` so the
# gateway enforces the shape through the engine's schema path (``--json-schema`` on
# claude, ``--output-schema`` on codex). A use case absent here still gets
# ``json_object`` whenever ``complete_json`` runs, which the gateway turns into a
# system instruction. Shapes mirror bench/contracts.py; keep them in step.
_STR_LIST = {"type": "array", "items": {"type": "string"}}
USE_CASE_SCHEMAS: dict[str, dict[str, Any]] = {
    "match_reasoning": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string"},
            "strengths": _STR_LIST,
            "gaps": _STR_LIST,
            "interviewProbes": _STR_LIST,
        },
        "required": ["verdict", "strengths", "gaps", "interviewProbes"],
        "additionalProperties": False,
    },
}


class GatewayProvider(OpenAIProvider):
    name = "gateway"
    _env_keys = ()
    _base_url_env = ("LIGHTTRACK_GATEWAY_URL",)
    _default_base_url = _DEFAULT_BASE_URL
    _base_url_implies_keyless = True
    # The gateway records every attempt itself ("What it records" in the gateway doc
    # linked above); a second row from here would be a double count.
    _emits_lighttrack = False

    def __init__(self, *, model: str | None = None, use_case: str | None = None, **kwargs: Any) -> None:
        # The route IS the use case; a bare ``model=None`` is not a missing model here.
        super().__init__(model=model or use_case or "", use_case=use_case, **kwargs)
        # Per-call response_format, threaded from complete_json into _call without
        # widening the base's ``_call`` signature. Thread-local because map() drives
        # complete() from a pool and a plain attribute would leak one call's schema
        # into another's.
        self._fmt = threading.local()

    # -- policy: the hop is local, the seats are not ---------------------------

    def _allowed_offline(self) -> bool:
        # The base would green-light 127.0.0.1 as on-box. The prompt does not stay
        # there: the gateway forwards it to a Claude or ChatGPT seat in the cloud.
        return False

    def consumer_terms_blocked(self) -> bool:
        """Same veto as ``claude_cli``: consumer seats, in production, un-unlocked."""
        return is_production_deployment() and not cli_engine_unlocked()

    def availability(self) -> tuple[bool, str | None]:
        if self.consumer_terms_blocked():
            return False, CONSUMER_TERMS_REASON
        return super().availability()

    # -- wire shape --------------------------------------------------------------

    def _request_extras(self) -> dict[str, Any]:
        fmt = getattr(self._fmt, "response_format", None)
        return {"response_format": fmt} if fmt else {}

    def _served_model(self, resp: Any) -> str:
        # ``model`` on the reply is the target that answered (``provider/model@effort``),
        # which is what the ledger should say a seat was spent on. Falls back to the
        # route name only if the gateway sent none.
        return str(getattr(resp, "model", None) or self.model)

    def _cost_of(self, resp: Any, input_tokens: int, output_tokens: int) -> float | None:
        # Unpriced, on purpose. Both seats behind the gateway are subscription-metered:
        # Codex reports no dollars, and the Claude CLI envelope reports an API-rate
        # figure the operator never pays per call. Writing that figure for one seat and
        # null for the other would mix a notional price with "unpriced" for identical
        # billing (ADR 0008). The route name would never prefix-match MTOK_PRICES either.
        return None

    def complete_json(
        self,
        prompt: str,
        *,
        system: str | None = None,
        timeout: int | None = None,
        expected_keys: Sequence[str] | None = None,
    ) -> Any:
        schema = USE_CASE_SCHEMAS.get(self.use_case or "")
        if schema is not None:
            fmt: dict[str, Any] = {
                "type": "json_schema",
                "json_schema": {"name": self.use_case, "schema": schema},
            }
        else:
            fmt = {"type": "json_object"}
        self._fmt.response_format = fmt
        try:
            return super().complete_json(prompt, system=system, timeout=timeout, expected_keys=expected_keys)
        finally:
            self._fmt.response_format = None
