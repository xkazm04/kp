# Auth, Sessions & Workspace Tenancy — Tri-Lens Scan
> Total: 6
> Severity: 2 Critical / 2 High / 1 Medium / 1 Low
> Lens: 5 bug / 1 ui / 0 biz

> **Tenancy ground-truth verdict (read this first):** Multi-workspace is **REAL and switchable TODAY**, not dead code. `createWorkspace()` inserts a genuine new `workspaces` row (`app/_lib/db/workspaces.ts:28`), `/api/auth/switch-workspace` re-mints the session cookie with the chosen id (`switch-workspace/route.ts:26`), and `currentWorkspace()` resolves the active id from that signed cookie (`current-workspace.ts:13`). The WorkspaceTab "Create" button calls create-then-switch, so a recruiter can stand up a 2nd workspace in two clicks. **BUT only `analyses` and `profiles` carry a `workspace_id` column and filter on it** (`db/core.ts:677-679`, `db/analyses.ts:72-157`); every other table — `jobs`, `pipeline_entries` (candidates/PII), `pipeline_events`, `dev_cases`, `dev_submissions`, `interview_sessions` (transcripts), `skill_profiles`, `channel_webhooks`, `billing_*` — is **workspace-blind**. The WorkspaceTab even admits this in a banner ("only Analyses isolates by workspace today", `WorkspaceTab.tsx:10-12`). **Conclusion: the dozens of latent cross-tenant leaks flagged elsewhere are NOT dead code — they become live the instant a 2nd workspace exists, which the shipped UI lets a user do unprompted.** That elevates the whole class from Low to High/Critical. Findings #1 and #2 below are the tenancy-owning manifestations.

## 1. Workspace switch exposes another tenant's data because only 2 of ~25 tables are scoped
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Multi-tenant isolation / cross-tenant data exposure
- **Value**: impact 9/10 · effort 6/10 · risk 5/10
- **File**: `app/_lib/db/core.ts:677` (only analyses/profiles get workspace_id); `app/features/sub_workspace/WorkspaceTab.tsx:53` (create-then-switch)
- **Scenario**: A recruiter (or a 2nd recruiter once team auth lands) clicks "Create workspace" → lands in workspace `ws_…`. Analyses/Profiles correctly read empty. But the Jobs board, the **candidate Pipeline (full PII, contacts, GDPR consent rows)**, interview transcripts, dev-case submissions, skill profiles, channel webhooks, and the billing ledger ALL still read/write the global, unscoped tables — so the "new" workspace shows, and can mutate, the first tenant's candidates and billing.
- **Root cause**: Tenancy was introduced as a per-table opt-in (`workspaceId` param defaulting to `DEFAULT_WORKSPACE_ID`) and only two domains were migrated. The session/switch seam is fully built; the data layer is two tables of the way there. Switchability shipped ahead of scoping.
- **Impact**: The moment a 2nd workspace is created (a shipped, one-click UI action), it is a cross-tenant read/write breach of candidate PII and billing — the most sensitive data in a hiring SaaS. This is the umbrella bug the "latent leak" findings across other contexts all roll up into.
- **Fix sketch**: Either (a) gate workspace creation behind a feature flag until every PII/business table carries+filters `workspace_id` (fail-safe: keep it single-tenant), or (b) finish the migration table-by-table with the same `workspaceId`-param pattern, backfilling to `'workspace'`. Add a tenancy test per table (mirror `analyses-tenancy.test.ts`). Do NOT ship create/switch as "done" UI until then.

## 2. Workspace export/import operate on the WHOLE database, not a workspace — exfil + clobber vector
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Data portability / cross-tenant exfiltration & destructive overwrite
- **File**: `app/_lib/db-portability.ts:59` (dump = every table) and `:164` (load = DROP+recreate every table)
- **Scenario**: `dumpWorkspace()` selects ALL tables from `sqlite_master` (minus `gemini_cache`/`tasks`) regardless of the caller's workspace, so `GET /api/workspace/export` hands the operator **the entire multi-tenant database** — every workspace's candidates, transcripts, billing. Conversely `loadWorkspace(replace:true)` does `DROP TABLE` + recreate + bulk-insert for every table in the uploaded dump inside one transaction, **wiping and replacing all tenants' data**, not just the active workspace's.
- **Root cause**: The endpoints are named "workspace export/import" but reuse the whole-DB `db-dump.mjs`/`db-load.mjs` scripts verbatim; "workspace" here means "the SQLite file", and the single-tenant assumption was never revisited when the switchable workspace UI landed.
- **Impact**: With ≥2 workspaces this is both a data-exfil channel (download all tenants) and a destructive overwrite (one tenant's import clobbers everyone). Even single-tenant today, import's whole-DB `DROP`/replace + executing the dump's DDL is an unauthenticated-by-default (see #3) remote DB-replace primitive.
- **Fix sketch**: Scope export to `WHERE workspace_id = ?` per scoped table (and refuse to export until all PII tables are scoped — ties to #1); for import, restore INTO the active workspace's rows only (per-table delete-by-workspace + insert), never `DROP TABLE`. Until scoped, label these "full-database backup/restore (operator only, all tenants)" so the name stops lying.

## 3. Auth is fail-OPEN by default — the entire recruiter surface is public unless KP_OPERATOR_PASSWORD is set
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Auth gate / insecure-by-default
- **File**: `proxy.ts:37` (`if (process.env.KP_OPERATOR_PASSWORD)`)
- **Scenario**: The proxy auth gate runs only when `KP_OPERATOR_PASSWORD` is set. With it unset (the default), the whole `if` block is skipped: every recruiter page and API — including `/api/workspace/export` (full-DB PII dump) and `/api/workspace/import` (full-DB replace) — is reachable with no session at all.
- **Root cause**: Auth was shipped opt-in "to avoid a regression / run open in dev". The secure posture depends on an env var the operator must remember to set in prod; a forgotten var silently degrades to fully open with no startup warning.
- **Impact**: A production deploy that forgets one env var exposes all candidate PII and a remote DB-replace endpoint to the internet — no credential required. Insecure-default is the classic way this bites.
- **Fix sketch**: Flip to fail-closed: if `KP_OPERATOR_PASSWORD` is unset in a production build (`NODE_ENV==='production'`), either refuse to boot or have the proxy 503/redirect-to-setup instead of passing through. Keep open-in-dev gated strictly on a dev check, never the absence of the secret.

## 4. Stateless sessions can't be revoked; logout is client-side only and there's no per-user binding
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Session lifecycle / revocation & identity
- **File**: `app/api/auth/logout/route.ts:8` (only clears the cookie); `app/_lib/auth/session.ts:28` (payload carries no jti/user/version)
- **Scenario**: Logout sets `maxAge:0` on the cookie — but the signed token is self-contained and valid for its full 7-day TTL. A token captured before logout (or copied from a device that "logged out") keeps verifying. There is no `jti`/version/user id and no server-side revocation list, so a leaked or shared token can't be killed short of rotating `KP_SECRET` (which nukes ALL sessions). All operators also share one password, so a session is bound to "whoever knew the password", not a user — no per-user revoke, no audit of who switched a workspace.
- **Root cause**: Stateless HMAC sessions were chosen for Edge-verify simplicity; revocation and per-user identity were deferred ("real multi-tenancy will mint per-tenant sessions", `session.ts:7`).
- **Impact**: Can't invalidate a compromised/shared session without a global secret rotation; no accountability for who exported data or switched tenants. A growth/team blocker the moment >1 person logs in.
- **Fix sketch**: Add a `jti` + a `session_version` (per user, or global kill-switch) stored server-side; verify it on each request (cheap single-row read alongside the HMAC check). Logout bumps the version / deletes the jti. Pairs naturally with introducing real user accounts.

## 5. Any authenticated operator can switch into any workspace (no membership check)
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Authorization / horizontal access (IDOR-shaped)
- **File**: `app/api/auth/switch-workspace/route.ts:22` (`getWorkspace(workspaceId)` existence-only check)
- **Scenario**: Switch only checks that the target workspace *exists*, not that the caller is a member of it. With one shared operator password and ≥2 workspaces, the single "user" can hop into every tenant — and once team auth arrives, this same route would let user A enter user B's workspace by id.
- **Root cause**: There is no user↔workspace membership table yet; the existence check is the only guard, and `listWorkspaces()` (powering the WorkspaceTab list) returns every workspace to everyone.
- **Impact**: No horizontal isolation between tenants at the session layer. Low today (one shared identity) but a hard blocker to onboarding a second customer/team, and it compounds #1/#2.
- **Fix sketch**: Introduce a `workspace_members(user_id, workspace_id)` table; gate `switch-workspace` and scope `listWorkspaces()`/`GET /api/workspaces` to the caller's memberships. Depends on per-user identity (#4).

## 6. WorkspaceTab switch is a full page reload with no destination/optimistic feedback
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Low
- **Category**: Switch UX clarity
- **File**: `app/features/sub_workspace/WorkspaceTab.tsx:31` (`window.location.reload()`)
- **Scenario**: Clicking "Switch" sets `busy`, fires the POST, then hard-reloads the whole app with no toast, no "switched to X" confirmation, and (because almost nothing is scoped, see #1) most of the app looks identical afterwards — so a successful switch reads as "nothing happened". The amber banner explains scope but a user still gets no positive switch confirmation.
- **Root cause**: Switch relies on a brute-force `location.reload()` so server components re-read the session; no client-side state update or confirmation toast.
- **Impact**: Minor confusion/low confidence in the feature; users may double-click or doubt it worked. Genuinely minimal surface (one tab, one banner) as the prompt anticipated.
- **Fix sketch**: Show a brief success toast ("Now in <name>") before/after reload, disable the just-clicked row distinctly, and once more domains are scoped, navigate to a workspace-overview rather than reloading in place so the switch has a visible effect.
