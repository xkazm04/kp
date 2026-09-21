// What the candidate modal renders when it is opened FROM the decisions ledger: the
// AI's recommendation waiting on the reviewer, the peer context for the ladder, and
// the two verdicts. Absent (the modal opened from the board) → no decision chrome.

import type { Entry as DecisionsEntry } from "@/app/features/shared/decisionsTypes";
import type { JobPeerContext, PeerScore } from "@/app/features/hiring/decisions/decisionsPeerCompare";

export type CandidateDecision = {
  entry: DecisionsEntry;
  /** The JD's last content edit when this recommendation predates it (informs, never blocks). */
  staleSince: string | null;
  peers: PeerScore[];
  peerFacts: JobPeerContext | null;
  /** `ttlDays` rides an offer accept (the per-offer deadline). */
  onAccept: (ttlDays?: number) => void;
  onReject: () => void;
  busy: boolean;
};
