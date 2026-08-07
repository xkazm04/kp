"""Capability matrix: which provider can serve which use case.

Providers are not interchangeable for every job — search grounding is
Gemini-only, the Claude CLI is text-only. The registry validates routing at
resolve time, so a wildcard config entry can't silently route ``cv_analysis``
to a text-only provider (it raises instead, and the caller's deterministic
fallback takes over only for *runtime* failures, never for misconfiguration).
"""

from __future__ import annotations

CAP_JSON = "json"
CAP_FILE_INPUT = "file_input"
CAP_GROUNDING = "grounding"

# NOTE: CAP_FILE_INPUT is intentionally NOT advertised by the anthropic/openai/
# azure_openai/gemini rows even though those vendors support multimodal input.
# Every adapter in THIS layer implements only text `_call(prompt: str, ...)` — the
# real multimodal CV path still lives in gemini.py (until Phase 3). Advertising the
# cap here green-lit routing `cv_analysis`/`profile_extract` to a provider whose
# adapter silently drops the attachment and analyzes an empty prompt — the exact
# misconfiguration this matrix exists to prevent. Re-add CAP_FILE_INPUT to a row
# ONLY when that provider's `_call` actually attaches files (llm-provider-layer #1).
PROVIDER_CAPABILITIES: dict[str, frozenset[str]] = {
    "anthropic": frozenset({CAP_JSON}),
    "openai": frozenset({CAP_JSON}),
    "azure_openai": frozenset({CAP_JSON}),
    "gemini": frozenset({CAP_JSON, CAP_GROUNDING}),
    "claude_cli": frozenset({CAP_JSON}),
    # OpenRouter serves the JSON/text use cases via prompt-embedded JSON; file input
    # varies per proxied model, so it is not advertised here.
    "openrouter": frozenset({CAP_JSON}),
    # Local/on-box models through Ollama's OpenAI-compatible /v1 endpoint.
    "ollama": frozenset({CAP_JSON}),
    # Qwen Cloud (DashScope-intl compatible mode) — Qwen family + hosted
    # third-party models by slug, one key. Text/JSON only here.
    "qwen": frozenset({CAP_JSON}),
}

# The use-case catalog (docs/architecture/llm-provider-layer.md). Unknown use cases default
# to {json} so new text call sites work without touching this file; the rows
# here exist to (a) gate multimodal/grounded cases and (b) document the set.
USE_CASE_REQUIREMENTS: dict[str, frozenset[str]] = {
    "match_reasoning": frozenset({CAP_JSON}),
    "automation": frozenset({CAP_JSON}),
    "campaign_pack": frozenset({CAP_JSON}),
    "jd_ingest": frozenset({CAP_JSON}),
    "profile_draft": frozenset({CAP_JSON}),
    "group_compare": frozenset({CAP_JSON}),
    "devcase_analyze": frozenset({CAP_JSON}),
    "devcase_role_design": frozenset({CAP_JSON}),
    "devcase_case_design": frozenset({CAP_JSON}),
    "devcase_reflect": frozenset({CAP_JSON}),
    "devcase_tooling": frozenset({CAP_JSON}),
    "devcase_evaluate": frozenset({CAP_JSON}),
    "devcase_transfer": frozenset({CAP_JSON}),
    "devcase_judge": frozenset({CAP_JSON}),
    "devcase_interview_scenario": frozenset({CAP_JSON}),
    "devcase_seed": frozenset({CAP_JSON}),
    "weight_proposal": frozenset({CAP_JSON}),
    "interview_scorecard": frozenset({CAP_JSON}),
    # Agent-candidate bridge: the job → AgentFitSpec transform (agentfit.py).
    "agent_fit": frozenset({CAP_JSON}),
    "github_analysis": frozenset({CAP_JSON}),
    "cv_analysis": frozenset({CAP_FILE_INPUT}),
    "profile_extract": frozenset({CAP_FILE_INPUT}),
}

# Provider defaults when a config row names a provider but no model. Azure has
# no default on purpose: the model IS the customer's deployment name.
DEFAULT_MODELS: dict[str, str | None] = {
    "anthropic": "claude-haiku-4-5",
    "openai": "gpt-5-mini",
    "gemini": "gemini-3.6-flash",
    "azure_openai": None,
    "claude_cli": None,  # the CLI's configured default
    # OpenRouter models are addressed by slug — always explicit, like Azure deployments.
    "openrouter": None,
    # Ollama models are addressed by local tag (`lfm2.5:8b`) — always explicit.
    "ollama": None,
    # Qwen Cloud models are addressed by slug — always explicit, like OpenRouter.
    "qwen": None,
}

# Quality-sensitive use cases step up a model class when no model is pinned.
USE_CASE_MODEL_OVERRIDES: dict[tuple[str, str], str] = {
    ("campaign_pack", "anthropic"): "claude-sonnet-4-6",
    ("devcase_analyze", "anthropic"): "claude-sonnet-4-6",
    ("devcase_role_design", "anthropic"): "claude-sonnet-4-6",
    ("devcase_case_design", "anthropic"): "claude-sonnet-4-6",
}


def default_model(use_case: str, provider: str) -> str | None:
    return USE_CASE_MODEL_OVERRIDES.get((use_case, provider)) or DEFAULT_MODELS.get(provider)


def unsupported_caps(use_case: str, provider: str) -> frozenset[str]:
    """Capabilities ``use_case`` requires that ``provider`` lacks (empty = ok)."""
    required = USE_CASE_REQUIREMENTS.get(use_case, frozenset({CAP_JSON}))
    return required - PROVIDER_CAPABILITIES.get(provider, frozenset())
