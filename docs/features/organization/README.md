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
- Onboarding wizard (`app/features/setup/`) — first-run org setup.

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
| UI | `app/features/settings/organization/*` (`OrganizationTab`, `OrganizationConsole`, `OrganizationMembersPanel`, `OrganizationMemberConfirmModals`, `OrganizationGeneralPanel`) |

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
- **Org-level billing with seats** — `billing_state` is still a single row
  keyed by the default workspace; no `org_id` on any billing table, no seat
  quantity in Polar checkout. This is enterprise-readiness E6 / org-plan
  Phase 3 (`docs/features/billing/README.md` Known gaps).
- **Per-team `llm_usage` attribution** — the usage ledger is global; it's
  written from the Python sidecar off the request path, so propagating org/team
  through the spawn is non-trivial (`docs/architecture/llm-provider-layer.md`).
- Per-workspace export/import (today's `/api/workspace/export` reads the whole
  DB regardless of caller — a cross-tenant channel the moment multi-tenant is on).
- Per-session revocation (stateless 7-day tokens can't be killed early) —
  needed before enterprise SSO / audit tracks can close out.
