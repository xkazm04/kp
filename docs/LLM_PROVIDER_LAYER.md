# LLM Provider Layer — multi-provider wrapper design

> **Status (2026-06-11):** Phase 1 + Phase 2 backend shipped. Live:
> `pipeline/jobfit/llm/` (base contract, registry, capabilities, all four API
> adapters + Claude CLI default), `match_reasoning` + `automation` ported,
> `llm_config`/`provider_keys`/`llm_usage` tables, `buildLlmConfigEnv()` →
> `KP_LLM_CONFIG` wired into the reasoning + automation spawn paths, headless
> admin API at `/api/llm/config` + `/api/llm/keys` (AES-256-GCM keys under
> `KP_SECRET`). Also live (2026-06-11): LightTrack observability (see
> Observability below) and the Phase 3 benchmark suite (see Benchmarks below).
> **Phase 3 text ports shipped (2026-06-12):** campaign_pack, jd_ingest,
> group_compare, weight_proposal, devcase/* (per-command use cases via
> `_USE_CASE_BY_COMMAND`), and profile_draft (config-gated — its unconfigured
> default stays the direct Gemini path). `/api/llm/test` runs a canary through
> the real resolution path for the Models admin tab. Outstanding: cv_analysis
> fold-in (needs multimodal+grounding in the adapters — Gemini remains the
> only capable provider, as capabilities.py encodes), the TS github-analysis
> wrapper, Phase 4 ledger emission (the `insertLlmUsage` writer exists), and
> a deliberate bench run to pick metered default models.

## Observability — LightTrack (`pipeline/jobfit/llm/monitor.py`)

LLM telemetry goes to **LightTrack** (sibling repo `../tracklight` — the
self-hosted LLM observability + scoring service; kp and LightTrack are
developed together toward prod). The seam:

- Every `TextProvider.complete()` (all metered adapters) and the registry's
  `MonitoredClaudeCli` emit one event per logical call: provider, model,
  tokens (incl. cached), latency, errors, and our computed `cost_usd` as
  metadata (LightTrack prices server-side from its own price book — the two
  travel side by side as a cross-check, e.g. `cost_usd: 0.0039` vs
  `metadata.cost_usd: 0.0099`).
- **The use case rides on a `use_case:<name>` tag, NOT `operation`.**
  LightTrack's `operation` is a fixed 4-variant enum (`chat`/`completion`/
  `embedding`/`other`) — an arbitrary string silently deserializes to `other`,
  which would collapse every kp call. So `operation` is uniformly `"chat"` and
  the use case is a tag (`cost_summary` groups by provider+model; per-use-case
  slicing is tag-filtered). The Claude CLI engine additionally carries
  `engine:claude_cli` (it reports as provider `anthropic` — it *is* Anthropic
  spend — so subscription vs metered stays separable).
- The direct Gemini paths (`gemini.py` grounded/CV analysis and the opt-in
  `embedding_bridge.py` embeddings) meter through the same
  `monitor.emit_result` seam, so no Python provider call escapes it.
- The one provider call that originates in **TypeScript**, not Python — the
  github-analysis deep review (`app/api/github-analysis/route.ts`) — mirrors
  the seam via `app/_lib/llm-lighttrack.ts`, the TS counterpart to `monitor.py`.
  (The voice adapters mint credentials only; the model runs browser-side and is
  metered by minutes, not tokens — it stays in the app's own cost ledger.)
- Activation is double-gated (SDK importable AND `LIGHTTRACK_URL` set);
  emission is fire-and-forget on a daemon thread and exception-swallowed — an
  observability outage can never fail an LLM call.

### Local-dev wiring (resolved 2026-06-17; prod deferred until the product grows)

1. **Once:** `pip install -e ../LightTrack/clients/python` (editable — kp and
   LightTrack are co-developed, so client edits reflect immediately).
2. **Each session:** start the server — `pwsh scripts/lighttrack-dev.ps1` —
   which runs `lighttrack-api` from `../LightTrack` in **dev auth mode** (no API
   key), SQLite store, `127.0.0.1:8787`, foreground in its own terminal.
3. Set in kp's `.env` (already in `.env.example`): `LIGHTTRACK_URL=http://127.0.0.1:8787`
   and `LIGHTTRACK_PROJECT=kp`. Dev mode needs no key; the literal `kp` project
   string is used directly (events have no FK to a registered project, so the
   project list is optional — registering would assign a random id and split
   the rollup).
4. Inspect: `GET /v1/events?project=kp`, `GET /v1/costs?project=kp`, or the
   `lt` CLI / MCP server in the LightTrack repo.

## Benchmarks — picking default models (`pipeline/jobfit/llm/bench/`)

Phase 3 ports get their default models from measurements over **seeded data**,
not vibes. The bench drives the REAL production functions (same prompts,
coercion, fallbacks) over `data/seed_candidates` × the seed job corpus:

```
python -m pipeline.jobfit.llm.bench.bench_cli \
  --use-cases match_reasoning,automation_screen,automation_outreach,automation_rejection,campaign_pack \
  --targets claude_cli,anthropic:claude-haiku-4-5,anthropic:claude-sonnet-4-6,gemini,openai:gpt-5-mini \
  --limit 8 --lang en --out tmp/bench
```

Per (use case × target) it reports: contract **valid-rate** (structural
checks mirroring each module's coercion layer), **llm-rate** (production
swallows provider failures into deterministic fallbacks — a flaky provider
shows up here, not as errors), p50/p95 latency, mean tokens, and total cost.
Outputs: `records.jsonl` + `summary.{json,md}`. Deliberately **never in CI**
(spends tokens); offline tests in `tests/test_llm_bench.py` keep the suite
itself healthy. Quality scoring beyond validity is LightTrack's job: bench
traffic is auto-tracked per use case when `LIGHTTRACK_URL` is set, and
`--include-payloads` keeps payloads in `records.jsonl` for its LLM-as-judge.
Extension points (same builder + contract pattern): automation_prep /
scorecard / offer, jd_ingest, profile_draft, devcase_* steps.

Goal: wrap every LLM call site behind one production-grade provider abstraction supporting
**Gemini, OpenAI, Azure OpenAI, and Anthropic**, with per-use-case model defaults and a
dedicated admin module ("Models") to manage them. This is also the technical foundation for
the BYOM pricing tier (bring-your-own keys, incl. ElevenLabs for voice) and the usage ledger
that the pricing meters bill against.

## Current state (the seams)

| Seam | File | Used by | Notes |
|---|---|---|---|
| `ClaudeCliProvider` | `pipeline/jobfit/claude_cli.py` | match_reasoning, automation (tasks 1–6), campaign, jobs ingest, group_compare, devcase/* (analyze, design, reflect, evaluate, llm_judge), profile_draft, recruiter_cli, seeds | Already a clean protocol: `available()`, `complete()`, `complete_json()`, `map()`. Returns `ClaudeResult` with `cost_usd` + usage. Subscription-based (`claude -p`), strips `ANTHROPIC_API_KEY`. |
| Gemini functions | `pipeline/jobfit/gemini.py` | `pipeline.py` (CV analysis), profile extraction | `analyze_profile_with_gemini` (multimodal PDF/image + Google Search grounding), `extract_profile_text_with_gemini`, `grounded_answer`. Retry/timeout/usage extraction already built (`_generate_with_retry`, `_usage_metadata`). |
| Direct Gemini (TS) | `app/api/github-analysis/route.ts` | GitHub deep analysis | Only TS-side text-LLM call. |
| Voice providers | `app/_lib/voice/openai.ts`, `elevenlabs.ts` | Interview sessions | Separate realtime registry — not part of the text wrapper, but BYOM key resolution is shared. |

Every call site already has a deterministic fallback and an envelope `source: "llm" | "deterministic"`
(`reasoning-cache-policy.ts` depends on this contract). The wrapper must preserve both.

## Target architecture

```
app (TS)                                pipeline (Python)
┌──────────────────────────┐            ┌─────────────────────────────────┐
│ Models admin module      │            │ pipeline/jobfit/llm/            │
│  - llm_config table      │  spawn +   │  base.py      Request/Envelope/ │
│  - provider_keys table   │  env:      │               Provider protocol │
│  - usage panel           │  KP_LLM_   │  registry.py  use_case→config   │
│ resolve(use_case) ───────┼──CONFIG───▶│  adapters/                      │
│  key: byom → platform    │  (JSON)    │   anthropic_api.py              │
│ ts wrapper (github route,│            │   openai_api.py                 │
│  future TS call sites)   │            │   azure_openai.py               │
└──────────────────────────┘            │   gemini_api.py                 │
                                        │   claude_cli.py (local/dev)     │
                                        │  capabilities.py                │
                                        └─────────────────────────────────┘
```

### Python package `pipeline/jobfit/llm/`

**`base.py`** — the contract, deliberately shaped like today's `ClaudeCliProvider` so call
sites port with minimal diffs:

```python
@dataclass
class LLMRequest:
    prompt: str
    system: str | None = None
    expected_keys: Sequence[str] | None = None   # JSON mode when set
    json_schema: dict | None = None              # strict schema where provider supports it
    files: list[Path] | None = None              # multimodal (capability-gated)
    grounding: bool = False                      # search grounding (capability-gated)
    max_tokens: int | None = None
    timeout_s: int = 180
    lang: str = "en"

@dataclass
class LLMEnvelope:
    text: str
    json: Any | None
    provider: str          # "gemini" | "openai" | "azure_openai" | "anthropic" | "claude_cli"
    model: str
    usage: dict            # input_tokens, output_tokens, cached_tokens
    cost_usd: float | None
    latency_ms: int
    request_id: str | None

class LLMProvider(Protocol):
    def available(self) -> bool: ...
    def complete(self, req: LLMRequest) -> LLMEnvelope: ...
    def complete_json(self, req: LLMRequest) -> LLMEnvelope: ...
    def map(self, reqs: list[LLMRequest], *, workers: int = 4) -> list[LLMEnvelope]: ...
```

**Adapters** — thin, hand-rolled (no LangChain/LiteLLM dependency; we need exact control of
envelopes, retries, and cost extraction):

- `anthropic_api.py` — Anthropic Messages API (haiku-class default for the small reasoning
  calls; structured output via JSON schema).
- `openai_api.py` — OpenAI chat/responses with JSON schema mode. Also serves any
  **OpenAI-compatible** endpoint via an optional `base_url` (vLLM / Ollama / LiteLLM /
  in-VPC proxy) and runs keyless against them — the enterprise self-host path
  (E-SH-5; `OPENAI_BASE_URL` env or `KP_LLM_CONFIG` `keys.openai.baseUrl`). See
  docs/SELF_HOSTING.md §5.
- `azure_openai.py` — same surface as OpenAI but config carries `endpoint`, `deployment`,
  `api_version` (from `provider_keys.meta_json`).
- `gemini_api.py` — refactor of `gemini.py`: keep `_generate_with_retry`, `_usage_metadata`,
  truncated-JSON repair; expose them through the protocol. Grounding + multimodal stay here.
- `claude_cli.py` — the existing subprocess provider, kept as the **local/dev** adapter
  (subscription billing is fine for a single dev machine; hosted SaaS must use metered API).

Shared behavior in the base: bounded retries with jitter on 429/5xx/timeouts (port the policy
from `gemini.py`), hard per-request timeout, JSON extraction/repair (`_extract_json` /
`_parse_truncated` consolidated), usage + cost normalization, prompt-artifact logging behind
`KP_LOG_PROMPTS` (existing convention in `logger.py`).

**`capabilities.py`** — providers are not interchangeable for every job:

| Capability | gemini | openai | azure_openai | anthropic | claude_cli |
|---|---|---|---|---|---|
| json_schema | ✅ | ✅ | ✅ | ✅ | ✅ (via expected_keys) |
| file_input (PDF/image) | ✅ | ✅ | ✅ | ✅ | ❌ |
| search_grounding | ✅ | ❌ | ❌ | ❌ | ❌ |
| batch `map()` | ✅ | ✅ | ✅ | ✅ | ✅ (process pool) |

The registry rejects (or visibly degrades) a config that routes a use case to a provider
missing a required capability — e.g. `cv_analysis` on OpenAI runs without salary grounding and
the envelope flags `grounding: "unavailable"` so the UI can show lower confidence.

### Use-case catalog and defaults

One row per use case — this is what the Models module edits:

| use_case | default provider / model | required caps | notes |
|---|---|---|---|
| `cv_analysis` | gemini / flash | file_input; grounding optional | the multimodal heavy call |
| `profile_extract` | gemini / flash | file_input | |
| `match_reasoning` | anthropic / haiku-class | json | cached 168h, `llm`-source only |
| `automation_screen/outreach/reject/prep/scorecard/rematch` | anthropic / haiku-class | json | 6 rows or one `automation_*` row with overrides |
| `campaign_pack` | anthropic / sonnet-class | json | copywriting quality matters |
| `jd_ingest` | anthropic / haiku-class | json | |
| `profile_draft` | anthropic / haiku-class | json | |
| `devcase_analyze / role_design / case_design` | anthropic / sonnet-class | json | design quality matters |
| `devcase_reflect / tooling / evaluate / transfer / judge` | anthropic / haiku-class | json | |
| `github_analysis` | gemini / flash | json | TS-side call |
| `interview_realtime` | elevenlabs (default) \| openai-realtime | — | separate voice registry; BYOM ElevenLabs key slot |

### Config storage and resolution (the "special module")

SQLite (single workspace today; `workspace_id` column reserved for multi-tenancy):

```sql
CREATE TABLE llm_config (
  use_case   TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',   -- max_tokens, grounding, workers…
  updated_at TEXT NOT NULL
);
CREATE TABLE provider_keys (
  provider   TEXT NOT NULL,   -- gemini|openai|azure_openai|anthropic|elevenlabs
  scope      TEXT NOT NULL,   -- 'platform' | 'byom'
  key_ciphertext TEXT NOT NULL,
  meta_json  TEXT NOT NULL DEFAULT '{}',    -- azure endpoint/deployment/api_version
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, scope)
);
CREATE TABLE llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL, use_case TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER,
  cost_usd REAL, source TEXT NOT NULL,       -- 'llm' | 'deterministic'
  request_id TEXT
);
```

**Resolution happens on the TS side** (it owns the DB), then flows to Python the same way all
spawn params do today: the resolved `{use_case → provider, model, params, key}` map is passed
as `KP_LLM_CONFIG` (JSON env var) on `spawnPython`. Python's `registry.py` only reads that env —
no DB access from Python, no second source of truth.

**Key resolution order:** workspace BYOM key → platform key → provider unavailable → existing
deterministic fallback. BYOM keys are encrypted at rest (AES-GCM with a `KP_SECRET` from env)
and never echoed back to the client after save.

**Models admin module** (new settings tab, e.g. `app/features/sub_models/`):
- per-use-case row: provider select, model field (pre-filled default), capability warnings,
  **Test** button (canary prompt through the real adapter, shows latency + tokens + cost);
- keys panel: one slot per provider × scope, validate-on-save (cheap list-models/ping call),
  Azure slot adds endpoint/deployment/api-version fields;
- usage panel: aggregates `llm_usage` per use case/provider/day — this is the same ledger the
  pricing meters (AI candidates / cases / interview minutes) will read.

### Invariants to preserve

1. **Deterministic fallbacks stay.** Adapter failure → same fallback paths as today; envelope
   `source` field keeps the `llm`/`deterministic` contract (`reasoning-cache-policy.ts`).
2. **Language routing.** `lang` (en/cs) threads through `LLMRequest` exactly as today's prompts.
3. **Prompt versioning.** Existing prompt-version tags (`case-design-v4`, …) stay with the call
   sites, not the wrapper.
4. **No silent model drift.** `llm_config` rows are explicit; upgrading a default model is a
   visible config change, not a code constant edit.

## Rollout phases

1. **Package + two adapters** (`anthropic_api`, `gemini_api`) + port `match_reasoning` and
   `automation` (highest traffic, simple JSON). `claude_cli` becomes an adapter and remains the
   default when no `KP_LLM_CONFIG` is present — zero behavior change for local dev.
2. **Registry + Models module.** `llm_config`/`provider_keys` tables, TS resolution into
   `KP_LLM_CONFIG`, admin tab with Test buttons. Add `openai_api` + `azure_openai` adapters.
3. **Port the rest.** devcase/*, campaign, profile_draft, jd_ingest; fold `gemini.py` CV
   analysis into the adapter with capability-gated grounding; TS-side mini-wrapper for
   `github-analysis` reading the same config.
4. **BYOM + ledger.** Encrypted BYOM key slots (incl. ElevenLabs for voice), `llm_usage`
   emission from every envelope, usage panel. This closes the loop with the pricing design
   (BYOM tier ≈ $5/mo infra-only; platform tiers meter candidates/cases/minutes).

## Testing

- Unit tests per adapter with recorded JSON fixtures (`npm run test:unit` for the TS wrapper,
  `python -m unittest pipeline.jobfit.tests.test_llm_*` for adapters/registry).
- Capability-matrix test: every `llm_config` default must satisfy its use case's required caps.
- Canary path = the admin Test button, runs the same code path as production calls.
