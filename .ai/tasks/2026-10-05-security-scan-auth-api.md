# Security scan — auth and API authorization surface (2026-10-05)

Charter `codebase-security-scan`, run b7518762 on `autopilot/codebase-security-scan-b7518762`,
cut from `main` at **d6854b7f4**.

Two fixes landed, both with a test that fails before and passes after. Everything else
the scan looked at held, and the reason it held is worth stating: this tree already
carries source-level ratchets for most of what a one-off scan would go looking for
(`route-capability-coverage`, `route-tenancy-coverage`, `deployment-read-gate`,
`write-capability-gate`, `public-body-cap-contract`, `rate-limit-contract`). The two
findings below are both in the same blind spot — **a credential that is already minted**,
which no source ratchet asks about.

## Step 1 — the known fix (S-01)

Reconciled against main first: `isHomeOrgReader()` at `app/_lib/auth/require-operator.ts:100`
did **not** carry the check on d6854b7f4, so the fix was needed and was made.
`isOperator()` has consulted `isSessionRevoked` since the store shipped (line 43);
`isHomeOrgReader()` verified the signature and re-read the account but never asked
whether the session had been revoked.

Why that tier specifically: it is the one reachable **without** `requireOperator()` above
it. `app/diagrams/page.tsx:70` and `app/api/palette/preview/route.ts:27` ask
`isHomeOrgReader()` alone, so `proxy.ts` was the only check a revoked cookie met on that
path — and proxy.ts's own revocation lookup fails open if its dynamic import fails (a
recorded design decision, 04b459639/47486fdab; it is the *reason* for this fix, not a
defect in itself).

Open mode's early return and the fail-closed `catch` are unchanged, as is
session-revocation.ts's fail-open-on-store-unavailable posture.

Commit **49bdcf65e**.

## Findings

| id | file:line | sev | consequence | status |
| --- | --- | --- | --- | --- |
| S-01 | `app/_lib/auth/require-operator.ts:100` | high | A revoked session kept the deployment-wide reads (`/diagrams`, the palette preview's deployment-wide tabs) — the one tier with no `requireOperator` above it, so proxy.ts was the only check in the path. | **fixed here** (49bdcf65e) |
| S-02 | `app/api/auth/switch-workspace/route.ts:31` | high | A revoked cookie re-minted itself into a fresh, **unrevoked** 7-day token. Measured: 200 OK. One POST reversed "sign out all devices" — the laptop-theft case the store exists for. | **fixed here** (see below) |
| S-03 | `app/api/benchmarks/salary/route.ts:9` | low | The only non-public route that reads nothing session-derived. Behind proxy.ts, so it needs a valid session, but a **demo-workspace** session reaches it. Aggregate-only, min-cohort-guarded (null below the floor), PII-free synthetic reference corpus — deliberate and documented in the route header. No tenant or candidate data. | open, no action proposed |
| S-04 | `app/api/intake/[id]/message/route.ts:32` | low | Derives `currentUserId` from a verified session without a revocation check. Non-public, so proxy.ts gates it (and does check revocation on that path); the id is used for actor attribution, not authorization. Noted for completeness — unlike S-01/S-02 there is no path where proxy.ts is absent. | open |
| S-05 | `app/_lib/auth/home-gate-server.ts:28` | low | Same shape as S-04 on the `/` landing-vs-workspace gate. Not an authorization decision over data — it chooses which page to paint. | open |

### S-02, the second fix

`/api/auth/switch-workspace` is **public** (`isPublicPath("/api/auth/switch-workspace")`
is `true`, via the `/api/auth/` prefix), so proxy.ts — the one place revocation was
consulted for an already-minted cookie — never runs on it. And the route is a
**renewal**: it hands back a fresh 7-day token on a new `iat`.

A revocation names `(principal, iat)`, and neither shape caught the re-mint:

- an exact row names the **old** `iat`;
- a "sign out all devices" cutoff matches `iat < cutoff_ms`, and the new token's `iat`
  is now.

`issueSession`'s own account re-read does not cover it either: "sign out all devices"
deliberately leaves the account **active**, so there is nothing for it to refuse. The
route's existing disabled-account test passes throughout.

Fix: `isSessionRevoked(session)` immediately after `verifySession`, answering 401 and
clearing the cookie — 14 lines of comment plus 3 of code, no change to proxy.ts, the
issuer, the login throttle or logout.

### What the scan checked and found clean

- **(a) guard coverage.** 291 route files, 37 public. Of the 254 non-public: 51 reach no
  in-handler guard, and all 51 resolve tenancy through `currentWorkspace()`, which reads
  the **session cookie**, never the request (`app/_lib/auth/current-workspace.ts:16`).
  They sit behind fail-closed proxy.ts for authentication. Exactly **one** non-public
  route reads nothing session-derived at all: S-03.
- **(b) public routes.** All 37 carry their own check or a stated reason. The three with
  no token/signature signal are `/api/auth/register` (gated 404 by `KP_SIGNUP_ENABLED`,
  per-IP persisted throttle, 8 KiB body cap), `/api/demo` (public entry by design,
  rate-limited) and `/api/extract-text` (documented, rate-limited, file-size gated).
  The three `[id]`-keyed devcase session doors all prove the attempt via
  `door.authorize(request.headers, body.token)`.
- **(c) server pages / actions.** `/diagrams` → `isHomeOrgReader()` (now revocation-aware
  via S-01); `/control` → `isOperator()`; `app/_lib/org-actions.ts` → `requireOrgCapability`.
  `app/history/[slug]` is workspace-scoped via `currentWorkspace()` behind proxy.ts.
  `app/api/palette/preview` gates on `isHomeOrgReader()` and so is also closed by S-01.
- **(d) cross-org reads.** **Zero** route files take a workspace or org id from the
  request (searched `searchParams.get("workspace"|"org"|…)` and `workspaceId: body…`).
  Tenancy is session-derived everywhere.
- **(e) body caps.** 46 route files added since 2026-09-21; the two public ones are
  `/api/status/[token]/resend` (EXEMPT, reads no body) and `/api/stop/[token]/language`.
  `public-body-cap-contract.test.ts` derives its set from `isPublicPath`, so it covers
  them by construction — and it passes.
- **(f) tracked secrets.** The `git grep` found 10 hits, **all** test fixtures: the
  brief's `':!*.test.ts'` pathspec does not exclude `.test.mjs` or
  `pipeline/jobfit/tests/*.py`. No real credential. One tracked `.env*` file:
  `.env.example`.

## Commands run

| command | files | result |
| --- | --- | --- |
| `npm run typecheck` | `schemas:gen` (3 generated files, no diff) then `tsc --noEmit` over the tree | **pass**, no tsc output |
| `npm run lint` | eslint, whole tree | **pass** — 50 problems, **0 errors**, 50 warnings, all pre-existing and all in `scripts/**` |
| `npm run test:unit -- app/_lib/auth/*.test.ts` | the 14 files: `credentials`, `current-user`, `edge-verify`, `login-throttle`, `org-authority`, `password`, `public-routes`, `require-operator`, `roles`, `session`, `session-issuer`, `session-nav`, `session-revocation`, `session-revocation-enforcement` | **144 tests, 144 pass, 0 fail** |
| `npm run test:unit -- app/api/auth/switch-workspace/route.test.ts` | 1 file | **6 tests, 6 pass, 0 fail** |
| `npm run test:unit -- "app/api/**/*.test.ts"` | the whole api suite | **1949 tests, 1945 pass, 4 fail** — the four inherited reds, below |
| `npm run test:unit -- app/api/auth/switch-workspace/route.test.ts app/api/rate-limit-contract.test.ts app/api/route-capability-coverage.test.ts app/api/error-response-contract.test.ts app/api/public-body-cap-contract.test.ts app/_lib/auth/public-routes.test.ts` | 6 files | **382 tests, 382 pass, 0 fail** |
| `npm run test:unit -- app/_lib/auth/*.test.ts "app/api/**/*.test.ts"` (final, on the committed tree) | the 14 auth files + the whole api suite | **2094 tests, 2090 pass, 4 fail** — the same four inherited reds |
| `npm run docs:check` | `scripts/docs/check-adrs.mjs` | **pass** — 12 decision records valid, every `sources:` path exists |
| `npm run i18n:check` | `scripts/i18n-check.mjs` | **pass** — 13825 strings/locale, 4 locales in parity (no catalog key was added) |

### Doc sync

`scripts/docs/feature-doc-map.json` couples both touched source files to a doc, so both
were updated in the same change:

- `app/_lib/auth/require-operator.ts` → **`docs/architecture/api-contracts.md`** §1.2, a
  new "A revoked session is no reader either" paragraph under the home-org tier.
- `app/api/auth/switch-workspace/**` → **`docs/features/organization/README.md`**: the
  revocation bullet went from "three seams consult it" to five and states why the two new
  ones were blind spots; the surface table's Workspace-switch row now names the revoked
  cookie beside the disabled account.

The three `app/_lib/*.generated.ts` files show as modified after any `typecheck` run —
`schemas:gen` rewrites them with CRLF and **no content change** (`git diff --stat` is
empty). They were restored rather than committed.

### The four failures are inherited from main

Three files, four cases:

- `app/api/interview/complete/complete-candidate-guard.test.ts` — *CONTROL — a
  candidate-mode session on a scoreable entry gets the scorecard, the approval and the
  sealed decision* (1)
- `app/api/interview/recording/recording-door.test.ts` — *playback streams the audio,
  serves a Range, and 404s for a foreign or absent recording*; *playback is closed by the
  RETENTION gate even before the sweep has run* (2)
- `app/api/interview/sessions/recruiter-recording-delete.test.ts` — *the recruiter's
  deletion unlinks the file, keeps the record, and closes playback* (1)

Proven inherited rather than asserted — the base's auth file was checked out and the same
three files re-run:

```bash
git checkout d6854b7f4 -- app/_lib/auth/require-operator.ts app/_lib/auth/require-operator.test.ts
npm run test:unit -- app/api/interview/complete/complete-candidate-guard.test.ts \
  app/api/interview/recording/recording-door.test.ts \
  app/api/interview/sessions/recruiter-recording-delete.test.ts
# → 17 tests, 13 pass, 4 fail  — identical to the run with this branch's change
git checkout HEAD -- app/_lib/auth/require-operator.ts app/_lib/auth/require-operator.test.ts
```

`style-debt.test.ts` (the other documented inherited red) is outside both globs this run
used and was not executed.

### The tests that prove the two fixes

Each was run against the un-fixed source to confirm it fails, then against the fix.

| fix | test | before | after |
| --- | --- | --- | --- |
| S-01 | `app/_lib/auth/require-operator.test.ts` — *a REVOKED home-org session is not a reader — and the live sibling device still is* | fail | pass |
| S-01 | `app/_lib/auth/require-operator.test.ts` — *open mode is unchanged by a revocation — the local-dev contract outranks it* | fail | pass |
| S-02 | `app/api/auth/switch-workspace/route.test.ts` — *a REVOKED cookie cannot re-mint itself through the switch: 401, cleared, and no new token* | fail — **expected 401, actual 200** | pass |

Before/after for S-01 was measured at `14 tests, 12 pass, 2 fail` → `14 tests, 14 pass,
0 fail`; for S-02 at `6 tests, 5 pass, 1 fail` → `6 tests, 6 pass, 0 fail`. Both new
require-operator cases open with a probe on the same cookie (it IS a reader while live,
and the sibling device stays one), so neither can pass for an unrelated reason; the S-02
case likewise renews successfully once before the revocation is written.

## For the operator

- S-03/S-04/S-05 are recorded, not fixed, and none is proposed for a fix: each is behind
  a gate that does hold, and S-03's exposure is a documented PII-free aggregate.
- Worth a decision: S-02 was a **renewal** door leaking a revocation, and
  `/api/auth/switch-workspace` was the only one of its kind (every other minting door
  demands a fresh credential — a password, an invite token). If another cookie-to-cookie
  renewal door is ever added, the check now in this route is the thing it must copy.
  Whether that belongs in `session-issuer.ts` as a single chokepoint instead is a design
  call this run deliberately did not make — the brief ring-fenced the issuer.
