# Skill Matrix & Coverage — bug-hunter + ui-perfectionist scan

> Context: The candidate↔skill fit matrix view, its coverage/reasoning affordances, and the public candidate-owned Durable Skill Profile credential surface (/skill/[token] + verify).
> Files reviewed: 8 of 8 (plus 4 credential-surface files from the sibling thread)
> Total: 5

## 1. KP_SECRET rotation or absence brands every genuine credential "TAMPERED"

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/_lib/skill-profile.ts:73-100`, `app/_lib/db/skill-profiles.ts:129-137`, `app/skill/[token]/page.tsx:30-45`
- **Scenario**: kp rotates `KP_SECRET` (routine after a suspected leak), or a redeploy/second environment reading the same SQLite file has `KP_SECRET` unset. Every already-issued skill profile now fails `verifyProfile` (HMAC recomputes to a different digest, or `signingKey()` throws and the `catch` returns `false`). `verifySkillProfileToken` sets `valid:false, revoked:false`; the page's `state` ladder (`revoked ? … : !valid ? "tampered"`) picks **"tampered"** and renders the red `ShieldAlert` "this credential appears tampered" to any third party the candidate shared their link with.
- **Root cause**: The signature has no key-id/version, so verification cannot distinguish "kp changed its own key" from "the bearer forged this." The badge treats every non-verifying-but-not-revoked profile as adversarial tampering. Re-issuing re-signs under a **new token**, so every previously shared `/skill/[token]` link stays broken and defamatory.
- **Impact**: A single ops action silently converts the entire outstanding credential population into fraud accusations shown to employers, with no in-place re-sign and no honest "please re-verify" state. Actively harmful on a trust surface.
- **Fix sketch**: Stamp a `keyId` into the signed artifact and keep a small map of current+previous secrets; verify against the profile's `keyId`. Add a distinct `"needs_reissue"` verdict (neutral, not red) for signatures that don't match any known key, and support re-signing in place (preserve the token) on key rotation so shared links survive.

## 2. Verify endpoint is an unauthenticated, unthrottled existence-and-data oracle

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/api/skill-profile/[token]/verify/route.ts:13-31`, `app/skill/[token]/page.tsx:19-20`, `app/_lib/db/skill-profiles.ts:120-124`
- **Scenario**: The GET verify route has no auth, no workspace scoping, and no rate limit (confirmed: nothing imports a limiter or `currentWorkspace` under `app/api/skill-profile/`). A miss returns `{found:false}` **404**; a hit returns **200** with the full `summary` (version, transferScore, confidence, issuedAt, **all axes**). The response class and status differ sharply between a real and a fake token. Paired with the sibling finding that the token is minted by the non-crypto `randomId("dsp")`, an attacker can walk the token space against this endpoint and harvest every valid credential's full contents.
- **Root cause**: A public "FICO lookup" was built as an open oracle that both confirms token validity and dumps the payload on a hit, with no throttle to make guessing uneconomical — so token-entropy weakness converts directly into bulk data exposure.
- **Impact**: Enumeration of candidate assessment scores/axes; validity confirmation for any harvested token. The differing 404/200 is the leak the trust model shouldn't offer.
- **Fix sketch**: Rate-limit by IP + return a uniform `200 {found:false}` (or `404`) shape for miss vs. tampered so the endpoint isn't a validity oracle; independently, mint tokens with `crypto.randomBytes` (the sibling fix) so brute force is infeasible regardless.

## 3. A "durable" credential has revocation but no expiry, and the badge never signals staleness

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/_lib/skill-profile.ts:14-23`, `app/_lib/db/skill-profiles.ts:129-137`, `app/skill/[token]/page.tsx:38-56`
- **Scenario**: A profile minted from a dev case in 2026 is opened by an employer in 2030. `verifySkillProfileToken` checks only signature + revoked + substantive — `issuedAt` is displayed (small, muted) but never compared to now, and `DurableSkillProfile` has no `expiresAt`. The green `ShieldCheck` "Verified" renders identically for a week-old and a five-year-old attestation, and identically for a `dsp-v1` methodology even after the methodology is superseded (`version`/`methodologyVersion` are shown only as tiny footer text).
- **Root cause**: The trust verdict is binary integrity, with no time or methodology-generation dimension. "Verified" over-asserts: it means "the bytes are untampered," but a third party reads it as "this is a current, valid assessment."
- **Impact**: Stale skill claims present as freshly verified indefinitely; a deprecated scoring methodology keeps emitting a confident green shield with no visible caveat.
- **Fix sketch**: Add `expiresAt` (or a configurable validity window) to the signed artifact and a `"stale"`/`"expired"` verdict; downgrade the badge (amber, "issued N years ago") past a freshness threshold and when `methodologyVersion` != current, so the shield's confidence tracks what the data actually supports.

## 4. Matrix `best()` floors "unassessed / blocked-everywhere" to 0, conflating it with a real weak score

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/features/sub_matrix/MatrixTab.tsx:167-187`
- **Scenario**: A candidate who is hard-KO'd (blocked) on every *visible* role, or whose profile simply wasn't scored for the current family filter, has all-null visible cells. `best(ri) = Math.max(0, ...scores.map(s => s ?? -1))` maps every missing score to `-1`, then the `Math.max(0, …)` floor turns the row's best into **0** — indistinguishable from a candidate genuinely scored 0. Default sort sinks them among the weak; setting the min-fit floor to ≥55/≥70 (`best(ri) >= minFit`) then silently drops them with no way to tell "no strong fit" from "blocked on a gate you could renegotiate."
- **Root cause**: `columnStats`/`colScores` carefully exclude blocked/null cells to keep "not assessed" distinct from a score, but `best()` collapses the same sentinel to 0, erasing that distinction on the exact axis (sort + floor) the recruiter acts on.
- **Impact**: Blocked-everywhere candidates read as bottom-of-pool weak fits and vanish under the floor unexplained; the KO reason (the actionable signal) is lost at the row level.
- **Fix sketch**: Track "no assessed cell" separately (e.g. `best` returns `null`), sort those into their own trailing group, and in the count/empty affordance distinguish "hidden by floor" from "no scored role" so a hard-block is never rendered as a 0.

## 5. Cell reasoning popover (new) has no focus management and misaligns on resize

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/features/sub_matrix/MatrixTab.tsx:134-141`, `:263-270`, `:734-761`
- **Scenario**: Clicking a scored cell opens a `role="dialog"` "why this score" popover positioned `fixed` at the cell's `getBoundingClientRect()` captured at click time. Focus is never moved into the dialog on open, and on close (Esc or outside click) focus is not restored to the triggering cell — a keyboard/screen-reader user gets no signal the dialog appeared and lands nowhere afterward. Because the coordinates are frozen and only an `Escape` listener is wired (no `resize` handler), rotating a tablet or resizing the window leaves the popover floating detached from its cell.
- **Root cause**: A recently added dialog was given `role="dialog"` + an `aria-label` and an Esc handler, but not the rest of the dialog contract (initial focus, focus trap, focus restoration) or a reposition-on-layout-change, so the semantics promise more than the behavior delivers.
- **Impact**: The score-explanation surface — the tab's headline interaction — is effectively unreachable/confusing for keyboard and AT users, and visually orphaned after any viewport change.
- **Fix sketch**: On open, move focus to the dialog (or its close button) and trap Tab within it; on close, return focus to the cell button. Reuse the app's `useDialogA11y`/`Modal` primitive rather than a bespoke fixed div, and recompute position on `resize`/`scroll` (or anchor relative to the cell).
