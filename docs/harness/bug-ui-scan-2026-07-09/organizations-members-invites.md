# Organizations, Members & Invites — bug-hunter + ui-perfectionist scan

> Context: The identity/tenancy layer — orgs own users, per-team memberships (role + capability overrides), and tokenized invites; org-service enforces guardrails and OrganizationConsole/OnboardingWizard drive it via /api/org/*.
> Files reviewed: 24 of 30
> Total: 5

## 1. Cap the assignable role to the actor's privilege — an admin can self-promote to owner

- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: privilege-escalation / broken-access-control
- **File**: `app/api/org/members/[userId]/route.ts:37-41` and `app/api/org/invites/route.ts:28,36`
- **Scenario**: A user with the `admin` role (holds `members:manage`, NOT `org:manage`) calls `PATCH /api/org/members/<their-own-id>` with `{ "role": "owner" }`. `requireCapability("members:manage")` passes, `body.role` passes `isMemberRole`, and `changeMemberRole` upserts the membership as `owner` with no check that the actor may grant that role. On the next request `capabilitiesForUserInWorkspace` resolves the owner role and they now hold `org:manage` (billing, delete-org). The same hole exists on `POST /api/org/invites` (`role` defaults to `recruiter` but freely accepts `"owner"`), so an admin can also mint a brand-new owner account.
- **Root cause**: Delegation is enforced for capability *overrides* only — the `[userId]` PATCH `capabilities` branch filters grants to `actorCaps` (line 54-57) and `org:manage` is non-grantable. But the parallel `role` branch and the invite `role` have NO delegation cap. The UI *hides* owner (`ASSIGNABLE_ROLES` in `member-ui.ts:26` deliberately omits it), so the entire owner boundary rests on client-side omission the API never re-checks.
- **Impact**: Vertical privilege escalation — any `members:manage` holder gains full owner control (billing, org deletion, granting others owner), collapsing the owner-vs-admin trust boundary.
- **Fix sketch**: In `changeMemberRole` (and the invite POST) require the actor to already hold the target role's authority: refuse to assign `owner` unless the actor is an owner (e.g. `roleAtLeast(actorRole, "owner")`), mirroring the override delegation cap. Make the class impossible by routing every role/capability grant through one `assertCanGrant(actorCaps, desiredRoleOrCap)` helper so no write path can escape it.

## 2. `acceptInvite` silently resets an existing user's password — stale duplicate invites are an account-takeover backdoor

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / auth
- **File**: `app/_lib/org-service.ts:73-84` and `app/_lib/db/invites.ts` (no per-email uniqueness / no invalidate-on-active)
- **Scenario**: An admin invites `x@corp.com` (invite A, pending). Before acceptance they invite the same address again (invite B, pending) — allowed, because `POST /api/org/invites` only blocks a re-invite when the user is *already active* (`route.ts:33`), and `x` has no user row yet. `x` accepts invite A → active user created. Invite B is never touched, stays `pending`, and remains redeemable for its 14-day TTL. Anyone holding token B (the admin who generated it, or anyone it leaked to) then `POST`s a new password: `acceptInvite` finds the existing same-org user and unconditionally runs `setUserStatus(active)` + `setUserPassword(newPassword)` + auto-login (route.ts:41-63), taking over the live account.
- **Root cause**: The accept flow treats "an existing same-org user" as a legitimate password-reset target (only cross-org is rejected), and nothing dedupes pending invites per email or invalidates outstanding invites once an account for that email becomes active. So an invite token silently doubles as a permanent password-reset primitive. (Note: `acceptInvite` is fully synchronous with no `await`, so this is a logic flaw, not a race — better-sqlite3 can't interleave two redeems in-process.)
- **Impact**: Account takeover of an already-onboarded member (including higher-privileged members) via a superseded/leaked invite link.
- **Fix sketch**: In `acceptInvite`, refuse when the resolved user is already `active` (reason `email_taken`/`already_member`). Enforce one pending invite per (org,email) and, on account activation, revoke all other pending invites for that email. That makes an invite a strictly one-account-creation token, never a reset path.

## 3. Auto-login after accept signs the user into the wrong team/role

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / auth-context
- **File**: `app/api/invite/[token]/route.ts:47-52`
- **Scenario**: A previously `disabled`/`invited` existing member (who already has a membership on team A) is re-invited to team B as `admin`. On accept, `acceptInvite` adds the team-B membership, then the route signs the session from `listMembershipsForUser(result.user.id)[0]`. That list is ordered `created_at ASC` (`memberships.ts:57`), so `[0]` is the OLDEST membership (team A, their old role) — not the `invite.workspaceId`/`invite.role` they just accepted. They land signed in on team A with team A's role; the accepted role appears not to have taken effect until they re-login and switch.
- **Root cause**: The session is derived from an arbitrary "first" membership instead of the membership the invite just created. The invite already carries the authoritative `workspaceId` + `role`; the route ignores them for the session claims.
- **Impact**: Confusing/incorrect auth context after accept — wrong active team and a role mismatch (can silently be higher or lower than intended). Correctness bug in the sign-in claims.
- **Fix sketch**: Sign the session for `invite.workspaceId ?? DEFAULT_WORKSPACE_ID` with `role: invite.role` (thread the invite through, since `acceptInvite` already has it), rather than `listMembershipsForUser(...)[0]`. Return the accepted membership from `acceptInvite` so the route never has to guess.

## 4. Onboarding is wired to the `mock.ts` prototype role vocabulary — a parallel enum and translation seam

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: component-architecture
- **File**: `app/features/sub_organization/mock.ts:9-10`, `app/features/setup/InviteEditor.tsx:9`, `app/features/setup/steps.ts:6`, `app/features/setup/OnboardingExperience.tsx:12-18`
- **Scenario**: The first-run onboarding — real, persisted production code — imports its `MemberRole`, `MEMBER_ROLES`, `roleTone`, `APP_LANGUAGES` from `mock.ts`, a file whose own header says "Mocked … prototype. No API/DB yet." That module defines a SECOND role vocabulary as capitalized display strings (`"Owner" | "Admin" | "Recruiter" | "Hiring manager" | "Viewer"`) that diverges from the real `auth/roles` slugs (`owner`/`admin`/`recruiter`/…). To bridge them, `OnboardingExperience` carries a hand-maintained `ROLE_SLUG` map with an `?? "recruiter"` fallback.
- **Root cause**: A prototype fixture was never retired when the real identity model landed; onboarding still consumes it, so the app now maintains two role enums plus a lossy translation layer. Add a role (or rename a label) in `auth/roles`/`member-ui` and onboarding silently can't offer it — worse, `ROLE_SLUG`'s fallback downgrades any unmapped label to `recruiter` with no error.
- **Impact**: Drift risk and a real correctness trap in the invite step (silent role downgrade); duplicated role→tint styling that can visually diverge from the real console.
- **Fix sketch**: Delete the `mock.ts` role/language exports; source roles, labels, and tones for onboarding from `member-ui.ts` + `auth/roles` (the real `ASSIGNABLE_ROLES`/`roleLabel`/`roleTone`), and drop `ROLE_SLUG` so the invite step speaks the server enum natively.

## 5. Invite button has no in-flight state — double-submit mints duplicate pending invites

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_organization/OrganizationConsole.tsx:73-89,229-231`
- **Scenario**: In the Members panel the Invite button is only `disabled={!email.trim()}`. `submitInvite` sets no "submitting" flag, so during the `await fetch(...)` the button stays enabled; a second click (or Enter-key repeat, line 216) fires a second `POST /api/org/invites`. Because the API has no per-email pending-invite uniqueness, both succeed and the roster shows two pending invitations for the same address. The same panel also reports "Active" as `members.filter(m => m.user.status !== "disabled")` (line 71), which counts still-`invited` seats as Active, inflating the stat.
- **Root cause**: The submit handler lacks the loading/disabled treatment every other async action in this file could share; no optimistic lock on the in-flight request.
- **Impact**: Duplicate pending invites (clutter, and each is an independent redeemable token feeding finding #2); a misleading "Active" count.
- **Fix sketch**: Add a `submitting` state that disables the input+button and shows a spinner label for the duration of the request (a small `useAsyncAction` wrapper would cover invite/patch/remove/revoke uniformly); count "Active" as `status === "active"` only.
