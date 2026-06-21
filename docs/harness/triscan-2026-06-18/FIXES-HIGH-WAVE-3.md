# Tri-Lens Fix — High Wave 3: Auth hardening

> Security-tier wave. 2 atomic fix commits, **3 High findings addressed** (1 full, 1 partial-with-deferral, 1 safe-variant).
> Baseline preserved: tsc 0 → 0 · TS unit tests 960 → 963 (+3) · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| Commit | Finding | Severity | Files |
|---|---|---|---|
| `6d34a29` | model-api-key #3 — weak KP_SECRET accepted silently | High | llm-secret.ts |
| `fd3c6ec` | auth-sessions-tenancy #3 (fail-open) + #4 (no revocation) | High ×2 | proxy.ts, session.ts, edge-verify.ts (+2 tests) |

## What was fixed

1. **Fail closed in production (#3).** The proxy gate ran *only* when `KP_OPERATOR_PASSWORD` was set; unset, the entire recruiter surface — candidate PII, every data API — was served **public**. That's the documented dev default and the likely state of a prod deploy that forgot the var. Now: set ⇒ enforce sessions (unchanged); unset ⇒ open in development, but in **production** refuse non-public routes (503 for APIs, redirect pages to `/login`) unless `KP_ALLOW_OPEN=1` deliberately opts into open prod. Dev is untouched — no regression.

2. **Global session kill-switch (#4, partial).** Stateless sessions couldn't be revoked: logout cleared only the cookie, so a captured token stayed valid for 7 days, and the only "revoke everyone" was rotating `KP_SECRET` — which *also* re-keys at-rest provider-key encryption (a nuke). Added an `epoch` to the session payload, checked at **both** gates (node `verifySession` + edge `verifySessionEdge`) against `KP_SESSION_EPOCH`: bumping that env var revokes every issued session at once, without touching `KP_SECRET`. Backward-compatible (a missing epoch = 0). **Deferred:** per-session logout-revocation needs a server-side session store (noted in `session.ts`) — the edge gate can't read SQLite, so a true per-token revoke is an architectural change, out of scope for this wave.

3. **Weak-secret warning (#3 / model-api-key).** `masterKey()` accepted any non-blank `KP_SECRET` through one unsalted sha256. A one-time **production** warning now fires when it's < 24 chars. Deliberately a warning, **not** a hard reject — refusing would brick an existing deployment (stored keys become undecryptable; operator locked out of sessions).

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 960 | 963 (+3) |

New tests: epoch kill-switch (node + edge), garbage-epoch → 0.

## Cumulative this session

30/30 criticals + **13 Highs** closed across 11 waves, 0 regressions throughout. TS 935→963, Python 626→634.

## Auth/tenancy theme — remaining

- **Per-session logout-revocation** (the full #4) — needs a server-side session/`jti` store the edge can consult; architectural.
- **Workspace-membership check on switch** (#5) — already mitigated by the Wave-2 single-tenant lock (switch-to-non-default is refused); revisit when real multi-tenancy lands.
- Login brute-force rate-limit, `__Host-` cookie attributes audit — non-critical follow-ups.
