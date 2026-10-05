# Branch reconcile: per-session revocation (f6e59d87f) onto main

Date: 2026-10-05 · Charter: accepted-idea-delivery · Branch: `autopilot/accepted-idea-delivery-1d7bc52b`

## Result: ported, one commit

Source `autopilot/enforce-per-user-session-revocation-list-to-cove` (`f6e59d87f`, base `6605474f7`)
was cherry-picked onto main `39a709baa` as `04b459639`.

**Reconcile first.** `git grep -n session_revocation 39a709baa -- app proxy.ts` found nothing, so
main did not carry it. The design decisions in the commit message are kept as written: `iat` is the
session identity (collisions over-revoke, never under-revoke), the lookup fails OPEN on an unreadable
store and says so once, and `session_revocations` is tenancy-exempt because a per-user revocation
follows the person across workspaces.

**Cherry-pick result.** 13 of the 15 files applied cleanly. This includes the three text-only conflicts
the brief predicted (`docs/features/organization/README.md`, `scripts/docs/feature-doc-map.json`,
`docs/architecture/api-contracts.md`) and `public-body-cap-contract.test.ts`. Git's three-way merge kept
main's additions next to the branch's, and the branch's edits to `proxy.ts`, `current-user.ts` and
`tenancy.ts` landed on main's current code without a conflict. Two files conflicted in content and
were resolved by hand:

- `app/api/auth/logout/route.ts`
- `app/_lib/auth/require-operator.ts`

## Deviations from f6e59d87f

1. **`logout/route.ts` ends in the issuer.** It returns
   `clearSession(NextResponse.json({ ok: true, revoked, scope }))`. The branch's `EXPIRED` constant, the
   two `res.cookies.set(...)` calls and the `ENTERED_COOKIE` import are dropped. The branch's revocation
   block and byte-capped body read are unchanged. This was needed because `session-issuer.test.ts`
   fails on any `cookies.set(SESSION_COOKIE` outside the issuer. The header comment now says the issuer
   owns the cookie attributes.
2. **`require-operator.ts`: `isSessionRevoked` is asked before `accountStillLive`.** Main replaced the
   old `return true` with `return await accountStillLive(session)`. The revocation check was added in
   front of it, so a revoked cookie returns `false`, which `requireOperator` answers with 401 and never
   403. The imports merge both sides: main's `currentOrgId`, `isOperatorSession` and `SessionPayload`,
   plus the branch's `isSessionRevoked`.
3. **Nothing else deviates.**
   - `session.ts` re-exports `SESSION_TTL_MS` from `edge-verify.ts`, so `session-issuer.ts` and the
     tests still import it from `./session`.
   - `tenancy.ts` has `session_revocations` in `TENANCY_EXEMPT_TABLES`, next to `login_attempts`, and in
     `TENANCY_LAZY_TABLES`, as on the branch.

## Not done (by brief)

- No revocation on renewal (`issueSession`'s `resolve()` seam).
- No "sign out all devices" button. The API is ready.
- **`isHomeOrgReader()` has no direct revocation check.** `requireHomeOrgReader()` calls `requireOperator()`
  first, so the route-level path is covered. A caller of the bare `isHomeOrgReader()` boolean is not.
  The branch never touched it and the brief names three seams. It is worth a follow-up
  decision: add the check there, or document that the boolean assumes a prior `isOperator()`.

## Verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` | pass: 0 errors, 50 warnings, all in files this change does not touch |
| `npm run docs:check` | pass: 12 ADRs valid |
| `npm run api:check` | pass: 291 routes |
| `npm run guidance:check` | pass |
| `npm run lint:ts-ratchet` | pass |
| `npm run test:unit -- "app/_lib/auth/**/*.test.ts"` | pass: 142/142. Includes `session-revocation.test.ts`, `session-revocation-enforcement.test.ts`, `session-issuer.test.ts`, `require-operator.test.ts` and `session.test.ts` |
| `npm run test:unit -- "app/api/public-body-cap-contract.test.ts" "app/api/auth/**/*.test.ts"` (with auth) | pass: 155/155 |
| `npm run test:unit -- "app/_lib/tenancy*.test.ts" "app/_lib/db/*tenancy*.test.ts" rate-limit-contract error-response-contract` | pass: 507/507 |
| `npm run test:unit -- "app/api/**/*.test.ts" "app/_lib/auth/**/*.test.ts"` | 2087 pass, 4 fail (see below) |
| `git grep -n "cookies.set(SESSION_COOKIE" -- app` | only `app/_lib/auth/session-issuer.ts` (2 sites) plus tests |

**Failures present on main without this change.** The same 4 tests fail on `39a709baa` when the same
combined command is run there (2072 tests, 4 fail):
- `app/api/interview/complete/complete-candidate-guard.test.ts` has 1 failing test, the CONTROL case.
- `app/api/interview/recording/recording-door.test.ts` has 3 failing tests: playback, retention gate and recruiter deletion.
- The recording door fails with `TypeError: NextResponse is not a constructor`, which is unrelated to auth.
- Run alone, the recording-door file fails 2 of those 3; the deletion case only fails in the combined run.

**Also red on main: `npm run test:docs`.** `check-doc-sync.test.mjs` asserts
`missing doc: docs/design/app-contest-kit.md`. That doc is referenced by the feature-doc map but is
absent from this checkout, and the brief marks it do-not-touch.

`npm run typecheck` rewrites the three `*.generated.ts` files with LF line endings only (no content
diff). They were restored with `git checkout --` and are not part of the change.
