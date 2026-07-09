# Auth, Sessions & Workspace Tenancy — bug-hunter + ui-perfectionist scan

> Context: Login/logout sessions, edge token verification, multi-workspace switching/tenancy scoping, and workspace export/import (data portability).
> Files reviewed: 21 of 32
> Total: 5

## 1. `/api/channels/` public prefix exposes the recruiter webhook console to anonymous callers

- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: auth-gap / prefix-vs-exact-match
- **File**: `proxy.ts:18` (`PUBLIC_API_PREFIXES` includes `"/api/channels/"`), `app/api/channels/webhooks/route.ts:13-44`, `app/api/channels/webhooks/[token]/route.ts:8-13`
- **Scenario**: The allow-list makes the WHOLE `/api/channels/` subtree public because only the token receiver `/api/channels/inbound/[token]` was meant to be. `proxy.ts:31` matches any path with `p.startsWith("/api/channels/")`, so an anonymous internet visitor hits `GET /api/channels/webhooks` and gets the real tenant's webhook rows (`currentWorkspace()` resolves a cookieless request to `DEFAULT_WORKSPACE` — `current-workspace.ts:13`), enumerating channels, job bindings, and receiver tokens. They can then `POST /api/channels/webhooks` to mint bindings and `DELETE /api/channels/webhooks/[token]` to revoke the tenant's live intake. Neither handler has a `requireOperator()`/`requireCapability()` defense — they trust the proxy gate, which waved them through.
- **Root cause**: Same class as the just-found `/api/schedule/invite/bulk` slip: public surfaces are classified by a coarse prefix (`startsWith`) instead of enumerating the exact public leaves, so every current AND future child route under the prefix inherits "public". The route's own comment even says "Listing/creating is a recruiter surface".
- **Impact**: Unauthenticated read of intake config + tokens, spoofed webhook creation, and revocation-based DoS of the candidate intake channel on a "gated" deploy.
- **Fix sketch**: Narrow the entry to the exact public leaf: replace the `/api/channels/` prefix with `PUBLIC_API_EXACT`-style matching for `/api/channels/inbound/` only, and add `requireOperator()` to `channels/webhooks/*` as defense-in-depth. Kill the class: make `isPublic` an allow-list of exact routes or `[prefix]`-scoped receiver paths, never a bare top-of-subtree prefix.

## 2. `switch-workspace` re-mints without identity claims → any member escalates to owner

- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: auth-gap / state-corruption
- **File**: `app/api/auth/switch-workspace/route.ts:35` (`signSession(workspaceId)` — no claims), `app/_lib/auth/current-user.ts:32-41` (`resolveCaller`), `app/_lib/auth/session.ts:65-74`
- **Scenario**: In a gated multi-user deploy (`KP_OPERATOR_PASSWORD` set, per-user logins active), a low-privilege user signs in and gets a session carrying `sub`/`org`/`role:"member"`. They `POST /api/auth/switch-workspace {workspaceId:"workspace"}`. `canSwitchWorkspace("workspace","workspace")` is true (target IS the default — `workspace-lock.ts:31`), so the route re-mints via `signSession(workspaceId)` — which stamps ONLY `workspace`, dropping `sub`/`org`/`role`. `resolveCaller` then hits `if (!userId) return { caps: OWNER_CAPS }` (`current-user.ts:37`) — a claim-less session is indistinguishable from an operator-password session — and grants full owner capabilities. The user can now call `PATCH /api/org/members/[userId]` and `POST /api/org/invites`, both gated only by `requireCapability("members:manage")` (confirmed at `app/api/org/members/[userId]/route.ts:22`, `app/api/org/invites/route.ts:12`).
- **Root cause**: The re-mint treats the session as workspace-only and forgets identity is now also encoded in the token; `resolveCaller` fails OPEN (owner) for a claim-less-but-valid session. Even the sole permitted no-op self-switch triggers it.
- **Impact**: Full privilege escalation to workspace owner (member management, invites, role changes) plus loss of audit attribution — a security breach of the role model.
- **Fix sketch**: In `switch-workspace`, preserve claims: `signSession(workspaceId, Date.now(), { sub: session.sub, org: session.org, role: <role on target> })`. Make the class impossible by having `resolveCaller` treat "valid session with no `sub`" as owner ONLY when `KP_OPERATOR_PASSWORD` matched at mint (e.g. a distinct `kind:"operator"` claim), not merely by absence of `sub`.

## 3. Public JD detail page `/jds/` is missing from the proxy allow-list — shared links redirect to /login

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / broken-flow
- **File**: `proxy.ts:17` (`PUBLIC_PAGES` omits `/jds/`), `app/jds/[slug]/page.tsx:57-163`
- **Scenario**: `app/jds/[slug]/page.tsx` is explicitly the "public, candidate-facing, shareable artifact" — it builds share/SEO `generateMetadata` (lines 33-51), renders an "Apply for this role" CTA for candidates, and gates recruiter controls behind `isOperator()` (line 102). But `PUBLIC_PAGES` lists `/apply/`, `/offer/`, `/schedule/`, `/skill/`, `/invite/` … and NOT `/jds/`. On a gated deploy (`KP_OPERATOR_PASSWORD` set), a candidate clicking a shared `/jds/senior-eng?lang=cs` link is redirected to `/login` by `proxy.ts:78-81`. The flagship shareable-JD feature is dead in exactly the mode where it ships.
- **Root cause**: The public-page allow-list is maintained by hand and drifted from the pages actually designed to be public; the JD page was hardened for candidates (privacy note, apply bridge) without adding its route to the gate's allow-list.
- **Impact**: Every externally-shared job posting is unreachable by candidates in production; the SEO metadata is never served to crawlers either (they hit the login redirect). Fails closed (no leak) but silently breaks a core acquisition flow.
- **Fix sketch**: Add `"/jds/"` to `PUBLIC_PAGES`. Prevent recurrence with a test that asserts every route rendering a candidate-facing page (or every `page.tsx` calling `isOperator()` for optional controls) is covered by `isPublic`.

## 4. [STILL-OPEN] `/api/auth/login` has no rate limiting — now enables per-account credential stuffing

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: auth-gap / brute-force
- **File**: `app/api/auth/login/route.ts:45-86`
- **Scenario**: Prior report #3 flagged the operator-password path as unthrottled; it is still unthrottled, and the surface has since GROWN. The route now also serves per-user login (`{email,password}` → `verifyCredentials`, lines 50-65) with no `rateLimit`, no lockout, no attempt accounting. An attacker runs credential-stuffing against every invited user's email, or brute-forces the single `KP_OPERATOR_PASSWORD`, at full request rate. The uniform 401 (line 54) resists user enumeration but does nothing against volume; `/api/demo` by contrast already calls `rateLimit`.
- **Root cause**: Authentication was extended from one shared secret to N per-user credentials without adding the throttle the threat model now demands; scrypt/constant-time compare address timing, not online guessing.
- **Impact**: Any user account (and the operator password) is brute-forceable → full recruiter/PII access. Blast radius is the whole app; still open after the prior scan and materially worse now that per-user accounts exist.
- **Fix sketch**: Wrap both branches in `rateLimit(\`login:${clientIp}\`, { limit: 5, windowMs: 15*60_000 })` (helper exists), key a second bucket on the submitted email, return 429 on trip, and add a global backoff after N total failures.

## 5. Login form shows "Incorrect email or password" for every failure and can stick in "submitting"

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / error-state
- **File**: `app/login/LoginClient.tsx:25-49`, `88-99`
- **Scenario**: `submit()` treats every non-ok response identically: `else { setStatus("error"); }` (line 47) renders the inline `t("error")` message ("Incorrect email or password."). So a `503` (server not configured), a `500`, or a future `429` (rate-limited, see #4) all tell the user their password is wrong — a misleading validation message that sends them into a guessing loop instead of surfacing "try again later" / "server unavailable". Separately, the `fetch` has no timeout: on a stalled (never-resolving) request the `.catch` never fires, `status` stays `"submitting"`, and the button is stuck disabled (`disabled={status === "submitting" || !password}`, line 95) with the "submitting" label and no recovery path.
- **Root cause**: The client collapses a multi-outcome server contract into a binary ok/error and assumes the network always resolves — no per-status branch and no request timeout.
- **Impact**: The app's front door gives wrong, confusing feedback for non-credential failures and can trap a user in a permanently-disabled spinner, forcing a manual reload. Degrades trust and, with #4, hides rate-limit feedback.
- **Fix sketch**: Branch on `r.status` (401 → inline credential error; 429 → "too many attempts, wait"; 5xx → toast "service unavailable"); add an `AbortController` timeout that re-enables the form and surfaces a retry. Reuse the shared `use-error-message.ts` mapping so every form treats these states consistently.
