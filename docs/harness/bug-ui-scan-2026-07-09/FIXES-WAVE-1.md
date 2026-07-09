# Fix Wave 1 — Auth gate & authorization model

> 5 commits, 5 findings closed (**4 Critical + 1 High**).
> Baseline preserved: tsc 0 → 0 · node unit 1355 → **1366** (+11 new tests) · python 781 OK → 781 OK · `next build` ✓.

The four Criticals were not four bugs. They were **one belief, held in four places: that
the absence of something implies safety.** An absent path segment meant "public". An absent
identity claim meant "operator". An absent delegation check meant "any role". An absent
account state check meant "provision it".

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `d62eb3a` | auth #1, scheduling #1, jd-authoring #1 | 2×Critical + 1×High | `proxy.ts`, `app/_lib/auth/public-routes.ts` (new), `+test` |
| 2 | `9988cae` | auth #2 | Critical | `session.ts`, `current-user.ts`, `login/route.ts`, `switch-workspace/route.ts`, `+test` |
| 3 | `2a77311` | organizations #1 | Critical | `roles.ts`, `org/members/[userId]/route.ts`, `org/invites/route.ts`, `+test` |
| 4 | `2a92fdc` | organizations #2 | High | `org-service.ts`, `invite/[token]/route.ts`, `AcceptForm.tsx`, `+test` |
| 5 | `eb3081d` | (regression repair) | — | `decisions-auth.test.ts` |

## What was fixed

### 1. The allow-list matched strings, not path segments

`proxy.ts` is a fail-closed gate: everything is authenticated except an explicit allow-list.
It decided membership with `p.startsWith(entry)` plus one hand-written exclusion. Raw prefix
matching means a **child or sibling route inherits its parent's public status**.

- `PUBLIC_API_PREFIXES` contained `/api/channels/`, exposing `/api/channels/webhooks` — the
  recruiter webhook console, whose handlers carry no operator check — to anonymous
  GET/POST/DELETE. Narrowed to `/api/channels/inbound`, the token-authed receiver.
- Schedule routes were allowed with `startsWith("/api/schedule/") && p !== "/api/schedule/invite"`.
  `/api/schedule/invite/bulk` is a **child of the excluded path**, added later, and sailed
  through: an unauthenticated caller could mint 100 scheduling tokens and email candidates
  per request. Now matched by shape (`/api/schedule/<one-segment>`), with the whole invite
  subtree gated — so a future child is gated by default.

Also restored `/jds/<slug>`, a public shareable JD page (Apply CTA + OG unfurl) that was
absent from the list and 302'd every shared link to `/login` in production. Only the *page*
is public: it is a server component that reads the DB and gates its recruiter controls on
`isOperator()`, so `/api/jds/*` stays gated. Two independent subagents found this one.

The allow-list moved to `app/_lib/auth/public-routes.ts` — pure, edge-safe, and inside the
`app/**/*.test.ts` glob. **`proxy.ts` lives at the repo root, outside that glob, which is
why the single most security-critical predicate in the app had no test at all.**

All 6 new assertions were run against the *old* matcher first and all 6 failed, so the test
is not vacuous. It also caught two latent widenings nobody had reported: `/marketing` matched
`/market`, and `/api/devcase/sessionX` matched `/api/devcase/session`.

### 2. Absent identity meant operator

`resolveCaller()` granted `OWNER_CAPS` when a session had no `sub` claim, reasoning that only
the operator-password login mints a claim-less cookie. It was not the only one:
`POST /api/auth/switch-workspace` re-minted with `signSession(workspaceId)` — workspace only,
claims dropped. **Any member who switched to the default workspace came back an owner.**

Fixed twice over, either half sufficient:
- Privilege is now a positive, signed marker (`op: true`), stamped only by the
  operator-password branch of login. A claim-less non-operator session gets *no* capabilities.
- `switch-workspace` carries identity across the re-mint, recomputing `role` against the
  target team (role is per-membership, not global).

Fails closed: an operator cookie issued before this commit lacks `op` and resolves to no
capabilities on the four `requireCapability` routes until the operator signs in again.

### 3. Delegation was capped on one path and forgotten on the other

`roles.ts` already documents the rule — `org:manage` "is never grantable via an override, so
no members:manage holder can escalate anyone (incl. themselves) to owner control." That was
enforced on the capability-override path and **not** on the role path. An `admin` (holds
`members:manage`, not `org:manage`) could `PATCH /api/org/members/<self>` with
`{role: "owner"}`, or mint an owner invite, and seize billing + delete-org.

New pure `canAssignRole(actorCaps, role)`: a role assignment *is* a capability grant, so the
actor must already hold every capability the target role confers. Expressed in capability
terms rather than role rank, so it survives a retune of the role matrix.

### 4. An invite overwrote the account it was supposed to create

`acceptInvite` called `setUserPassword` on any existing same-org user. Inviting an active
member is refused at `POST /api/org/invites` — but an invite minted *before* that account
went active stays pending and redeemable. Whoever held the link could reset the member's
password, rename them, and be auto-logged-in as them. Redeem is now provisioning only:
an active account is refused (`already_active`, 409). Activating an `invited`/disabled seat
is unchanged, and the pre-existing test for that path still passes.

## Regression caught and repaired

`decisions-auth.test.ts` pinned the allow-list by grepping `proxy.ts` for literal substrings.
Moving the list broke the match — a true positive for a brittle assertion. Re-pointed at the
real `isPublicPath` predicate (behavior beats source text: a substring check passes even when
the entry is unreachable behind an earlier rule), keeping one inverted source check that
`proxy.ts` must route through the shared predicate.

## Verification

| Gate | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| node unit | 1355 pass | **1366 pass** (+11) |
| python | 781 OK (4 skipped) | 781 OK (4 skipped) |
| `next build` | ✓ | ✓ (proxy compiles on the edge runtime) |

## Patterns established (catalogue items 1–4)

1. **Prefix-vs-segment matching on a security allow-list.** `startsWith` on a URL path lets a
   sibling (`/marketing` under `/market`) or a child (`/api/schedule/invite/bulk` under an
   excluded `/api/schedule/invite`) inherit public status. Match whole segments, and prefer a
   shape test over a hand-written exclusion so *new* children are gated by default.
2. **Absence of identity is not evidence of privilege.** Never infer "operator/admin" from a
   missing field. Grant privilege from a positive, signed marker, so any code path that drops
   the field fails closed instead of escalating.
3. **A doctrine enforced on one path and forgotten on a sibling.** When a codebase writes down
   a rule ("org:manage is never grantable"), grep for *every* path that can produce the
   guarded effect. Here the override path was capped and the role path was not; the ATS
   context has the same shape (a write-only-secret doctrine defeated by the whole-DB export).
4. **A security predicate that lives outside the test glob has no test.** `proxy.ts` sits at
   the repo root; the runner globs `app/**/*.test.ts`. Extract such predicates into a pure
   module *inside* the tested tree. Then verify the new test fails against the old code —
   this scan found a tautological assertion (`x and 0`) that had guarded nothing for months.

## What remains

Criticals: **4 of 9 closed.** Still open — SSRF in the ATS webhook (`ats-integration-egress` #1),
GDPR erasure missing transcripts + comms (`privacy-consent-provenance` #1), the non-crypto
public credential token (`shared-utility-libraries` #1), refunds never clawed back
(`billing-engine-webhooks` #1), and the `KP_OFFLINE` egress bypass (`llm-provider-layer-python` #1).

Next per the INDEX wave plan: **Wave 2 — GDPR / erasure**, then **Wave 3 — Money**.
