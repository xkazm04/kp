# Member removal: blast radius, cascade postures, and a confirmed destructive path

Date: 2026-08-30 · Status: implemented with this spec
Registry techniques: `software-engineering/entity-lifecycle/blast-radius-computation`,
`software-engineering/entity-lifecycle/cascade-design`,
`software-engineering/security/authorization/delegated-authority` (accounting side).

## Current state

- `DELETE /api/org/members/[userId]` (app/api/org/members/[userId]/route.ts:82) is
  gated on `members:manage` and the `last_owner` backstop, then hard-deletes: it
  calls `removeMember()` (app/_lib/org-service.ts:234) → `deleteUser()`
  (app/_lib/db/users.ts:109), which deletes `user_credentials`, `memberships`, and
  the `users` row by hand (no DB-level FKs). Returns `{ ok: true }` — a boolean,
  not a receipt.
- The UI confirm (app/features/settings/workspace/MemberConfirmModals.tsx,
  `confirmRemove`) is generic prose: it states "deletes their account and access"
  but shows no enumeration of what the delete drags with it. That is the exact
  shape blast-radius-computation names a liability transfer: the confirmation
  comes first and the consequences are discovered after.
- No preview exists anywhere: nothing counts casualties before the act, and the
  destructive path is armed by a bare `DELETE` with no confirm token.

## The blast radius, enumerated (schema walk, 2026-08-30)

Walk of every reference to a `users.id` in `app/_lib/db/core.ts`:

| Reference | Posture (cascade-design) | Rationale |
| --- | --- | --- |
| `user_credentials.user_id` | **Cascade** (already) | Meaningless without the account; secret material must not outlive it. |
| `memberships.user_id` | **Cascade** (already) | Join rows; a seat without a person is noise. |
| `invites.invited_by` | **Detach / retained by design** | The invite has independent meaning (a pending or historical invitation to someone else). The id stays as historical attribution; no reader dereferences it today, and a dangling id reads as "a removed user". A "retained by design" note goes at the declaration site in core.ts so absence of cleanup is a decision, not an omission. |
| `pipeline_events.actor` | **Survivor by design** (already) | Stores the denormalized decision-chain label (`human:<Name>`), never the user id — provenance-denormalization already applied (UAT LUC-ANA-4). Nothing to do on delete. |
| Sessions | **No server-side rows** | Sessions are HMAC cookies (ADR 0005); a deleted user's cookie dies at `getUserById() → null` on the next request. |
| Last owner | **Block** (already) | `removeMember` refuses with `last_owner` (409). |

Conclusion: kp's radius is deliberately small — the domain records (analyses,
jobs, pipeline, tasks…) are workspace-owned, not user-owned, so there is
**nothing to reassign**; ownership transfer is not needed in this tree. What is
missing is the honest preview, the explicit confirm, and the receipt.

## Target shape

1. **One implementation for preview and act** (`gate-sees-target`): rework
   `deleteUser` into a counting reaper — the same DELETE statements run inside a
   `db.transaction`, tallying `info.changes` per table; in dry-run mode the
   transaction rolls back by throwing a sentinel and the tally is returned. The
   preview *is* the enforcement path executed and rolled back; it cannot drift.
2. **Service**: `removeMember(userId, opts?: { dryRun?: boolean })` returns
   `MemberOpResult` extended with an `impact` on success:
   `{ casualties: { users, credentials, memberships }, survivors: { invitesAttributed } }`.
   The `last_owner` blocker fires in both modes (a preview against a blocked
   target reports the blocker, not counts — blockers turn confirmation into
   explanation). The preview carries the same `members:manage` privilege as the
   act (recon must not be cheaper than the act).
3. **Route**: `DELETE /api/org/members/[userId]?confirm=true` executes and
   returns the receipt `{ ok: true, removed: impact }`. Without
   `confirm=true` the same route returns `{ preview: true, impact }` (200) and
   destroys nothing — the destructive path is gated on the explicit parameter.
   `last_owner` still returns 409 either way.
4. **UI**: the `confirmRemove` modal fetches the preview when it opens and shows
   the enumerated impact (seats deleted; invitations that survive attributed to
   a removed user). A failed preview renders as "impact preview unavailable" —
   never as an empty/zero impact (`failure-not-empty-success`). The confirm
   button then calls the route with `confirm=true`. New strings land in all four
   locales (en/cs/de/fr) per docs/architecture/localization.md.
5. **Schema note**: `invites.invited_by` gains the "retained by design" comment
   at its declaration in core.ts.

## Out of scope

- Ownership transfer / reassignment machinery — the walk shows no user-owned
  domain records to reassign. If a user-owned record class ever lands, this
  spec's table is the checklist that must gain a row.
- `removeMemberFromWorkspace` (single seat) — reversible, radius is one row.
- DB-level foreign keys / declared cascades — kp runs without FK enforcement by
  ADR 0002 posture; the hand cascade stays, now measured and receipted.
- Batch/bulk removal rails.

## Acceptance checks

- Unit (`app/_lib/org-service.test.ts` + `app/_lib/db/users.test.ts` additions):
  - dry-run returns per-table counts and destroys nothing (user still present,
    seats intact, credential verifies).
  - real run returns the same counts the dry-run predicted for the same state.
  - `last_owner` blocks both modes.
  - survivors: invites stay after removal, `invited_by` retained.
- Route: preview responds without `confirm`, destructive path requires
  `confirm=true` (covered through service tests + typecheck; kp has no route
  test harness for this route today beyond delegation-delta).
- `npm run typecheck` clean; scoped `node --test` on the touched test files.
