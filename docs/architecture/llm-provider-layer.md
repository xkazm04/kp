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
  (config-gated — its unconfigured default stays the direct Gemini path),
  `agent_fit`, `role_intake` / `role_intake_voice`, `repo_scan`.
- **`repo_scan` is the one use case whose *engine* changes what it can see.**
  Every provider gets the same prompt, which carries the deterministic dossier and
  the repo's own `CLAUDE.md`/`AGENTS.md` as grounding — but only `claude_cli` can
  actually run *inside* the checkout and read the files
  (`ClaudeCliProvider.with_repo_access` → `--permission-mode plan`, a read-only
  `--allowedTools` list and a write `--disallowedTools` list). That is a quality
  difference, not a capability the matrix can gate — there is no "runs in your
  checkout" capability, and inventing one would refuse a perfectly valid grounded
  refinement — so `capabilities.py` declares it `{json}` like `agent_fit`, and the
  dossier's own `source` / `fieldProvenance` is what stays honest about which path
  produced each field. See `docs/features/app-master/README.md`.
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
| Ollama | `ollama.py` | First-class local/on-box models through Ollama's OpenAI-compatible `/v1`. **Keyless but configurable from Settings → Models** (see "Local model servers" below); models addressed by tag (`lfm2.5:8b`) with no built-in default; endpoint defaults to `http://localhost:11434/v1`, overridable via `keys.ollama.baseUrl` in `KP_LLM_CONFIG` or the `OLLAMA_BASE_URL` env var. |
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
This default carries the same `USE_CASE_MAX_TOKENS` ceiling as a configured row
(below) — it used to build the adapter without one, so a config-less cloud box
ran every heavy-output use case at the 2048 cost cap and shipped the
deterministic fallback after two truncated, paid calls.

## A non-answer is never an answer

An adapter must not turn a provider-side non-answer into a successful
`LLMResult`. An empty string handed back as a completion is metered as a healthy
paid call and is taken by every plain `complete()` caller (`intake.run_voice_turn`,
the interview/intake eval personas) as the model's real reply — a fallback with no
signal that it *is* one. Each adapter raises a typed `LLMError` instead:

| Shape | Adapter | `LLMError.subtype` |
| --- | --- | --- |
| HTTP 200 whose body carries a top-level `{"error": …}` | `openai_api._raise_on_error_response` | `provider_error` |
| HTTP 200 with no `choices` | same | `empty_choices` |
| `finish_reason` = `error` / `content_filter` | same | `content_filter` |
| Gemini response with no text (safety/recitation block, or a stop with no parts — `.text` raises or is `None`) | `gemini_api._call` | `empty_response` |
| Parseable-JSON failure surviving the one repair re-prompt | `base.complete_json` | `unparseable_json` |

Where the tokens were already billed (a Gemini block bills the prompt; a paid
completion that came back as unusable JSON), the adapter emits the usage line
**before** raising, so the spend still reaches the ledger and the failure still
reaches LightTrack — the same success-then-error pair `complete_json` uses.

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
  the same seam — including the `operation`/tag rule above, which the TS half now
  mirrors (it used to put the use case on `operation`, so every TS-originated
  event silently deserialized into the `other` bucket and answered no
  `use_case:` filter at all, while the Python half read `chat`). Pinned by
  `app/_lib/llm-lighttrack.test.ts`, which stubs `fetch` and asserts the emitted
  body — the failure mode is invisible at runtime, since the enum's serde
  catch-all accepts anything.
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

**Scorecard scoping — what each column can and cannot fail on.** The three axes
(`summarize()` in `bench/runner.py`) are deliberately disjoint, and all three are
now scoped to the rows the *model itself* answered (`source == "llm"`):

| column | scope | why |
| --- | --- | --- |
| `judge*` | LLM rows only | the deterministic fallback is the same template for every target — judging it measures the fallback, not the model |
| `valid` | LLM rows only | the fallback passes every contract *by construction* (contracts.py mirrors the production coercion), so counting it made `valid` a signal that could not fail: a target that never once served read `valid 100%`. It now reads `0%` |
| `llm` | all served rows | the reliability axis — where a degraded target is supposed to show up |
| `$/task`, `p50/p95` | all served rows | envelope facts |

`bench_cli --judge` reports `judged N/M` over LLM rows only for the same reason;
its "the judge scored 0 outputs" warning therefore fires on a broken *judge*, not
on a target that fell back on every scenario (which it used to blame the Claude
CLI for). `bake_quality.py` already scoped its cells this way — the summary table
now matches it.

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

**Deterministic serves carry a descent reason.** A `source:"deterministic"`
sidecar line may now name WHY the floor served: `emit_deterministic(use_case,
reason=...)` writes an optional `reason` key — `"offline_policy"` (KP_OFFLINE
veto), `"not_installed"` (no CLI binary), `"unavailable"` (a bare-bool adapter:
missing key/SDK), or `"disabled"` (`--no-llm`) — fed by the shared
`provider_availability(provider)` predicate in `pipeline/jobfit/llm/registry.py`
(`ClaudeCliProvider.availability()` supplies the discriminated reasons; other
adapters still collapse to the generic one). The key is omitted when the cause
is unknown (an LLM call that failed mid-flight), and `parseLedgerLine` ignores
it, so ingestion into `llm_usage` is unchanged — the diagnosis lives in the
NDJSON sidecar. The Python CLI seats (`reasoning`, `automation`, `campaign`,
`agentfit`, `group_compare`, `devcase`, `repo_scan`) all thread it.

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

### Where spend is read: Billing, not Models

Metered spend is a **billing** question, so the whole Usage & cost surface lives
on **Settings → Billing** (`app/features/settings/billing/spend/`), not on
Models. One section there answers it, from three sources at once:

| Source | What it contributes |
| --- | --- |
| `GET /api/billing` (prop from the tab) | This period's plan meters: included allowance, remaining, pack credits |
| `GET /api/llm/usage` | The `llm_usage` ledger folded per use case over 30 days (`spendUsageFold.ts`) |
| `GET /api/ops` | Engine availability, run queue, automation clock, 7-day analyze rollups, comms/schedule failure counters |

`useSpendData.ts` owns both fetches for the whole section — one loading state,
one failure state. The ledger read is THE failure (it is the section's subject);
a dead `/api/ops` just drops the engine lines rather than erroring the section.
`degradedReasons` stay canonical English server diagnostics (no `code` to
resolve) — see [localization.md](./localization.md).

This replaced two half-answers that had drifted: a Usage panel on Models and a
separate meters card on Billing, neither of which knew what the other showed. An
intermediate consolidation NESTED the ops readout inside the usage panel, which
gave the surface two borders, two headings and two staggered spinners for one
question; the section is flat now, with ruled bands rather than nested cards.

### The Models tab is three sections, not one scroll

`ModelsTab.tsx` is a `SegmentedControl` over three mutually exclusive sections,
each its own chunk with its own fetch:

- **Routing** (`ModelsRoutingPanel.tsx`) — the per-use-case pin table.
- **Quality** (`ModelsQualityOverview.tsx`) — the baked bench matrix: per-model
  ranking + best model per case. With no baked matrix it says so (it used to
  render nothing, which reads as a broken tab once it is a whole section).
- **API keys / BYOM** (`ModelsKeysPanel.tsx`) — the write-only key store.

### Proving a key: `POST /api/llm/keys/test`

Saving a key used to end at "Saved". The first evidence that a pasted credential
worked arrived later, from a hiring action quietly failing over to its
deterministic fallback — the worst place to discover it. Each stored key row now
has a **Test** that fires a hello-world completion through the real adapter.

It is a distinct endpoint from `POST /api/llm/test`, which canaries a use case's
ROUTING, because the two answer different questions: a key can be perfectly valid
while nothing routes to its provider, which is the normal state right after
saving one.

- Python: `registry.probe_provider(name, model=…)` builds an adapter by provider
  NAME, bypassing use-case routing; `test_cli.py --provider` drives it. The probe
  runs under its own `KEY_PROBE_USE_CASE = "key_probe"` so admin traffic lands in
  the ledger under its own name instead of inflating a real use case.
- TS: `buildProviderKeyProbeEnv(provider, scope)` emits a `KP_LLM_CONFIG` with
  exactly the row being asked about and no routing — deliberately NOT
  `buildLlmConfigEnv()`, whose byom-over-platform precedence would let a
  "Test" on a platform row be silently answered by the BYOM key above it.
- Providers with no built-in default model (Azure deployments, OpenRouter/Qwen/
  Ollama slugs — `MODEL_REQUIRED_PROVIDERS` in `app/_lib/llm-model-defaults.ts`,
  kept in lockstep with `capabilities.DEFAULT_MODELS` by
  `llm-model-required.test.ts`) get a `model_required` verdict up front, which is
  what reveals the model field, instead of a request that could only fail as a
  generic `invalid_model`.
- Both Test buttons now render the **reason**, not just "failed":
  `modelsTestReason.ts` maps the verdict's stable code (auth / rate_limit /
  connection / timeout / …) onto localized copy. The codes were always computed
  server-side and always thrown away by the client, which resolved them through
  the `errors` namespace — a namespace that carries none of them.
- `classifyProviderError` (`app/api/llm/test/verdict.ts`) reads the raw text ONLY
  to pick that code, and its marker precedence matters: the `unavailable` code
  renders as *"Nothing to call: no usable key or SDK on the server"* — a verdict
  about **kp's own config** — so it is matched on `test_cli`'s full phrase
  (`"provider unavailable (missing key or SDK/CLI)"`), never the bare word.
  Everything else `test_cli` reports is a raw provider exception, and a
  provider-side 503 spells "unavailable" too (`ServerError: 503 UNAVAILABLE …`,
  `Error code: 503 - … 'Service Unavailable'`); those now land on the
  overloaded/rate-limit family or the generic bucket instead of telling an
  operator with a valid key that no key is stored. Pinned by `verdict.test.ts`.

### A Test only ever claims what the server holds

`POST /api/llm/test` takes `{ useCase }` and nothing else — it resolves the pin
the **server** has stored. So the routing row's Test button is disabled while its
draft is unsaved (`canTest={!dirty}` in `ModelsRoutingRow.tsx`), for the same
reason it is absent on an unpinned row: with an edited provider/model sitting in
the boxes, a verdict about the stored pin reads as a verdict about the edit —
green ("that typo works") or red ("my correction didn't help") equally wrongly.
Save, then test. The key row's Test is a different case and stays enabled: its
`model` box is an argument of the probe, not stored state, and the key it proves
is the stored one.

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


## Local model servers — the `baseUrl` field

KP is open source and expected to run on somebody's own machine, so pointing it at a
local inference server is a first-class path rather than an enterprise escape hatch.

**Settings → Models → API keys** offers a **Server URL** field for every provider that
speaks the OpenAI Chat Completions wire format (`BASE_URL_PROVIDERS` in
`app/_lib/llm-model-defaults.ts`: `openai`, `ollama`, `qwen`). Point it at Ollama, LM
Studio, llama.cpp's server, vLLM, LiteLLM, or an in-VPC gateway:

```
http://localhost:11434/v1      # Ollama
http://localhost:1234/v1       # LM Studio
http://vllm.internal:8000/v1   # vLLM behind your own network
```

**A keyless provider may be saved with a base URL and no API key.** A stock local
server authenticates nothing; the Python adapter supplies the placeholder the OpenAI
SDK insists on (`adapters/openai_api.py`). `ollama` is offered in the keys form for
exactly this reason — it was excluded as "keyless" before, which left its endpoint
settable only through the process environment.

### How this used to be broken

The Python half has accepted `keys.<provider>.baseUrl` since E-SH-5, but the
TypeScript half never PERSISTED or EMITTED it: `saveProviderKey` kept only Azure's
`endpoint`/`apiVersion`, and `buildLlmConfigEnv`'s `KeysEntry` had no `baseUrl` at
all. The capability existed and was unreachable from the app — you could only get at
it by setting `OPENAI_BASE_URL` / `OLLAMA_BASE_URL` in the environment. Both builders
now emit it (including the key-probe builder, so a green "Test" proves the server the
operator actually configured).

### Validation, and why it differs from Azure's

A base URL is checked for SHAPE only — parseable, `http`/`https`, no embedded
credentials — and is deliberately NOT run through
`assertPublicHttpsEndpointResolved`, the SSRF guard applied to Azure endpoints. That
guard rejects loopback, LAN and non-https on purpose. Here those are the normal,
intended values. The threat models genuinely differ:

| | Azure `endpoint` | `baseUrl` |
| --- | --- | --- |
| What travels there | a cloud credential | usually no credential at all |
| Who names the host | the user | the operator, in an admin surface behind `requireOperator` |
| Private host means | an exfiltration pivot | the entire point |

It replaces the `OPENAI_BASE_URL` / `OLLAMA_BASE_URL` env vars and sits at the same
trust level as them.

### A blank box is a delete, so the boxes show what is stored

`upsertProviderKey` sets `meta_json = excluded.meta_json` — a save rewrites the
row's metadata **wholesale**. An empty Server URL / API version box therefore
DELETES the stored one; it does not mean "leave it alone". The add-replace form
used to open those boxes blank whatever was stored, so rotating the key on an
`openai` row pointed at an in-house gateway wiped its Server URL with no warning
and sent the next call — carrying the gateway's key — to `api.openai.com`.

`keyFormMetaFor` (`modelsKeysPanelLogic.ts`) now seeds `endpoint` / `apiVersion` /
`baseUrl` from the row a save would REPLACE, applied by the provider and scope
selects (never from an effect, so it cannot clobber a value mid-typing). It keeps
`buildKeyRequestBody`'s drop-for-the-wrong-provider rule, so nothing is re-seeded
from a row whose provider has since been flipped away. The stored base URL also
renders on the key row beside the Azure endpoint — it is not a secret, it decides
where the key is sent, and it was the one stored field the list dropped. Pinned by
`modelsKeysPanelLogic.test.ts`. (Azure's `endpoint` could never be wiped this way —
the PUT rejects an Azure save without one — but its `apiVersion` could.)

### Offline

Under `KP_OFFLINE=1` an on-box base URL stays usable while an off-box one is sealed
off — the adapter reports its resolved base URL as its egress target, so the check
runs against the host you configured rather than the vendor's default cloud
(`_offline_egress_url` in `adapters/openai_api.py`).
