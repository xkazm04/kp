# Agents — the agent-candidate bridge

kp can hire an **AI agent** for a role instead of (or alongside) a human: a job is
transformed into an *agent-fit spec* (which responsibilities an agent could own, what it
should cost, how to measure it), the spec is dispatched to the external **Personas**
desktop app as a persona request, a human approves it there, and the hired persona
reports cost/activity back into kp, where it rides the pipeline like any other hire.

## Entry points

| Surface | Where | What it does |
| --- | --- | --- |
| **Agent fit** tab | Job detail modal (`app/features/library/jobs/JobsAgentFitTab.tsx`, 7th tab of `JobsPostingModal.tsx`) | Assess the role, edit the spec, dispatch, track the hire's status. Also points at the **App master** intake: owning a whole application is a different question from automating this job's tasks, and it needs an input this tab does not have (the codebase) — see [docs/features/app-master/README.md](../app-master/README.md) |
| **Agents** nav module | Sidebar, hiring group (`app/features/agents-workforce/AgentsWorkforceTab.tsx`) | Roster of hired agents: status, spend vs budget, runs, connectors, expectations verdict |
| **Personas bridge** card | Settings → Integrations (`app/features/settings/integrations/IntegrationsPersonasPanel.tsx`) | Two-phase human-approved pairing, base-URL override, disconnect |

## User flow

1. **Pair** (once): Settings → Integrations → *Connect to Personas*. kp registers a
   pairing request (`POST /api/agents/pair {phase:"start"}`), the operator approves it in
   the Personas desktop app, and the card's 2s claim poll (`{phase:"claim"}`) picks up the
   `pk_` key — stored encrypted, write-only (reads expose only `hasKey`).
   Encrypted at rest means a master key is **required**: both phases refuse with
   `503 AGENT_PAIR_NO_SECRET` when neither `KP_SECRET` nor `KP_ATS_SECRET_KEY` is set,
   before anything is registered and before the single-use claim is spent. It used to
   fail *inside* the claim — after the human had approved in Personas — with a message
   about the ATS webhook signing secret; `e2e/app-master-hire.spec.ts` found that on its
   first run, and `agent-hire.test.ts` pins the refusal now.
   Both bridge calls send an **`Origin` header** (`publicBaseUrl()`): Personas reads the
   pairing origin from that header only and binds the minted key + CORS entry to it — a
   server-side Node fetch sends none by itself, so pairing died with `400 Origin header
   required` on first live contact (bench sweep 2026-08-24). The P5b mock had accepted
   origin-less pairing, which is how a green e2e hid it; the mock now refuses like the
   real bridge.
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
   **Both agent doors are throttled per IP.** Dispatch and pairing spawn real outbound
   work behind `requireOperator()`, which open mode (no `KP_OPERATOR_PASSWORD`) makes a
   documented no-op for the whole API — so each self-limits, in the idiom
   `app/api/rate-limit-contract.test.ts` states for every spend door:
   `agent-dispatch:<ip>` 10 / 10 min (inside `mintAndDispatch`, i.e. after every cheap
   refusal and after the one-live-agent idempotency reuse, so a rejected or idempotent
   call costs nothing), `agent-pair:<ip>` 10 / 10 min for the start phase, and
   `agent-pair-claim:<ip>` 120 / 10 min for the claim poll — laxer because the panel
   polls claim for the full 300s TTL along a 2s→15s backoff. All three answer the shared
   `TOO_MANY_REQUESTS` code, so the card says it in the reader's language. The public
   report receiver keeps its own per token+IP budget (60 / 60 s), now pinned
   behaviourally by `app/api/agents/report/[token]/report-throttle.test.ts`.
   **An expired pairing key is its own answer.** Personas rejecting kp's stored `pk_`
   (a 401 upstream) comes back as a 502 whose code is **`AGENT_BRIDGE_KEY_INVALID`**,
   with the message *"Personas rejected kp's API key (401) — the pairing key has expired
   or been revoked. Re-pair in Settings → Integrations."* The status stays 502 (the house
   convention for a bridge failure) but the code separates a dead credential from an
   outage: nothing is broken except the key, and the fix is one re-pair — reading it as
   `AGENT_DISPATCH_BRIDGE_FAILED` sends the operator looking for a server that is running
   fine. Personas' **headless auto-pair keys live 24 hours**, so this is a routine
   morning-after state, not an exotic one. The refresh poll surfaces the same code beside
   its `refreshed:false` reason. A non-401 upstream keeps the generic code — both halves
   pinned by `agents-bridge.test.ts`.
   **An UNREADABLE key is a third state, not the same one.** The stored `pk_` is held
   encrypted (`ats-secret.ts`), so `resolveBridge()` *throws* when `KP_SECRET` /
   `KP_ATS_SECRET_KEY` is unset or has rotated since pairing. That call sat outside the
   try in dispatch, poll and both pairing phases, so the throw went straight past
   `bridge-client.ts`'s stated error model ("every helper returns a structured result and
   NEVER throws to the route") — and the message it carried named the *ATS webhook signing
   secret*, a feature the operator was not using. Every helper now resolves through
   `resolveBridgeOrFail()`, which returns code **`AGENT_BRIDGE_KEY_UNREADABLE`** with a
   Personas sentence naming the env var; nothing dials Personas with a key kp cannot read.
   This is the client half of the same wrong-error trap `pairing.ts` guards with
   `AGENT_PAIR_NO_SECRET` (pinned by `agent-hire.test.ts`, which rotates the secret between
   the pairing phases to reach the claim's resolve step).
4. **Approve in Personas**: the status ladder is
   `dispatched → pending_approval → onboarding → active` (terminal: `rejected`,
   `failed`, `retired`). The push path is the token-authed public report route; the
   *Refresh* button is the pull fallback (`POST /api/agents/[id]/refresh`). Activation
   auto-moves the pipeline entry to Hired.
   **The button answers.** The route's reply is a typed non-continuation, not a bare 200:
   `refreshed:true` with the new `personasStatus`, or `refreshed:false` with either a
   `reason` (+ `code`) or the unchanged `personasStatus`. The row rendered all of them
   identically — spinner stops, nothing moves — so a dead 24h pairing key, an agent that
   was never dispatched and a real transition were the same non-event on screen. Each
   branch now writes its outcome into a `role="status"` line beside the button, resolved
   from the machine `code` through `useErrorMessage()` (never the server's English
   `error`), and only a real transition refetches the roster. `AGENT_BRIDGE_KEY_INVALID`
   and `AGENT_BRIDGE_KEY_UNREADABLE` are in the `errors` catalog in all four locales, as
   is `AGENT_REFRESH_NOT_DISPATCHED` — the "there is no Personas request to poll" branch,
   which used to ship a `reason` and no code and so landed every operator on the generic
   localized sentence with no remedy in it.
   Known gap: the route's "no Personas request to poll" reason carries no code, so it
   lands on the localized generic rather than on its own sentence.
5. **Counters flow back**: the hired persona reports executions/rollups/lifecycle events
   through `POST /api/agents/report/[token]`; the Agents module shows aggregates (runs,
   success rate, month spend vs budget, connector use) and a client-computed
   "n/m expectations met" verdict (`agentsWorkforceLogic.expectationsVerdict`).
   `metricActual` maps a metric key onto that ledger, and a **cost** key is read as a
   rate or a total depending on its name: `cost_per_task` — the ceiling agentfit ships
   (`suggestedMonthlyUsd / 20`) — is spend ÷ runs, not the month's bill, because
   comparing a per-task ceiling against the month total reported every busy-but-cheap
   agent as far over the cost it was hired at. A cost target is scored only once
   something has actually been costed: an uncosted ledger reads `–` ("no data"), never a
   ✓, since the provider CLI reports $0 on subscription auth. An unmapped key stays `–`.

## API / lib surface

| Path | Role |
| --- | --- |
| `GET /api/agents` (`app/api/agents/route.ts`) | Roster + per-agent aggregates (report token never leaves the server) |
| `GET/DELETE /api/agents/bridge` | Connection status (key presence only) / disconnect (clears the stored key; 409 for env-driven config) |
| `POST /api/agents/pair` | Two-phase pairing: `{phase:"start", baseUrl?}` → `{nonce}`; `{phase:"claim", nonce}` → pending/paired |
| `GET /api/agents/catalog` | Connector catalog for the spec editor (Personas live list, else the built-in fallback; `source` says which) |
| `POST + GET /api/jobs/[id]/agent-fit` | Start the backgrounded transform (returns `{taskId}`) / read the latest stored spec |
| `POST /api/agents/dispatch` | `{jobId, overrides?}` → merge overrides onto the stored spec, mint the hire, POST the persona request. **Or `{intakeId}`** — the App-master path (below) |
| `POST /api/agents/[id]/refresh` | Poll Personas for the request state (pull fallback), map it onto the row; returns the same safe projection as the roster — `reportToken` is stripped on every response path |
| `POST /api/agents/report/[token]` | PUBLIC inbound report route — the CSPRNG token is the capability |
| `app/_lib/agent-hire/*` | `bridge-store` (encrypted config, env override), `bridge-client` (loopback fetch helpers), `pairing`, `transform-run`, `report-payload` |
| `app/_lib/app-master/backbone.ts` | The performance backbone scored in TS — a pinned port of `pipeline/jobfit/appmaster.py::backbone_score` (parity fixtures in `__fixtures__/`, generated by the Python function itself) |
| `app/_lib/db/agents.ts` | Records, statuses, activity ledger, aggregates |
| `pipeline/jobfit/agentfit.py` + `agentfit_cli.py` | The job → AgentFitSpec transform (LLM + deterministic fallback) |
| `pipeline/jobfit/agentfit.py::assess_population_fit` | A SECOND question in the same module, for the App master role: given a `RepoDossier` and the outcomes a requestor chose, who should hold the role — `human \| agent \| hybrid \| unassessed`. Reuses this module's `COVERAGE_CLASSES` and `coverage_ratio` (code-owned on both paths); the verdict is derived from the ratio in code, and the keyless path never returns `automatable`. Consumed by the intake shape `app_master` — see [docs/features/app-master/README.md](../app-master/README.md) |

## Hiring an App master by intake (P4)

A second origin for the same dispatch. The **App master** role (owning one application's
value rather than a job's tasks) is composed in the Intake dialog, not from a job posting —
see [docs/features/app-master/README.md](../app-master/README.md) — so
`POST /api/agents/dispatch` accepts `{intakeId}` as an alternative to `{jobId}`:

1. the intake's stored `AppMasterSpec` is re-validated against `appMasterSpecSchema` (it
   crosses a JSON column, and a half-parsed mandate must never reach a dispatch — a spec
   that no longer matches the contract is a 409 `AGENT_DISPATCH_SPEC_STALE`, not a
   best-effort send);
2. `role.population` must be `agent` or `either`. `human` is a **400**
   (`AGENT_DISPATCH_HUMAN_POPULATION`), refused before a byte leaves the process — hiring an
   agent into a role the fit transform judged human-only is exactly the decision this
   feature exists to make visible;
3. the flat `spec` the bridge has always sent is **projected** from `appMaster.agent`
   (name / mission / systemPromptDraft / connectors / maxTurns), with
   `maxBudgetUsd = appMaster.budget.monthlyUsd` and `successMetrics` = the objectives;
4. the whole `AppMasterSpec` rides **beside** it as `appMaster` on the wire (additive: a
   Personas build without the hire handler v2 still receives a complete flat spec), and is
   persisted on the hire as `hired_agents.app_master_spec_json` — the mandate the agent is
   actually working under is the one that crossed the wire, not whatever the intake is
   re-composed into later;
5. idempotency, failure marking and the last-place board write are the job path's,
   unchanged (`agents-bridge.test.ts`) — with one carve-out: **one live agent per intake**
   instead of per job, and **no pipeline card at all**, because an App master owns an
   application and there is no job column its card would belong to. The roster is that
   hire's home.

`hired_agents` gained two nullable columns for this (`intake_id`, `app_master_spec_json`,
migrated in `db/agents.ts`, one owner per table). `job_id` stays `NOT NULL` in the DDL and
is the **empty string** for an intake-originated hire; every read that would navigate to a
job checks for it (the roster renders the role as plain text, `getActiveHiredAgentForJob`
excludes it, and the activation → Hired move in both the report and refresh routes is
skipped).

The dispatch payload kp sends:

```jsonc
{
  "kp": { "baseUrl": "…", "jobId": "", "jobTitle": "App master — kp",
          "workspace": "workspace", "intakeId": "intake-…" },
  "spec": { "name": "…", "mission": "…", "systemPromptDraft": "…",
            "connectors": ["github"], "maxBudgetUsd": 120, "maxTurns": 40,
            "successMetrics": [{ "key": "gate_green_rate", "target": 0.95, … }] },
  "reportToken": "agrpt-…",
  "appMaster": { /* AppMasterSpec exactly as schemas:gen defines it */ }
}
```

## Reporter v2 — the App-master backbone

`POST /api/agents/report/[token]` takes additive fields on two of its three shapes.
Everything below is optional; a Personas build that predates reporter v2 keeps validating
unchanged, and its rollups stay **distinguishable from a sender reporting zeroes**.

**Rollup** gains `proposalsOpened`, `proposalsMerged`, `proposalsReverted`, `gatePassRate`
(0..1 or null), `forbiddenClassViolations`, `kpiDeltas[]`
(`{kpiKey, baseline, current, target, direction, windowDays, measured}`),
`budgetReservedUsd`, `budgetSettledUsd`, `budgetUnmeasured`, `ledgerConsistent` and
`autopilotMode` (`off|measure|suggest|full`). They are bounded at `report-payload.ts` like
everything else inbound, plus three **internal-consistency** rules, for the same reason
`runs` is corrected up to `successes + failures`: the roster divides these against each
other.

- `merged ≤ opened` and `reverted ≤ merged` — corrected **down**, because a merge implies
  an open and inflating the open count would invent proposals nobody saw. `{opened:5,
  merged:9}` otherwise rendered a 180% delivery rate.
- `gatePassRate` is clamped into 0..1; counts floor at 0 (a negative violation count is
  never a credit); a `kpiDelta` with no `kpiKey` is dropped (nothing could match it to an
  objective) and an unstated `measured` is **false**, never a scored miss.
- `budgetUnmeasured: true` means the settled figure is **reported but not adherence** — the
  backbone withholds the budget rule entirely rather than scoring an unmetered window as
  perfect. A rollup that reports neither budget number is treated the same way: "unmeasured
  is not free", and a $0 window nobody measured is not a cheap one.

The block is stored in the rollup row's `raw_json` beside `runs`/`successes`/`failures` —
the same JSON column, so no migration — and `getLatestAgentRollupRaw` reads the latest
period back. Rollups are absolutes per period, so the **latest period IS the review
window**; summing periods would blur two windows into a number describing neither.

**Lifecycle** gains the event `probation_review` with `{decision, note}`, where `decision`
is `activated | extended | retired` and is **required** (a probation review with no decision
is not a review — it is a deterministic 400). The status transition is the decision, not the
event: `activated → active` (and the same board move a plain `activated` performs),
`retired → retired`, and `extended → onboarding` — more probation is not a promotion, and
rendering it as one would put a green "Active" on an agent a human just declined to
activate.

### What the roster does with it

`GET /api/agents` adds, for App-master rows only:

- `appMaster: {population, scopeRung, probationDays, autopilotMode}` — a **projection** of
  the dispatched spec, not the spec (the system prompt and the forbidden-class vocabulary
  are not roster data). `autopilotMode` comes from the latest rollup, never from the spec:
  a spec saying "probation ⇒ suggest" is an intention, the rollup is the reading.
- `backbone` — the full `backbone_score` dict for the latest reported window (rules with
  their per-rule contributions and reasons, gates, `scoredWeight`/`totalWeight`,
  `coverage`, `score`, `unmeasured`, `verdict`), or `null` when nothing has reported one.
- `kpiDeltas` — the per-objective readings behind that verdict.

`reportToken` is stripped on this path as it always was. The row leads with the verdict on
the shared ✓ / – / ✗ convention (`pass` / `incomplete` / `fail`) — **`incomplete` is a dash,
never a soft ✓**: it means the scorer could not read enough to judge, and the score is
reported over the *scored* weight with `coverage` beside it so a 1.0 across 5% of the record
cannot read as a perfect agent. Expanding a row shows every rule's contribution and reason,
the gates (a forbidden-class violation fails the verdict outright — a gate is not a weight),
and the probation countdown. `expectationsVerdict` switches to the reported `kpiDeltas` when
they are present, because an App master is hired against a value ledger and scoring it on
run counts answers a question nobody asked; an objective with no delta, or one whose delta
says `measured:false`, reads `–`.

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
  authoritative over that month's events), `lifecycle` audit rows. Everything inbound is
  bounded at the `report-payload.ts` trust boundary (string caps, finite non-negative
  numbers, list caps) — including internal consistency: a rollup claiming more outcomes
  than runs has `runs` corrected up to `successes + failures`, because the aggregates
  divide the two and `{runs:2, successes:5}` otherwise rendered a **250% success rate**
  (and a ✓ against a "≥ 90%" expectation).

Plus the single-row **`personas_bridge`** config (base URL + AES-256-GCM-encrypted `pk_`
key; `PERSONAS_BRIDGE_URL`/`PERSONAS_BRIDGE_KEY` env vars beat the stored row).

### Reading the silence: `hired_agents.last_report_at`

`hired_agents.last_report_at` is the **liveness receipt** — stamped by
`recordAgentReportReceipt` as soon as a live token resolves on
`POST /api/agents/report/[token]`, *before* the body is read or parsed. It is the inbound
twin of the channels receiver's `recordChannelWebhookReceipt`, and it exists because three
different clocks were being read as one:

| Signal | Answers | Moves when |
|---|---|---|
| `last_report_at` | did Personas reach kp? | any authenticated POST on the report route, **accepted or rejected** |
| aggregates' `lastActivityAt` | did Personas report real work? | an **accepted** execution/rollup/lifecycle event |
| `personas_bridge.last_ok_at` | can kp reach Personas? | an **outbound** dispatch/catalog/claim succeeds |

What it means: a hire showing no runs but a recent `last_report_at` is being heard from —
so a silent roster is the agent's own idleness or a payload kp is rejecting (check the
route's 400s), not a broken callback. What it does **not** mean: it is not proof any work
happened, and it never moves for an unknown or retired token, so a hire whose token was
rotated stays at "never heard from" exactly like one that was never contacted. The roster
renders it on the no-runs row (`agentsWorkforce.heardFrom` / `.neverHeardFrom`).

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
  "Loopback by design" describes the URL kp *dials*, so every bridge call (catalog,
  dispatch, status poll, both pairing phases) is issued `redirect: "manual"` like
  `ats-egress.deliver()`: a followed 307/308 replays method **and body** to wherever the
  answer points, and the dispatch body carries the `reportToken` — the only auth on the
  public report route. A 3xx is reported as a redirect, never as an acceptance.

## Known gaps

- **Edge terminal-write reporting**: an execution report that dies mid-request can be
  lost; the monthly rollup path (authoritative per month) covers the drift.
- **Cost is provider-self-reported**: spend comes from the provider CLI's own numbers and
  can read $0 on subscription auth — the roster labels it as such.
- **Pairing TTL**: the pairing nonce lives 300s in memory on both sides; a server restart
  mid-pairing means starting over (surfaced as the timeout state with a retry).
- **Metrics are not editable pre-dispatch**: the dispatch route always reads success
  metrics from the stored spec; the tab shows them read-only.
- **App-master hires have no board presence**: an agent dispatched from an intake carries
  `job_id = ""`, so it never appears on the pipeline board and cannot be walked back from a
  job. The roster row's intake link is the only handle; a promoted intake (one that also
  built a JD) does keep its job and its card.
- **The backbone is scored from the LATEST period only**: an agent that reported August and
  then went quiet keeps showing August's verdict. There is no multi-window trend, and no
  staleness marker on the verdict beyond the period the rollup names.
- **Two implementations of one scorer**: `backbone_score` exists in Python (the authority)
  and TypeScript (the read path). They are pinned by generated fixtures
  (`app/_lib/app-master/backbone.test.ts`), but a change still has to be made twice.
- **Roster lifecycle history**: `GET /api/agents` serves aggregates, not the per-agent
  `agent_activity` rows — the row detail shows metrics vs actuals, not the event log.
