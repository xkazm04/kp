# The session issuer owns the renewal's revocation check (2026-10-06)

Charter `codebase-security-scan`, run 2837136d on
`autopilot/codebase-security-scan-2837136d`, cut from `main` at **0119df445**.

The follow-up the previous run deliberately did not make. Its record
([`2026-10-05-security-scan-auth-api.md`](./2026-10-05-security-scan-auth-api.md),
"For the operator") closed S-02 with an inline check in
`/api/auth/switch-workspace` and left the chokepoint question open, because that
brief ring-fenced the issuer. This one answers it.

## Reconciled first

On `main` at 0119df445, `app/_lib/auth/session-issuer.ts` did **not** import
`session-revocation.ts`, had no `renewing` option and no `revoked` refusal. Its
header still said *"Revocation (the unmerged per-principal list) plugs in here
too"* — wording older than the store, which has been merged since 2026-09-21.
The only renewal-side check was the inline `isSessionRevoked(session)` at
`app/api/auth/switch-workspace/route.ts:46` (commit 5891e13d7). So the change was
needed and was made.

## The decision: the issuer, not the route

A revocation names `(principal, iat)`. A renewal hands back a fresh token on a
**new** `iat`, so neither row shape sees it: an exact row names the old `iat`, and
a "sign out all devices" cutoff matches `iat < cutoff_ms` while the re-mint's
`iat` is now. The only thing that can catch it is a question about the session the
renewal came **from** — and the issuer's existing account re-read cannot stand in,
because signing out all devices deliberately leaves the account *active*.

Both placements close today's hole identically. They differ on tomorrow's:

- **In the route** the check is a fact about one handler. `switch-workspace` is
  the only cookie-to-cookie renewal door that exists — every other minting door
  (login, register, invite accept) demands a fresh credential — so a second one
  would be written from scratch, and the author would have to know this check
  exists in order to copy it. Nothing would fail if they did not: the route's own
  test would not be written either.
- **In the issuer** the check is a fact about *minting*. `issueSession` is already
  the only place a session can be born (a source ratchet has pinned that since the
  issuer shipped), so every present and future door passes through it. A renewal
  door now has to **name its prior session** to mint at all, and the obligation is
  discoverable from the type rather than from a sibling route's comments.

The issuer wins on that one axis, and nothing argues the other way: the import is
node-only (the issuer already reads `db/users`, `db/memberships`, `db/workspaces`),
the proxy gate is untouched, and `isSessionRevoked`'s fail-open-on-store-unavailable
posture is inherited unchanged — a renewal during a database fault behaves exactly
as every other seam does.

### The shape

```ts
issueSession(res, principal, { entered: false, renewing: session })
// → { ok: false, reason: "revoked" }   // before signing; no cookie set
```

`IssueOptions.renewing?: RevocableSession` (the type from `session-revocation.ts`,
so the issuer keys on signed claims only) and a fourth `IssueRefusal`, `"revoked"`,
beside `inactive` / `unknown_user` / `foreign_workspace`.

**Omitting `renewing` is an assertion, not a default.** It says this mint comes
from a fresh credential — a password, an invite token — which is true of login,
register and invite accept, and those three were left alone. The assertion is held
by a ratchet rather than by trust: `session-issuer.test.ts` fails if any non-test
file under `app/` calls both `verifySession(` and `issueSession(` without passing
`renewing:`. It reads each call's arguments by paren balance (a regex cannot find
where a call with a nested object literal ends) and **asserts it found
switch-workspace**, so it cannot pass while matching zero files.

### What changed in the route

`renewing: session` on the `issueSession` call, and the inline `isSessionRevoked`
block deleted — the issuer is now the only check. The refusal maps to the branch
the route already had: `foreign_workspace` → 404, everything else → 401 with
`clearSession`, which is byte-for-byte the answer the inline block gave.

**The one behavioural difference, deliberate.** The inline check ran immediately
after `verifySession`; the issuer's runs last. So a revoked cookie that also asks
for a demo switch, an unknown workspace or a team it has no membership in now
meets that guard's 403/404 instead of the revocation's 401. It never reaches a
mint either way, and the information a revoked holder gains is "this workspace
exists / I am not a member" — which it could already learn while its cookie was
live. Weighed and accepted; the alternative is keeping a duplicate check in the
route, which is the thing this change removes.

The route's existing case — *a REVOKED cookie cannot re-mint itself through the
switch: 401, cleared, and no new token* — **passes unchanged**. That was the
acceptance condition for the move, and it is what proves it: the test knows
nothing about where the check lives.

## Acceptance

Test-first. The four new cases were written and run against the un-fixed source
before `session-issuer.ts` was touched.

| file | before the source change | after |
| --- | --- | --- |
| `app/_lib/auth/session-issuer.test.ts` | **17 tests, 13 pass, 4 fail** | **17 tests, 17 pass** |
| `app/api/auth/switch-workspace/route.test.ts` | 6 pass (not re-written) | **6 tests, 6 pass** |

The four that failed first, all labelled BROKEN (failed twice, not flakes):

- *issueSession refuses a renewal of a REVOKED prior session (exact-iat row) and
  sets no cookie*
- *issueSession refuses a renewal caught by a 'sign out all devices' CUTOFF row*
- *a LIVE prior session still renews, and a revocation of one device leaves the
  sibling minting*
- *every app/ file that both verifies and issues a session passes renewing: to the
  issuer*

Each of the first three opens with a **non-vacuity probe**: the identical renewal
succeeds while the prior session is live, so the refusal cannot be a status,
membership or workspace failure wearing a new name. The cutoff case additionally
asserts that a sign-in with a fresh credential (no `renewing`) still mints — the
property that makes "sign out all devices" a revocation of sessions and not of the
account.

| command | result |
| --- | --- |
| `npm run typecheck` | **exit 0**, no tsc output |
| `npm run lint` | **0 errors**, 50 warnings — all pre-existing, all in `scripts/**` (same 50 the 2026-10-05 run recorded) |
| `npm run test:unit -- "app/_lib/auth/*.test.ts"` | **149 tests, 149 pass** (144/144 before; the 5 new cases are 3 revocation + the ratchet + its shape fixture) |
| `npm run test:unit -- app/api/auth/switch-workspace/route.test.ts` | **6 tests, 6 pass** |
| `npm run test:unit -- "app/_lib/auth/*.test.ts" "app/api/**/*.test.ts"` | **2099 tests, 2095 pass, 4 fail** — the four inherited reds and nothing else |
| `npm run docs:check` | **pass** — 12 decision records valid |

No catalog key was added, so `i18n:check` has nothing to say about this change.

The three `app/_lib/*.generated.ts` files show as modified after any `typecheck`
run — `schemas:gen` rewrites them with CRLF and no content change (`git diff
--stat` empty). Restored, not committed, exactly as the previous run did.

### The four failures are the documented inherited reds

Unchanged from the 2026-10-05 record, same three files and four cases:

- `app/api/interview/complete/complete-candidate-guard.test.ts` — *CONTROL — a
  candidate-mode session on a scoreable entry gets the scorecard, the approval and
  the sealed decision* (1)
- `app/api/interview/recording/recording-door.test.ts` — *playback streams the
  audio, serves a Range, and 404s for a foreign or absent recording*; *playback is
  closed by the RETENTION gate even before the sweep has run* (2)
- `app/api/interview/sessions/recruiter-recording-delete.test.ts` — *the
  recruiter's deletion unlinks the file, keeps the record, and closes playback* (1)

They are in `app/api/interview/**`, which this change does not touch and which the
brief ring-fenced as a separate run. The previous run proved them inherited by
re-running the three files against the base; this run's evidence is weaker on
purpose — it is the same four names, and nothing in auth is in their path.

## Doc sync

`scripts/docs/feature-doc-map.json` couples both touched source files to a doc:

- `app/_lib/auth/session-issuer.ts` → **`docs/architecture/api-contracts.md`**: a
  new "And a revoked session cannot re-mint itself" paragraph beside the 2026-10-05
  home-org-tier one, stating that the check lives in the issuer, what omitting
  `renewing` asserts, and that a ratchet holds it.
- `app/api/auth/switch-workspace/**` → **`docs/features/organization/README.md`**:
  the "five seams consult it" list now names the **session issuer** rather than the
  one route (it covers every renewal door, which is the point of the move); a new
  bullet states the contract and the ratchet; the surface table's Workspace-switch
  row now says both refusals come from the issuer.

## Open

- The "sign out all devices" **button** is still not built — the API has been ready
  since the store shipped and the sidebar's sign-out uses the single-session scope.
  Unchanged by this run, restated because it is the control this fix protects.
- S-03, S-04 and S-05 from the 2026-10-05 scan remain open and unproposed, for the
  reasons that record gives.
