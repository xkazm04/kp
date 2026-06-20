# Auth, Sessions & Workspace Tenancy — Bug Hunter scan

> Context: Login/logout sessions, edge token verification, multi-workspace switching/tenancy scoping, and workspace export/import (data portability).
> Files reviewed: 22 of 28
> Total: 7 findings — Critical: 2, High: 2, Medium: 2, Low: 1

## 1. Anonymous `/api/demo` session reaches the unscoped recruiter surface — cross-tenant PII read

- **Severity**: Critical
- **Category**: auth-gap / tenant-isolation
- **File**: `app/api/demo/route.ts:31` (mints session), `app/api/pipeline/route.ts:8` + `app/_lib/db/pipeline.ts:286` (`listPipeline()` ignores workspace), `app/_lib/workspace-lock.ts:1-13` (only `analyses`+`profiles` scoped)
- **Scenario**: An anonymous internet visitor hits `GET /api/demo`. With `KP_SECRET` set, the route mints a **valid signed session** scoped to the `"demo"` workspace. That cookie now satisfies the `proxy.ts` auth gate for *every* recruiter route. The visitor calls `GET /api/pipeline`, `GET /api/jobs`, `GET /api/decisions/records`, etc. — none of which are workspace-scoped (`listPipeline()` takes no `workspaceId`, reads every row). They read the real tenant's candidate names, contacts, scores, decisions.
- **Root cause**: The tenancy seam was only half-built (`workspace-lock.ts` admits exactly two tables filter on `workspace_id`), but the demo endpoint mints a *non-default workspace session* that bypasses the `canSwitchWorkspace` lock entirely. The lock guards `/api/auth/switch-workspace` and workspace creation, but `/api/demo` mints a foreign-workspace cookie with no lock check, and the ~28 unscoped tables don't honor the cookie's workspace anyway.
- **Impact**: Full read of all candidate PII by any unauthenticated visitor whenever auth is enabled (the supposedly "safe" gated deploy). The demo "isolation" is illusory for every unscoped table.
- **Fix sketch**: Until full per-table scoping lands, `/api/demo` must NOT mint a session that the proxy treats as recruiter-authorized — gate the demo behind its own surface, or have `currentWorkspace()`/proxy reject any workspace other than the default when `KP_MULTI_WORKSPACE` is off (mirror the `canSwitchWorkspace` lock at the mint AND at the read path, not just at switch).

## 2. `/api/workspace/export` dumps the ENTIRE database to any session-holder (incl. demo)

- **Severity**: Critical
- **Category**: auth-gap / data-exfiltration
- **File**: `app/api/workspace/export/route.ts:22`, `app/_lib/db-portability.ts:53` (`dumpWorkspace()` reads every table)
- **Scenario**: Any holder of a valid session — including the anonymous demo session from finding #1 — calls `GET /api/workspace/export`. The handler calls `dumpWorkspace()`, which reads **every table regardless of workspace** and streams it as a downloadable JSON of all candidates, transcripts, contacts, decisions, and billing rows.
- **Root cause**: The route relies solely on the proxy session gate (any session passes) and has no `requireOperator()` defense-in-depth, unlike `/api/llm/keys` and `/api/billing/*`. The code's own SCOPE NOTE admits it is a whole-DB dump that "becomes a cross-tenant exfiltration channel" — but the demo-session path already makes any visitor a session-holder today.
- **Impact**: One-request full-PII exfiltration. The single most damaging endpoint in the context: it bypasses even the partial `analyses`/`profiles` scoping by reading raw tables.
- **Fix sketch**: Add `const denied = await requireOperator(); if (denied) return denied;` to both export and import handlers, AND reject any non-operator/demo workspace. A demo session must never satisfy an export. Long-term, filter the dump by `workspace_id`.

## 3. Login endpoint has no rate limiting — operator-password brute force

- **Severity**: High
- **Category**: auth-gap / brute-force
- **File**: `app/api/auth/login/route.ts:18-27`
- **Scenario**: An attacker POSTs `{ password }` to `/api/auth/login` in a tight loop. There is no per-IP throttle (contrast `/api/demo:22`, which *does* call `rateLimit`). The single shared `KP_OPERATOR_PASSWORD` is the only credential gating the whole recruiter surface; constant-time compare prevents timing leaks but not volume.
- **Root cause**: The auth model is a single static shared secret with no lockout, no second factor, and no attempt accounting. The constant-time compare addresses one threat (timing) while leaving the dominant one (online guessing) open.
- **Impact**: A weak/guessable operator password is brute-forceable, yielding full recruiter access to all PII. Blast radius is the entire app.
- **Fix sketch**: Wrap the password check in `rateLimit(\`login:${clientIpFrom(headers)}\`, { limit: 5, windowMs: 15*60_000 })` (the helper already exists), return 429 on trip, and add a short global backoff after N total failures.

## 4. Logout cannot revoke a stolen/leaked session token (no server-side invalidation)

- **Severity**: High
- **Category**: session-management / silent-failure
- **File**: `app/api/auth/logout/route.ts:8-18`, `app/_lib/auth/session.ts:29-37`
- **Scenario**: A session cookie leaks (shared machine, XSS-adjacent, proxy log). The operator "logs out". Logout only clears the cookie in *that* browser (`maxAge: 0`); the signed token remains cryptographically valid for the full 7-day TTL anywhere it was copied. The only revocation is the global `KP_SESSION_EPOCH` bump, which nukes **every** session for every operator and requires an env change + redeploy.
- **Root cause**: Stateless HMAC sessions with no per-session store. The code comment concedes "per-session logout-revocation still needs a server-side store (deferred)". So logout is **security theater** against the threat it exists for.
- **Impact**: A leaked 7-day token survives logout; the only mitigation is an all-or-nothing kill switch. For an app holding candidate PII this is a real incident-response gap.
- **Fix sketch**: Add a server-side revocation list keyed by a per-session `jti` (random id in the payload); logout records the `jti` as revoked; `verifySession`/`verifySessionEdge` reject revoked ids. Until then, shorten `SESSION_TTL_MS` from 7 days.

## 5. `currentWorkspace()` silently falls back to the default tenant on any cookie error

- **Severity**: Medium
- **Category**: silent-failure / tenant-isolation
- **File**: `app/_lib/auth/current-workspace.ts:10-17`
- **Scenario**: The resolver wraps `cookies()` + verify in a `try/catch` that returns `DEFAULT_WORKSPACE` on ANY throw. If `verifySession` ever throws (e.g. a future change, or `cookies()` behaving unexpectedly under a new Next runtime), a request that should be unauthenticated/foreign-scoped resolves to the **real default workspace** instead of failing closed.
- **Root cause**: The fallback conflates "outside a request (script/background)" with "verification failed" — two cases that must diverge: background work legitimately wants the default, but a *failed verify inside a request* should yield no access, not the primary tenant.
- **Impact**: Today benign (single tenant), but the moment any second workspace exists this fail-open default leaks the primary tenant's scope to a request whose session was unverifiable.
- **Fix sketch**: Distinguish the two paths — only fall back to default when `cookies()` itself is unavailable (no request scope). When a cookie is present but `verifySession` returns null, resolve to a non-existent/empty workspace, not the default.

## 6. Workspace import executes attacker-supplied DDL behind only the session gate

- **Severity**: Medium
- **Category**: injection-surface / auth-gap
- **File**: `app/api/workspace/import/route.ts:24-49`, `app/_lib/db-portability.ts:161-191` (`loadWorkspace` runs `t.ddl` + `DROP TABLE`)
- **Scenario**: A session-holder (again, including a demo session per #1) POSTs `{ dump, apply:true, replace:true }`. `loadWorkspace` executes each table's `ddl` string and `DROP TABLE` for every table in the payload — arbitrary CREATE statements from the uploaded file run against the live DB. `SAFE_IDENT` guards table/column *names*, but the `ddl` body is executed verbatim.
- **Root cause**: Restore-is-running-DDL by design, mitigated only by the assumption that the caller is a trusted operator — an assumption broken by the demo-session and missing `requireOperator()`.
- **Impact**: Schema destruction / data clobber of the whole DB by any session-holder. Coupled with #1, anonymous-reachable.
- **Fix sketch**: Gate behind `requireOperator()` (see #2), and reject DDL that isn't a plain `CREATE TABLE/INDEX` for the named identifier (parse + allowlist the statement shape, not just the identifier).

## 7. Session cookie `sameSite: "lax"` leaves state-changing GET-less routes mildly CSRF-exposed

- **Severity**: Low
- **Category**: csrf / session-management
- **File**: `app/api/auth/login/route.ts:34`, `app/api/auth/switch-workspace/route.ts:38`, `app/api/demo/route.ts` (GET that sets a cookie + side-effects)
- **Scenario**: `sameSite: "lax"` allows the cookie on top-level cross-site GET navigations. `/api/demo` is a GET that mints a session and seeds rows — a cross-site link can silently establish a demo session in a victim's browser. The POST mutation routes are protected by lax for cross-site POSTs, but there is no explicit CSRF token / Origin check anywhere.
- **Root cause**: Reliance on SameSite=lax as the sole CSRF defense, with at least one state-changing **GET** (`/api/demo`) that lax does not protect.
- **Impact**: Limited (demo-scope session forced onto a victim; no mutation of recruiter data via the POST routes under lax). Low blast radius but a real gap if any future state-changing GET is added.
- **Fix sketch**: Make `/api/demo` a POST (or add an Origin/Referer check), and add an Origin allowlist check to the auth mutation routes as defense-in-depth beyond SameSite.
