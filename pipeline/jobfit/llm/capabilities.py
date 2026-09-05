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
# azure_openai rows even though those vendors support multimodal input. Their
# adapters implement only text `_call(prompt: str, ...)` — advertising the cap
# green-lit routing `cv_analysis`/`profile_extract` to a provider whose adapter
# silently drops the attachment and analyzes an empty prompt — the exact
# misconfiguration this matrix exists to prevent. Re-add CAP_FILE_INPUT to a row
# ONLY when that provider's adapter actually attaches files (the gemini row earned
# it via `GeminiProvider.complete_document`, the Phase 3 fold-in —
# docs/specs/2026-08-30-cv-analysis-fold-in.md). Declared, never probed: routing
# trusts this row, and the base `complete_document` fails loud if it is wrong.
PROVIDER_CAPABILITIES: dict[str, frozenset[str]] = {
    "anthropic": frozenset({CAP_JSON}),
    "openai": frozenset({CAP_JSON}),
    "azure_openai": frozenset({CAP_JSON}),
    "gemini": frozenset({CAP_JSON, CAP_GROUNDING, CAP_FILE_INPUT}),
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
    # App master: read a repository into a RepoDossier (repo_scan.py). JSON-only,
    # like agent_fit. The IN-REPO reading is a claude_cli-only superpower — every
    # other provider answers from the heuristic dossier carried in the prompt — but
    # that is a quality difference, not a capability the matrix can gate: there is no
    # "runs in your checkout" capability, and declaring one would refuse a perfectly
    # valid grounded refinement. `source` on the dossier stays honest either way.
    "repo_scan": frozenset({CAP_JSON}),
    # Role-intake dialog with a hiring requestor (intake.py) — one JSON turn
    # per exchange (reply + updated RoleBrief).
    "role_intake": frozenset({CAP_JSON}),
    # The FAST voice thread of the intake (run_voice_turn): plain-text spoken
    # utterances at speech pace — pin a fast model here without touching the
    # text dialog's routing. No JSON capability required by design.
    "role_intake_voice": frozenset(),
    # The operator companion's chat turns (companion_cli.py). PROSE, like
    # role_intake_voice: one plain-text reply per turn, no JSON contract, so it
    # requires no capability at all and every provider can serve it.
    "assistant": frozenset(),
    "github_analysis": frozenset({CAP_JSON}),
    "cv_analysis": frozenset({CAP_FILE_INPUT}),
    "profile_extract": frozenset({CAP_FILE_INPUT}),
}

# Provider defaults when a config row names a provider but no model. Azure has
# no default on purpose: the model IS the customer's deployment name.
DEFAULT_MODELS: dict[str, str | None] = {
    "anthropic": "claude-haiku-4-5",
    # gpt-5.4-mini (2026-03-17) superseded gpt-5-mini — same tier, current version.
    "openai": "gpt-5.4-mini",
    "gemini": "gemini-3.8-flash",
    "azure_openai": None,
    "claude_cli": None,  # the CLI's configured default
    # OpenRouter models are addressed by slug — always explicit, like Azure deployments.
    "openrouter": None,
    # Ollama models are addressed by local tag (`lfm2.5:8b`) — always explicit.
    "ollama": None,
    # Qwen Cloud models are addressed by slug — always explicit, like OpenRouter.
    "qwen": None,
}

# Heavy-output use cases: the payload is structurally LARGE (a proposal per
# candidate in one call, ~8 ad variants with video scripts, a full case design),
# so the base DEFAULT_MAX_TOKENS=2048 cost cap TRUNCATES it on API adapters —
# the JSON then fails the coercion boundary and the identical deterministic
# fallback ships instead. The 2026-08-05 bench hit exactly this (scorecard/case
# design stubs judged ~2-3 across three models). These defaults apply when the
# config row sets no explicit params.maxTokens; an explicit pin still wins.
USE_CASE_MAX_TOKENS: dict[str, int] = {
    # The letter/prep tasks all ride "automation": a prep pack (4-6 questions ×
    # 4 filled fields) or an evidence-anchored letter from a verbose model runs
    # past 2048 — deepseek's n=4 bench outputs truncated at exactly the ceiling
    # and shipped the deterministic template 75% of the time.
    "automation": 4096,
    # jd_ingest re-emits the posting as `description` plus structured
    # requirements — long ads truncate at 2048 and the parse dies or drops the
    # requirements list (bench: 0-25% validity on API adapters, CLI unaffected).
    "jd_ingest": 6144,
    # One proposal+rationale per candidate in a single call: ~200-250 output
    # tokens × a 60+ pool. 8192 truncated exactly at the ceiling on the
    # 2026-08-11 bench (the CLI reference run needed ~15.6k).
    "weight_proposal": 16384,
    "campaign_pack": 8192,
    # The companion answers in prose and the reply is capped at ~1200 chars, but
    # the PROMPT carries the constitution, the identity, six recalled episodes and
    # the grounding blob — a provider that reasons before answering runs past the
    # base 2048 and truncates mid-sentence, which reads as the companion trailing off.
    "assistant": 4096,
    "interview_scorecard": 6144,
    "devcase_case_design": 8192,
    "devcase_role_design": 6144,
    "devcase_analyze": 6144,
    "devcase_interview_scenario": 6144,
    "group_compare": 4096,
    # A dossier refinement returns up to 12 risk areas, 12 hot-spot rationales and
    # 6 objectives in one object — past the base 2048 cap, at which point the JSON
    # truncates and the identical heuristic dossier ships instead.
    "repo_scan": 6144,
    # agent_fit re-emits the WHOLE judgement in one object: up to
    # _MAX_COVERAGE_ITEMS=12 {item, coverage, rationale} rows, then a spec whose
    # `systemPromptDraft` is asked for at <=1200 chars and ACCEPTED by the coercer
    # up to 4000 (agentfit.py) — a ready-to-use system prompt is the single
    # largest field this app asks a model to write — plus 2-4 metric objects.
    # Structurally the same 12-rationales-plus-prose shape as `repo_scan` one
    # size down, and it fails the same way: generate_with_fallback coerces the
    # truncated JSON away and ships the keyword-matched deterministic() spec whose
    # verdict is a permanent "unassessed".
    "agent_fit": 4096,
    # profile_draft re-emits DRAFT_SCHEMA whole: 17 keys including UNCAPPED
    # `skill_claims` (3 fields each — a real CV yields 15-30) and `experiences`
    # (5 fields each, one of them prose plus a nested skills list).
    # This row is not an estimate so much as a correction: the DIRECT Gemini path
    # this use case still defaults to already passes max_output_tokens=4000
    # (profile_draft_cli._extract), so before this row a KP_LLM_CONFIG row for
    # profile_draft silently HALVED the budget its own default path had chosen,
    # and the truncated payload raises "AI returned no structured draft" — the
    # operator reads it as "add more detail to the notes", which makes it worse.
    "profile_draft": 4096,
    # Every intake turn returns the reply (capped 1600 chars) AND the ENTIRE
    # updated RoleBrief — summary, responsibilities, success_criteria, plus
    # requirements (8 fields each, incl. a rationale) and facets (7 fields each,
    # incl. a prose value), neither list capped (rolebrief.py). The brief is at
    # its LARGEST on the last turns, so the base cap truncates exactly when the
    # session has the most to lose, and merge_brief then merges a half-object;
    # `extract_transcript` rides the same use case and re-emits that whole brief
    # in ONE shot from a finished voice call. Same "re-emit the whole structured
    # artifact each call" shape as `jd_ingest`, and sized with it.
    "role_intake": 6144,
}

# Use cases DELIBERATELY left on the base cap. A row here is a decision with a
# reason, not an omission — the seven use cases below had no row and no record,
# which is indistinguishable from "nobody looked". ``test_llm_capabilities`` pins
# every use case ``resolve_provider`` is called with to one of these two maps, so
# a NEW call site cannot reach production on an unexamined 2048 cap.
#
# Raising a cap is not free: it is the ceiling a runaway or reasoning-heavy model
# is allowed to bill to, so "just make them all 8192" trades a truncation bug for
# a spend bug. These four earn the base cap on their output contract.
BASE_CAP_BY_DECISION: dict[str, str] = {
    "match_reasoning": (
        "One verdict sentence, 2-4 strengths, 1-4 gaps, 2-3 probes — 11 short "
        "strings at the structural maximum (match_reasoning._coerce), ~600 output "
        "tokens. NOTE the asymmetry worth knowing about: automation.py reaches this "
        "same generator through a provider resolved for `automation` (4096), so the "
        "identical code runs under two caps decided by the CALLER. Both clear the "
        "payload, so this is a curiosity rather than a bug — but a future change "
        "that grows this payload has to move BOTH."
    ),
    "cv_analysis": (
        "This use case does not read this map at all, and a row here would be a "
        "lie a future reader would act on. The analysis rides `complete_document` "
        "(the file_input verb), and gemini.analyze_profile_with_gemini passes "
        "max_output_tokens=16000 explicitly at the call site; GeminiProvider."
        "complete_document forwards that parameter and never consults "
        "self.max_tokens. The cap for the largest payload in the app is therefore "
        "owned by gemini.py, which also raises a named `output_truncated` error "
        "when it is hit — the visibility the base cap lacks. Move that constant, "
        "not this map."
    ),
    "role_intake_voice": (
        "A SPOKEN turn, coerced to MAX_VOICE_REPLY_CHARS=700 (~3 sentences, ~200 "
        "tokens) and resolved with timeout=30 because a slow answer must fall to "
        "the scripted thread rather than stall a live call. The base cap is already "
        "~10x the contract; more room buys nothing and only widens what a model "
        "that reasons aloud may spend before the timeout fires. Judged on the task, "
        "not on symmetry with `role_intake` — the two threads differ precisely in "
        "that this one carries no JSON contract and no brief."
    ),
    "devcase_judge": (
        "A judging seat, and the verdicts are small by construction: "
        "{score, levers<=3, note<=200 chars} (lifecycle_audits), "
        "{score, fairToAiUse, note<=200} (submission_eval), {matchesRole, "
        "note<=160} (role fit), and the bench judge's score + 3 dims + a short "
        "verdict. Every one is capped by its own coercer well under 2048. The seat "
        "also runs FAN-OUT (run_judge maps one call per item), so it is the worst "
        "place in the app to widen a ceiling on speculation."
    ),
}


def default_max_tokens(use_case: str) -> int | None:
    return USE_CASE_MAX_TOKENS.get(use_case)


# The Claude CLI model the JUDGE seat is pinned to when nothing is configured: the same
# cheapest tier DEFAULT_MODELS already names for ``anthropic``.
#
# The VERSIONED id, not the ``haiku`` alias the CLI also accepts. The alias would be
# immune to model retirement, but ``test_llm_base.PriceTest`` requires every routed
# default to resolve a price and prices are keyed by version — an alias would have made
# the judge seat the one routed model whose spend could not be costed, which is a worse
# trade than owning a version bump the catalogue already owns for ``anthropic``.
JUDGE_CLI_MODEL = "claude-haiku-4-5"

# Per-(use case, provider) model defaults that differ from the provider's own.
#
# TWO reasons a seat overrides the provider default, and they pull in OPPOSITE
# directions — which is why they share one map instead of one of them being "the
# quality map":
#
# QUALITY. A structurally large, judgement-heavy generation (a campaign pack, a whole
# case design) steps UP a model class when nothing is pinned.
#
# INDEPENDENCE. ``devcase_judge`` is a fairness/quality GATE over artifacts another
# seat produced (llm_judge.py owns the invariant). With nothing configured, BOTH seats
# fell back to the same engine on the same default — ``claude_cli`` with ``model=None``
# — so ``judge_independence`` reported False on every default install and the product
# self-graded out of the box. The seat is now distinct BY DEFAULT: ``claude_cli/haiku``
# against the generator's ``claude_cli/default``. On ``anthropic`` the collision is the
# same shape one level down (``devcase_evaluate`` has no override, so both seats land on
# DEFAULT_MODELS' ``claude-haiku-4-5``), so the judge takes the cheapest model in the
# catalogue that is DISTINCT from it.
#
# The trade-off is stated rather than hidden: on the CLI the default judge is a cheaper
# tier than the generator, so independence is bought with judge capability. An operator
# who wants a stronger judge pins the seat in Models config — and if they pin it to the
# generator's own model, ``judge_independence`` reports False and the reviewer is told
# instead of the gate quietly certifying itself.
#
# It cannot be fixed for every engine: ``openai``, ``gemini``, ``openrouter``, ``qwen``,
# ``ollama`` and ``azure_openai`` name at most ONE model in this catalogue, so there is
# no distinct default to pick. Those installs report ``independent: false`` honestly
# until the operator pins the seat, which is the correct answer, not a gap.
USE_CASE_MODEL_OVERRIDES: dict[tuple[str, str], str] = {
    ("campaign_pack", "anthropic"): "claude-sonnet-4-6",
    ("devcase_analyze", "anthropic"): "claude-sonnet-4-6",
    ("devcase_role_design", "anthropic"): "claude-sonnet-4-6",
    ("devcase_case_design", "anthropic"): "claude-sonnet-4-6",
    ("devcase_judge", "claude_cli"): JUDGE_CLI_MODEL,
    ("devcase_judge", "anthropic"): "claude-sonnet-4-6",
}


def default_model(use_case: str, provider: str) -> str | None:
    return USE_CASE_MODEL_OVERRIDES.get((use_case, provider)) or DEFAULT_MODELS.get(provider)


def unsupported_caps(use_case: str, provider: str) -> frozenset[str]:
    """Capabilities ``use_case`` requires that ``provider`` lacks (empty = ok)."""
    required = USE_CASE_REQUIREMENTS.get(use_case, frozenset({CAP_JSON}))
    return required - PROVIDER_CAPABILITIES.get(provider, frozenset())
