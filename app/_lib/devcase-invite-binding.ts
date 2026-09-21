// BINDING BACK — the other half of the homework column.
//
// The arrival hook (stage-hooks-homework.ts) mails a named candidate, who already has a
// pipeline entry, the apply link for a posting. When their work comes back through that
// link, `promoteSubmission` has to decide WHO submitted it, and before this module it
// could not tell an invited candidate from a stranger who found the link: it resolved
// the submission's free-text `candidateRef` against `profiles`, failed, minted a NEW
// profile and therefore a SECOND pipeline entry. The person then existed twice on one
// job — once in the homework column, once freshly promoted into Screened — and the AI
// interview that follows was grounded off whichever of the two the recruiter happened to
// open. `buildGroundedInterview` reads the submission through `entry.devSubmissionId`
// (interview-planned-minutes.ts), so the duplicate is exactly what made the interview
// ungrounded.
//
// THE LEDGER IS THE MAPPING, so nothing new is stored. The invite's outbox row already
// carries every field this join needs: `ref` is the invited entry's id, `recipient` is
// what `candidateRecipient` resolved for that entry, and the body carries the posting's
// apply token. Reading it back is what turns "somebody submitted on this token" into
// "THIS board entry's candidate submitted".
//
// NO INTERNAL ID GOES ON THE PUBLIC WIRE for this. The alternative — putting an entry or
// profile id in the invite link — would hand a candidate-facing URL an internal key, and
// the public tokenized surfaces in this repo deliberately carry a projection and never a
// row. The join is server-side and reads only what the invite already recorded.

import { candidateRecipient } from "./comms-dispatch";
import { getPosting, listOutboxFiltered, type DevSubmission } from "./db/devcase";
import { getPipelineEntry } from "./db/pipeline";

/** The comms kind the homework invite writes — the same constant
 *  stage-hooks-homework.ts reads back for idempotence. */
const CASE_INVITE_KIND = "case_invite";

/** How many of a team's assignment letters the join scans. A posting's invite list is a
 *  shortlist, not a mailing list; 200 is far above a real one and keeps this off the
 *  hot path of a public submission. */
const OUTBOX_LOOKBACK = 200;

/** Normalized comparison for the two identifiers a candidate can present: the address we
 *  mailed and the name they typed. Trim + case-fold only — nothing clever, because a
 *  near-miss must resolve to "I don't know", not to somebody else's entry. */
const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/**
 * The pipeline entry a submission belongs to BECAUSE WE INVITED IT, or null.
 *
 * Null is the honest answer in every uncertain case — an uninvited submission (the
 * posting was shared, or a candidate found it), a submitter matching no invite, and
 * crucially a submitter matching MORE THAN ONE invited entry. Guessing between two
 * people is worse than promoting a stranger: it attaches one candidate's work to
 * another's hiring record. The caller falls back to its existing resolution.
 */
export function invitedEntryIdForSubmission(sub: DevSubmission): string | null {
  if (!sub.postingId) return null;
  const token = sub.postingId ? (getPosting(sub.postingId)?.token ?? null) : null;
  if (!token) return null;

  const submitter = [norm(sub.contact), norm(sub.candidateRef)].filter(Boolean);
  if (submitter.length === 0) return null;

  const matches = new Set<string>();
  for (const row of listOutboxFiltered({ kind: CASE_INVITE_KIND, limit: OUTBOX_LOOKBACK }, sub.workspaceId)) {
    // A `bounced` row is a delivery RECEIPT, not a send (db/devcase.ts) — it never
    // proves we invited anybody.
    if (row.status === "bounced") continue;
    if (!row.ref || !(row.body ?? "").includes(token)) continue;
    if (!submitter.includes(norm(row.recipient))) continue;
    matches.add(row.ref);
  }
  if (matches.size !== 1) return null;

  const entryId = [...matches][0];
  const entry = getPipelineEntry(entryId, sub.workspaceId);
  if (!entry) return null;
  // Defence in depth: the outbox row is scoped to the submission's tenant already, and
  // so is this read — an invite ledger may not reach across teams even by id.
  // Re-derive the recipient from the LIVE row rather than trusting the stored string:
  // a candidate whose contact was corrected (or erased) since the letter went out must
  // not be re-identified from a stale copy of it.
  if (!submitter.includes(norm(candidateRecipient(entry)))) return null;
  return entry.id;
}

/** The invited candidate's profile id, for the promote path's identity resolution. */
export function invitedCandidateIdForSubmission(sub: DevSubmission): string | null {
  const entryId = invitedEntryIdForSubmission(sub);
  if (!entryId) return null;
  return getPipelineEntry(entryId, sub.workspaceId)?.candidateId ?? null;
}
