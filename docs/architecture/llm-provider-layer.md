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
  (`app/features/settings/models/ModelsTab.tsx`). The tab's three secondary
  panels (quality overview, keys, usage) are `<Defer>`-mounted own chunks that
  own their own fetches — they are **not** gated on `/api/llm/config`, so the
  routing table's round-trip no longer serializes ahead of theirs.
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
| Qwen Cloud | `qwen.py` | qwencloud.com / DashScope-intl **compatible mode** (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, override `QWEN_BASE_URL`). One key (`QWEN_API_KEY`/`DASHSCOPE_API_KEY`) serves the Qwen family plus hosted third-party models (`deepseek-v4-flash-0731`) by explicit slug — an OpenRouter-style gateway that IS a production routing target. |

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

## Output-token ceilings (`capabilities.USE_CASE_MAX_TOKENS`)

The base `DEFAULT_MAX_TOKENS = 2048` is a cost cap sized for the sub-KB JSON most
wrapped use cases return. Heavy-output use cases (one proposal per candidate in a
single `weight_proposal` call, ~8 `campaign_pack` variants with video scripts, the
devcase design artifacts) structurally exceed it on API adapters — the JSON
truncates, fails coercion, and the deterministic fallback ships, which the
2026-08-05 bench misread as model weakness. `USE_CASE_MAX_TOKENS` raises the
default per use case (4–8k); an explicit `params.maxTokens` on the config row
still wins, and both the production registry and the bench runner apply the same
table so the bench measures what production runs.

## Benchmarks (`pipeline/jobfit/llm/bench/`)

Drives the real production functions (same prompts, coercion, fallbacks) over the
seed corpus to pick default models per use case — never in CI (spends tokens).
See `docs/architecture/llm-model-matrix.md` for the latest measured results and
`bake_quality.py` for how results feed the in-app Models-tab scorecard
(`app/_lib/llm-quality.ts`, `app/_lib/llm-quality-scores.ts` — generated, do not
hand-edit).

The LLM-as-judge (`bench/judge.py`) scores against an **anchored rubric** (bands
defined by the decision a recruiter would make with the output; a flawless output
must land 9–10) and sees an **input-evidence excerpt** per scenario
(`meta["judgeInput"]`, stamped in `bench/scenarios.py` — the JD text, transcript,
or candidate×match facts) so correctness is graded against evidence. The earlier
unanchored, evidence-free judge compressed the whole 7-model matrix into the 5–8
band. `--judge-model` picks the CLI model alias for the judge seat (e.g. `fable`).

## Background-mode contract + the Activity log (2026-08-12)

Every heavy one-shot LLM action runs as a **background task** (`app/_lib/tasks.ts`
kinds; the measured p50s in the model matrix motivated the move — 9–60s API-side,
up to 150s via the CLI). The UI contract is **wait-or-leave**: the surface that
started a run watches it with `useTaskResult(taskId)` and renders the shared
`TaskFlightNote` ("runs in the background — you can keep working elsewhere"); a
recruiter who leaves picks the outcome up via the read/unread trail:

- every finished task carries a server-side `seen_at` ack (`tasks.seen_at`,
  `POST /api/tasks/seen`); the sidebar `TasksIndicator` badges **unread**
  failures (coral) and unread successes (moss) and leads to the Tasks tab, which
  stamps the ack only after the rows have been on screen for a short dwell;
- conversational turns (role intake, devcase session chat) and the sub-15s
  interactive matrix-reasoning popover stay synchronous by design — you cannot
  "return later" to a dialog turn.

The sync routes remain as thin convenience wrappers over the same runners
(`campaign-run.ts`, `profile-draft-run.ts`, `reasoning-run.ts` — the
`llm-spawn-contract.test.ts` map pins where the spawn + `buildLlmConfigEnv`
contract lives).

**Insights → Activity** (`app/features/insights/activity/ActivityTab.tsx`,
`GET /api/llm/activity`) is the row-level audit trail of the `llm_usage` ledger:
every individual LLM action newest-first — use case, provider, model, tokens,
cost (null renders as unknown, never $0), and llm-vs-deterministic source — in a
paginated table built from the shared primitives (`ColumnFilter` headers +
`TablePager` over the bounded `LLM_ACTIVITY_WINDOW` of 500 rows; older spend
stays in the Models tab's daily rollup).

#### Row detail: from "what it cost" to "what it produced"

`llm_usage` stores meters, never content — so a row cannot carry the model's
answer. It can carry the *run* that produced it. `request_id` had been in the
schema (and in `parseLedgerLine`) since T0.1 with nothing ever writing it; it is
now the background-task id, stamped along this chain:

| Step | Where |
| --- | --- |
| Open an ambient request scope around the task handler | `app/_lib/tasks.ts` → `withLlmRequestId` |
| Carry it across async boundaries (`AsyncLocalStorage`) | `app/_lib/llm-request-context.ts` |
| Hand it to the child as `KP_LLM_REQUEST_ID` | `app/_lib/python-runner.ts` (beside `KP_LLM_USAGE_LOG`) |
| Write it onto every metered ledger line | `pipeline/jobfit/llm/monitor.py` → `_append_ledger` / `_request_id` |
| Map it into the row | `app/_lib/llm-usage-ledger.ts` → `parseLedgerLine` (already did) |

`AsyncLocalStorage` rather than a threaded parameter because `spawnPython` is
called from ~20 modules, most several frames below the runner: the plumbing stays
at the two ends that care, and no intermediate call site can forget to forward it.

Clicking a row opens `ActivityDetailModal.tsx` — the ledger facts (including
cached tokens, which the table has no room for), then the linked run's output
fetched from `GET /api/tasks/[id]`, the one endpoint serving the full `result`
blob (the 2s task poll projects it away). Arbitrary result shapes are rendered by
`app/_components/ui/StructuredReadout.tsx`, which presents by *structure* rather
than by payload knowledge (scalars → fact rows, arrays of objects → tables,
long strings → prose, nesting → indented sections) and is depth/count-capped with
the overflow stated out loud.

Three degradations, kept distinct because they are different facts: **no request
id** (the call ran outside a tracked task — an inline route or a direct CLI, so
nothing was stored), **id but no task** (aged out of task retention), **task but
no result** (the run stored none). Only new rows link; the pre-existing window
keeps its historical nulls.

The **AI tasks** tab (`?tab=tasks`, `app/features/shell/tasks/**`) is the runtime
half of the same story — what is running right now, what finished, what failed and
can be replayed — as one paginated, column-filtered table over the recent window
plus an on-demand history pager. It is the run log, not the spend log: it holds
tasks, and nothing else.

### One LLM-telemetry overview, not two

**Models → Usage & cost** (`ModelsUsagePanel.tsx`, `GET /api/llm/usage`) is the
single place the workspace answers "what is the LLM layer doing and what does it
cost". It folds the ledger per use case over 30 days (calls, tokens in/out,
cached, est. cost, the deterministic-fallback split, the unpriced-spend footnote)
and carries `ModelsSystemStrip.tsx` above the table: engine availability
(Gemini key / Claude CLI on `PATH`), the run queue, the automation-clock
heartbeat, seed health, 7-day analyze rollups (cache hit rate, avg duration),
average stage timings, and the comms/schedule failure counters — all from
`GET /api/ops`.

That strip was a standalone "System" card on the tasks tab. It reported the same
prompt-cache rows and a 7-day token total this ledger already covered, so it was
folded in and the duplicated halves dropped rather than left to drift apart. The
health line renders **above** the ledger because it is the precondition for
reading it: a stalled scheduler or a missing key explains a suspiciously cheap
week. `degradedReasons` from `/api/ops` stay canonical English server diagnostics
(no `code` to resolve) — see [localization.md](./localization.md).

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
