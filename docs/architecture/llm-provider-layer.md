# LLM provider layer — multi-provider wrapper

BYOM (bring-your-own-model) routing: every text-LLM call site — Python
(`pipeline/jobfit/llm/`) and the one TS-side call (`app/_lib/github/code-review.ts`,
served by `app/api/github-analysis/route.ts`)
— resolves through one config, not a hardcoded provider. This is the technical
foundation for the BYOM pricing tier and the usage ledger the pricing meters bill
against (`docs/features/billing/README.md`).

## Status

Backend shipped and in production use:

- `pipeline/jobfit/llm/` — base contract (`base.py`), registry (`registry.py`),
  capability matrix (`capabilities.py`), adapters for all providers below, plus
  `claude_cli.py` as the local/dev default.
- `llm_config` / `provider_keys` / `llm_usage` tables (`app/_lib/db/llm.ts`,
  `app/_lib/db/core.ts`) and `buildLlmConfigEnv()` → the `KP_LLM_CONFIG` JSON env
  var wired into every Python spawn path.
- Headless admin API: `/api/llm/config`, `/api/llm/keys`, `/api/llm/test`,
  `/api/llm/usage` — BYOM keys encrypted at rest (AES-256-GCM under `KP_SECRET`,
  never echoed back after save). UI: **Settings → Models**
  (`app/features/settings/models/ModelsTab.tsx`).
- Most production use cases ported: `match_reasoning`, `automation` (screen/
  outreach/reject/prep/scorecard/rematch), `campaign_pack`, `jd_ingest`,
  `group_compare`, `weight_proposal`, `devcase/*`, `profile_draft`
  (config-gated — its unconfigured default stays the direct Gemini path).
- LightTrack observability (below) and the benchmark suite (below).

**Outstanding:** `cv_analysis` fold-in (needs multimodal + grounding in the
adapters — Gemini remains the only capable provider per `capabilities.py`), a
deliberate bench run to pick metered default models, org-level (per-tenant)
`llm_usage` attribution (tracked in `docs/features/organization/README.md` /
`docs/product/enterprise-readiness.md` §8).

## Adapters (`pipeline/jobfit/llm/adapters/`)

| Adapter | File | Notes |
|---|---|---|
| Anthropic | `anthropic_api.py` | Haiku-class default for small reasoning calls; JSON-schema structured output. |
| OpenAI (+ compatible) | `openai_api.py` | Also serves any **OpenAI-compatible** endpoint via `base_url` (vLLM / Ollama / LiteLLM / in-VPC proxy) — runs **keyless** against them, the enterprise self-host path (see `docs/architecture/self-hosting.md` §5). |
| Azure OpenAI | `azure_openai.py` | Own `endpoint`/`deployment`/`api_version` (from `provider_keys.meta_json`), unaffected by `OPENAI_BASE_URL`. |
| Gemini | `gemini_api.py` | Multimodal (PDF/image) + Google Search grounding; the CV-analysis workhorse. |
| Claude CLI | `pipeline/jobfit/claude_cli.py` | Subprocess provider, **local/dev only** (subscription billing — fine for one dev machine, not for hosted SaaS). |
| OpenRouter | `openrouter.py` | Bench-only adapter — routes many third-party models through one key for the model-matrix comparison (`docs/architecture/llm-model-matrix.md`); not a production routing target. |
| Ollama | `ollama.py` | First-class local/on-box models through Ollama's OpenAI-compatible `/v1`. Keyless (not offered in the keys form); models addressed by tag (`lfm2.5:8b`) with no built-in default; endpoint defaults to `http://localhost:11434/v1`, overridable via `keys.ollama.baseUrl` in `KP_LLM_CONFIG` or the `OLLAMA_BASE_URL` env var. |
| Qwen Cloud | `qwen.py` | qwencloud.com / DashScope-intl **compatible mode** (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, override `QWEN_BASE_URL`). One key (`QWEN_API_KEY`/`DASHSCOPE_API_KEY`) serves the Qwen family plus hosted third-party models (`glm-5.2`, `deepseek-v4-flash-0731`) by explicit slug — an OpenRouter-style gateway that IS a production routing target. |

Every call site already has a deterministic fallback and an envelope
`source: "llm" | "deterministic"` (`reasoning-cache-policy.ts` depends on this
contract) — the wrapper preserves both.

## Capability matrix (`capabilities.py`)

| Capability | gemini | openai | azure_openai | anthropic | claude_cli |
|---|---|---|---|---|---|
| json_schema | done | done | done | done | done (via expected_keys) |
| file_input (PDF/image) | done | done | done | done | no |
| search_grounding | done | no | no | no | no |
| batch `map()` | done | done | done | done | done (process pool) |

The registry rejects (or visibly degrades) a config that routes a use case to a
provider missing a required capability — e.g. `cv_analysis` on OpenAI runs
without salary grounding and the envelope flags `grounding: "unavailable"` so the
UI can show lower confidence.

## Config storage and resolution

SQLite tables (`app/_lib/db/llm.ts`; single workspace today — `workspace_id`
reserved for multi-tenancy, see the organization doc):

- `llm_config(use_case, provider, model, params_json, updated_at)`
- `provider_keys(provider, scope['platform'|'byom'], key_ciphertext, meta_json, updated_at)`
- `llm_usage(id, ts, use_case, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, request_id)`

**Resolution happens on the TS side** (it owns the DB), then flows to Python via
`KP_LLM_CONFIG` (JSON env) on `spawnPython` — Python's `registry.py` only reads
that env, no DB access from Python, no second source of truth.

**Key resolution order:** workspace BYOM key → platform key → provider
unavailable → existing deterministic fallback (`app/_lib/provider-key-precedence.ts`).

**Environment-aware default (no config row):** local dev keeps the Claude CLI,
byte-for-byte the pre-wrapper behavior. Under `NODE_ENV=production` (cloud /
`next start`), `resolve_provider` prefers **Gemini Flash** (`gemini-3.6-flash`)
— but only when Gemini can actually serve (key + SDK resolve; `available()` also
honors `KP_OFFLINE`), so a keyless self-hosted deployment keeps the unchanged
CLI default and its deterministic fallbacks. An explicit config row — including
`claude_cli` — always wins. (`registry._production_gemini_default`; use cases
needing `file_input` are excluded and keep their dedicated `gemini.py` path.)

## Observability — LightTrack (`pipeline/jobfit/llm/monitor.py`)

LLM telemetry goes to **LightTrack** (sibling repo `../LightTrack`, self-hosted):

- Every `TextProvider.complete()` and the registry's `MonitoredClaudeCli` emit one
  event per call: provider, model, tokens (incl. cached), latency, errors, and
  computed `cost_usd` as metadata (LightTrack prices server-side from its own
  price book — the two travel side by side as a cross-check).
- **The use case rides on a `use_case:<name>` tag, NOT `operation`.** LightTrack's
  `operation` is a fixed 4-variant enum (`chat`/`completion`/`embedding`/`other`)
  — an arbitrary string silently deserializes to `other`, collapsing every call
  into one bucket. So `operation` is uniformly `"chat"` (`_OPERATION` in
  `monitor.py`) and the use case is a tag; `cost_summary` groups by
  provider+model, per-use-case slicing is tag-filtered. The Claude CLI engine
  additionally carries `engine:claude_cli` (it reports as provider `anthropic` —
  it *is* Anthropic spend — so subscription vs metered stays separable).
- Direct Gemini paths and the TS github-analysis call (via
  `app/_lib/llm-lighttrack.ts`, the TS counterpart to `monitor.py`) meter through
  the same seam. **Known gap:** the TS seam still assigns the use case to
  `operation`, so TS-originated events collapse to `other` — the Python fix above
  has not been mirrored there yet.
- Activation is double-gated (SDK importable AND `LIGHTTRACK_URL` set); emission
  is fire-and-forget on a daemon thread, exception-swallowed — an observability
  outage can never fail an LLM call.
- Local dev, once: `pip install -e ../LightTrack/clients/python` (editable — kp
  and LightTrack are co-developed). Each session: `pwsh scripts/lighttrack-dev.ps1`
  runs `lighttrack-api` from `../LightTrack` in dev auth mode (no API key), SQLite
  store, `127.0.0.1:8787`. Then set `LIGHTTRACK_URL=http://127.0.0.1:8787` and
  `LIGHTTRACK_PROJECT=kp` in `.env` (both are listed empty in `.env.example`, so a
  copied env leaves telemetry off by default). Inspect with
  `GET /v1/events?project=kp` / `GET /v1/costs?project=kp`.

## Benchmarks (`pipeline/jobfit/llm/bench/`)

Drives the real production functions (same prompts, coercion, fallbacks) over the
seed corpus to pick default models per use case — never in CI (spends tokens).
See `docs/architecture/llm-model-matrix.md` for the latest measured results and
`bake_quality.py` for how results feed the in-app Models-tab scorecard
(`app/_lib/llm-quality.ts`, `app/_lib/llm-quality-scores.ts` — generated, do not
hand-edit).

## Invariants

1. **Deterministic fallbacks stay** — adapter failure never surfaces as a broken
   response; the envelope `source` field stays `llm`/`deterministic`.
2. **Language routing** — `lang` (en/cs) threads through every `LLMRequest`.
3. **Prompt versioning** stays with call sites, not the wrapper.
4. **No silent model drift** — `llm_config` rows are explicit; changing a default
   model is a visible config change.

## Known gaps

- `cv_analysis` / `profile_extract` still Gemini-only (multimodal + grounding not
  yet in the shared adapter contract) — both are listed in the use-case catalog
  but route through the dedicated `gemini.py` path; a config row for them has no
  effect today.
- `grounded_salary` (market salary via `market_salary_cli.py`) also calls
  `gemini.py` directly and is not in the use-case catalog — un-routable.
- Voice (OpenAI Realtime / ElevenLabs) is deliberately outside the provider
  layer: env-configured, per-minute ledger attribution via
  `app/_lib/voice/minute-prices.ts`; its OpenAI key does not use
  `resolveProviderKey`.
- Per-tenant `llm_usage` attribution not built (global ledger today).
- The TS-side github-analysis call honors the BYOM **key** layering and (since
  2026-08-05) a Models-tab **model** re-pin on its gemini row
  (`configuredModelFor`), but it speaks the Gemini SDK only — a provider *swap*
  configured for `github_analysis` is not honored there.
- Spawn-site coverage is pinned by `app/_lib/llm-spawn-contract.test.ts` — every
  TS module spawning an LLM-resolving Python CLI must pass
  `env: buildLlmConfigEnv()` (a 2026-08-05 sweep found four sites where the
  re-route was silently dead: `jd_ingest`, `weight_proposal`, `group_compare`,
  `profile_draft` — all fixed).

## Testing

- `npm run test:unit` for the TS wrapper; `python -m unittest pipeline.jobfit.tests.test_llm_*` for adapters/registry.
- Capability-matrix test: every `llm_config` default must satisfy its use case's required caps.
- Canary path = the Models-tab **Test** button, runs the same code path as production calls.
