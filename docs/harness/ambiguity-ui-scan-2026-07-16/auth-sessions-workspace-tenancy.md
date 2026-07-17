# Auth, Sessions & Workspace Tenancy — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. e2e auth helper seeds a dead localStorage key — every gated journey lands on the public landing
- **Severity**: High
- **Lens**: ambiguity
- **Category**: dead-code-stale-contract
- **File**: `e2e/dev-auth.ts:11`
- **Scenario**: A Playwright journey calls `seedDevAuth(page)` and then visits `/?tab=…` expecting the workspace dashboard. The gate was moved server-side (`home-gate-server.ts.hasEnteredWorkspace()`, consumed by `app/page.tsx:32`) and now reads the `__Host-kp_session` / `kp_entered` cookies — nothing reads `localStorage["kp_dev_authed"]` anymore. `devAuth.ts` and `HomeGate` referenced in the doc comment (lines 4-9) no longer exist. The seeded flag is a no-op, so `/` renders the public landing and the journey either fails confusingly or asserts against the wrong page.
- **Root cause**: The client localStorage gate was replaced by a server cookie gate, but this e2e helper (and its comment pointing at the deleted `app/_lib/auth/devAuth.ts`) was never updated to seed a real session/entry cookie.
- **Impact**: Silently defeats authenticated e2e coverage — the exact surface (login/session/workspace) this context owns — while looking like it still works.
- **Fix sketch**: Replace the `localStorage` seed with a real entry: either POST `/api/auth/login` with `{}` (open mode sets the `kp_entered` cookie) via the Playwright request context and reuse its storage state, or add the `kp_entered=1` cookie through `context.addCookies` before navigation. Delete the stale `devAuth.ts` / `HomeGate` references from the comment.

## 2. Create-then-switch: a failed switch strands the just-created workspace, contradicting its own comment
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: happy-path-only
- **File**: `app/features/sub_workspace/WorkspaceTab.tsx:57`
- **Scenario**: A user creates a workspace. The code comment (lines 55-56) promises the flow "falls back to a list refresh if the switch is unavailable, e.g. auth off." But `create()` calls `await switchTo(created.workspace.id)`, and `switchTo`'s failure branch (lines 36-39) only shows a toast and clears `busy` — it never calls `reload()`. So when the switch returns non-OK (401/403/404), the newly created workspace does not appear in the list until the user manually refreshes.
- **Root cause**: The "list refresh" fallback described in the comment lives only in the `else` branch that runs when `created.workspace` is absent (lines 58-61); the `switchTo`-failed path has no such fallback.
- **Impact**: A successful create followed by a failed switch looks like the create silently failed — the user sees an error toast and no new workspace, and may create it again.
- **Fix sketch**: Make `switchTo` return a success boolean (or reject) and have `create()` call `reload()` when the switch did not navigate, so the newly created workspace is always shown. Update the comment to match the real fallback.

## 3. Login submits an operator attempt when email is blank but password is present, yielding a misleading error
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-assumption
- **File**: `app/login/LoginClient.tsx:136`
- **Scenario**: On a per-user deployment a user types their password, forgets to fill the email, and clicks Sign in. The submit button only gates on `!password` (line 136), so the form posts `{ password }` (line 46). The server treats a bodyless-email request as the *operator* path: if `KP_OPERATOR_PASSWORD` is unset it 503s (→ "server error" toast), and if it is set the password is checked against the shared operator secret and 401s (→ "Incorrect email or password"). Either way the user is never told the email field was required.
- **Root cause**: The endpoint routes on presence of `email` (login/route.ts:67), but the client never validates that email is filled for a credential login; the button's `disabled` guard omits email entirely.
- **Impact**: A common "forgot the email" slip is reported as a wrong password or an opaque server error, sending the user to reset a credential that was actually correct.
- **Fix sketch**: Since KP has no email-less user login, either require email in the button guard (`disabled={submitting || !password || (isUserDeploy && !email.trim())}`) or, when the operator path is not available on this deployment, show an inline "Enter your email" hint before submitting rather than posting a doomed operator attempt.

## 4. `createWorkspace` silently truncates names at 80 chars and carries an unreachable blank-name fallback
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-number
- **File**: `app/_lib/db/workspaces.ts:73`
- **Scenario**: A user names a workspace with more than 80 characters. `createWorkspace` does `name.trim().slice(0, 80) || "Untitled workspace"` with no signal to the caller — the stored name is silently truncated and the UI (which reloads and shows the created workspace) displays the shortened form as if the user had typed it. The `|| "Untitled workspace"` branch is also dead from the API path: `/api/workspaces` already rejects a blank name (route.ts:41) before calling this.
- **Root cause**: The 80-char cap is an undocumented magic constant applied at the DB layer, and the two guards (route-level non-empty check vs. store-level blank coercion) were added independently and now contradict.
- **Impact**: Silent data mutation the user can't see coming; a future caller reading the "Untitled" fallback assumes blank names are accepted here, while the only real caller forbids them.
- **Fix sketch**: Name the constant (e.g. `MAX_WORKSPACE_NAME = 80`) with a one-line rationale, and either validate the length at the route boundary (reject/inform) instead of truncating, or return the truncated name so the UI reflects what was stored. Drop or document the unreachable blank fallback.

## 5. Workspace switch has no per-row loading feedback and disables every Switch button at once
- **Severity**: Low
- **Lens**: ui
- **Category**: missing-loading-state
- **File**: `app/features/sub_workspace/WorkspaceTab.tsx:98`
- **Scenario**: With several workspaces listed, the user clicks "Switch" on one. The shared `busy` flag (line 24) disables *every* row's Switch button (lines 100-102) and the clicked button only fades via `disabled:opacity-60` — there is no spinner or "Switching…" label. Because success triggers a full `window.location.reload()`, the user stares at a row of greyed-out buttons with no indication of which switch is in flight or that anything is happening.
- **Root cause**: A single boolean models a per-row action, and the button has no in-flight visual state (`aria-busy`, spinner, or text swap).
- **Impact**: On a slow switch the UI looks frozen/unresponsive; a user may click again or assume it failed.
- **Fix sketch**: Track the in-flight workspace id (`switchingId`) instead of a global boolean, disable only that row's button, and swap its label to a spinner + "Switching…" with `aria-busy`. Leave other rows interactive.
