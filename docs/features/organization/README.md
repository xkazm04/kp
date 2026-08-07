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

- **Settings → Organization** (`app/features/settings/organization/OrganizationTab.tsx`,
  `OrganizationConsole.tsx`) — general org settings, member roster, invites.
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

## Surface

| Layer | File(s) |
|---|---|
| Org/member/invite API | `app/api/org/members/route.ts`, `app/api/org/members/[userId]/route.ts`, `app/api/org/invites/route.ts`, `app/api/org/invites/[token]/route.ts` |
| Workspace switch/list | `app/api/auth/switch-workspace/route.ts`, `app/api/workspaces/route.ts` |
| Whole-workspace export/import | `app/api/workspace/export/route.ts`, `app/api/workspace/import/route.ts` |
| DB — identity | `app/_lib/db/organizations.ts`, `app/_lib/db/users.ts`, `app/_lib/db/memberships.ts`, `app/_lib/db/invites.ts` |
| RBAC | `app/_lib/auth/roles.ts` |
| Tenancy manifest | `app/_lib/tenancy.ts`, `app/_lib/workspace-lock.ts` |
| Business logic | `app/_lib/org-actions.ts`, `app/_lib/org-service.ts`, `app/_lib/bulk-invite.ts` |
| UI | `app/features/settings/organization/*` (`OrganizationTab`, `OrganizationConsole`, `OrganizationGeneralPanel`, `OrganizationMembersPanel`, `OrganizationMembersTable`, `OrganizationMemberConfirmModals`, `OrganizationMemberPermissionsModal`, `useOrganizationMembers`, `organizationMemberHelpers`) |
| Shared presenters | `app/features/shared/memberUi.ts` — role labels/tints, member-status badges, the assignable-role list, the overridable-capability rows |

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
noun in every locale.

`useOrganizationMembers` exposes `error` as a **boolean flag**, not a message:
the hook has no translator, both failure paths render the same line, and the copy
lives at `workspaceAdmin.members.loadError`.

## Data model

`organizations`, `users`, `memberships` (user × team/workspace × role),
`invites` (token, email, role, status, expiry). "Team" = the existing
`workspaces` table.

Cross-company reference reads (curated shared library + aggregated benchmarks,
never raw PII) are designed but not the current focus of this doc — see the
enterprise-readiness roadmap for sequencing.

## Feature flag

`/api/auth/switch-workspace` still hard-locks any non-default workspace target
behind `KP_MULTI_WORKSPACE` (`workspace-lock.ts`) — the tenancy data layer is
ready, but multi-workspace is not yet turned on for production traffic.

## Known gaps

The data-layer work is complete; what remains before `KP_MULTI_WORKSPACE` goes
live for real multi-team customers (see `app/_lib/tenancy.ts` comments and
`docs/product/enterprise-readiness.md` §1):

- Give the pipeline entry-id scheme a workspace component (today only the
  DEFAULT workspace's `m-<key>-<job>` id is guaranteed collision-safe).
- Widen the `tasks` dedup index to `(workspace_id, dedupe_key)`.
- Thread the real session workspace through the inbound lead-intake chain and
  the remaining mutating routes (some still default to the default workspace).
- **The sidebar attention badges are default-workspace-only.**
  `attentionCounts()` (`app/_lib/attention.ts`) calls `listPipeline()` and
  `listJobStatuses()` with no workspace argument — both default to
  `DEFAULT_WORKSPACE_ID` — and `dueReminders()` takes no workspace parameter at
  all, so it counts across every tenant. Neither `/api/attention` nor the
  server-rendered `WorkspaceNav` passes `currentWorkspace()` in. On a non-default
  workspace every badge therefore reports another tenant's counts. Fixing it needs
  a workspace argument on all three reads (`dueReminders` is the only one that
  needs a new store-level parameter) plus the two call sites.
- **Org-level billing with seats** — the org-keyed DATA layer has landed
  (`org_id` on every billing table, org-keyed entitlement/reducer lookups,
  webhook attribution via checkout metadata; `app/_lib/db/billing-tenancy.test.ts`).
  Still open from enterprise-readiness E6 / org-plan Phase 3: seat quantity in
  Polar checkout + webhook, seat enforcement vs. memberships, per-team metering
  (`docs/features/billing/README.md` Known gaps).
- **Per-team `llm_usage` attribution** — the usage ledger is global; it's
  written from the Python sidecar off the request path, so propagating org/team
  through the spawn is non-trivial (`docs/architecture/llm-provider-layer.md`).
- Per-workspace export/import (today's `/api/workspace/export` reads the whole
  DB regardless of caller — a cross-tenant channel the moment multi-tenant is on).
- Per-session revocation (stateless 7-day tokens can't be killed early) —
  needed before enterprise SSO / audit tracks can close out.
- **`POST /api/org/invites` emits no error `code`.** All three of its refusals —
  invalid address (400), inviting above your own privileges (403), and the
  address already belonging to an active member (409) — return only a canonical
  English `error`. The panel therefore routes the payload through
  `useErrorMessage()` and always lands on the localized generic
  (`workspaceAdmin.members.inviteFailed`), so the *specific* reason is lost in
  every language, English included. Fixing it means giving the route real codes
  plus matching `errors.*` catalog entries; no code is invented client-side in
  the meantime.
