# The 1 ms hole at `exp`: one validity convention for the session lifecycle

**Date:** 2026-10-06 · **Charter:** `codebase-security-scan` · **Branch:**
`autopilot/codebase-security-scan-6a4cf8a3` · base `main` @ `c1f70b1ed`

## The finding

The session lifecycle had **two** validity conventions, and they disagreed by exactly
one millisecond at the expiry instant.

The **verifiers** used a closed window `[iat, exp]` — they rejected only when the
cookie was strictly past its expiry:

| Site | On `main` |
| --- | --- |
| `app/_lib/auth/session.ts:122` (`verifySession`) | `payload.exp < now` → **accepts** at `now === exp` |
| `app/_lib/auth/edge-verify.ts:69` (`verifySessionEdge`) | `payload.exp < now` → **accepts** at `now === exp` |

The **revocation store** used a half-open one — a row is gone the moment it reaches
its prune point:

| Site | On `main` |
| --- | --- |
| `session-revocation.ts:124` (`sweepExpired`) | `DELETE … WHERE expires_at_ms <= ?` |
| `session-revocation.ts:247` (`isSessionRevoked`) | `AND expires_at_ms > @nowMs` |
| `session-revocation.ts:279`, `:285` (`listRevocations`) | `AND expires_at_ms > ?` |

Those two are the same number. `signSession` (session.ts:80) mints
`exp = iat + SESSION_TTL_MS`, and `revokeSession` (session-revocation.ts:173) writes
`expires_at_ms = iat + SESSION_TTL_MS` — an exact revocation row's prune point **is**
the cookie's own `exp`. (For a cutoff row it is `cutoff_ms + SESSION_TTL_MS`, and every
session it matches has `iat < cutoff_ms`, so that one is strictly later than the
cookie's `exp` and never the binding edge.)

So at exactly `now === exp` a **revoked** cookie verified, and the row that would have
refused it had already been filtered out and swept. For one millisecond the targeted
revocation control was enforced by nothing — not the window, not the store. The same
millisecond existed at the edge gate, which matters more than it looks: `/api/auth/`
is on the public allow-list, so `proxy.ts` is the only seam that asks the revocation
question for an already-minted cookie on routes no handler-side gate covers.

A 1 ms window is not a practically exploitable race on its own. It is recorded and
fixed as a **convention defect**: two halves of one security control were written
against different interval conventions, and that is the class of thing that becomes
exploitable the next time either half is refactored or a clock is quantised.

## The decision

**One convention for the whole lifecycle: the half-open window `[iat, exp)`.** A
session is valid only while `now < exp`; the instant `exp` itself is already dead.

Both verifiers now reject on `exp <= now`:

- `app/_lib/auth/session.ts:131`
- `app/_lib/auth/edge-verify.ts:72`

### Why this direction and not the mirror

The brief offered the alternative (keep the closed window and relax the store to
`expires_at_ms >= now`, sweeping only `< now`). Half-open was chosen:

1. **It is the convention already in force on the half that is hard to change.** The
   store's predicate appears at four sites including a `DELETE`, and
   `isSessionRevoked`'s doc comment (session-revocation.ts:228-240) argues its
   correctness *from* `expires_at_ms > now` — the mirror would have required rewriting
   a reasoned security argument, against changing one comparison operator twice.
2. **No existing test pinned acceptance at `now === exp`.** Checked: `session.test.ts`
   ("an expired token fails") asserts at `exp + 1`, and `edge-verify.test.ts`
   ("expired token fails at the edge") asserts far past expiry. Neither boundary was
   specified, so there was no intent to preserve. No existing assertion was weakened
   or touched.
3. **It errs toward refusal.** Under half-open the cookie dies one millisecond earlier
   than before; under the mirror a revocation row would live one millisecond longer
   than the cookie it names. Both close the hole, but only the first shortens a
   credential's life rather than lengthening a list's.

The two predicates now meet **exactly**: a row lives while `expires_at_ms > now`, a
cookie verifies while `exp > now`, and `expires_at_ms === exp` for the row that names
it. There is no instant on either side of the boundary where one is live without the
other. The store is unchanged.

## Evidence

Boundary cases added. On `main`'s source (fix reverted, tests kept) — **3 of 34 red**,
and precisely the three:

```
not ok 5  - the edge window is half-open too: exp - 1 verifies, exp does NOT
              exp is the first dead instant
not ok 11 - a revoked cookie is dead at exactly exp — the window and the row meet, with no gap
              no row left, so a revoked cookie must not verify at exp
not ok 28 - the session window is half-open: exp - 1 verifies, exp does NOT
              exp is the first dead instant — the window excludes it
# tests 34 / pass 31 / fail 3
```

With the fix — **34/34 green**.

Each case asserts all three of `exp - 1` (verifies), `exp` (does not) and `exp + 1`
(does not), so acceptance (b) is carried inside the boundary tests themselves rather
than assumed: the pre-existing verdicts at `exp - 1` and `exp + 1` are now pinned.

- `app/_lib/auth/session.test.ts` — the node verifier's window.
- `app/_lib/auth/edge-verify.test.ts` — the edge verifier's, so the two gates cannot
  drift to a millisecond apart again.
- `app/_lib/auth/session-revocation-enforcement.test.ts` — the seam itself: a revoked
  operator cookie, the clock read as exactly `exp`, the row proven **absent** at that
  instant (`isSessionRevoked(…, exp) === false`, which is correct behaviour for the
  store) and the cookie therefore required to be dead on the window alone. Probed at
  `exp - 1` first, where both halves are live, so the assertion cannot pass on a token
  that was never valid.

## The ratchet

`app/_lib/auth/session-revocation-sources.test.ts` (new sibling —
`session-revocation-enforcement.test.ts` is a behaviour suite and scanned no sources).

It walks every `route.ts` under `app/api/auth/` and reports any file that calls
`verifySession(` without referencing `isSessionRevoked`. Comments are stripped first,
so naming the helper in prose buys no silence. The prefix is the point: `/api/auth/`
is public (`app/_lib/auth/public-routes.ts`), so `proxy.ts` never runs on it and the
handler is the only check in the path — the omission has now been found at three
separate doors there (`isHomeOrgReader()` 2026-10-05, the switch-workspace re-mint
2026-10-06, its on-the-way-out decisions in scan `f727beae`).

`POST /api/auth/logout` is listed as exempt with its reason — the only thing it
decides from the cookie is *whose* revocation to write, which is a narrowing and never
a grant, and refusing an already-revoked caller there would make a second logout
silently write nothing. The entry is **conditional**, not a waiver: it carries the
token that keeps its premise true (`revokeSession|revokeAllSessions`), so a logout
that stopped writing a revocation loses the exemption and is reported.

Proven to bite, not vacuous:

- the tree scan asserts it visited `>= 2` verifying routes and that both
  `switch-workspace/route.ts` (the guarded door) and `logout/route.ts` (the exempt
  one) are in the set, so a scan that found nothing fails;
- the checker is a pure `findingFor(rel, source)` shared by the tree walk and the
  fixtures, so the fixtures exercise the same code that guards the tree;
- fixtures assert it **reports** a mutated unguarded door, **passes** the same door
  guarded, **still reports** it when `isSessionRevoked` appears only in a comment,
  **ignores** a file that verifies nothing (login, register), and **reports** `logout`
  once its revocation write is stripped.

It is green on the fixed tree, and green on `main`'s source too — it is an
independent control, not a restatement of this fix.

## Gates

| Gate | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test:unit -- app/_lib/auth/**/*.test.ts app/api/**/*.test.ts` | pass |

Untouched, per the brief: the `session_revocations` table shape, the login / logout /
switch-workspace response contracts, `SESSION_TTL_MS`, and `proxy.ts` (it delegates to
`verifySessionEdge` and re-implements no expiry check of its own, so the fix reaches it
through the shared verifier).

## What would reopen this

A reason to accept a cookie at exactly `exp` — e.g. a clock source quantised coarser
than a millisecond, where losing the boundary instant starts costing real sessions. If
that arrives, the mirror convention (§The decision) is the alternative, and it must be
applied to **all five** sites at once. Do not mix the two.
