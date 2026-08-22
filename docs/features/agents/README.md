# Agents — the agent-candidate bridge

kp can hire an **AI agent** for a role instead of (or alongside) a human: a job is
transformed into an *agent-fit spec* (which responsibilities an agent could own, what it
should cost, how to measure it), the spec is dispatched to the external **Personas**
desktop app as a persona request, a human approves it there, and the hired persona
reports cost/activity back into kp, where it rides the pipeline like any other hire.

## Entry points

| Surface | Where | What it does |
| --- | --- | --- |
| **Agent fit** tab | Job detail modal (`app/features/library/jobs/JobsAgentFitTab.tsx`, 7th tab of `JobsPostingModal.tsx`) | Assess the role, edit the spec, dispatch, track the hire's status |
| **Agents** nav module | Sidebar, hiring group (`app/features/agents-workforce/AgentsWorkforceTab.tsx`) | Roster of hired agents: status, spend vs budget, runs, connectors, expectations verdict |
| **Personas bridge** card | Settings → Integrations (`app/features/settings/integrations/IntegrationsPersonasPanel.tsx`) | Two-phase human-approved pairing, base-URL override, disconnect |

## User flow

1. **Pair** (once): Settings → Integrations → *Connect to Personas*. kp registers a
   pairing request (`POST /api/agents/pair {phase:"start"}`), the operator approves it in
   the Personas desktop app, and the card's 2s claim poll (`{phase:"claim"}`) picks up the
   `pk_` key — stored encrypted, write-only (reads expose only `hasKey`).
2. **Assess**: open a job → *Agent fit* → *Assess agent fit*. `POST /api/jobs/[id]/agent-fit`
   starts the backgrounded `agent_fit` task (`pipeline.jobfit.agentfit_cli`, one LLM call
   with a deterministic keyword fallback); the result persists as the job's latest
   `agent_fit_specs` row. The tab leads with the fit verdict
   (`complete | temporary | unassessed`, the shared ✓/–/✗ eval-report convention) and the
   per-responsibility coverage (`automatable ✓ / assisted △ / human_only ✗`) with a
   headline coverage percentage. That percentage is **always computed in kp**
   (`agentfit.coverage_ratio`, `automatable` = 1, `assisted` = 0.5), never taken from the
   model, and it is denominated in the job's full responsibility itemization — a model
   that classifies only part of the list (or whose remaining rows are dropped for an
   off-taxonomy coverage class) leaves the rest counted as NOT covered rather than
   rendering a partial answer as 100%.
3. **Edit + dispatch**: name, mission, connector chips (catalog via
   `GET /api/agents/catalog`) and the monthly budget are editable; *Dispatch to Personas*
   POSTs the overrides. The budget field is free text (`inputMode="decimal"`) and
   `budgetFromInput` reads a comma as the cs/de/fr **decimal** separator, so `99,5` is
   99.5 — but a **group** separator wears the same character, and `2,000` used to parse
   as `Number("2.000")` = 2 with no validation shown, dispatching a $2/month cap where
   the operator meant $2,000. `2,000` is 2000 in `en` and 2.0 in `cs`, so a
   grouped-*looking* value (1–3 digits, one separator, exactly 3 digits) is now reported
   invalid and retyped rather than guessed; `1234.56` and the decimal comma are
   untouched. Pinned by `jobsAgentFitModel.test.ts`. That client check is **not** the bound:
   `POST /api/agents/dispatch` now 400s a `budgetUsd` that is present but unusable
   (negative, non-numeric, non-finite) instead of silently swapping in the stored
   suggestion — an *omitted* budget still falls back to `suggestedMonthlyUsd`, which is
   what a blank field sends. A `hired_agents` row is minted (idempotent — one live agent per
   job) and, **once Personas has accepted the request**, the agent enters the pipeline at
   Offer (`candidateId agent-<id>`, `sourceChannel agent-bridge`). The board write is
   deliberately last: a failed dispatch mints a fresh agent id on every retry, so filing
   the card up front left one phantom Offer-stage candidate per attempt — and an
   **unpaired** kp fails every dispatch before a byte leaves the process. A 502 now
   leaves the roster row marked `failed` and the board untouched
   (`agents-bridge.test.ts`).
4. **Approve in Personas**: the status ladder is
   `dispatched → pending_approval → onboarding → active` (terminal: `rejected`,
   `failed`, `retired`). The push path is the token-authed public report route; the
   *Refresh* button is the pull fallback (`POST /api/agents/[id]/refresh`). Activation
   auto-moves the pipeline entry to Hired.
5. **Counters flow back**: the hired persona reports executions/rollups/lifecycle events
   through `POST /api/agents/report/[token]`; the Agents module shows aggregates (runs,
   success rate, month spend vs budget, connector use) and a client-computed
   "n/m expectations met" verdict (`agentsWorkforceLogic.expectationsVerdict`).

## API / lib surface

| Path | Role |
| --- | --- |
| `GET /api/agents` (`app/api/agents/route.ts`) | Roster + per-agent aggregates (report token never leaves the server) |
| `GET/DELETE /api/agents/bridge` | Connection status (key presence only) / disconnect (clears the stored key; 409 for env-driven config) |
| `POST /api/agents/pair` | Two-phase pairing: `{phase:"start", baseUrl?}` → `{nonce}`; `{phase:"claim", nonce}` → pending/paired |
| `GET /api/agents/catalog` | Connector catalog for the spec editor (Personas live list, else the built-in fallback; `source` says which) |
| `POST + GET /api/jobs/[id]/agent-fit` | Start the backgrounded transform (returns `{taskId}`) / read the latest stored spec |
| `POST /api/agents/dispatch` | `{jobId, overrides?}` → merge overrides onto the stored spec, mint the hire, POST the persona request |
| `POST /api/agents/[id]/refresh` | Poll Personas for the request state (pull fallback), map it onto the row; returns the same safe projection as the roster — `reportToken` is stripped on every response path |
| `POST /api/agents/report/[token]` | PUBLIC inbound report route — the CSPRNG token is the capability |
| `app/_lib/agent-hire/*` | `bridge-store` (encrypted config, env override), `bridge-client` (loopback fetch helpers), `pairing`, `transform-run`, `report-payload` |
| `app/_lib/db/agents.ts` | Records, statuses, activity ledger, aggregates |
| `pipeline/jobfit/agentfit.py` + `agentfit_cli.py` | The job → AgentFitSpec transform (LLM + deterministic fallback) |

## Data model

Three tables (all tenancy-scoped by `workspace_id`; see `app/_lib/db/agents.ts`):

- **`agent_fit_specs`** — versioned per-job transform artifacts (`fit`, `spec`, `budget`,
  `metrics` JSON + `source`); the latest row per job is what dispatch reads.
- **`hired_agents`** — one row per hire: job link, persona identity (filled on approval),
  status, dispatched spec/fit/metrics, `budget_usd`, and the CSPRNG `report_token` (the
  only gate on the public report route; retired agents' tokens are dead). The token is
  **server-side only**: every recruiter-facing read (`GET /api/agents`,
  `POST /api/agents/[id]/refresh`) returns `Omit<HiredAgentRecord, "reportToken">`,
  because a client holding it could post lifecycle/execution reports for that agent with
  no session at all.
- **`agent_activity`** — the activity ledger: `execution` events (idempotent by
  `exec_id`), `rollup` periods (upsert — Personas reports absolutes; a month's rollup is
  authoritative over that month's events), `lifecycle` audit rows.

Plus the single-row **`personas_bridge`** config (base URL + AES-256-GCM-encrypted `pk_`
key; `PERSONAS_BRIDGE_URL`/`PERSONAS_BRIDGE_KEY` env vars beat the stored row).

## Gating & keyless behavior

- **Nav gating**: the Agents tab is visible when `NODE_ENV !== "production"` **or**
  `NEXT_PUBLIC_KP_AGENT_HIRING=1` (`AGENTS_TAB_IN_NAV` in `app/features/shell/tabs.ts`, the
  About-tab two-place pattern — a direct `?tab=agents` falls back to the default when off;
  the `NEXT_PUBLIC_` prefix is required because the flag is read in the client bundle too).
  The Agent fit tab and the Integrations card are not separately gated.
- **Keyless transform**: without a reachable LLM the transform degrades to a keyword
  heuristic — the verdict stays `unassessed` and the UI labels the spec as heuristic.
- **Bridge-less transform**: the connector catalog degrades to a built-in static list
  when Personas is unpaired/down; assessment never depends on the bridge being alive.
  Dispatch does require pairing and says so.
- **Localhost-only bridge**: Personas is a local desktop app
  (`http://127.0.0.1:9420` default) — the bridge client is loopback by design and
  deliberately skips the SSRF egress guard. The URL comes only from operator config/env.

## Known gaps

- **Edge terminal-write reporting**: an execution report that dies mid-request can be
  lost; the monthly rollup path (authoritative per month) covers the drift.
- **Cost is provider-self-reported**: spend comes from the provider CLI's own numbers and
  can read $0 on subscription auth — the roster labels it as such.
- **Pairing TTL**: the pairing nonce lives 300s in memory on both sides; a server restart
  mid-pairing means starting over (surfaced as the timeout state with a retry).
- **Metrics are not editable pre-dispatch**: the dispatch route always reads success
  metrics from the stored spec; the tab shows them read-only.
- **Roster lifecycle history**: `GET /api/agents` serves aggregates, not the per-agent
  `agent_activity` rows — the row detail shows metrics vs actuals, not the event log.
