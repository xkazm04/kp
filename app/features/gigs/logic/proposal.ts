import { GIG_PROPOSAL_SPECIALIST_ID, gigTrackOf, type Gig, type GigAttempt, type GigProposal, type GigTrack } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// The proposal track (a freelance gig: a bid, never a build)
// ---------------------------------------------------------------------------
//
// The operator's call (2026-09-30): a freelance bid is rarely won, so kp prepares a plan, the
// questions and artifacts to ask the client, and a client proposal (an HTML file with no
// internal figures) - and never builds the solution. Once the proposal lands kp writes the
// bid message as the gig's draft itself (`specialistId === "kp:proposal"`), and the desk's
// Approve / Mark sent work as for any draft. These derivations decide what the proof shows
// for such a gig. Pure: pinned by proposal.test.ts.

export const trackOf = (gig: Pick<Gig, "arena">): GigTrack => gigTrackOf(gig.arena);

/** The draft kp wrote itself from the proposal (no persona ran). */
export function isKpDraft(attempt: Pick<GigAttempt, "specialistId"> | null): boolean {
  return attempt?.specialistId === GIG_PROPOSAL_SPECIALIST_ID;
}

/** Whether there is a proposal file to open: a finished one, or a rewrite in flight or failed
 *  whose previous file is still on disk (the record then still carries its message). A first
 *  write in progress, or a first write that failed, has no file yet. */
export function proposalHasFile(p: GigProposal | null): boolean {
  return p !== null && (p.status === "ready" || p.message.trim() !== "");
}

/** The note beside Prepare / Rewrite about what the proposal is (or will be) written from:
 *  "will" - none yet and no plan accepted; "was" - written from the brief alone and still no
 *  plan; "stale" - written from the brief alone before a plan was accepted (rewrite it now);
 *  null - written from the accepted plan, or none yet with a plan accepted. */
export type ProposalBasisNote = "will" | "was" | "stale" | null;
export function proposalBasisNote(p: GigProposal | null, planAccepted: boolean): ProposalBasisNote {
  if (p === null || !proposalHasFile(p)) return planAccepted ? null : "will";
  if (p.planId !== null) return null;
  return planAccepted ? "stale" : "was";
}

/** The message to the client the Review tab shows: the proposal's bid message when one was
 *  written, else the research brief's first-contact message; with where it came from and
 *  when it was written (the brief's is dated by the brief). */
export type ClientMessage = { text: string; from: "proposal" | "brief"; at: string | null };
export function clientMessageOf(gig: Pick<Gig, "proposal" | "brief">): ClientMessage | null {
  const p = gig.proposal;
  if (p && p.message.trim()) return { text: p.message.trim(), from: "proposal", at: p.generatedAt };
  const b = gig.brief?.outreachMessage?.trim();
  return b ? { text: b, from: "brief", at: gig.brief?.createdAt ?? null } : null;
}

/** What to ask the client: the proposal's artifacts and questions when it carries them,
 *  else the brief's missing artifacts (the brief writes no questions for the client). */
export function clientAsksOf(gig: Pick<Gig, "proposal" | "brief">): { artifacts: string[]; questions: string[]; from: "proposal" | "brief" } {
  const p = gig.proposal;
  if (p && proposalHasFile(p)) return { artifacts: p.artifacts, questions: p.questions, from: "proposal" };
  return { artifacts: gig.brief?.missingArtifacts ?? [], questions: [], from: "brief" };
}

/** The Pairing tab is open on the build track, and on the proposal track only for a legacy
 *  gig a persona already worked (its own agent, or a niche specialist's attempt): a bid gets
 *  a proposal, not an agent. */
export function pairingOpen(gig: Pick<Gig, "arena">, hasPersona: boolean, latest: Pick<GigAttempt, "specialistId"> | null): boolean {
  if (trackOf(gig) === "build") return true;
  return hasPersona || (latest !== null && !isKpDraft(latest));
}

/** The bid message and the proposal's message differ: the proposal was rewritten after kp
 *  put its draft on the desk (a rewrite of a drafted gig writes the file, not a new draft). */
export function proposalMovedOn(p: GigProposal | null, draftText: string | null | undefined): boolean {
  const a = p?.message.trim() ?? "";
  const b = draftText?.trim() ?? "";
  return a !== "" && b !== "" && a !== b;
}
