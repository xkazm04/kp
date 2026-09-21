// WHO MAY DELETE A JOB DESCRIPTION — the pure half of the rule.
//
// The owner's rule is "the user who created the description, or any admin". That is
// a narrower question than any existing capability: `pipeline:write` (what the JD
// edit door asks for) is held by every recruiter, and a recruiter deleting a
// colleague's draft is precisely what the rule excludes. So the door needs a
// per-ROW answer, and TWO places must produce the same one — GET /api/jds folds it
// into `canDelete` for the trash icon, DELETE /api/jds/[slug] enforces it. This is
// that single fold. Never re-implement either half at a call site.
//
// Import-free on purpose (the jds-delete-access.ts sibling owns the session read),
// so the rule is unit-testable without booting next/server or the DB.

/** The delete-door identity of a request. `userId` is the creator claim to match;
 *  `isAdmin` is the blanket authority that skips the match. */
export type JdDeleteActor = { userId: string | null; isAdmin: boolean };

/** May this actor delete a row authored by `createdBy`?
 *
 *  A NULL `createdBy` (a legacy row, or one saved with no identity behind it) is
 *  "no creator claim" and matches NOBODY — never "everyone". Both null-guards are
 *  load-bearing: without them a legacy row read against an identity-less session is
 *  `null === null`, and every recruiter on the team could delete every
 *  pre-migration draft. Only an admin clears those, which is the fail-closed
 *  direction: the worst case is a recruiter asking an admin, not a recruiter
 *  erasing a stranger's work. */
export function canDeleteJd(actor: JdDeleteActor, createdBy: string | null | undefined): boolean {
  if (actor.isAdmin) return true;
  return Boolean(createdBy) && Boolean(actor.userId) && createdBy === actor.userId;
}
