# Organizations, Members & Invites — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 2 high, 3 medium, 0 low)

## 1. "Preview onboarding flow" persists real, hard-to-undo changes on finish
- **Severity**: High
- **Lens**: ambiguity
- **File**: `app/features/sub_organization/OrganizationTab.tsx:48`
- **Scenario**: An owner on Settings → Organization clicks the "Preview onboarding flow" button, walks through the five steps out of curiosity, and clicks "Enter KP" on the last one. The word "Preview" implies a read-only walkthrough — but `finish()` in `OnboardingExperience.tsx:38` runs for real: it POSTs every typed invite to `/api/org/invites`, creates a JD, and unconditionally calls `setOrgLanguage(state.language)`.
- **Root cause**: The same `OnboardingExperience` used for genuine first-run is mounted behind a button labeled "Preview," with no preview/dry-run mode. `INITIAL_SETUP.language` is `"en"`, and `finish()` calls `setOrgLanguage` regardless of whether the language step was touched, rewriting both the `NEXT_LOCALE` cookie and the workspace default locale.
- **Impact**: A "preview" silently flips a Czech org's whole app + candidate-comms language to English and mints real, individually-redeemable invite tokens that cannot be un-sent. Only Escape/X/Skip discard; the terminal action commits.
- **Fix sketch**: Either give the preview a real dry-run mode (swallow the network writes) or rename the entry point to "Re-run setup" and gate `setOrgLanguage`/invite POSTs on the relevant step actually being edited (e.g. only persist language when it differs from the current locale, only POST invites the user explicitly added).

## 2. Editing a member's permissions silently strips capabilities the actor can't delegate
- **Severity**: High
- **Lens**: ambiguity
- **File**: `app/api/org/members/[userId]/route.ts:63`
- **Scenario**: A "Writer" (a recruiter granted `members:manage` but not `team:manage` — exactly the delegate the override system is built to create) opens the permission modal for a teammate who has a `team:manage` override, toggles an *unrelated* switch (e.g. turns off `pipeline:write`), and saves. The teammate silently loses `team:manage`.
- **Root cause**: The client sends the full desired capability set and the server rebuilds the entire override with `overrideFromDesired(...)`, then filters *all* grants to `actorCaps` (`override.grant.filter((c) => actorCaps.has(c))`). Because the recompute regenerates the grant for the untouched `team:manage`, and the actor doesn't hold it, that grant is dropped from the replacement override — even though it was pre-existing and never edited. The modal shows that toggle disabled+on (`MemberPermissionsModal.tsx:81`), reinforcing the (false) assumption that it is preserved.
- **Impact**: A partial delegate performing a routine permission tweak silently revokes capabilities they merely can't grant — a wrong-permission-state write with no warning.
- **Fix sketch**: Apply the delegation cap to the *delta* the actor is actually introducing, not the full recompute: compute the member's current override, and only reject/strip grants that are newly added by this request and not held by the actor; leave pre-existing grants the actor didn't touch intact.

## 3. "Primary domain" shows a hardcoded fake value with a lock icon
- **Severity**: Medium
- **Lens**: ui
- **File**: `app/features/sub_organization/OrganizationTab.tsx:57`
- **Scenario**: An operator renames their org to something other than Česká spořitelna. The Organization page still displays "Primary domain: csas.cz" beside a `Lock` icon (`OrganizationConsole.tsx:187`), presenting a fabricated constant as an authoritative, locked account setting.
- **Root cause**: `OrganizationTab` passes `domain="csas.cz"` as a literal and never reads the real `organizations.domain` column (which exists and is nullable in `db/organizations.ts`). The org name itself comes from a cookie, not the org row, so the console never loads the actual organization record.
- **Impact**: Every non-pilot org sees a wrong, immutable-looking domain — misleading, and the lock affordance implies a real security boundary that isn't backed by data.
- **Fix sketch**: Load the org's real `domain` (via an org endpoint or server component) and render it; when it is null, show an explicit "not set" state instead of a hardcoded literal, or drop the row until the field is wired.

## 4. An invite for an email owned by another org looks pending but can never be accepted
- **Severity**: Medium
- **Lens**: ambiguity
- **File**: `app/api/org/invites/route.ts:37`
- **Scenario**: An admin invites `person@x.com`, unaware that email already belongs to a *different* org's user. The POST succeeds and the invite shows as "Pending." When the recipient opens the link and tries to accept, `acceptInvite` returns `email_taken` and the link is permanently dead.
- **Root cause**: The re-invite guard only rejects when `existing.orgId === orgId && existing.status === "active"` (line 38); a same-email user in another org sails past it, but `acceptInvite` (`org-service.ts:83`) hard-refuses cross-org attach because email is globally unique.
- **Impact**: A pending invite that is structurally un-acceptable — the inviter gets no feedback, the invitee hits a generic "already belongs to another organization" wall, and the roster carries a zombie invite. A latent trap that grows sharper once `KP_MULTI_ORG` is real.
- **Fix sketch**: In the POST, also reject (409) when `getUserByEmail(email)` returns a user whose `orgId !== orgId`, with a clear "that email is already registered elsewhere" message, so the impossible invite is never created.

## 5. Recruiter/hiring-manager monogram tints bypass the theme token seam
- **Severity**: Medium
- **Lens**: ui
- **File**: `app/features/sub_organization/member-ui.ts:41`
- **Scenario**: In Spark Dark, the member roster and onboarding invite chips render owner/admin monograms with adaptive `coral/12` and `moss/15` token tints, but recruiter and hiring-manager monograms use raw `bg-blue-50 text-blue-700` / `bg-amber-100 text-amber-700` — pale fixed-palette chips that stay light on the dark surface, clashing with their neighbours.
- **Root cause**: `roleTone` mixes two color systems: token-based opacity tints (which carry dark mappings) for owner/admin, and hardcoded Tailwind palette steps for recruiter/hiring_manager. The file header comment even asserts "Colours resolve through the token seam, so both themes hold" — an undocumented-assumption violation, since these classes are applied directly to a `<span>` (`OrganizationConsole.tsx:282`, `InviteEditor.tsx:63`), not through the Badge tone shades the comment credits.
- **Impact**: Visible dark-mode inconsistency across the two most common roles, and a stated invariant the code doesn't uphold.
- **Fix sketch**: Replace the blue/amber literals with token-seam tints consistent with owner/admin (e.g. a `steel`/`ink` or dedicated accent token at matching opacity), or route all four through the Badge tone system so every role chip adapts to both themes.
