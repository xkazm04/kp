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
  — company identity only: org name, app language, backup/restore. There is **no
  domain row**: `organizations.domain` exists in the schema but nothing in the app
  ever writes it (`createOrganization` is called once, from `signup-service.ts`,
  with no domain), so every install has it NULL and the panel was rendering a
  hardcoded `"csas.cz"` behind a padlock — a demo string presented as a locked
  company fact. It is gone until a surface actually sets the column.
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
- **The org can never be left without an owner.** `org:manage` is owner-only and
  `canAssignRole` refuses to grant a role whose capabilities the actor lacks, so
  an org that loses its last owner can never get one back. Every write that could
  produce that state therefore clears `org-service`'s last-owner backstop:
  `changeMemberRole` (demote), `removeMemberFromWorkspace` (unseat),
  `setMemberStatus` (disable), `removeMember` (delete account) — each answers
  `last_owner` → **409**. `PUT /api/workspaces/[id]/members/[userId]` is an
  UPSERT, so it is a demotion path too: when the target already holds `owner` on
  that team it routes through `changeMemberRole` rather than the unguarded
  `addMemberToWorkspace`. It previously did not, and an `admin` could strip the
  org's only owner with one call while `DELETE` on the same route refused it
  (pinned in `app/api/workspaces/workspaces-route.test.ts`).
- **…and the backstop holds under concurrency.** All four writes run through ONE
  seam, `org-service`'s `underOwnerLock`: a `db.transaction(...).immediate()`
  whose callback performs the owner-set read (`isSoleOwner` / `ownerSeatCount`)
  **inside** the lock. They used to read, decide and write unlocked, so two
  operators demoting the org's TWO owners at the same moment both saw a two-seat
  owner set, both concluded "not the last one", and both committed — the exact
  state the guard exists to prevent. Under `BEGIN IMMEDIATE` the second caller
  waits, re-reads a one-seat set and is refused. The seam also re-asserts the
  invariant AFTER the write and rolls back with `last_owner` if the org would be
  left ownerless anyway, so a future operation that forgets its pre-check orphans
  nothing. Pinned by `app/_lib/org-service.test.ts` (a rival demotion forced by a
  trigger; the sequential pair leaving exactly one owner; a source-level check
  that each of the four takes the lock and reads inside it).
- **Removing or disabling a member closes the way back in.** An invite is a
  deferred account — redeeming one activates or re-creates the user with the
  invited role and a fresh password — so `removeMember` and
  `setMemberStatus(id, "disabled")` now also revoke the org's **pending invites
  addressed to that email** (`revokePendingInvitesForEmail`,
  `app/_lib/db/invites.ts`), in the same transaction as the removal. Without it
  an old link in the ex-member's inbox re-minted the account at the invited role
  while the roster showed the seat gone. Scoped to the acting org: a pending
  invite to the same person from a DIFFERENT org is untouched. A removal
  **preview** (`dryRun`) revokes nothing.
- Open-mode + operator-password sessions fold to `owner` so local dev is
  unchanged.
- **Disabling a member bites immediately, not at next login.**
  `capabilitiesForUserInWorkspace` (`app/_lib/db/memberships.ts`) — the live
  authority `resolveCaller`/`currentUser`/`callerWorkspaceCapabilities` read —
  resolves an empty set when the account row is missing or `status = 'disabled'`,
  so `setMemberStatus(id, "disabled")` ends the person's access on their next
  request instead of at the end of their 7-day session. `users.status` was
  previously consulted only by `verifyCredentials`, i.e. at sign-in, so an
  offboarded member's existing cookie kept full `read`/`pipeline:write` on their
  team while the console showed them disabled. Still open: the ORG-WIDE
  administrative path (`orgMembershipGrants` in `current-user.ts`, feeding
  `callerOrgCapabilities`/`callerDelegationCeiling`) does not consult the status,
  so a disabled admin's live session can still reach member/team administration —
  see Known gaps.
- **A login costs the same whether or not the account exists.**
  `verifyCredentials` (`app/_lib/db/users.ts`) verifies against
  `DUMMY_PASSWORD_HASH` (`app/_lib/auth/password.ts` — a real scrypt hash of a
  throwaway secret, computed once at module load) when the email is unknown, the
  account is disabled, or an invited user has no credential row yet. It used to
  return before the hash in all three cases, so the deliberately uniform 401 was
  undone by the clock: microseconds for "no such account" against ~40ms for "wrong
  password" is a user-existence oracle any client can measure.
  `app/_lib/auth/credentials.test.ts` counts the scrypt work rather than the wall
  clock, so the property is pinned without a timing flake.
- **A stored hash carries its own parameters, and upgrades itself on login.** The
  format is `v1$scrypt$<N>$<r>$<p>$<saltB64url>$<hashB64url>`
  (`app/_lib/auth/password.ts`). It used to be a bare `<salt>:<hash>` with the cost
  implied by node's defaults, so there was no way to ask whether a row was behind:
  raising the cost later meant either invalidating every password in the install or
  carrying an undocumented "hashes written before <date> are cheap" rule forever.
  `needsRehash(stored)` now answers that from the row alone — true for a legacy
  untagged value or one below `CURRENT`, false for anything unparseable (no caller
  will ever hold a plaintext proven against it) and for stronger-than-current
  parameters. `verifyCredentials` rewrites the credential on a **successful** login,
  the one moment the plaintext is legitimately in hand; a failed login rewrites
  nothing, and a legacy hash whose password is below today's floor is left alone
  rather than pushed through a write `setUserPassword` would refuse. Legacy values
  still verify at node's defaults, so the change logs nobody out. Pinned by
  `app/_lib/auth/password.test.ts` (both formats, both directions of `needsRehash`,
  malformed values failing closed) and `credentials.test.ts` (the in-place rewrite,
  the failed-login no-op, the below-floor no-op).
- **The password floor is enforced at the store write.** `MIN_PASSWORD_LENGTH`
  lives in `app/_lib/auth/password.ts` (users.ts cannot import `org-service.ts` —
  org-service imports users) and `setUserPassword` throws below it. Signup and
  invite redemption still answer their own `weak_password` refusal first; the
  store check is what covers every OTHER path — `createUser({ password })`, an
  admin reset, a script — which had no floor at all. `org-service.ts` re-states
  the constant for its callers and the two are pinned equal by a test.
- **The login throttle's storage is bounded, not just its counters.**
  `app/_lib/auth/login-throttle.ts` keeps one `login_attempts` row per bucket key
  (`login:acct:<email>` / `login:ip:<ip>` / `login:op:<ip>`). Rows used to be
  deleted only by `clearFailures` on a SUCCESSFUL login, so every distinct key
  ever seen persisted forever — and `/api/auth/login` is proxy-public with no
  `rateLimit()`, so an anonymous caller posting a fresh `email` per request grew
  `kp.sqlite` without bound (a persistent disk-fill on the only database). Two
  bounds now hold: `recordFailedAttempt` lazily sweeps rows whose OWN window has
  elapsed (at most one pass per 60 s; the per-row `window_ms` column — added by
  in-place migration, legacy rows assumed 15 min — means a short-window caller
  can never reclaim a long-window caller's live bucket), and a key longer than
  160 chars is stored as a fixed-size SHA-256 digest so an unvalidated
  request-body `email` cannot write a multi-megabyte row. A swept row is already
  semantically absent (`isThrottled` admits it, `recordFailedAttempt` restarts it
  at 1), so the sweep can never release a live bucket.
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
  proven by a query-level guard (40+ such files: pipeline, jobs
  corpus, channels, schedule, dev-case, offers/status-links/
  skill-profiles, interviews, the background-task queue, `decision_records`).
  **That "each" is now machine-checked**, and it was not true when it was first
  written: five scoped tables (`candidate_nps`, `outreach_state`, `ats_links`,
  `calendar_connections`, `apply_sessions`) had no tenancy guard anywhere in
  `app/`. Their SQL was correctly scoped, but the manifest was reporting
  "verified" on a promise nothing checked — and membership of
  `TENANCY_SCOPED_TABLES` is exactly what lets the boot guard wave
  `KP_MULTI_WORKSPACE` through. `tenancy-coverage.test.ts` now fails when a
  scoped table has no proof, and carries pins for those five (each asserting
  every statement **binds** `workspace_id`, not merely mentions it) until real
  colocated guards are written.
- **`decision_records`** — the tamper-evident hiring-decision hash chain — has
  been **re-architected to per-tenant chains** (was previously a single global
  chain; this was the hardest structural item). Verified in
  `app/_lib/decision-records-tenancy.test.ts`.
- Org/deployment **config + metering** (`billing_*`, `provider_keys`,
  `brand_settings`, `ats_config`, `ats_connections`, `comms_relay_config`,
  `personas_bridge`, `edge_config`, `llm_usage`) is classified **exempt** —
  org- or install-level, not per-team, by design. `seed_marks` (which one-shot
  fixture seeder has run against this database) joins them for the same reason as
  `scheduler_heartbeat`: deployment bookkeeping, one row per seeder per install,
  with no tenant to scope it to. (`analytics_targets`,
  `jd_templates` and `decision_config` are *not* on that list: they are scoped,
  the latter two as a dual tier whose `workspace_id IS NULL` rows are the org
  layer every team inherits.)
- A **lazy-table hole** in the boot guard (store tables created on first
  request, not at `ensureDb()`) is closed: `TENANCY_LAZY_TABLES` is unioned into
  the guard's check, kept in lockstep by `tenancy-coverage.test.ts`.

**What the coverage guard does NOT do.** It inspects no SQL. It answers "is every
table classified, exportable, and proven *somewhere*" — never "is this statement
scoped". Per-statement scoping lives in the per-table guards, and **each of those
owns its own by-id / by-token exemption**. So a table can sit in
`TENANCY_SCOPED_TABLES`, pass every coverage assertion, and still carry an unscoped
point-op its own guard deliberately excluded. That is a judgement call in *that*
guard: exempting a by-token read (the token *is* the capability) or a read keyed on
a globally-unique PK is sound; exempting a **sticky write** reachable from an id a
recruiter can already see is not — the write then needs `AND workspace_id = ?` like
any enumeration. When adding a by-id carve-out, say in the manifest entry which of
those two it is.

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
offer accepted — was written with NULL `candidate_label` / `job_title` /
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

**The two org SETTINGS writes take `org:manage`, like every route beside them.**
`setOrgName` / `setOrgLanguage` (`app/_lib/org-actions.ts`) are server actions,
which are reachable by any signed-in member with a POST — and `setOrgLanguage`
writes `workspaces.default_locale`, the shared row that decides the language of
background automation passes and of every candidate email sent without a request
cookie, so a recruiter could re-language the company's outbound comms. Both now
call `requireOrgCapability("org:manage")` (the same helper the export route uses:
resolved org-wide from live memberships, so an admin of one team is not an
administrator here) and answer `{ ok: false, code }` rather than silently doing
nothing — the console renders the code, and a refused save never ticks over to
"Saved". Pinned by `app/_lib/org-actions.test.ts`. The org NAME's storage stays a
per-browser cookie; the gate is about who may write it, not where it lives.

`setOrgLanguage` writes `workspaces.default_locale` for **every team in the caller's
org**, not only the one their session sits on. The setting is org-wide on every
other axis — the Organization tab, the label "App language", an `org:manage`
capability resolved across the org — so writing a single row left a sibling team's
automation passes and candidate emails in the previous language while the console
reported "Saved". The org is resolved from the current workspace
(`getWorkspaceOrgId`), so an operator-password / open-dev caller with no identity
claims still writes the whole org, and an unlinked legacy workspace (`org_id` NULL)
keeps the single-row behaviour. A single-team deployment — the seeded shape — is
unaffected, since its org holds exactly one row.

**Entering** a team is separate from administering it:
`POST /api/auth/switch-workspace` requires a real membership (plus an org match).
An org admin can seat people on a team they don't belong to, but cannot park a
session on it — without a membership their capabilities inside it resolve empty,
so the session would 403 on everything anyway.

A **demo session cannot switch at all** (403). `/api/demo` is public and mints a
validly-signed cookie with no `sub` and no `op`, so the membership check above is
skipped for it entirely — and the workspace id `demo` is the only thing that marks
it as not-an-operator downstream (`isOperator()` in `auth/require-operator.ts`
admits any valid non-demo session, as do `home-gate-server.ts` and
`/api/me/onboarding`). Re-minting that cookie onto the default workspace therefore
promoted an anonymous visitor to full operator, including the org export/import
routes below. The switch route now refuses on the workspace the session came from
(`app/api/auth/switch-workspace/route.test.ts`).

## Surface

| Layer | File(s) |
|---|---|
| Org/member/invite API | `app/api/org/members/route.ts`, `app/api/org/members/[userId]/route.ts`, `app/api/org/invites/route.ts`, `app/api/org/invites/[token]/route.ts` |
| Workspace API | `app/api/workspaces/route.ts` (GET org-filtered list + memberCount/role/canManage; POST `team:manage`-gated, stamps the caller's org, seats the creator as owner), `app/api/workspaces/[id]/route.ts` (rename), `app/api/workspaces/[id]/members/[userId]/route.ts` (PUT seat/re-role — delegation-capped, and last-owner-guarded when it demotes an existing owner; DELETE unseat) |
| Workspace switch | `app/api/auth/switch-workspace/route.ts` — membership + org required; a `demo`-workspace session is refused outright (403) |
| Org backup/restore | `app/api/workspace/export/route.ts`, `app/api/workspace/import/route.ts`, `app/_lib/db-portability.ts` (`dumpOrg`, `restoreOrg`, `planOrgRestore`) |
| DB — identity | `app/_lib/db/organizations.ts`, `app/_lib/db/users.ts`, `app/_lib/db/memberships.ts`, `app/_lib/db/invites.ts`, `app/_lib/db/workspaces.ts` (`listWorkspacesForUser`, `renameWorkspace`) |
| RBAC | `app/_lib/auth/roles.ts`, `app/_lib/auth/org-authority.ts` |
| Tenancy manifest | `app/_lib/tenancy.ts`, `app/_lib/workspace-lock.ts` |
| Rate limits | `POST /api/org/invites` — `org-invite:<ip>`, 30/10min; `GET /api/workspace/export` — `org-export:<ip>`, 10/10min. Both pinned in `app/api/rate-limit-contract.test.ts` |
| Business logic | `app/_lib/org-actions.ts`, `app/_lib/org-service.ts` (`addMemberToWorkspace`, `removeMemberFromWorkspace`), `app/_lib/bulk-invite.ts` |
| Workspaces console UI | `app/features/settings/workspace/*` (`WorkspaceTab` shell, `WorkspaceRail`, `WorkspaceDetailPanel`, `WorkspacePeoplePanel`, `WorkspaceMembersTable`, `MemberPermissionsModal`, `MemberConfirmModals`, `useWorkspaceAdmin` + the pure `workspaceAdminLoad` fold, `workspaceAdminHelpers`) |
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

**Every member write leaves a receipt, and locks the row it is writing.** A role
change and a status toggle used to do neither: the PATCH went out, the reload came
back, and the only evidence was one word changing inside a select — while every
other mutation on this console toasted. Both now toast
(`workspaceAdmin.members.roleUpdated` / `statusUpdated`) and hold a **per-member**
lock (`pendingMembers` in `WorkspaceTab`, `aria-busy` on the row, the controls
disabled) until the reload lands, so a double click cannot send two PATCHes and the
row never sits silently on its old value. Per-member and not panel-wide on purpose:
locking the whole console would freeze four other rows an administrator is working
through. The permissions dialog and the language setting keep their own tickers
(`saving` / `saved` / `saveFailed`).

**A partial reload says so.** `foldWorkspaceAdminLoad`
(`app/features/settings/workspace/workspaceAdminLoad.ts`, pinned by
`workspaceAdminLoad.test.ts`) is the pure fold over the three parallel answers, and
it separates three states the inline promise chain could not: a failed **members**
request is the error state (coral, and the previous roster is kept rather than
blanked — an emptied roster reads as "everybody is gone"); a failed **teams** or
**invites** request for a caller who may read them is `partial`, which the console
renders as an amber note over the previous reading; and a missing invites answer for
a caller **without** `members:manage` is the complete answer, not a failure, because
that endpoint refuses them by design.

**Membership-scoped vs account-scoped controls ask different ownership
questions.** Role, seat permissions and remove-from-team write one membership, so
they gate on `teamFor(m, workspaceId)?.role === "owner"` — this team's seat.
Enable/Disable and account deletion write `users.status` / the user row, which is
org-wide, so they gate on `workspaceAdminHelpers.holdsOwnerSeat(m)` — does the
person own **any** team. Both lenses now call that one helper. Before, the
By-workspace roster used the team-scoped test for the account-wide Disable
control, so an owner of one team who also sat on another as a recruiter could be
disabled out of the whole product from that second team's roster, while the
By-person view offered no such control for the same person.

The deployment lock (`KP_MULTI_WORKSPACE`) gates create / rename / switch only.
Member administration is org-scoped and stays fully usable while it is off.

### Backup & restore

`GET /api/workspace/export` downloads **the caller's organization** as one
`kp-org-dump` file; `POST /api/workspace/import` restores it. Both are reachable from
this tab, `<Defer>`-mounted below the identity panel. They used to sit on the
Background-tasks tab, beside a health readout and a webhook form, because that tab was
where the operator-only surfaces had collected; taking and replacing a snapshot is
organization administration, so it lives with the rest of it now.

**Scope comes from the tenancy manifest, not from `sqlite_master`.**
`orgExportClass(table)` (`app/_lib/tenancy.ts`) classifies every table —
`workspace` (the org's teams), `org` (`org_id = ?`), `org_shared` (the null tier),
`by_user`, `membership`, `exclude` — and the defaults derive from
`TENANCY_SCOPED_TABLES` / `TENANCY_EXEMPT_TABLES`, so only 14 genuine exceptions are
hand-listed in `ORG_EXPORT_OVERRIDES`. A table nobody classified fails
`tenancy-coverage.test.ts` rather than being dumped on the guess that whatever it
holds is safe to hand over. That is the whole reason the old whole-DB pair could not
survive multi-tenancy: it enumerated the live schema and read every table with no
predicate, so one team's "Download backup" handed them every other tenant's
candidates, and the restore `DROP`ped tables the other tenants were still using.
Both routes were hard-refused (503) with the flag on until this replacement landed.

Gating is two-layer: `requireOperator()` (a valid non-demo session) **and**
`requireOrgCapability("org:manage")`. The second is the one that matters under
multi-workspace — `requireOperator` reads neither membership nor role, so it alone
would let any signed-in member export the whole company.

Restore is deliberately two-step and loud: pick a file → the route returns a **dry-run
plan** (per table, the rows the restore would actually insert against the rows it would
delete first — the file's out-of-scope shared tier is excluded from that count so the
preview cannot promise rows that will not land) → the operator types `REPLACE` to
confirm. "Destructive" is decided by what
would be **deleted**, not by how many tables the file names — a plan can carry
thousands of rows and destroy nothing, or carry none and empty a live table. The write
itself is `DELETE`-by-scope + `INSERT` in one transaction, never `DROP TABLE`, because
another org's rows live in the same tables; and the delete scope is the union of the
file's teams and the org's teams **today**, so a team created after the backup is
removed with its rows instead of being stranded behind a deleted `workspaces` row. The
copy is fully localized (`workspaceAdmin.org.backup`) — comprehension is a safety
property here, not a nicety — while the table names it lists stay verbatim, being
schema identifiers.

Round-trip behaviour is pinned by `app/_lib/db-portability-org.test.ts` (multi-org:
scope, refusal, rollback, the bystander org, and that a dual-tier table's team-private
rows come back while its shared tier stays untouched) and
`app/_lib/db-portability-shared-tier.test.ts` (single-org: the shared library comes
back). The whole-DB `dumpWorkspace` / `loadWorkspace` remain in
`app/_lib/db-portability.ts` for the CLI scripts only; `export-guard.test.ts` asserts
neither route reaches for them again.

**The explanation is a diagram, not a paragraph** (`OrganizationBackupFlow.tsx`). The panel
used to open with a four-line intro carrying five facts at once, which nobody reads before
clicking and which is too late by the time the confirm dialog is up. Two lanes show the
artefact chain each button walks — `your organization → one file` and `your file → preview
→ your organization` — with the destructive terminal node drawn in coral, so the dangerous
direction LOOKS dangerous before any prose is read. The three scope facts (every team in
the org, integration settings and provider keys excluded, restores back into this
deployment) are three separate lines instead of subordinate clauses, and the internal
codename is gone from user-facing copy.

### Refusal codes

Every deliberate 4xx on these doors carries a machine `code` from `REFUSAL_ERRORS`
(`app/_lib/api-response.ts`), which the console resolves through `useErrorMessage()`
in the reader's language — the server's English `error` is never rendered:

| Code | Where | Status |
|---|---|---|
| `INVITE_EMAIL_INVALID` | `POST /api/org/invites` | 400 |
| `INVITE_ROLE_ABOVE_PRIVILEGE` | `POST /api/org/invites` (delegation ceiling) | 403 |
| `INVITE_ALREADY_MEMBER` | `POST /api/org/invites` | 409 |
| `RESTORE_FOREIGN_ORG` | `POST /api/workspace/import` — the file names another org | 409 |
| `RESTORE_REPLACE_REQUIRED` | `POST /api/workspace/import` — `apply` without `replace`; carries `existingRows` + `populated` | 409 |
| `MEMBER_PERMISSIONS_CHANGED` | `PATCH /api/org/members/[userId]` — the seat moved under the editor | 409 |
| `ORG_SETTINGS_FORBIDDEN` / `ORG_LANGUAGE_INVALID` | `setOrgName` / `setOrgLanguage` | — (action result) |
| `TOO_MANY_REQUESTS` | the invite mint and the org export | 429 |

Route tests: `app/api/org/org-routes.test.ts` (invites POST/GET/DELETE, the
delegation ceiling, the permissions race) and
`app/api/workspace/import/import-route.test.ts` (both 409 branches, plus the dry
run and the applied restore).

### Editing one seat's permissions is a compare-and-swap

`PATCH /api/org/members/[userId]` with `capabilities` re-sends the WHOLE desired
set, computed from what the editor loaded. Two administrators on one member
therefore raced last-writer-wins, silently: the second save recomputed grants for
capabilities its author never touched and erased the first's change with no error.
`MemberPermissionsModal` now sends `expectedCapabilities` — the seat exactly as it
rendered it — and the route re-reads the membership inside
`db.transaction(...).immediate()`, comparing the live effective capability set
against that snapshot (falling back to the row the request itself read when a
caller sends none) and refusing with `MEMBER_PERMISSIONS_CHANGED` when it moved.
Nothing is written on a refusal, and the console reloads the roster so the next
decision is made against what the seat now says.

### The invite accept door (`/invite/[token]`)

The one surface in this feature an outsider sees, and the only one reached without
a session: a colleague opens the emailed link, `AcceptForm.tsx` previews the invite
through `GET /api/invite/[token]`, and the redeem `POST` sets the password, adds the
membership and signs them in.

Both verbs are classified through **`app/invite/[token]/invite-result.ts`**
(`classifyInviteResult`, pinned by `invite-result.test.ts`) — the same extraction,
for the same reason, as `app/login/login-result.ts`. Before it, the form had two
endings: every non-ok preview response *and* every fetch-level failure became
`{ valid: false }`, which renders "This link is invalid, already used, or expired.
Ask an admin to send a new one." So the door's own 10/min limiter (429), a 5xx and a
dropped connection all told a colleague their invitation was dead and sent them to
ask for a replacement that would behave identically. The classifier splits them:

| Outcome | From | The form shows |
| --- | --- | --- |
| `dead` | 404 (no redeemable invite) · 410 (consumed / lapsed on redeem) | The unavailable panel. No retry: a retry over a consumed invite is a loop with no exit. |
| `rateLimited` | 429 | "Too many attempts", the invitation stated to be still valid, plus a retry. |
| `retry` | 5xx · network drop · the 15 s abort | "Couldn't load your invitation", plus a retry. |
| `weakPassword` / `emailTaken` / `alreadyActive` | 400 / 409 with the reason code | The existing inline field messages. |

Two consequences worth naming. A redeem that answers **410** now swaps the whole
surface to the dead ending rather than leaving a generic line under a form that can
never succeed again. And both fetches run under a 15 s `AbortController` budget
(`INVITE_TIMEOUT_MS`), mirroring `LOGIN_TIMEOUT_MS`, so a stalled request cannot
strand the invitee on a spinner or a dead "Setting up…" button.

**Redeem lands on the dashboard.** A successful `POST` mints the session cookie
*and* the readable `kp_entered` marker, exactly as `/api/auth/login` and
`/api/auth/register` do (`app/_lib/auth/session.ts` `ENTERED_COOKIE`). It used to
set only the session: `AcceptForm` redirects to `/`, and in OPEN mode (no
`KP_OPERATOR_PASSWORD`) the `/` gate reads **only** that marker
(`hasEnteredWorkspace`, `app/_lib/auth/home-gate-server.ts`) — so a colleague who
had just joined the team was handed the public landing page. Both cookies are set
inside the same best-effort `try`: with no `KP_SECRET` nothing is signed, so
neither is written and no marker claims a session that does not exist.

**One transaction, not four writes.** `acceptInvite` (`app/_lib/org-service.ts`)
runs inside `db.transaction(...).immediate()` with the redeemable-invite read
re-asserted **inside** the lock. It is a read→compute→write over the invite, user,
credential and membership stores, and it ran unlocked: two processes redeeming one
link both saw a pending invite and both wrote a password, only the loser's
`markInviteAccepted` no-op'ing. The second caller is now refused structurally
(`invalid`) and writes nothing, and a redeem interrupted between the membership
write and the mark rolls back rather than seating a member on a pending invite.
The session signing stays in the route, outside the transaction — nothing is
awaited between BEGIN and COMMIT. Pinned by `app/_lib/org-service.test.ts` (two
callers on one link; a rival consuming the token mid-flight) and, at HTTP level, by
`app/api/invite/[token]/invite-accept-route.test.ts` — the reason→status map
(400 weak / 409 taken / 409 already active / 410 dead), the cookie attributes, and
the signing-failure-after-consume path that must still answer `ok`.

`GET /api/invite/[token]` answers **`orgName: null`** for an org with no name,
where it used to answer the English literal `"your organization"` — a server-side
string spliced into a four-locale eyebrow by code that has no idea who is reading.
The fallback is now the catalog's (`invite.orgNameFallback`), resolved in the
invitee's language.

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

- **Backup does not move an org between deployments.** The org backup restores
  **in place** — into the deployment the file came from — and the import refuses a
  file naming any other org. That is what makes it safe to ship: the ids in the
  file are already this deployment's. Carrying an org to a *different* install
  needs four things re-keyed first: `org-default` / `workspace` / `tpl-standard`
  are seeded into every deployment (id collisions), `users.email` is globally
  UNIQUE (account collisions), `decision_config`'s org tier is UNIQUE on `(phase)`
  alone so two orgs' defaults cannot coexist, and the HMAC chains in
  `decision_records` / `skill_profiles` verify against deployment-local key
  material.
- **Seven config tables are not carried by a backup** (`ORG_CONFIG_NOT_PORTABLE` in
  `app/_lib/tenancy.ts`): `brand_settings`, `ats_config`, `ats_connections`,
  `ats_delivery`, `comms_relay_config`, `personas_bridge`, `edge_config`. Each is a literal
  singleton (`CHECK (id = 1)`, a fixed row id, or a provider PK) carrying no
  `org_id`, so a backup cannot say which org owns them. The restore **reports**
  the list (`notRestored`, surfaced in the panel) rather than leaving the operator
  to discover it; re-keying them by org is the prerequisite for carrying them.
- **The shared template/decision tier is skipped when a second org is present.**
  `jd_templates` and `decision_config` keep the org tier in `workspace_id IS NULL`,
  and the schema holds exactly one such tier per deployment. Restoring it on a
  single-org install is correct and happens; on a multi-org install it would reset
  a bystander's library, so it is left alone and the plan says so
  (`sharedTierRestored: false`). The skip is **per row, not per table**
  (`restorableRows` in `db-portability.ts`): the same two tables also hold the org's
  TEAM-PRIVATE rows, which the delete-by-scope *does* clear, so skipping the whole
  table deleted a multi-org customer's team template library and per-team decision
  config and then reported `inserted: 0` as a success. Only the `workspace_id IS NULL`
  rows — the ones the delete deliberately left alone — are held back.
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
  needed before enterprise SSO / audit tracks can close out. Account-level
  disable no longer waits on it for team data (see Identity & auth), but the
  **org-wide administrative capabilities still do**: `orgMembershipGrants`
  (`app/_lib/auth/current-user.ts`) builds `callerOrgCapabilities` and
  `callerDelegationCeiling` straight from `listMembershipsForUser` without
  reading `users.status`, so a disabled admin holding a live cookie can still
  create a team and administer seats. The fix is the same one-line status read
  that `capabilitiesForUserInWorkspace` now does, applied in that helper.
- **No workspace deletion.** Rename exists; delete does not, deliberately — a
  team's candidates, decisions and audit chain outlive its label, and there is no
  reassign-or-purge story yet.
- *(closed 2026-09-02)* `POST /api/org/invites` used to emit no error `code` on
  any of its three refusals, so the panel always painted the localized generic.
  All three now answer through `jsonRefusal` — see **Refusal codes** below.
