// What the governance control should read — and what the recruiter must be TOLD —
// when opening a role serves a CACHED group evaluation instead of spawning a run.
//
// The server's rule (app/_lib/group-eval-governance.ts) is deliberately asymmetric:
// a user may always escalate recommendation→governed; only the silent
// governed→recommendation downgrade is blocked. The client's cache-hit path used to
// do the opposite — it overwrote the control with the payload's stored mode in BOTH
// directions, so a recruiter who had just switched a role to committee got the saved
// recommendation-mode evaluation served AND their choice snapped back, silently.
//
// This module holds the one decision that fixes it. It is pure and imports only the
// server's ordering, so there is exactly ONE definition of "which mode is stronger":
// resolveGovernanceMode / sealsLead. Do not write a second one here.
import { resolveGovernanceMode, sealsLead, type GovernanceMode } from "@/app/_lib/group-eval-governance";

/** A served evaluation whose governance mode is NOT the mode the control now shows.
 *  The recruiter is reading a comparison produced under `ranUnder` while asking the
 *  question `selected` asks — the notice's entire subject. */
export type GovernanceCacheMismatch = {
  /** The mode the SAVED evaluation was actually produced under. */
  ranUnder: GovernanceMode;
  /** The mode the control shows (and that a re-run would evaluate under). */
  selected: GovernanceMode;
  /** The governance-critical half: the saved run was free to auto-seal an AI lead
   *  while the selected mode keeps the AI advisory. A lateral committee↔eligibility
   *  mismatch is a presentation difference; this one is a governance difference. */
  weaker: boolean;
};

export type GovernanceCacheSync = {
  /** What the governance control should show after the cache hit. */
  mode: GovernanceMode;
  /** Non-null when the served evaluation's mode differs from `mode`. */
  mismatch: GovernanceCacheMismatch | null;
};

/** Decide the control's mode and the disclosure for a cache HIT.
 *
 *  @param stored     the served payload's `governanceMode` (absent on legacy payloads)
 *  @param selected   the control's current value
 *  @param userChose  whether `selected` came from the recruiter operating the
 *                    governance selector this session, as opposed to the unpersisted
 *                    per-mount default (or a mode a previous cache hit snapped up).
 *
 *  Untouched control → the payload's mode wins outright: that is the anti-downgrade
 *  sync this path was built for (bug-ui-scan-2026-07-09 #1), and it also keeps a
 *  committee role from re-running as "recommendation" after a fresh mount. It also
 *  means a mode snapped up while viewing one role never leaks onto the next role.
 *
 *  Deliberate choice → the server's own asymmetry arbitrates: a stored governed mode
 *  still raises a control sitting at "recommendation", but nothing lowers a mode the
 *  recruiter picked. Whenever the result differs from what the saved evaluation was
 *  produced under, the caller owes the reader a notice. */
export function syncGovernanceOnCacheHit(
  stored: GovernanceMode | null | undefined,
  selected: GovernanceMode,
  userChose: boolean
): GovernanceCacheSync {
  // A legacy payload saved before governanceMode existed says nothing about how it
  // ran; there is no mismatch to claim and nothing to sync the control to.
  if (!stored) return { mode: selected, mismatch: null };
  if (!userChose) return { mode: stored, mismatch: null };
  const mode = resolveGovernanceMode(stored, selected);
  if (mode === stored) return { mode, mismatch: null };
  return { mode, mismatch: { ranUnder: stored, selected: mode, weaker: sealsLead(stored) && !sealsLead(mode) } };
}
