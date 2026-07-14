import {
  recordAutomationEvent,
  rematchSourceEntry,
  terminalPriorEntriesForCandidate,
  type RematchSourceResult,
} from "./db";

// Close-the-prior on a manual rediscovery reach-out (direction 3). Reaching out to a
// silver medalist mints a FRESH pipeline entry for the new role; without this the
// person is left active in the new role while their rejected/role_closed history sits
// orphaned in the old one — one human, two roles, no link. This connects them using
// the SAME machinery the automation rematch uses (rematchSourceEntry — NOT a fork),
// so the manual path and the automated path resolve the source→target relationship
// identically.
//
// Only genuinely terminal priors are touched (terminalPriorEntriesForCandidate filters
// to rejected/declined/role_closed and excludes the target role) — never an active
// entry, never a Hired one — so rematchSourceEntry hits its documented "already
// terminal → stamp the link, keep the status" re-engagement branch: a company reject
// stays a reject, now linked to the re-engagement. The symmetric `rematched_from`
// back-link is recorded on the target, exactly as the automation path does.

/** Link the candidate's terminal priors (other roles) to the just-created target
 *  entry. The caller MUST invoke this ONLY when the target was NEWLY created
 *  (created===true) — that is the idempotency guarantee: a repeat reach-out returns
 *  the existing entry (created===false) and never re-enters here, so a second click
 *  can neither re-close nor double-link. Workspace-scoped (direction 1). Returns the
 *  number of priors linked. */
export function linkTerminalPriorsToTarget(
  candidateId: string,
  targetEntryId: string,
  targetJobId: string,
  workspaceId: string
): number {
  const priors = terminalPriorEntriesForCandidate(candidateId, targetJobId, workspaceId);
  let linked = 0;
  for (const prior of priors) {
    const r: RematchSourceResult = rematchSourceEntry(prior.id, targetEntryId, targetJobId, workspaceId);
    // A prior we pre-filtered as terminal resolves to `already_terminal` (link stamped,
    // status untouched); `closed` covers the rare reinstate-race where it went active
    // between our read and rematchSourceEntry's atomic re-read (handled exactly as the
    // automation path would). Either way a source→target link was stamped, so record
    // the matching back-link on the target. `missing`/`hired` stamp nothing — skip.
    if (r.outcome === "already_terminal" || r.closed) {
      recordAutomationEvent(targetEntryId, "rematched_from", `${prior.id} (${prior.jobId ?? "?"})`, workspaceId);
      linked += 1;
    }
  }
  return linked;
}
