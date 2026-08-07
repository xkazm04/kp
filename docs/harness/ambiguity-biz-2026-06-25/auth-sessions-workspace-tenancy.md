# Auth, Sessions & Workspace Tenancy — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H3/M1/L0

## 1. Multi-tenancy is a fully-built "dark capability" gated only by an honor-system env flag
- **Lens**: 🚀 Business
- **Severity**: Critical
- **Category**: dark-capability / tenant-isolation
- **File**: app/_lib/workspace-lock.ts:21
- **Observation**: The whole tenancy seam ships and works end-to-end: `signSession(workspace)` mints per-workspace cookies (session.ts:44), `currentWorkspace()` resolves the tenant from the cookie (current-workspace.ts:10), `/api/auth/switch-workspace` re-mints to a chosen workspace, and `WorkspaceTab.tsx` lets a user create+switch in two clicks. But only 3 of ~31 tables are actually scoped (analyses, profiles, pipeline_entries — core.ts:656,729-731), and **only 9 of 129 API route files even call `currentWorkspace()`**. The single thing standing between this and a cross-tenant PII breach is `multiWorkspaceEnabled()`, which just reads `KP_MULTI_WORKSPACE` from the env — with *zero* runtime check that table scoping is actually complete. The flag is documented as the "flip me to enable" switch (workspaces/route.ts:35), so an operator who flips it instantly re-opens cross-tenant read/write of candidate PII + billing across ~28 blind tables.
- **Why it matters**: Multi-tenant + SSO is the #1 enterprise/B2B upsell, and it is ~90% built but locked behind a foot-gun: a one-character env change (set by someone who reads the docs that *tell* them to set it) is a silent, catastrophic data breach with no guardrail. Both the value (a near-complete enterprise feature) and the risk (keystone cross-tenant leak) live at this one honor-system line.
- **Recommendation**: Make the flag self-defending, not advisory. Add a `assertTenancyComplete()` that introspects `sqlite_master` for a `workspace_id` column on every PII/business table and refuses to honor `KP_MULTI_WORKSPACE=1` (throw at boot / 503 the gate) until the set is complete. Track the canonical "scoped tables" list in one place and gate the flag on it. This converts a Critical foot-gun into a cheap, enforced invariant and is the milestone that turns the upsell on safely.
- **Effort**: M

## 2. The "exact tenancy-scoping contract" is internally inconsistent — three sources disagree
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: contract-drift / scoping-ambiguity
- **File**: app/_lib/workspace-lock.ts:1
- **Observation**: The canonical doc-of-record says *"Only `analyses` + `profiles` carry a `workspace_id` column"* (workspace-lock.ts:1-2). That is already wrong: `pipeline_entries` also has the column **and** an index (core.ts:656,672) **and** one scoped query (`findActiveEntriesByCandidateLabel`, pipeline.ts:606-612). Yet `pipeline_entries` is simultaneously *not* honestly scoped — the primary read `listPipeline()` (pipeline.ts:286, `FROM pipeline_entries WHERE status NOT IN (...)`, no workspace filter at :301) and the write `createPipelineEntry` (hardcodes `workspace_id: input.workspaceId ?? "workspace"` at :583, and the `/api/pipeline` POST never passes a workspaceId) both ignore the column. So "is pipeline_entries scoped?" has three answers: yes (schema), no (the canonical comment), and half (1 of ~10 queries).
- **Why it matters**: Finding #1's Critical flag is only as safe as the checklist used to decide "every table is scoped." That checklist is a free-text comment that is already drifted in *both* directions — under-reporting (omits pipeline_entries) and over-promising (the column implies scoping the read path doesn't deliver). A maintainer auditing "are we ready to flip KP_MULTI_WORKSPACE?" against this comment will reach a wrong, breach-causing conclusion. A column that exists but is ignored by the main read is worse than no column: it *looks* isolated.
- **Recommendation**: Replace the prose with a single machine-checked manifest (a typed `SCOPED_TABLES`/`BLIND_TABLES` map) plus a test that asserts each "scoped" table's read+write paths actually filter on `workspace_id`. Finish or explicitly demote `pipeline_entries` so schema, queries, and docs agree.
- **Effort**: M

## 3. Stateless 7-day tokens: logout doesn't revoke, and the only kill-switch is all-or-nothing
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: session-security / undocumented-tradeoff
- **File**: app/api/auth/logout/route.ts:8
- **Observation**: Sessions are stateless signed cookies with `SESSION_TTL_MS = 7 days` (session.ts:19, a magic number with no recorded rationale). Logout only clears the cookie in the caller's browser (logout/route.ts:8-17) — a token captured, copied to another device, or left in a proxy log stays valid for up to 7 days regardless of "logging out." The only server-side revocation is the global epoch kill-switch (`KP_SESSION_EPOCH`), which by design nukes *every* operator session at once and cannot target one. The code itself flags this as a deferred trade-off: *"Per-session logout-revocation still needs a server-side store (deferred)"* (session.ts:37-38) — but nothing surfaces this risk to an operator.
- **Why it matters**: This is the security keystone of a PII app. "Sign out" that doesn't actually invalidate the token is a real incident-response gap (shared/stolen laptop, leaked token) and a compliance red flag in any security questionnaire. The 7-day window with no per-session revocation is an undocumented exposure trade-off chosen for convenience, with no recorded reasoning balancing it.
- **Recommendation**: Either (a) add a lightweight server-side revocation list keyed by a `jti` minted into the payload (logout inserts the jti; verify rejects revoked jtis), or (b) if staying stateless, document the trade-off explicitly, shorten the operator TTL (e.g. 24h) and justify it, and give logout a "sign out everywhere" that bumps a per-workspace epoch. At minimum, record why 7 days.
- **Effort**: M

## 4. Data portability is whole-DB-only — no per-workspace/GDPR export, and a future cross-tenant clobber channel
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: data-portability / compliance-differentiator
- **File**: app/api/workspace/export/route.ts:8
- **Observation**: Export/import operate on the **entire database**, not a workspace. `dumpWorkspace()` reads every table irrespective of caller (db-portability.ts:53, comment export/route.ts:8-18), and import `DROP TABLE`s and recreates every table in the dump (db-portability.ts:175; scope note import/route.ts:15-21). There is no path to export one workspace, one candidate, or one tenant's data.
- **Why it matters**: Two values left on the table at once. (1) Compliance/sales: a self-serve **per-workspace / data-subject export** ("download all data for this candidate/tenant") is a concrete GDPR portability + enterprise-procurement differentiator that the current all-or-nothing dump cannot satisfy. (2) Safety: this is the same dark-capability pattern as #1 — the moment multi-tenant is on, whole-DB export becomes a one-request cross-tenant exfiltration channel and import becomes a cross-tenant clobber. A workspace-scoped export is therefore *both* the marketable feature **and** the prerequisite that makes #1 safe — one build unlocks two outcomes.
- **Recommendation**: Add `dumpWorkspace(workspaceId)` (filter scoped tables by `workspace_id`; for still-blind tables, finish scoping first per #2) and a `loadIntoWorkspace` that does delete-by-workspace + insert (never `DROP TABLE`). Expose a per-candidate export for GDPR. Sequence it as the first slice of the multi-tenant epic so the upsell and the compliance story land together.
- **Effort**: M

## 5. The public anonymous demo session can read the real tenant's PII — gated by yet another honor flag
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark-capability / growth-lever
- **File**: app/api/demo/route.ts:28
- **Observation**: `/api/demo` is public and mints an **anonymous, recruiter-authorized** session scoped to the `"demo"` workspace (demo/route.ts:36-45). Because ~28 tables are workspace-blind (see #1), that anonymous session reads the *real* tenant's candidate PII through `/api/pipeline`, analytics, etc. The code admits it: *"this anonymous recruiter session can read the real tenant's PII via the ~28 unscoped tables"* (demo/route.ts:28-31, workspace-lock.ts:33-43). It is gated by a *separate* honor flag, `KP_DEMO_ENABLED`, with the same "only safe if you hold no real data" caveat. `requireOperator()` does reject the demo session — but only for export/import (require-operator.ts:33); the ~28 blind *read* routes have no such guard.
- **Why it matters**: A genuinely isolated demo workspace is a strong top-of-funnel growth lever — the marketing "Try the live demo" CTA points straight here (demo/route.ts:15) — but today it cannot be safely enabled on any deploy that holds real candidates, so the highest-converting demo experience is permanently off in production. The same incomplete-tenancy root that blocks the enterprise upsell also blocks the self-serve growth motion. Distinct surface (public, no password, anonymous), distinct upside.
- **Recommendation**: Make the demo workspace truly isolated (the per-workspace scoping from #2/#4) so `KP_DEMO_ENABLED` can be on in prod; until then, keep the default-deny but add a defense-in-depth guard that rejects the `demo` workspace on PII *read* routes, not just export/import — so a misconfiguration can't quietly leak. Then promote the live demo as a funnel feature.
- **Effort**: M
