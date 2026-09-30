// ---------------------------------------------------------------------------
// The Summary's ONE action place (proof/summary/MovesBlock.tsx)
// ---------------------------------------------------------------------------
//
// Every Summary action lives in one "Moves" block at the top of the decision sidebar, grouped
// by the object it acts on (the report, the client proposal, the plans, the research, the
// draft). Exactly ONE of them is the primary button: the gig's next move by stage, decided
// here. The sign-off keeps its own moves (Accept, Approve, Dispatch, Decline): a New listing's
// next move is the sign-off's Accept or Decline, so the Moves block has no primary then; after
// the pick on the build track (Dispatch) it offers the report. Pure: pinned by moves.test.ts.
// The reading of a lead into one sentence and the rest is here too (the Summary's header).

export const MOVE_IDS = ["research", "generatePlans", "goPlans", "prepareProposal", "openProposal", "goBid", "goDraft", "openReport", "writeReport"] as const;
export type MoveId = (typeof MOVE_IDS)[number];

export type MoveFacts = {
  /** The gig has a research brief. */
  brief: boolean;
  /** Plans in the shown round; null while they load. */
  plans: number | null;
  /** A plan seat is queued or writing. */
  plansBusy: boolean;
  accepted: boolean;
  /** The proposal track (a freelance bid): a client proposal, never a build. */
  proposalTrack: boolean;
  /** A client proposal file exists to open. */
  proposalFile: boolean;
  proposalWriting: boolean;
  /** A draft is on the desk (drafted or approved, with text). */
  draftOnDesk: boolean;
  /** That draft is the one kp wrote itself from the proposal (the bid message). */
  kpDraft: boolean;
  /** A report file exists to open. */
  report: boolean;
  reportWriting: boolean;
  /** The gig is off the line (declined, withdrawn, expired, sent, quarantined). */
  closed: boolean;
  /** A New listing nobody accepted yet: the sign-off's Accept or Decline comes first. */
  untriaged: boolean;
};

/** The gig's next move, or null when it is not a Summary move (a write in flight, a New
 *  listing's Accept, or a move that belongs to the sign-off with no report to open instead). */
export function nextMove(f: MoveFacts): MoveId | null {
  const reportMove: MoveId | null = f.report ? "openReport" : f.brief && !f.reportWriting ? "writeReport" : null;
  if (f.closed) return f.report ? "openReport" : null;
  if (f.untriaged) return null;
  if (f.draftOnDesk) {
    if (!f.kpDraft) return "goDraft";
    return f.proposalFile ? "openProposal" : "goBid";
  }
  if (!f.brief) return "research";
  if (f.plans === null) return f.report ? "openReport" : null;
  if (!f.accepted) return f.plans === 0 && !f.plansBusy ? "generatePlans" : "goPlans";
  if (f.proposalTrack) {
    if (f.proposalWriting) return f.report ? "openReport" : null;
    return f.proposalFile ? "openProposal" : "prepareProposal";
  }
  return reportMove;
}

/** A lead split into its first sentence (the one line set in the display size) and the rest
 *  (set as body). A first sentence too long to be a lead (over `max` characters) is not one:
 *  the lead is then empty and the whole text is body, never cut mid-thought. */
export function leadSentence(text: string, max = 200): { lead: string; rest: string } {
  const s = text.replace(/\s+/g, " ").trim();
  const end = /[.!?](?=\s|$)/.exec(s);
  const first = end ? s.slice(0, end.index + 1) : s;
  if (first.length > max) return { lead: "", rest: s };
  return { lead: first, rest: s.slice(first.length).trim() };
}
