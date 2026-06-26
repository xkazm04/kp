import { getPipelineEntry, latestInterviewByEntry, listAnalyses, listOutboxFiltered } from "./db";
import { listScheduleInvites } from "./schedule-store";
import { listOffersForEntry } from "./offers-store";

// c6524f2f — one chronological story per candidate. A candidate's record is
// scattered across stores that never meet on one surface: pipeline events
// (already in the drawer), persisted analyses, the voice-interview session,
// scheduling invites, sent comms, and the offer. This module joins everything
// EXCEPT pipeline events (the drawer already loads those via
// /api/pipeline/events?entry=) into time-ordered items the drawer merges in.
//
// Wire shape is structural (kind + refs), never prose — labels are the
// client's i18n concern. Analyses are joined by exact candidate label
// (case-insensitive): they aren't entry-keyed, and a fuzzy join would invent
// history for same-named strangers, so exact-match is the honest line.

export type CandidateTimelineItem = {
  at: string; // ISO timestamp the item happened
  kind: "analysis" | "interview" | "invite" | "comm" | "offer";
  // Lifecycle status within the kind: interview created/completed, invite
  // sent/confirmed, offer extended/accepted/declined, comm delivery status.
  status?: string | null;
  // Analysis refs — slug links to /history/<slug>.
  slug?: string | null;
  score?: number | null;
  disposition?: string | null;
  // Invite refs.
  slot?: string | null;
  // Comm refs — subject was localized at send time; commKind is the enum.
  subject?: string | null;
  commKind?: string | null;
};

const ANALYSES_SCAN_LIMIT = 300;
const COMMS_LIMIT = 100;
const INVITES_SCAN_LIMIT = 500;

export function candidateTimeline(entryId: string): CandidateTimelineItem[] | null {
  const entry = getPipelineEntry(entryId);
  if (!entry) return null;
  const items: CandidateTimelineItem[] = [];

  const label = entry.candidateLabel?.trim().toLowerCase();
  if (label) {
    for (const a of listAnalyses(ANALYSES_SCAN_LIMIT)) {
      if (a.candidate_label?.trim().toLowerCase() !== label) continue;
      items.push({
        at: a.created_at,
        kind: "analysis",
        slug: a.slug,
        score: a.score,
        disposition: a.disposition ?? null,
      });
    }
  }

  const interview = latestInterviewByEntry(entryId);
  if (interview) {
    items.push({ at: interview.createdAt, kind: "interview", status: "created" });
    if (interview.endedAt) items.push({ at: interview.endedAt, kind: "interview", status: "completed" });
  }

  for (const invite of listScheduleInvites(INVITES_SCAN_LIMIT)) {
    if (invite.entryId !== entryId) continue;
    items.push({ at: invite.createdAt, kind: "invite", status: "sent" });
    if (invite.confirmedAt) items.push({ at: invite.confirmedAt, kind: "invite", status: "confirmed", slot: invite.slot });
  }

  for (const offer of listOffersForEntry(entryId)) {
    items.push({ at: offer.createdAt, kind: "offer", status: "extended" });
    if (offer.respondedAt) items.push({ at: offer.respondedAt, kind: "offer", status: offer.status });
    // An expired offer has no respondedAt (the candidate never acted) — surface the
    // lapse at its deadline so it doesn't render as "extended" forever.
    else if (offer.status === "expired" && offer.expiresAt) {
      items.push({ at: offer.expiresAt, kind: "offer", status: "expired" });
    }
  }

  for (const comm of listOutboxFiltered({ ref: entryId, limit: COMMS_LIMIT })) {
    items.push({ at: comm.createdAt, kind: "comm", status: comm.status, subject: comm.subject, commKind: comm.kind });
  }

  items.sort((a, b) => a.at.localeCompare(b.at));
  return items;
}
