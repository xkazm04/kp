# Organization & Multi-User (Teams) — Impact Analysis & Plan

_Scan date: 2026-07-05. Scope requested: turn the solo-operator app into
Organization → Team → User with team-level data separation and cross-company
(cross-team) reference data. Areas assessed: Organization page, Billing,
Library (`?tab=library`), Schedule (`?tab=schedule`), Decisions
(`?tab=decisions`), Channels (`?tab=channels`), Pipeline (`/`)._

---

## 1. Executive summary

The app is architecturally **single-operator** today, but it already carries a
**half-built tenancy seam** that the requested model maps onto almost exactly.
Two facts frame everything below:

1. **There is no user identity.** Auth is one shared `KP_OPERATOR_PASSWORD`; the
   session cookie payload is only `{ workspace, iat, exp, epoch }`
   (`app/_lib/auth/session.ts:21`). `isOperator()` is binary
   (`app/_lib/auth/require-operator.ts:22`). Nothing records _which_ person did
   anything — pipeline attribution is only `auto` vs `human`, never a user
   (`app/_lib/decision-attribution.ts:95`). **"Assign users into teams" requires
   building an identity layer (users, memberships, roles, invites) that does not
   exist yet.** This is the single largest piece of work.

2. **The tenancy boundary already exists but is ~10% wired.** `session.workspace`
   is the tenant key, `currentWorkspace()` resolves it, `/api/auth/switch-workspace`
   re-mints it, `createWorkspace()` exists, and a boot guard (`assertTenancyReady`,
   `app/_lib/tenancy.ts:63`) refuses to enable `KP_MULTI_WORKSPACE` until the data
   layer is fully scoped. **But only 2 of ~40 tables are verified scoped**
   (`analyses`, `profiles` — `app/_lib/tenancy.ts:22`); a prior scan found only
   **9 of 129 API routes** call `currentWorkspace()`.

**Recommended mapping:** the existing `workspace` becomes the **Team** (the
data-isolation boundary — a perfect fit for "1–2 users per team, teams
separated"); a new **Organization** parent groups teams for billing and the
cross-company reference pool; **Users** are a new entity assigned to teams. This
reuses the `workspace_id` machinery instead of inventing a second scoping
dimension. See §3.

**Bottom line on effort:** the UI shells (Organization page, onboarding wizard,
billing catalog, Polar integration) are already built and shaped to drop real
data in. The work is almost entirely **backend**: an identity model, finishing
`workspace_id` scoping on ~38 tables, an org-level billing key with seats, and
three genuinely hard structural items (§6).

---

## 2. Current-state inventory (what exists vs. what's real)

### 2.1 Identity & auth — _net-new, ~0% built_
- Session = `{ workspace, iat, exp, epoch }`, HMAC-signed, stateless, 7-day TTL
  (`session.ts:19,21`). No `userId`, email, name, or role.
- One shared operator password; binary operator/non-operator gate
  (`require-operator.ts`). The five UI roles (Owner/Admin/Recruiter/Hiring
  manager/Viewer) have **no server-side meaning** (`sub_organization/mock.ts:9`).
- No `users`, `members`, `teams`, `invites`, or `roles` table anywhere.
- Route gating is a fail-closed edge proxy (`proxy.ts`) with a public allow-list;
  it authenticates the _session_, never a _user_.

### 2.2 Organization page (`?tab=organization`) — _shell real, data mocked_
- `OrganizationConsole.tsx` renders members/roles/seats/invites — but every
  people interaction is **local React state** (`OrganizationTab.tsx:64`). Members
  come from `MOCK_MEMBERS` (`mock.ts:46`); `seats: 25` and `domain: "csas.cz"`
  are hardcoded literals.
- Only **two** settings persist: org **name** (cookie `kp_org_name`,
  `org-actions.ts:17`) and app **language** (locale cookie + `workspaces.default_locale`,
  `org-actions.ts:32`). No branding, no seat store, no member store.
- The onboarding wizard (`features/setup/`) collects orgName/language/invites/
  first-job but **discards all of it** on "Enter KP" — the final button just calls
  `onClose` (`OnboardingWizard.tsx:139`). `InviteEditor` sends no email and creates
  no record. It is only reachable from a "Preview onboarding" button, not a
  first-run trigger.
- `/api/auth/switch-workspace` is **hard-locked**: any target other than the
  default workspace returns 403 until `KP_MULTI_WORKSPACE=1`
  (`switch-workspace/route.ts:25`, `workspace-lock.ts:31`).

### 2.3 Data layer — _2 of ~40 tables scoped_
All persistence — the `db/*.ts` modules **and** every `*-store.ts` — writes to
one shared SQLite file; there are **no JSON or in-memory stores**. A table is
"scoped" only when read **and** write filter on `workspace_id`, proven by a
colocated `*-tenancy.test.ts`.

| Group | Tables | Scoped today |
|---|---|---|
| **Verified scoped** | `analyses`, `profiles` | ✅ (2) |
| **Column present, reads blind** | `pipeline_entries` | ⚠️ inert (always `'workspace'`, ~2 of ~15 reads filter) |
| **Exempt (genuinely global)** | `workspaces`, `gemini_cache`, `llm_config`, `scheduler`, `scheduler_runs`, migrations | — |
| **GAP — no `workspace_id`, no filter** | `jds`, `jd_revisions`, `jd_templates`, `jobs`, `job_ingests`, `pipeline_events`, `consent_events`, `channel_webhooks`, `channel_spend`, `dev_outbox`, `analytics_targets`, `campaign_packs`, `tasks`, `dev_cases/postings/submissions/sessions/session_events/lifecycle/audit/control/outcomes`, `skill_profiles`, `interview_sessions`, `interview_preps`, `schedule_invites`, `offers`, `decision_records`, `decision_config`, `application_status_links`, `onboarding_*` (5), `rediscovery_alerts`, `group_evals`, `ats_config`, `provider_keys`, `llm_usage`, `billing_state/events/credits/usage/alerts` | ❌ (~38) |

Two safety notes from the scan:
- **Boot-guard hole:** `assertTenancyReady` enumerates `sqlite_master` at the end
  of `ensureDb()`, but the `*-store.ts` tables are created **lazily on first
  request** — so the guard can green-light a DB that still has ~20 unscoped store
  tables. Must be fixed before trusting the flag.
- **Whole-DB export/import** (`api/workspace/export`) reads/writes every table
  regardless of caller — a cross-tenant exfiltration/clobber channel the moment
  multi-tenant is on.

### 2.4 Billing — _global singleton, no seats_
- `billing_state` has exactly one row `id='workspace'` (`db/billing.ts:19`); the
  other four billing tables (`events/credits/usage/alerts`) have **no tenant
  column at all**. Metering (`recordMeterUsage`, `meterGate`) takes **no workspace
  argument** — limits are per-deployment.
- 4 hardcoded plans (`free/starter/growth/byom`) + one top-up pack, meters
  `ai_candidates / case_designs / interview_minutes` (`billing/plans.ts:28`).
- **No seat/quantity concept** — checkout posts a single product with no quantity
  (`polar.ts:128`).
- **Polar is a real, complete integration** (checkout, portal, signature-verified
  webhooks) behind a provider-agnostic `BillingGateway` seam — the clean part.
- `llm_usage` (internal cost ledger) is global, has no tenant/user column, and is
  written from the Python sidecar **off the request path** — per-team spend
  attribution is genuinely non-trivial.

### 2.5 Feature areas — where data would split
| Area | Backing tables | `workspace_id`? | Owner concept today | Notes |
|---|---|---|---|---|
| **Library** | `jds`, `jd_revisions`, `jd_templates`, `jobs` | none | none | Request/response only (no realtime). **Latent bug:** `/api/jds` calls `countAnalysesByJd()` with no arg → shows the _default_ workspace's counts to every team (`api/jds/route.ts:18`). |
| **Pipeline** | `pipeline_entries` (inert col), `pipeline_events` (no col) | partial/none | `source_*` only; no assignee | `[id]` action routes keyed by entry id only — **any session can mutate any entry**. Realtime = 30s poll + origin-wide `BroadcastChannel` + workspace-blind automation heartbeat. |
| **Schedule** | `schedule_invites`, `interview_sessions`, `interview_preps` | none | free-text `interviewer` in prep JSON | **One global calendar**: `bookedSlots()` is global, so any team booking "Tue 14:00" blocks every team. No host/availability model. |
| **Decisions** | `decision_config` (by `phase`), `decision_records` (global hash chain) | none | `actor` role string | **`decision_records` is a single global tamper-evident hash chain** — Team A's integrity proof cryptographically reads Team B's rows. Hardest blocker (§6). |
| **Channels** | `channel_webhooks`, `channel_spend`, `dev_outbox` | none | transitive via `job_id` (and `jobs` has no owner) | Inbound = public token → webhook → job → `intakeLead`. Team ownership must ride the token/job. Idempotency & email-dedup must scope per team. |

**`jobs` has no `workspace_id`** and every area pivots on it (channel→job,
decision roleKey=jobId, schedule carries jobTitle). **Scoping `jobs` is a
prerequisite for Library, Pipeline, Schedule, Decisions, and Channels.**

---

## 3. Recommended data model

```
Organization (the customer company — e.g. Česká spořitelna)
│   • owns the subscription (billing) and the cross-team reference pool
│   • has a domain, branding, default locale
│
├── Team  ==  today's `workspace`  (the data-isolation boundary, 1–2 users)
│     • private: pipeline, candidates, schedule, decisions, channels, offers
│     • scoped by the existing `workspace_id`
│
└── User (belongs to an org; member of one or more teams via a role)
      • Owner / Admin / Recruiter / Hiring manager / Viewer
```

- **Team = workspace.** Rename conceptually; keep the column name `workspace_id`
  to avoid a mass rename. Add `org_id` + `type` to the `workspaces` table so a
  team knows its org, and an org can be resolved from any team.
- **Cross-company ("inspiration") reads** = read across sibling teams sharing the
  same `org_id`. Two tiers, both PII-safe:
  1. **Curated shared library** — nullable `workspace_id` (org-level rows) read
     via `WHERE workspace_id IS NULL OR workspace_id = ?`. Natural fits:
     `jd_templates`, `decision_config` rule templates, outbound message templates.
  2. **Aggregated benchmarks** — `org_id`-join, anonymized/aggregated only, never
     raw rows. Natural fits: salary bands (`analysis_json`), funnel calibration &
     fairness (`pipelineCalibrationPairs`), stage-SLA defaults.
- **Never** cross-share raw candidate PII, `pipeline_events`, `decision_records`,
  transcripts, or comms across teams.

New tables required: `organizations`, `users`, `memberships` (user × team ×
role), `invites` (token, email, role, status, expiry). `teams` can be the
existing `workspaces` table extended with `org_id`.

---

## 4. Per-area impact & required changes

### 4.1 Organization page
Replace the mock with a real backend: `GET/POST/PATCH/DELETE` for members and
invites, backed by `users`/`memberships`/`invites`. Wire the onboarding wizard's
terminal action to actually persist org/language/invites/first-job. Make it a
first-run trigger for a new org. Surface real seat usage from the membership
count vs. the subscribed seat quantity (§4.2).

### 4.2 Billing
- Change `billing_state` PK from the constant `'workspace'` to a real `org_id`;
  add `org_id` to `billing_events/credits/usage/alerts`; thread scope through
  `getBillingState`/`upsertBillingState`, `entitlements.ts`, `enforce.ts`, and
  the 4 route call sites.
- Add a **seat quantity** to `CheckoutRequest` + `createCheckout` (Polar
  per-seat product or metered seats) and capture it in the webhook reducer.
- Route webhooks by `event.customerId → org_id` (provider customer id is already
  stored).
- Enforce seat count against active memberships.
- Per-team/seat metering: add scope to the metering tables + functions;
  attribute `llm_usage` by threading org/team through the Python spawn.
- **Decision to make:** subscription and quotas at the **org** level (recommended
  — one bill per company, seats = users) vs. per-team. Org-level with a seat
  count matches "billing packages" best.

### 4.3 Library
- Add `workspace_id` to `jds` and `jd_revisions`; filter every read/write.
- Fix the `countAnalysesByJd()` latent bug — pass the real workspace.
- Keep `jd_templates` and the `jobs` corpus as the **shared reference tier**
  (nullable `workspace_id`, `IS NULL OR = ?` read), with an optional private
  per-team template. Decide whether a team's own draft JDs enter the org-wide
  rematch corpus.

### 4.4 Pipeline
- Activate the existing `pipeline_entries.workspace_id`: pass `currentWorkspace()`
  into `createPipelineEntry`; add `WHERE workspace_id = ?` to `listPipeline` and
  every entry read.
- **Guard the `[id]` action routes** — verify the entry's workspace matches the
  session before any mutation (today unguarded).
- Scope `pipeline_events` (add a column or JOIN through `entry_id`); handle
  entry-less events (`recordKnockoutDecline`).
- Scope the automation heartbeat (`listActiveEntriesForAutomation`) per workspace.
- Namespace the `BroadcastChannel` per workspace to avoid cross-team reload
  chatter; the 30s poll auto-scopes once the endpoints are scoped.

### 4.5 Schedule
- Add `workspace_id` (and ideally `host_id`) to `schedule_invites`,
  `interview_sessions`, `interview_preps`.
- **Re-scope the global calendar:** `bookedSlots()` and collision detection must
  key on the owner, not treat `slot_at` as a global unique — otherwise teams
  contend for the same abstract slot. This implies a real **host/availability
  model** (per-host working hours + calendar) that doesn't exist today.
- The reminder sweep already joins `pipeline_entries`, so it inherits scoping.

### 4.6 Decisions
- `decision_config` → key `(workspace_id, phase)` with a shared org-level template
  set alongside.
- **`decision_records` is the hard one:** re-architect the single global hash
  chain into a **per-workspace chain** (add `workspace_id`, a per-workspace latest
  hash head, per-workspace `verifyDecisionChain`). Until then, one team's
  integrity proof reads another's sealed rows. This is a design change, not just
  a column add (§6).

### 4.7 Channels
- Put `workspace_id` on `jobs` (the prerequisite) and/or `channel_webhooks`, so
  the inbound receiver resolves `token → webhook/job → owning team` and stamps the
  created `pipeline_entry`, its comms, and decisions with that team.
- Scope `channel_spend` and `dev_outbox`; scope webhook idempotency and
  email-dedup per team so two teams sourcing the same person don't collide.
- Connector setup instructions and message-copy templates are the shareable
  reference content (static / template tier).

---

## 5. Cross-cutting prerequisites (the critical path)
1. **Identity model** — `organizations`, `users`, `memberships`, `invites`; real
   per-user login (or SSO); session payload gains `userId`, `orgId`, current
   `workspace` (team), and `role`; role enforced server-side.
2. **`org_id` + `type` on `workspaces`** so teams resolve to an org.
3. **`workspace_id` on `jobs`** — unblocks Library, Pipeline, Schedule,
   Decisions, Channels.
4. **Finish `workspace_id` on the ~38 gap tables**, each with a colocated
   `*-tenancy.test.ts` and registration in `TENANCY_SCOPED_TABLES` — the gate
   `assertTenancyReady` enforces.
5. **Fix the boot-guard lazy-table hole** so store tables are counted.
6. **Per-workspace export/import** replacing the whole-DB dump.

---

## 6. Hardest / highest-risk items
- **Decision-record hash chain (Decisions)** — cryptographically single-tenant;
  needs a per-workspace chain re-architecture, not a column add.
- **Global calendar → per-host availability (Schedule)** — needs a host/
  availability model that doesn't exist.
- **`llm_usage` per-team attribution (Billing)** — the ledger is written off the
  request path from the Python sidecar; propagating org/team through the spawn is
  non-trivial.
- **Boot-guard lazy-creation hole** — the safety net can pass on an unsafe DB.
- **Demo & session hygiene** — the anonymous demo session can read real PII via
  unscoped tables today; stateless 7-day tokens have no per-session revocation.
  Both should be closed before multi-tenant is enabled.

---

## 7. Suggested phasing

| Phase | Theme | Key deliverables | Rough effort |
|---|---|---|---|
| **0** | Identity foundation | `organizations`/`users`/`memberships`/`invites`; per-user login; session carries user+org+team+role; role gates; real invite flow; wire onboarding to persist | **L** (net-new) |
| **1** | Finish tenancy on the critical path | `org_id` on workspaces; `workspace_id` on `jobs`, then Pipeline (`entries`+`events`+`[id]` guards+automation), Library, Channels, Schedule, Decisions-config; fix `countAnalysesByJd`; fix boot-guard hole; tests + manifest registration | **L** |
| **2** | Cross-company reference tier | Nullable-workspace shared templates (`jd_templates`, `decision_config`, message copy); `org_id`-join aggregated benchmarks (salary, funnel, fairness) | **M** |
| **3** | Org billing with seats | `org_id` key on billing tables; seat quantity in Polar checkout + webhook mapping; seat enforcement vs. memberships; per-team metering; `llm_usage` attribution | **M–L** |
| **4** | Hard structural items | Per-workspace decision-record chain; per-host calendar/availability; per-workspace export/import; demo isolation; per-session revocation | **L** |

Phases 0 and 1 are the critical path and are mostly sequential (identity before
scoping is meaningful, `jobs` before the areas that pivot on it). Within Phase 1,
Pipeline → Channels → Schedule → Decisions can proceed area-by-area, each behind
its own tenancy test, without flipping `KP_MULTI_WORKSPACE` until the whole set
is green.

---

## 8. Key files
- **Identity/auth:** `app/_lib/auth/{session,current-workspace,require-operator,edge-verify}.ts`, `proxy.ts`
- **Tenancy manifest/guard:** `app/_lib/tenancy.ts`, `app/_lib/workspace-lock.ts`, `app/_lib/db/core.ts` (`assertTenancyReady` at `:843`)
- **Org page/setup:** `app/features/sub_organization/{OrganizationTab,OrganizationConsole,mock}.*`, `app/features/setup/*`, `app/_lib/{org-actions,org-settings,org-settings-server}.ts`, `app/api/{workspaces,auth/switch-workspace}/route.ts`
- **Billing:** `app/_lib/billing/*`, `app/_lib/db/billing.ts`, `app/api/billing/*`, `app/features/sub_billing/BillingTab.tsx`
- **Reference implementation to copy for scoping:** `app/_lib/db/{analyses,profiles}.ts` + their `*-tenancy.test.ts`
