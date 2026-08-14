# Organization, teams & tenancy

The solo-operator app has shipped a real **Organization → Team → User** model
(internally "E0"). This doc describes the shipped reality; see **Known gaps**
for what's still open before `KP_MULTI_WORKSPACE` can be flipped for real
multi-team deployments, and `docs/product/enterprise-readiness.md` §1 for how
this gates the rest of the enterprise roadmap.

**Model:** `Organization` (the customer company) owns billing (today: single
workspace, see gaps) and a cross-team reference pool → **Team** (`workspace` —
the existing data-isolation boundary, 1–2 users) → **User** (belongs to an org,
member of one or more teams via a role). Reusing `workspace_id` as "team" avoided
inventing a second scoping dimension.

## Entry points

- **Settings → Workspaces** (`app/features/settings/workspace/WorkspaceTab.tsx`) —
  the console for teams **and** the people on them. See *Surface* below.
- **Settings → Organization** (`app/features/settings/organization/OrganizationTab.tsx`)
  — company identity only: org name, app language, backup/restore.
- `/api/auth/switch-workspace` — re-mints the session for a different team.
- Onboarding wizard (`app/features/shell/setup/`) — first-run org setup.
- **Self-serve signup** (`/signup` + `POST /api/auth/register`) — public
  registration that provisions a brand-new org → team → owner in one
  transaction (`app/_lib/signup-service.ts`) and signs the user in (same
  session mint as login; lands on `/` where the onboarding wizard fires).
  **Gated dark by default:** both surfaces answer 404 unless
  `KP_SIGNUP_ENABLED` is set (`workspace-lock.signupEnabled`) — flipping it on
  is a tenancy-completion decision, since a stranger's account would read
  shared data through any still-unscoped table. Registration is throttled
  per-IP via the persisted login-throttle store (every attempt counts —
  the bounded side effect is tenant creation itself).

## Identity & auth

- Session claims carry real identity: `sub` (userId), `org`, `role`
  (`app/_lib/auth/session.ts`) — no longer just `{ workspace, iat, exp, epoch }`.
- `organizations`, `users`, `memberships`, `invites` tables exist
  (`app/_lib/db/{organizations,users,memberships,invites}.ts`), each with a test
  file. `DEFAULT_ORG_ID = "org-default"` seeds the single-org case.
- **Real RBAC**: five roles (Owner/Admin/Recruiter/Hiring manager/Viewer) with a
  capability set per role plus per-membership overrides
  (`app/_lib/auth/roles.ts`: `roleCan`, `roleAtLeast`, `resolveCapabilities`,
  `canAssignRole`). `org:manage` can never be granted by an override — only the
  owner role carries it, closing a prior privilege-escalation path.
- Open-mode + operator-password sessions fold to `owner` so local dev is
  unchanged.
- **Every server-side session read calls `await connection()` before verifying.**
  `verifySession` checks expiry against the wall clock (`Date.now()`), which
  Cache Components (Next 16.3) treats as an unstable value a prerender may not
  bake in — and reading `cookies()` no longer opts a route into request rendering
  the way the old model did, it only streams that subtree. Without the explicit
  request-time marker, every server render that authenticates logged
  `blocking-prerender-current-time` (`/` did, on every load). The four request-scope
  readers — `currentSession` (`current-user.ts`), `currentWorkspace`
  (`current-workspace.ts`), `isOperator` (`require-operator.ts`) and
  `hasEnteredWorkspace` (`home-gate-server.ts`, password branch only, since the
  open-mode marker read needs no clock) — each mark the clock read explicitly. The
  edge verifier is unaffected: middleware never prerenders.

## Data layer — tenancy scoping

`app/_lib/tenancy.ts` is the single machine-checked manifest of which tables are
workspace-scoped. As of this pass:

- **`tenancyGaps()` is ZERO** and `assertTenancyReady(multiWorkspace=true)`
  passes — every per-team table's read+write paths are workspace-scoped, each
  proven by a colocated `*-tenancy.test.ts` (20+ such files: pipeline, jobs
  corpus, channels, schedule, dev-case + onboarding, offers/status-links/
  skill-profiles, interviews, the background-task queue, `decision_records`).
- **`decision_records`** — the tamper-evident hiring-decision hash chain — has
  been **re-architected to per-tenant chains** (was previously a single global
  chain; this was the hardest structural item). Verified in
  `app/_lib/decision-records-tenancy.test.ts`.
- Org/deployment **config + metering** (`billing_*`, `provider_keys`,
  `brand_settings`, `ats_config`, `analytics_targets`, `decision_config`'s
  org-default tier, `jd_templates`, `llm_usage`) is classified **exempt** —
  org-level, not per-team, by design.
- A **lazy-table hole** in the boot guard (store tables created on first
  request, not at `ensureDb()`) is closed: `TENANCY_LAZY_TABLES` is unioned into
  the guard's check, kept in lockstep by `tenancy-coverage.test.ts`.

Reference implementation for scoping a new table: `app/_lib/db/{analyses,profiles}.ts`
+ their `*-tenancy.test.ts`.

### The route layer, and where the guard belongs

The 40-odd `*-tenancy.test.ts` files pin the SQL **inside** store modules. Every one
of them passed while the app leaked across tenants, because the defect was never in
the SQL — it was one layer up. ~200 store functions **default** their tenant, so a
route that omits the argument silently reads or writes the default team, and no
store-level test can see it. A tab-by-tab audit found ~90 such call sites.

`app/api/route-tenancy-coverage.test.ts` closes that as a **ratchet**: it derives the
tenant-defaulting surface from source, finds every route call that omits the argument,
and asserts the offender set equals a documented allowlist. **The allowlist is empty
and the test passes** — the route layer is clean, and a new route that forgets fails CI.

Two notes for anyone editing that scanner. Comments **inside** a parameter list contain
commas (`actOnPipelineEntry`'s `actor` note makes a naive splitter see 7 parameters,
not 5), and `Record<string, unknown>` splits on its own comma unless generics are
stripped — while *arguments* need the opposite rule, because `=>` reads as a closing
angle. Each side gets the rule that fits it. A guard that cries wolf is worse than
none: the response to a false positive is an allowlist entry, which enshrines it.

Resolve a tenant in this order: from an entity already in scope
(`entry.workspaceId`, `invite.workspaceId`, `sub.workspaceId`, `offer.workspaceId`);
else derived from a linked one (`getEntryWorkspace`, `getJobWorkspace`); else — **only
on a session route, never a public token route or an off-request sweep** —
`await currentWorkspace()`.

### `PipelineEntry` carries its own tenant

`PipelineEntry.workspaceId` exists because its ABSENCE was the root of a whole
family of defects. The row always had `workspace_id`; `rowToEntry` dropped it, so
every function handed an entry had to be told the tenant separately — and ~24 call
sites simply weren't, silently falling back to `DEFAULT_WORKSPACE_ID`. The
automation pass had already worked around this by widening the type locally
(`AutomationEntry = PipelineEntry & { workspaceId }`), which was the tell.

The visible symptom was subtle rather than loud, which is why it survived:
`recordAutomationEvent` writes the event to the RIGHT tenant (`recordEvent`
derives that from an unscoped by-id read) but looked its DISPLAY metadata up with
a tenant-scoped query. On any non-default team the lookup missed, so every
automation event — outreach sent, interview scheduled, rejection sent, offer sent,
onboarding started — was written with NULL `candidate_label` / `job_title` /
`archetype` / `to_stage` and rendered in the Activity feed and drawer history as an
anonymous row. `app/_lib/automation-event-tenancy.test.ts` pins the behaviour, the
field, and a source assertion that every `comms-dispatch` dispatcher passes it.

Safe on the wire: `/api/pipeline` serves this type to the RECRUITER client, which
already knows its own workspace, and every candidate-facing token route projects
explicit fields rather than serializing a row.

**The contract this creates:** every query feeding `rowToEntry` must `SELECT
workspace_id`. Most are `SELECT *` and get it free; the two explicit column lists
(`listPipeline`, `listReconsiderQueue`) name it deliberately. Omitting it does not
fail — the row silently reports the DEFAULT team, which is *worse* than the missing
field it replaced, because the value now looks authoritative. That regression was
caught by a behavioural test, not a source-level one; `listPipeline` shipped it for
exactly one commit.

`DevCaseRecord`, `Posting` and `DevSubmission` carry `workspaceId` for the same
reason (`app/_lib/db/devcase.ts`). `listPostings` used to hand-roll a second mapper
beside `rowToPosting`, which is precisely how it missed the new field; it now
composes the shared one.

**Read paths closed since the manifest went green** (each was previously listed
here as a gap; re-verify against the code before re-adding any of them):

- The pipeline entry-id scheme carries a workspace component for non-default
  teams, and the `tasks` active-dedup index is `(workspace_id, dedupe_key)`
  (`uq_tasks_active_dedupe_ws`).
- The inbound channel receiver files each lead into the webhook's own team
  (`webhook.workspaceId` through `lead-intake`/`cv-intake`).
- **Sidebar attention badges** — `attentionCounts(workspaceId)`
  (`app/_lib/attention.ts`) now takes the tenant and forwards it to
  `listPipeline` / `countFutureConfirmedInvites` / `listJobStatuses`; both call
  sites (`/api/attention` and the server-rendered `WorkspaceNav`) pass
  `await currentWorkspace()`. They previously reported the default team's backlog
  to everyone.
- **Public status + NPS** — `/api/status/[token]` and `.../nps` derive the tenant
  with `getEntryWorkspace(entryId)`, matching the sibling `/decisions` route. A
  non-default team's candidate used to get a 404 on their own status link, and any
  score that landed was filed under the default team's experience metric.
- **Global search (⌘K)** — `searchEntities` bound its `workspaceId` for
  `pipeline_entries` only; profiles, jobs, JDs and analyses accepted the argument
  and ignored it, so two typed letters returned another team's candidate profiles,
  analysis scores and JD drafts, each hit deep-linking to the record. All five now
  filter, with the two predicates that table class requires — strict
  `workspace_id = ?` for the team-private tables, `(workspace_id IS NULL OR = ?)`
  for `jobs`, whose NULL rows are the shared cross-company corpus
  (`db/search-tenancy.test.ts` pins both, including that the corpus stays visible).
- **Background tasks** — all five routes (`/api/tasks`, `/history`, `/seen`,
  `/[id]`, `/[id]/retry`) resolve `currentWorkspace()`, and `getTask` takes an
  optional tenant that routes must pass. This is the single door for every AI job
  the UI starts (`TasksProvider.startTask`), so omitting it broke both directions
  at once: the tray listed the default tenant's rows — task labels embed candidate
  names — and a non-default team's task was stamped for the default tenant, so its
  handler looked the entry up in the wrong team. Six server-side `startTask` sites
  (jd_build ×3, lifecycle ×3) were threaded too. `getTask`'s ownership check also
  closes the Activity chain: `llm_usage.request_id` IS the task id and that ledger
  is deployment-global, so every task id on the box is enumerable from the UI
  (`app/api/tasks/tasks-route-tenancy.test.ts`).

## Authority — org-wide vs per-workspace

A role lives on a **membership**, so it is per team. That makes "an admin can
administer any team in the company" inexpressible with `resolveCaller()` alone,
which only ever resolves against the session's workspace.
`app/_lib/auth/org-authority.ts` states the split explicitly:

- **Administrative** capability (`org:manage`, `members:manage`, `team:manage`)
  is **org-wide** — holding it in any one team confers it over every team of that
  org. `orgAdminCapabilities()` computes the union.
- **Operational** capability (`read`, `pipeline:write`) stays **per workspace** —
  owning team A never reveals team B's candidates.

Request-scope wrappers live in `current-user.ts`:
`callerWorkspaceCapabilities(workspaceId)` / `requireWorkspaceCapability(ws, cap)`
(404 for a workspace outside the caller's org, so a cross-org probe learns
nothing) and `callerOrgCapabilities()` / `requireOrgCapability(cap)` for calls
that target no single workspace, i.e. creating one.

**Entering** a team is separate from administering it:
`POST /api/auth/switch-workspace` requires a real membership (plus an org match).
An org admin can seat people on a team they don't belong to, but cannot park a
session on it — without a membership their capabilities inside it resolve empty,
so the session would 403 on everything anyway.

## Surface

| Layer | File(s) |
|---|---|
| Org/member/invite API | `app/api/org/members/route.ts`, `app/api/org/members/[userId]/route.ts`, `app/api/org/invites/route.ts`, `app/api/org/invites/[token]/route.ts` |
| Workspace API | `app/api/workspaces/route.ts` (GET org-filtered list + memberCount/role/canManage; POST `team:manage`-gated, stamps the caller's org, seats the creator as owner), `app/api/workspaces/[id]/route.ts` (rename), `app/api/workspaces/[id]/members/[userId]/route.ts` (PUT seat/re-role, DELETE unseat) |
| Workspace switch | `app/api/auth/switch-workspace/route.ts` — membership + org required |
| Whole-workspace export/import | `app/api/workspace/export/route.ts`, `app/api/workspace/import/route.ts` |
| DB — identity | `app/_lib/db/organizations.ts`, `app/_lib/db/users.ts`, `app/_lib/db/memberships.ts`, `app/_lib/db/invites.ts`, `app/_lib/db/workspaces.ts` (`listWorkspacesForUser`, `renameWorkspace`) |
| RBAC | `app/_lib/auth/roles.ts`, `app/_lib/auth/org-authority.ts` |
| Tenancy manifest | `app/_lib/tenancy.ts`, `app/_lib/workspace-lock.ts` |
| Business logic | `app/_lib/org-actions.ts`, `app/_lib/org-service.ts` (`addMemberToWorkspace`, `removeMemberFromWorkspace`), `app/_lib/bulk-invite.ts` |
| Workspaces console UI | `app/features/settings/workspace/*` (`WorkspaceTab` shell, `WorkspaceRail`, `WorkspaceDetailPanel`, `WorkspacePeoplePanel`, `WorkspaceMembersTable`, `MemberPermissionsModal`, `MemberConfirmModals`, `useWorkspaceAdmin`, `workspaceAdminHelpers`) |
| Organization UI | `app/features/settings/organization/*` (`OrganizationTab`, `OrganizationGeneralPanel`) |
| Backup & restore UI | `app/features/settings/organization/OrganizationBackupPanel.tsx`, `OrganizationBackupRestorePlan.tsx` |
| Shared presenters | `app/features/shared/memberUi.ts` — role labels/tints, member-status badges, the assignable-role list, the overridable-capability rows |

### The Workspaces console

Two lenses over one dataset (`useWorkspaceAdmin` composes `/api/workspaces` +
`/api/org/members` + `/api/org/invites` in a single parallel fetch):

- **By workspace** — a rail of the org's teams (name, seat count, which one the
  session is in) beside one team's detail: inline rename, Switch, its roster, and
  two ways to add somebody — seat an existing colleague, or invite an address.
  Both write against the selected workspace.
- **By person** — one row per colleague with **every** seat they hold as an
  editable chip, plus a `+` to add another and the account-deletion action.

`workspaceAdminHelpers.teamFor(m, workspaceId)` replaced `primaryTeam(m) =
m.teams[0]` — the single line that made the app single-team. Memberships have
always been many-to-many (`UNIQUE(user_id, workspace_id)`), but every surface read
seat [0], so a person on three teams showed one role three times and there was no
way to put them on a second team.

Removing somebody **from a workspace** and removing them **from the organization**
are now distinct actions with distinct confirms: the first is reversible in two
clicks, the second deletes the account. They used to be the same red X.

The deployment lock (`KP_MULTI_WORKSPACE`) gates create / rename / switch only.
Member administration is org-scoped and stays fully usable while it is off.

### Backup & restore

The whole-database dump/restore (`GET /api/workspace/export`, `POST
/api/workspace/import`) is reachable from this tab, `<Defer>`-mounted below the identity
panel. It used to sit on the Background-tasks tab, beside a health readout and a webhook
form, because that tab was where the operator-only surfaces had collected; taking and
replacing a database snapshot is organization administration, so it lives with the rest of
it now.

Restore is deliberately two-step and loud: pick a file → the route returns a **dry-run
plan** (every table, its row count, and which live tables already hold data) → the operator
types `REPLACE` to confirm. A dump whose tables are all empty on the live side reports
itself as non-destructive and skips the typed confirmation. The copy is fully localized
(`workspaceAdmin.org.backup`) — comprehension is a safety property here, not a nicety —
while the table names it lists stay verbatim, being schema identifiers.

**The explanation is a diagram, not a paragraph** (`OrganizationBackupFlow.tsx`). The panel
used to open with a four-line intro carrying five facts at once, which nobody reads before
clicking and which is too late by the time the confirm dialog is up. Two lanes show the
artefact chain each button walks — `all data → one file` and `your file → preview → all
data` — with the destructive terminal node drawn in coral, so the dangerous direction LOOKS
dangerous before any prose is read. The three scope facts (every workspace, cache/queue
excluded, refused under multi-workspace) are three separate lines instead of subordinate
clauses, and the internal codename is gone from user-facing copy.

**The scope is the whole installation, not one workspace.** One file carries all data
across every workspace (prompt cache and task-runner state excluded); the panel says so.
Per-workspace export/restore waits on workspace data isolation.

## Copy & localization

The console is fully localized in all four locales from the **`workspaceAdmin`**
namespace, split three ways: `org` (header, General panel, the onboarding-preview
button), `members` (roster, invite row, pending invites, both destructive
confirms, and every toast) and `permissions` (the per-user capability editor).
`app/features/settings/organization/**/*.tsx` is held at eslint **`error`** for
`i18next/no-literal-string`.

The interesting part was not the JSX. `app/features/shared/memberUi.ts` is a plain
`.ts` module, so `useTranslations` cannot be called there — yet it owned the five
role names, the three member statuses and the four capability label/description
pairs, and it is imported by `shell/setup/SetupInviteEditor.tsx` and
`app/invite/[token]/AcceptForm.tsx`, two surfaces already at eslint `error` that
were therefore rendering English while looking migrated. Following the "a pure
builder takes its copy as a parameter" rule
(`docs/architecture/localization.md`) and the translator-type idiom of
`hiring/pipeline/pipelineTranslator.ts`, those helpers now take a **bound
translator** from the caller:

| Helper | Signature |
| --- | --- |
| `roleLabel` | `(role, t: MembersTranslator)` — `workspaceAdmin.members.role.<slug>` |
| `statusBadge` | `(status, t: MembersTranslator)` — `workspaceAdmin.members.status.<slug>` |
| `capabilityMeta` | `(t: PermissionsTranslator)` — replaces the old `CAPABILITY_META` constant; `CAPABILITY_ORDER` keeps the slug order and the catalog key per row (a capability slug carries a `:` and cannot be a catalog key) |

`APP_LANGUAGES.native` stays untranslated on purpose — an endonym is a proper
noun in every locale. The list covers **all four** `LOCALES` (it was pinned at
`en`/`cs` until 2026-08, which left the General panel's language control and the
first-run wizard offering half the languages the app ships); `AppLanguage` is now
`Locale` itself and a type-level exhaustiveness check in `memberUi.ts` fails
`tsc` if a locale gains no endonym row. See
[`docs/architecture/localization.md`](../../architecture/localization.md#choosing-the-app-language).

`useWorkspaceAdmin` exposes `error` as a **boolean flag**, not a message: the hook
has no translator, every failure path renders the same line, and the copy lives at
`workspaceAdmin.members.loadError`.

It fires `GET /api/workspaces`, `GET /api/org/members` and `GET /api/org/invites`
**in parallel**. The invite request used to wait for the members payload to prove
`canManage`, which cost the console two serial round-trips on first paint. The
permission check now decides only what is KEPT: the invites response is discarded
unless `canManage` is true (a caller without `members:manage` gets a 403 there,
handled as "no invites"), so nothing gated is ever rendered.

`DEFAULT_WORKSPACE_ID` reaches the console through the `/api/workspaces` payload
(`defaultWorkspace`), not an import — `db/workspaces.ts` opens better-sqlite3 and
cannot enter a client bundle. It is used only to bucket legacy invites, whose
`workspace_id` is nullable.

## Data model

`organizations`, `users`, `memberships` (user × team/workspace × role),
`invites` (token, email, role, status, expiry). "Team" = the existing
`workspaces` table.

Cross-company reference reads (curated shared library + aggregated benchmarks,
never raw PII) are designed but not the current focus of this doc — see the
enterprise-readiness roadmap for sequencing.

## Feature flag

`KP_MULTI_WORKSPACE` (`workspace-lock.ts`) gates workspace **create, rename and
switch**; member administration is org-scoped and works with it off. It is
default-OFF, but it is no longer "wait for the data layer" — that is done. It is
an operator's opt-in to running more than one tenant in a database, and what still
argues for OFF in production is the export/import and billing-seat gaps below.
`assertTenancyReady` (`db/core.ts`) re-proves the manifest at boot when it is on,
so turning it on can only fail loudly.

## Known gaps

The data-layer work is complete; what remains before `KP_MULTI_WORKSPACE` goes
live for real multi-team customers (see `app/_lib/tenancy.ts` comments and
`docs/product/enterprise-readiness.md` §1):

- **Per-workspace export/import.** BOTH halves now answer **503** while
  `KP_MULTI_WORKSPACE` is on (`export-guard.test.ts`, `multi-workspace-guard.test.ts`).
  Import was already guarded; export — the exfiltration half — was not, and
  `requireOperator()` is no substitute: it passes open mode or any valid non-demo
  session and reads neither membership nor role, so any member of any team could
  have downloaded every other team's data in one request. Enabling multi-workspace
  therefore disables backup AND restore until a per-workspace version exists
  (filter every table by `workspace_id`; restore as delete-by-workspace + insert,
  never `DROP TABLE`). This is the biggest remaining reason the flag stays off in
  production.
- **Org-level billing with seats** — the org-keyed DATA layer has landed
  (`org_id` on every billing table, org-keyed entitlement/reducer lookups,
  webhook attribution via checkout metadata; `app/_lib/db/billing-tenancy.test.ts`).
  Still open from enterprise-readiness E6 / org-plan Phase 3: seat quantity in
  Polar checkout + webhook, seat enforcement vs. memberships, per-team metering
  (`docs/features/billing/README.md` Known gaps).
- **Per-team `llm_usage` attribution** — the usage ledger is global; it's
  written from the Python sidecar off the request path, so propagating org/team
  through the spawn is non-trivial (`docs/architecture/llm-provider-layer.md`).
- Per-session revocation (stateless 7-day tokens can't be killed early) —
  needed before enterprise SSO / audit tracks can close out.
- **No workspace deletion.** Rename exists; delete does not, deliberately — a
  team's candidates, decisions and audit chain outlive its label, and there is no
  reassign-or-purge story yet.
- **`POST /api/org/invites` emits no error `code`.** All three of its refusals —
  invalid address (400), inviting above your own privileges (403), and the
  address already belonging to an active member (409) — return only a canonical
  English `error`. The panel therefore routes the payload through
  `useErrorMessage()` and always lands on the localized generic
  (`workspaceAdmin.members.inviteFailed`), so the *specific* reason is lost in
  every language, English included. Fixing it means giving the route real codes
  plus matching `errors.*` catalog entries; no code is invented client-side in
  the meantime.
