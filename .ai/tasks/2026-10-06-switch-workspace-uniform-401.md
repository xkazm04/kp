---
kind: task
status: done
opened: 2026-10-06
charter: codebase-security-scan
branch: autopilot/codebase-security-scan-f727beae
gate: npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'
measurable: five distinguishing refusals a REVOKED cookie could read from POST /api/auth/switch-workspace. Before 5, after 0. Suite 2099 → 2106 tests, 0 failures.
---

# A revoked cookie gets ONE refusal shape at POST /api/auth/switch-workspace

## The leak

`proxy.ts` (its one-refusal-shape note, ~lines 204–206) states the doctrine: a
**missing, forged, expired or REVOKED** session is refused *identically*, so a dead
cookie is never an oracle. Two things put this route outside that:

1. It sits under the `/api/auth/` public prefix (`app/_lib/auth/public-routes.ts`
   `PUBLIC_API_PREFIXES`), so the proxy gate — the one place a revocation was consulted
   for an already-minted cookie — never runs on it.
2. The revocation question was asked only at the very **end**, inside `issueSession`
   via `renewing` (commit 008fb8965, the 2026-10-05 scan's S-02). Correct for *minting*,
   but the issuer is the last line the handler reaches.

So everything the handler decided on the way there answered a revoked cookie first. The
holder could not re-mint, but could read the tenant map on its way out: which workspaces
exist, which belong to its org, and where its holder held a seat — handed to exactly the
stolen-and-revoked cookie the store exists to kill.

## Before / after, per case

All five with the SAME cookie, each shown non-vacuously: the live cookie is first
asserted to get the distinguishing answer, so the `401` after the revocation cannot be a
signature, expiry, membership or status failure.

| Case | Request | Before | After |
| --- | --- | --- | --- |
| (a) | `workspaceId` that does not exist (lock open) | `404 Unknown workspace.` | `401` uniform |
| (b) | existing workspace owned by ANOTHER org (lock open) | `404 Unknown workspace.` | `401` uniform |
| (c) | existing same-org workspace, no membership (lock open) | `403 You are not a member of that workspace.` | `401` uniform |
| (d) | existing non-default workspace, `KP_MULTI_WORKSPACE` off | `403 Switching workspaces is disabled…` | `401` uniform |
| (e) | body over `MAX_SWITCH_BODY_BYTES` (4 KiB) | `413 PAYLOAD_TOO_LARGE` | `401` uniform |

"uniform" means all of: status `401`; body `deepEqual` to the **no-cookie** case's
`{"error":"Sign in to switch workspaces."}` (pinned by its own new test, so the
comparison cannot drift); and a `Set-Cookie` clearing `__Host-kp_session` with
`Max-Age=0`, the same answer the pre-existing revoked test asserts.

(b) uses the exact-`iat` `revokeSession` shape (the logout path); the rest use the
`revokeAllSessions` cutoff. Both shapes are covered.

## The fix

`app/api/auth/switch-workspace/route.ts`: `isSessionRevoked(session)` immediately after
`verifySession` succeeds — **before** the demo check and before the body is read —
answering `clearSession(NextResponse.json({ error: "Sign in to switch workspaces." }, {
status: 401 }))`, the issuer-refusal branch's own response. The issuer's `renewing` check
is untouched and stays as defence in depth for any other renewal door; so does the
source ratchet in `session-issuer.test.ts` that requires it.

No existing assertion in any test file changed. 6 tests added here, 1 in
`session-revocation.test.ts` (below).

## Step 3 — `isSessionRevoked`'s unused `nowMs`: it now HONOURS the row expiry

The static sweep's finding 7 (`.ai/tasks/2026-10-06-static-analysis-sweep.md`) reports
`nowMs` as accepted-and-ignored at `session-revocation.ts:227`, the one `npm run lint`
warning in auth. **Decision: use it** — apply the same `expires_at_ms > @nowMs` filter
`listRevocations` applies — rather than delete the parameter. Three reasons, in order of
weight:

1. **It cannot free a live session.** An exact row expires at `iat + SESSION_TTL_MS`,
   which *is* the named cookie's own `exp`. A cutoff row expires at
   `cutoff_ms + SESSION_TTL_MS`, and every session it matches has `iat < cutoff_ms`, so
   that session's `exp` is strictly earlier. Past either point `verifySession` already
   rejects the cookie on expiry alone, so the filter can only drop a row whose every
   possible match is already dead. (`UPSERT` takes `MAX(expires_at_ms)`, which can only
   move the boundary later, i.e. safer.)
2. **The answer already changed at that boundary — just non-deterministically.**
   `sweepExpired` DELETES rows on exactly this predicate, lazily and write-side only, at
   most once per `SWEEP_EVERY_MS`. So the same question already got two answers depending
   on when the sweep last ran. The filter makes it deterministic and makes this read agree
   with `listRevocations`, which is what an operator's "active revocations" view shows.
3. Deleting the parameter would have meant editing ~20 existing `isSessionRevoked(s, t)`
   assertion lines across two test files, which this brief forbids — and those `t` values
   are how the tests express "at this instant", so they would have lost intent.

New test: *"the read honours a row's expiry even while the row is still in the table"* —
in force at `expiresAt - 1`, not at `expiresAt`, with a **read-only second connection**
proving the row is still present (so the `false` is the read's filter, not a deletion),
and `listRevocations` asserted to agree at both instants.

The alternative — a caller passing a bogus future `nowMs` to suppress a live revocation —
is not a new exposure: `revokeSession`, `revokeAllSessions` and `listRevocations` already
take the clock the same way, every caller is trusted server code, and all four production
callers (`proxy.ts`, `require-operator.ts`, `current-user.ts`, `session-issuer.ts` — plus
this route) take the `Date.now()` default.

## Gates (in the worktree; `node_modules` is a junction to the main checkout)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | exit 0 (the three `*.generated.ts` CRLF-only rewrites were `git restore`d, as the sweep record warns) |
| `npm run lint` | exit 0, 0 errors, **49** warnings — was 50; the `nowMs` warning is gone and no new one appeared |
| `npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'` | 2106/2106 pass, 0 fail (baseline 2099) |

Test-first was verified: before the route change the five new cases gave
`not ok` with `404/404/403/403/413 !== 401`; after it, `12/12` in that file.

## Doc

`docs/architecture/api-contracts.md` §1.1's revocation block gained the paragraph for
this half ("…and it learns nothing on the way out"), next to the 2026-10-05 reader-tier
and 2026-10-06 issuer paragraphs it continues.

## What this does NOT close

- Other `/api/auth/` doors are outside the proxy for the same reason. `logout` is
  anonymous-safe by design and `login`/`register`/invite-accept mint from a fresh
  credential (no prior session to revoke), so none of them has a revoked-cookie oracle
  today — but nothing *enforces* that. A ratchet in the shape of
  `session-issuer.test.ts`'s ("every file under `app/` that verifies a session on a
  proxy-public path asks `isSessionRevoked`") would, and is not written here.
- The uniform `401` is about the *refusal shape*, not timing. The revoked cookie still
  learns nothing from the body, but the guard now runs before the store reads, so if
  anything the timing side-channel narrowed rather than widened.
