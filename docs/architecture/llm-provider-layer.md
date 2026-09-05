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

**Outstanding:** `profile_extract` fold-in (`cv_analysis` folded in 2026-08-30 —
`docs/specs/2026-08-30-cv-analysis-fold-in.md`: `pipeline.py` resolves
`cv_analysis` through the registry and the Gemini adapter's `complete_document`
attaches the file, so the gemini row now declares `file_input`; Gemini remains
the only capable provider, and `extract_profile_text_with_gemini` still calls
`gemini.py` directly), a
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

**The TS mirrors are pinned to it.** `LLM_PROVIDERS` and `LLM_USE_CASES`
(`app/_lib/llm-config.ts`) and `BENCH_OPS` (`app/_lib/llm-quality.ts`) are
hand-mirrored copies of `PROVIDER_CAPABILITIES`, `USE_CASE_REQUIREMENTS` and
`bench/scenarios.REGISTRY_USE_CASE`. Python is authoritative; the TS copies only
gate what the admin API accepts and what the Models tab offers.
`llm-capabilities-lockstep.test.ts` reads the Python source and asserts set
equality in both directions, the way `llm-model-required.test.ts` already did for
`DEFAULT_MODELS`. Each mirror rots in a direction nothing else can see: a
provider Python gained and TS did not answers `"Unknown provider."` for a
provider that works; a use case TS gained and Python did not is a routing pin the
resolver never reads; and a bench op rolling up to a use case that does not exist
makes the Models tab silently show no recommendation for it. The test carries a
shape guard so a re-shaped Python declaration fails loudly instead of parsing to
an empty list and passing vacuously.

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
- `llm_usage(id, ts, use_case, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, request_id, ingest_key)`

**The ledger fold is replay-safe.** `ingestLlmUsageLog` (and
`ingestLlmUsageResult`, which additionally reports the skip count) writes
`INSERT OR IGNORE` against a UNIQUE index on `ingest_key` — a per-LINE key over
(sidecar path, line ordinal, line bytes). Deleting the sidecar after the fold
used to be the only thing making it idempotent, and that delete is a best-effort
`rmSync` in a catch: a locked file, a read-only temp dir or a crash between the
INSERT and the unlink left the file where the next fold re-read it, and every row
landed twice — doubling the spend the pricing meters bill against. A refused
replay is COUNTED and logged (`[llm-usage] N of M …`), because a non-zero skip
means a cleanup failed. The key is deliberately **not** `request_id`: that
identifies the *spawn* and is stamped on every line the spawn wrote, so a unique
index on it would drop the second and later metered calls of every multi-call
run. Rows written directly by `insertLlmUsage` (the voice-interview per-minute
estimate) and every row predating the column carry `ingest_key` NULL, and SQLite
treats NULLs as distinct — so the index can never be blocked by existing data.

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
`claude_cli` — always wins. (`registry._production_gemini_default`. Use cases
needing `file_input` — which the text-only CLI can never serve — resolve to the
Gemini adapter in dev AND production, un-gated on `available()` so a missing key
fails at call time with the same actionable error the old direct path raised;
the former "dedicated `gemini.py` path" carve-out is retired.)
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

### The direct `gemini.py` seam has its own typed vocabulary

`cv_analysis` and `profile_extract` reach Gemini through `pipeline/jobfit/gemini.py`
rather than a `TextProvider` adapter (it needs multimodal file bytes + grounding).
Its refusals used to be bare `RuntimeError`s carrying English prose only, so a
caller could not tell an operator-config problem from a model-side failure, and
`_cli.emit_error` classified every one of them as an anonymous `engine_error`/500.

`GeminiError(subtype=…)` now names the cause, and — by also being a
`_cli.CliError` — carries the code the process boundary already speaks, so any CLI
that answers through `_cli.emit_error` emits it. It subclasses `RuntimeError` too,
so existing `except RuntimeError` call sites are unchanged.

| `GeminiError.subtype` | Raised when | CLI code / status |
| --- | --- | --- |
| `missing_key` | no `GEMINI_API_KEY` / `GOOGLE_API_KEY` resolvable | `invalid_input` / 400 |
| `offline_refused` | `KP_OFFLINE=1` seals this egress path (self-hosting.md §7) | `invalid_input` / 400 |
| `blind_unavailable` | blind screening requested, no redacted text extractable | `invalid_input` / 400 |
| `output_truncated` | stopped at `max_output_tokens` and nothing salvageable | `invalid_input` / 400 |
| `empty_response` | the model returned no text at all | `engine_error` / 500 |
| `unparseable_json` | text came back, but no JSON payload in it | `engine_error` / 500 |
| `missing_field` | JSON parsed, but a required field is absent/blank | `engine_error` / 500 |

Pinned by `pipeline/jobfit/tests/test_gemini_errors.py`.

**Known gap — the code is carried, not yet read on the analyze path.** The three
CLIs that reach `gemini.py` directly (`cli.py analyze`, `market_salary_cli.py`,
`profile_draft_cli.py`) hand-roll their own `{error, status: 500}` envelope
instead of calling `_cli.emit_error`, so today they still answer 500 for a missing
key. The typed error is what makes fixing that a one-line change per CLI (swap the
hand-rolled `print` for `_cli.emit_error(exc)`); until then the branchable cause
exists in Python but does not reach `useErrorMessage()` from those three.

## One JSON scanner, two selection policies (`pipeline/jobfit/json_values.py`)

Every adapter has to find the JSON inside a prose answer. That scan existed
**twice** — near-verbatim in `claude_cli.py` and `gemini.py` — and `llm/base.py`
imported the CLI module's *private* `_extract_json` to reach it, so a fix to one
copy silently left the other behind. It is now one module all three import.

The two selection policies on top of it are genuinely different decisions and stay
separate, named and tested:

| Function | Used by | Rule | Why |
| --- | --- | --- | --- |
| `select_last_matching` | `claude_cli` / `llm.base` (`extract_json`) | last value; last value carrying an `expected_keys` field when given | few-shot prompts make the model echo the example schema **before** the answer |
| `select_best_scoring` | `gemini._parse_json` | rank by schema-key overlap, then size, document order only as final tiebreak | a grounded answer trails citation blobs and stray objects **after** the payload |

`candidate_values()` is the shared "fenced blocks first, whole text otherwise" scan.
`pipeline/jobfit/tests/test_json_values.py` pins both policies, asserts each picks
the WRONG object on the other's corpus (so a future "simplification" that collapses
them fails loudly), and was mutation-verified: six independent mutations of the
scanner and both rankers each turn it red.

## Timeouts and the embedding client

`gemini.gemini_timeout_ms()` (env `KP_GEMINI_TIMEOUT_MS`, default 90 s) is the
per-request network deadline for **every** Gemini client kp builds. The opt-in
embedding bridge (`embedding_bridge.GeminiEmbeddingProvider`) used to build
`genai.Client()` with no `http_options` at all, so a stalled embeddings call had no
wall clock — and the bridge's documented fail-open ("a network error yields `None`
and the caller falls back to the keyword heuristic") could never fire, because
nothing ever raised. A whole pool's ranking sat on one hung socket. Both clients
now read the same function.

## Retries, and who decides how long to wait

Python's `TextProvider.complete` retries only *transient* failures
(`base.is_transient_error`: 408/429/5xx/529 or a timeout marker), 3 attempts,
`0.5s * 2^attempt` + jitter, capped by the call's deadline. `app/_lib/gemini-retry.ts`
is the TS mirror of that policy for the one Gemini call site that never reaches
Python (`app/_lib/github/code-review.ts`), and the two classification lists are now
pinned to `base.py` by `app/_lib/llm-capabilities-lockstep.test.ts` — a code or
marker added on one side and not the other fails a unit test instead of quietly
changing what gets retried.

The TS side adds one thing Python does not have: it honours a **`Retry-After`**
response header (both RFC 9110 forms — delta-seconds and HTTP-date), because a
server stating when its bucket refills is better information than our schedule and
retrying earlier is a guaranteed second 429. Rules, in `geminiRetryDelayMs`:

- header absent or unparseable → the local backoff, unchanged;
- header shorter than the backoff → the backoff still wins (the schedule spreads
  load, it is not a minimum to satisfy);
- header longer, up to `GEMINI_RETRY_AFTER_CAP_MS` (5 s) → we wait exactly that long;
- header longer than the cap → **we stop retrying** and rethrow the SDK error.
  Holding a request handler open for a 30-second rate-limit window is worse for the
  caller than an honest failure now, and `maxDuration` does not save a self-hosted
  deploy (`next start` never kills a long handler).

## Prompt artifacts are PII, and their retention is explicit

`KP_LOG_PROMPTS=1` captures the full prompt and response for each analysis to
`tmp/prompts/<request_id>-<suffix>` (`-prompt.txt`, `-response.txt`). The module
docstring claimed `<request_id>.json` for as long as it existed; no writer ever
emitted that name.

These artifacts contain a candidate's whole CV. They are off by default, and:

- written **owner-only** (0600), created with that mode rather than chmod'd after,
  so there is no window where the CV is world-readable. Best-effort — a filesystem
  without POSIX modes keeps its own;
- swept on **`KP_LOG_PROMPTS_TTL_H`** (hours; a malformed or non-positive value is
  treated as unset). The sweep runs before each write, so no cron is needed.
- **With `KP_LOG_PROMPTS_TTL_H` unset the artifacts are NEVER swept** — they
  accumulate until an operator removes `tmp/prompts` by hand. That is the honest
  default, not an omission.

Pinned by `pipeline/jobfit/tests/test_logger.py`.

## Document MIME is sniffed, never taken from the file name

`gemini._mime_type` used to be `mimetypes.guess_type(path.name)`: the uploader's
file name alone decided what kp told the model a document was, and `mimetypes`
reads the host's mime database (the Windows registry among others), so the same
upload could be declared differently on two installs. It now reads the magic bytes
and answers only from `ALLOWED_MIME` — exactly the formats `extractors.extract_text`
supports:

| Bytes | Declared |
| --- | --- |
| `%PDF-` | `application/pdf` |
| ZIP whose container holds `word/document.xml` | `…wordprocessingml.document` |
| decodable, NUL-free text | `text/plain` |
| anything else, incl. a non-Word ZIP or an unreadable path | `application/octet-stream` |

`application/octet-stream` is the honest answer — "bytes we will not vouch for" —
so the model treats them as opaque instead of being told a falsehood. Pinned by
`pipeline/jobfit/tests/test_gemini_mime.py`.

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

**An absent row is now a decision, not a gap.** Until 2026-09-05 seven resolved use
cases (`agent_fit`, `match_reasoning`, `cv_analysis`, `profile_draft`, `role_intake`,
`role_intake_voice`, `devcase_judge`) had no row and no record, so "2048 fits" and
"nobody sized this" read identically in the source. Three earned a row —
`agent_fit` 4096 (12 coverage rationales plus a system-prompt draft the coercer
accepts to 4000 chars), `profile_draft` 4096 (matching the budget its own direct
Gemini path already passes), `role_intake` 6144 (every turn re-emits the whole
RoleBrief, `jd_ingest`'s shape). The other four are recorded in
`capabilities.BASE_CAP_BY_DECISION` with the reason they stay on the base cap —
notably `cv_analysis`, whose ceiling this table does **not** own: it rides
`complete_document`, and `gemini.analyze_profile_with_gemini` passes
`max_output_tokens=16000` at the call site, which the Gemini adapter forwards without
consulting `self.max_tokens`.

`pipeline/jobfit/tests/test_llm_capabilities.py` scans the tree for
`resolve_provider("…")` and fails when a use case appears in neither map, so a new
call site cannot reach production on an unexamined ceiling.

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

**Two clocks, both stated.** The table's timestamps render in the READER's zone
(`format.dateTime`) and its token counts in the reader's locale
(`useNumberFormat().grouped`, matching the detail modal that used to disagree with
the row that opened it). The daily rollup does NOT follow the reader: `substr(ts,
1, 10)` cuts `aggregateLlmUsage`'s buckets on UTC midnights, so a late-evening call
in Prague sits in "today" on Activity and in tomorrow's cost column on Models.
Every rollup bucket now carries `tz: "UTC"` (`LLM_USAGE_DAY_TZ`) and the Activity
header says which clock it keeps (`activity.tzNote`, 4 locales). Re-cutting the
buckets in an operator's zone is a separate decision — it needs an operator zone to
exist first.

The tab **states its scope**: `llm_usage` has no org or workspace column, so the
ledger is deployment-wide, and the intro sentence says so in the same words the
billing panel uses for the same ledger (`activity.intro` ↔
`billing.spend.breakdownScope`, pinned across all four locales by
`app/api/llm/activity/activity-route.test.ts`). It previously read "the last N AI
actions **this workspace** ran" — a claim, not an omission, and a wrong one on any
install with more than one team.

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
reason=...)` writes an optional `reason` key — one of `base.AVAILABILITY_REASONS`
(`"offline_policy"`, `"missing_key"`, `"sdk_missing"`, `"missing_endpoint"`,
`"invalid_base_url"`, `"not_installed"`) or `"disabled"` (`--no-llm`) — fed by the
shared `provider_availability(provider)` predicate in
`pipeline/jobfit/llm/registry.py`. **Every** provider the registry hands out now
answers with its own reason: `ClaudeCliProvider.availability()` as before, and the
metered adapters through `TextProvider.availability()` (Azure adds
`missing_endpoint`, the OpenAI family `invalid_base_url`). The generic
`"unavailable"` is now only the floor for a duck-typed object exposing the bare
bool — a test fake, an in-process drill. Before that, an air-gapped install
recorded its DELIBERATE `KP_OFFLINE` seal in the ledger as "missing key/SDK" — a
diagnosis whose only repair is the one thing that cannot help. The key is omitted when the cause
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

**Not every id is a task id.** A companion turn is not a background run and never
had one to point at, so it names ITSELF: `companion:<threadId>:<turnId>`, minted
by the message route before the spawn and used as the id the reply is stored
under (`companionRequestId` / `parseCompanionRequestId` in
`app/_lib/companion-turn.ts`). It used to stamp the bare THREAD id, which the
detail then resolved against `/api/tasks/[id]` and reported as "run gone" on
every companion row. The modal now branches on the id's shape: a companion id
resolves to its conversation, with a button that opens the dock when that
conversation is the one the dock will show; legacy bare thread ids resolve the
same way, with the turn unknown. `withLlmRequestIdIfUnset` is what keeps the
digest leg honest: it runs inside the task runner's scope, so the TASK id stays
on its ledger rows rather than being shadowed by an id nothing can fetch.

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
- **A keyless stored row is an ANSWER, not a miss.** Since `KEYLESS_PROVIDERS`, a
  row carrying a base URL and no key is a valid configuration (a stock Ollama /
  llama.cpp / LM Studio server checks no credential). `resolveProviderApiKey`
  therefore returns `""` for it and stops — it does NOT fall through to the
  provider env var, because doing so would resurrect a deployment credential the
  operator deliberately configured away from and send it to a server chosen
  precisely because it needed none. `buildLlmConfigEnv` expresses the same refusal
  in its own idiom (it omits an empty key from `KP_LLM_CONFIG` rather than
  emitting `""`). Both halves are pinned by `provider-key-precedence.test.ts`,
  which fails if the "obvious" fallthrough is added.
- **The ledger's numbers are bounded non-negative.** `parseLedgerLine`
  (`app/_lib/llm-usage-ledger.ts`) drops a negative token count or cost to `null`
  rather than passing it through. `db/llm.ts` aggregates with
  `COALESCE(SUM(cost_usd), 0)` and `SUM(input_tokens)`, so one negative row would
  subtract from every total containing it — wrong in the direction nobody audits.
  Reachable without anyone writing a negative on purpose: cached-token discounts
  are computed by subtraction on the Python side. `null` is the right landing
  place because the table already counts `cost_usd IS NULL` as `unpriced_calls`,
  which is visible; a row folded into the sum is not. Token counts are rounded to
  the INTEGER columns that hold them; `cost_usd` is REAL and stays fractional.
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
  about **kp's own config** — so it is matched on `test_cli`'s phrase
  `"provider unavailable"`, never the bare word `unavailable`. `test_cli` now
  spells the descent out after it — `provider unavailable (offline_policy: …)` —
  and carries the same value as a `reason` field in its JSON envelope; the phrase
  is kept verbatim precisely because this classifier reads it. (The *client* copy
  is still the single `unavailable` reason: mapping each descent onto its own
  localized sentence is a `verdict.ts` + catalog change, not made here.)
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

### Who may change the models, and how often (2026-09-03)

Reading the Models tab is operator-gated. **Writing** it is `org:manage` — the
owner-only band `app/_lib/auth/roles.ts` defines as "billing, org
profile/settings, delete org" — because a provider key is this deployment's
spending credential and a routing pin decides where every model call in the
product goes. `requireOperator()` only answers "is there a valid, non-demo
session on this deployment?", which every recruiter and viewer also answers yes
to, so all four write doors now call `requireOrgCapability("org:manage")` after
it and refuse an under-privileged caller with `MODEL_ADMIN_FORBIDDEN` (403);
no session at all still answers 401. Open dev mode (no `KP_OPERATOR_PASSWORD`)
and an operator-password session both fold to owner inside
`callerOrgCapabilities`, so a self-hosted single-operator install is unchanged.
Pinned by `app/api/llm/keys/llm-admin-auth.test.ts`.

Both **Test** buttons spend money — each click spawns a Python child that makes a
real completion — so each carries a per-IP budget after its gate, in the idiom
`app/api/rate-limit-contract.test.ts` states for every spend door:

| Door | Key | Budget |
| --- | --- | --- |
| `POST /api/llm/test` (routing canary) | `llm-canary:<ip>` | 30 / 10 min |
| `POST /api/llm/keys/test` (key probe) | `llm-key-probe:<ip>` | 20 / 10 min |

Both sit *after* every refusal that spawns nothing, so a malformed or
unanswerable call consumes no budget, and both answer the shared
`TOO_MANY_REQUESTS` refusal so the panel says "you're going too fast" in the
reader's language.

### The key store is DEPLOYMENT-wide, and the routing table has a version

`provider_keys` is keyed `(provider, scope)` with no org or workspace column
(`app/_lib/db/core.ts`), so a key saved here is the key **every** workspace on
this install spends through. The BYOM/Platform selector picks which of two
deployment-wide slots the key fills — it is not a per-tenant choice — and the
panel now says so out loud (`models.keys.storeScope`). Per-tenant keys remain an
open product decision, listed under Known gaps.

**Key writes carry the same version token as routing writes.** `saveProviderKey`
takes an `expectedUpdatedAt` — the `updatedAt` the Models panel rendered for the row
it is replacing — and `upsertProviderKey` re-asserts it inside `.immediate()`,
refusing on a mismatch (including a row deleted underneath the caller) instead of
overwriting. The route answers `MODEL_KEY_STALE` (409) **carrying the current rows**,
and the panel reloads onto them before showing the message. The stakes are higher
here than for a routing pin: a stored key is encrypted at rest and unrecoverable, so
the old last-writer-wins upsert destroyed one of two admins' credentials while
showing both a green "Saved". `updated_at` is nudged forward on a same-millisecond
collision so the token strictly increases; omitting the field keeps the
unconditional write for the headless/curl path. Pinned by
`app/_lib/db/provider-key-precondition.test.ts`.

`llm_config` writes take an `expectedUpdatedAt`: the version the editing tab read.
`upsertLlmConfig` re-asserts it inside an IMMEDIATE transaction and returns false
on a mismatch, which the route answers as `MODEL_ROUTING_STALE` (409) **carrying
the current rows**, so the table reloads itself instead of leaving a dead draft on
screen. The stamp is nudged forward on a same-millisecond collision so the token
strictly increases. Omitting the field keeps the old unconditional write for the
headless/curl path. Pinned by `app/api/llm/config/llm-config-race.test.ts`.

The keys route's refusals are codes, not prose: `MODEL_KEY_BODY_INVALID`,
`MODEL_KEY_PROVIDER_UNKNOWN`, `MODEL_KEY_SECRET_REQUIRED`,
`MODEL_KEY_LOCATION_REQUIRED`, `MODEL_KEY_ENDPOINT_REQUIRED`,
`MODEL_KEY_ENCRYPTION_UNCONFIGURED`, `MODEL_KEY_REJECTED` and `MODEL_KEY_STALE`, each carrying the
provider (or the accepted provider list) as data. The panel used to detect the
missing-`KP_SECRET` case by substring-matching the server's English sentence; it
now reads the code, so the env-var fix appears for a reader in any of the four
locales.

## Invariants

1. **Deterministic fallbacks stay** — adapter failure never surfaces as a broken
   response; the envelope `source` field stays `llm`/`deterministic`.
2. **Language routing** — `lang` (en/cs) threads through every `LLMRequest`.
3. **Prompt versioning** stays with call sites, not the wrapper.
4. **No silent model drift** — `llm_config` rows are explicit; changing a default
   model is a visible config change.

## Known gaps

- `cv_analysis` is folded in (2026-08-30): it routes through
  `resolve_provider` and the Gemini adapter's `complete_document`, so a config
  row's model pin and BYOM key take effect — **but only since 2026-09-05.** From
  the fold-in until then this paragraph was false: `analyze-run.ts` spawned the
  child without `env: buildLlmConfigEnv()`, so `KP_LLM_CONFIG` never reached it
  and the pin was silently inert while the Models tab went on offering the row.
  The spawn now carries the env and `llm-spawn-contract.test.ts` pins it. Gemini
  stays the only
  `file_input`-capable adapter (openai/anthropic/azure rows are still honestly
  text-only). `profile_extract` still calls the dedicated `gemini.py` path; a
  config row for it has no effect today.
- `grounded_salary` (market salary via `market_salary_cli.py`) also calls
  `gemini.py` directly and is not in the use-case catalog — un-routable.
- Voice (OpenAI Realtime / ElevenLabs) is deliberately outside the provider
  layer: env-configured, per-minute ledger attribution via
  `app/_lib/voice/minute-prices.ts`; its OpenAI key does not use
  `resolveProviderKey`.
- Per-tenant `llm_usage` attribution not built (global ledger today).
- Per-tenant provider KEYS are not built either, deliberately (owner decision):
  `provider_keys` and `llm_config` are one deployment-wide store. The Models panel
  states the scope rather than implying a boundary that does not exist.
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
- The direct Gemini seam and its shared parts: `test_json_values`, `test_gemini_errors`,
  `test_gemini_mime`, `test_logger`, `test_service`, `test_embedding_bridge`.
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

A base URL is checked for SHAPE only — parseable, `http`/`https` (or a
unix-domain-socket scheme), a host present, no embedded credentials — and is
deliberately NOT run through
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

**Both doors are checked.** `assertValidBaseUrl` (`app/_lib/llm-config.ts`) guards
the save; `base.validate_base_url` guards resolution in Python, so an endpoint
arriving from the ENVIRONMENT (`OPENAI_BASE_URL` / `OLLAMA_BASE_URL` /
`QWEN_BASE_URL` / `OPENROUTER_BASE_URL` / `AZURE_OPENAI_ENDPOINT`) gets the same
rules instead of going straight to the SDK. A malformed one is a routing descent
(`availability()` → `invalid_base_url`, deterministic fallback), while an actual
call raises — a request that WAS made never degrades silently. No message ever
echoes the URL: `base.endpoint_host` reduces it to `scheme://host[:port]`, because
a base URL can carry a credential in its userinfo or query string.

The provider list itself is single-sourced per side and pinned across them:
`BASE_URL_PROVIDERS` in `app/_lib/llm-model-defaults.ts` ↔ `BASE_URL_PROVIDERS` in
`pipeline/jobfit/llm/registry.py` (consumed by both `resolve_provider` and
`probe_provider`), with `app/_lib/llm-base-url-lockstep.test.ts` failing on drift —
a provider the panel offers but the registry never threads is a saved setting that
silently does nothing.

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
(`_offline_egress_url` in `adapters/openai_api.py`). The refusal names the endpoint
as `scheme://host` only, and every sealed adapter reports `offline_policy` from
`availability()` rather than a generic "unavailable".

The OpenAI-compatible adapters share ONE resolver and ONE availability rule
(`adapters/openai_api.py`), parameterized by three class attributes —
`_base_url_env`, `_default_base_url`, `_base_url_implies_keyless`. They used to be
four byte-identical `_resolved_base_url` copies and two identical `available()`
bodies, which is how the offline gate went missing from Qwen's copy once
(`test_llm_offline.py`'s 2026-08-22 audit note).
