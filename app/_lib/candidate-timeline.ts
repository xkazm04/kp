import { getPipelineEntry, latestInterviewByEntry, listAnalyses, listConsentEvents, listOutboxFiltered, listPipelineEventsForEntry, type ConsentEvent, type PipelineEvent } from "./db";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { listScheduleInvites } from "./schedule-store";
import { isScheduleInviteExpired, INVITE_LINK_TTL_DAYS } from "./schedule-slots";
import { listOffersForEntry } from "./offers-store";
import { jdSlugOfJobId } from "./jd-limits";
import { deriveCommsView } from "./comms-view";
import { consentStatus, consentWithholdsPii, redactTranscriptForConsent, type ConsentStatus } from "./consent";
import { getInterviewPrep } from "./interview-prep";
import { normalizeScorecardEntities, type Scorecard, type ScorecardEntities } from "./interview-scorecard";
import type { InterviewTelemetry } from "./interview-telemetry";
import type { ScorecardCoverage } from "./interview-transcript";

// c6524f2f — one chronological story per candidate. A candidate's record is
// scattered across stores that never meet on one surface: pipeline events,
// persisted analyses, the voice-interview session, scheduling invites, sent
// comms, and the offer. candidateTimeline joins the cross-store chapters
// (analysis / interview / invite / offer) into time-ordered items; the drawer
// merges them with the pipeline events.
//
// candidateDrawerBundle (below) assembles EVERYTHING the drawer needs — those
// items PLUS pipeline events, the full comms letters, the latest interview
// outcome, and the human scorecard — in ONE server call, so the drawer opens
// with a single request instead of five independent fetches.
//
// Analysis join (the identity contract): analyses carry NO entry/candidate
// foreign key — only a free-text `candidate_label` and a `jd_slug`. So the
// strongest available identity is the SAME strict (label + jd_slug↔jobId) join
// the canonical match score uses (match-score-resolve.ts): a same-named stranger
// analyzed for a DIFFERENT role no longer inherits this candidate's history.
// When the entry's job is NOT JD-backed (a corpus job — no jd_slug to match on),
// there is no job axis to confirm identity, so a label match is REDUCED-CONFIDENCE
// and is flagged (`labelOnly`) rather than presented as certainly this person —
// the honest fallback for the rows that predate any id linkage.

export type CandidateTimelineItem = {
  at: string; // ISO timestamp the item happened
  kind: "analysis" | "interview" | "invite" | "offer";
  // Lifecycle status within the kind: interview created/completed, invite
  // sent/confirmed, offer extended/accepted/declined.
  status?: string | null;
  // Analysis refs — slug links to /history/<slug>.
  slug?: string | null;
  score?: number | null;
  disposition?: string | null;
  // ANALYSIS ONLY — true when this analysis was matched to the candidate by name
  // alone (the entry's job carries no JD slug to confirm identity), so it MAY
  // belong to a same-named stranger. The drawer surfaces this as an honest
  // "matched by name" caveat instead of asserting the link.
  labelOnly?: boolean;
  // Invite refs.
  slot?: string | null;
};

// One candidate-facing message (the drawer's rich "Messages" section) — the same
// fields the /api/comms read exposes, so the drawer no longer needs a second
// round trip to render the actual letters a candidate received.
export type CandidateComm = {
  id: string;
  kind: string | null;
  status: string;
  channel: string | null;
  subject: string | null;
  body: string | null;
  createdAt: string;
};

// The latest completed voice-interview outcome, derived from its scorecard — the
// same projection the /api/interview/by-entry read produced for the drawer, now
// server-joined so it rides the single bundle. Consent-gated identically (a
// withheld-PII entry drops the verbatim synthesis AND, with it, the telemetry +
// coverage that ride on the scorecard object).
export type InterviewOutcome = {
  recommendation?: string;
  summary?: string;
  ratings?: Scorecard["ratings"];
  hasTranscript?: boolean;
  // Round-3 telemetry + scoring-coverage — the same descriptive conversation
  // signals (talk share, longest pause, duration, hint uptake) and the honest
  // "scorer read N/total turns" caveat the InterviewTranscriptModal shows. Both
  // ride on the AI scorecard object at runtime (interview-run.ts); absent on old
  // sessions and on a complete-coverage score (no caveat needed).
  telemetry?: InterviewTelemetry;
  coverage?: ScorecardCoverage;
  // The structured read-back outcome (scorecard-v5): confirmed / corrected
  // (heard→meant) / unconfirmed technologies from the call's closing confirmation
  // turn. Rides on the AI scorecard object, so a withheld-PII entry drops it with the
  // verbatim synthesis. Absent when no read-back happened — same no-chrome rule as
  // telemetry/coverage.
  entities?: ScorecardEntities;
};

// The GDPR consent snapshot + audit trail for one entry — the SAME shape the
// dedicated /api/pipeline/[id]/consent read returns, now folded into the bundle so
// the drawer's "Data & consent" panel no longer fires its own second fetch on open.
export type CandidateConsentView = {
  consent: {
    givenAt: string | null;
    expiresAt: string | null;
    source: string | null;
    anonymizedAt: string | null;
    status: ConsentStatus;
  };
  events: ConsentEvent[];
};

// Everything the CandidateDrawer needs to render, in ONE call.
export type CandidateDrawerBundle = {
  items: CandidateTimelineItem[];
  events: PipelineEvent[];
  comms: CandidateComm[];
  interview: InterviewOutcome | null;
  humanScorecard: Scorecard | null;
  consent: CandidateConsentView;
};

const ANALYSES_SCAN_LIMIT = 300;
const COMMS_LIMIT = 200;
const INVITES_SCAN_LIMIT = 500;
const EVENTS_LIMIT = 50;

export function candidateTimeline(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): CandidateTimelineItem[] | null {
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) return null;
  return candidateTimelineForEntry(entry, workspaceId);
}

// The cross-store chapters for an ALREADY-RESOLVED entry (candidateDrawerBundle
// holds the entry for the consent gate, so it passes it straight through instead
// of a second by-id read).
function candidateTimelineForEntry(
  entry: NonNullable<ReturnType<typeof getPipelineEntry>>,
  workspaceId: string
): CandidateTimelineItem[] {
  const items: CandidateTimelineItem[] = [];

  const label = entry.candidateLabel?.trim().toLowerCase();
  // The entry's JD slug (null for a corpus job) is the job axis of the identity
  // join. A JD-backed entry attributes ONLY same-job analyses; a corpus entry has
  // no job axis, so its label matches are flagged reduced-confidence below.
  const entryJdSlug = jdSlugOfJobId(entry.jobId);
  if (label) {
    for (const a of listAnalyses(ANALYSES_SCAN_LIMIT, workspaceId)) {
      if (a.candidate_label?.trim().toLowerCase() !== label) continue;
      const jobMatched = entryJdSlug !== null && a.jd_slug === entryJdSlug;
      // JD-backed entry: require the job axis to agree, or this analysis is for a
      // DIFFERENT role (a same-named stranger, or this person on another job) and
      // must not fold into their story here.
      if (entryJdSlug !== null && !jobMatched) continue;
      items.push({
        at: a.created_at,
        kind: "analysis",
        slug: a.slug,
        score: a.score,
        disposition: a.disposition ?? null,
        // High confidence only when the job axis confirmed the link.
        labelOnly: !jobMatched,
      });
    }
  }

  const interview = latestInterviewByEntry(entry.id);
  if (interview) {
    items.push({ at: interview.createdAt, kind: "interview", status: "created" });
    if (interview.endedAt) items.push({ at: interview.endedAt, kind: "interview", status: "completed" });
  }

  for (const invite of listScheduleInvites(INVITES_SCAN_LIMIT, workspaceId)) {
    if (invite.entryId !== entry.id) continue;
    items.push({ at: invite.createdAt, kind: "invite", status: "sent" });
    if (invite.confirmedAt) items.push({ at: invite.confirmedAt, kind: "invite", status: "confirmed", slot: invite.slot });
    // The candidate proposed alternative times the recruiter hasn't actioned yet — a
    // timeline FACT (no action, no link): the story shouldn't read as a live "invite
    // sent" when the ball is actually in the recruiter's court.
    if (invite.proposalStatus === "pending" && invite.proposalsAt) {
      items.push({ at: invite.proposalsAt, kind: "invite", status: "proposed" });
    }
    // Terminal fate — mirror the offer branch below: a declined / no-show / (derived)
    // expired invite must stop rendering as a live "sent/confirmed" link forever.
    // declined + no_show are stored statuses; expired is DERIVED from a still-pending
    // row's age (isScheduleInviteExpired), so no row is written for it.
    if (invite.status === "declined") {
      // No stored decline timestamp (the column doesn't exist) — anchor the fact at
      // the best-known instant (a proposal they made, else the invite's creation),
      // never a fabricated later time.
      items.push({ at: invite.proposalsAt ?? invite.createdAt, kind: "invite", status: "declined" });
    } else if (invite.status === "no_show") {
      // no_show keeps slot_at as the record of the missed time (schedule-store) — the
      // truthful instant for the lapse.
      items.push({ at: invite.slotAt ?? invite.confirmedAt ?? invite.createdAt, kind: "invite", status: "no_show" });
    } else if (isScheduleInviteExpired(invite)) {
      // Surface the lapse at its TTL deadline (createdAt + INVITE_LINK_TTL_DAYS) so a
      // never-booked link stops reading as "sent" forever — exactly the offer branch's
      // expired-at-its-deadline handling.
      const expiredAt = new Date(Date.parse(invite.createdAt) + INVITE_LINK_TTL_DAYS * 86_400_000).toISOString();
      items.push({ at: expiredAt, kind: "invite", status: "expired" });
    }
  }

  for (const offer of listOffersForEntry(entry.id)) {
    items.push({ at: offer.createdAt, kind: "offer", status: "extended" });
    if (offer.respondedAt) items.push({ at: offer.respondedAt, kind: "offer", status: offer.status });
    // An expired offer has no respondedAt (the candidate never acted) — surface the
    // lapse at its deadline so it doesn't render as "extended" forever.
    else if (offer.status === "expired" && offer.expiresAt) {
      items.push({ at: offer.expiresAt, kind: "offer", status: "expired" });
    }
  }

  items.sort((a, b) => a.at.localeCompare(b.at));
  return items;
}

// The full comms letters for one entry (the drawer's "Messages" section). Same
// derivation as the /api/comms read — supersession-aware, bounce receipts folded
// — so the drawer's rich letters no longer need a second fetch. Comms appear here
// EXACTLY ONCE and are deliberately NOT duplicated as timeline items.
function candidateComms(entryId: string, workspaceId: string): CandidateComm[] {
  // deriveCommsView (the /api/comms derivation): supersession-aware and folds
  // bounce-receipt rows onto their send, so a receipt never renders as a message.
  return deriveCommsView(listOutboxFiltered({ ref: entryId, limit: COMMS_LIMIT }, workspaceId)).map((m) => ({
    id: m.id,
    kind: m.kind,
    status: m.status,
    channel: m.channel,
    subject: m.subject,
    body: m.body,
    createdAt: m.createdAt,
  }));
}

// The latest COMPLETED interview's outcome, consent-gated the same way the
// /api/interview/by-entry read is (a withheld-PII entry drops the verbatim
// scorecard synthesis + transcript). Null when there's no completed interview.
function candidateInterviewOutcome(
  entry: NonNullable<ReturnType<typeof getPipelineEntry>>
): InterviewOutcome | null {
  let session = latestInterviewByEntry(entry.id);
  if (!session || session.status !== "completed") return null;
  if (
    consentWithholdsPii({ givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt })
  ) {
    session = redactTranscriptForConsent(session);
  }
  const sc = (session.scorecard ?? null) as Scorecard | null;
  // Telemetry + coverage ride on the scorecard OBJECT at runtime (interview-run.ts)
  // but aren't in the pure Scorecard type — read them through the SAME narrow guard
  // InterviewTranscriptModal uses. Because redactTranscriptForConsent nulls the whole
  // scorecard, a withheld-PII entry drops these along with the verbatim synthesis.
  const enriched = sc as (Scorecard & { telemetry?: InterviewTelemetry; coverage?: ScorecardCoverage }) | null;
  return {
    recommendation: sc?.recommendation,
    summary: sc?.summary,
    ratings: sc?.ratings,
    hasTranscript: Array.isArray(session.transcript) && session.transcript.length > 0,
    telemetry: enriched?.telemetry,
    coverage: enriched?.coverage,
    // Structured read-back — validated through the SAME narrow guard the modal uses so
    // a malformed/legacy blob degrades to absence (undefined) rather than empty chrome.
    entities: normalizeScorecardEntities(sc?.entities) ?? undefined,
  };
}

// The GDPR consent snapshot + audit trail for one entry — same derivation as the
// /api/pipeline/[id]/consent read, now workspace-scoped through the resolved entry
// so it rides the single bundle instead of a second drawer fetch.
function candidateConsent(
  entry: NonNullable<ReturnType<typeof getPipelineEntry>>,
  workspaceId: string
): CandidateConsentView {
  return {
    consent: {
      givenAt: entry.consentGivenAt,
      expiresAt: entry.consentExpiresAt,
      source: entry.consentSource,
      anonymizedAt: entry.anonymizedAt,
      status: consentStatus(
        { givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt },
        Date.now()
      ),
    },
    events: listConsentEvents(entry.id, workspaceId),
  };
}

// The human scorecard saved against this entry's prep artifact (PREP1), if any.
function candidateHumanScorecard(entryId: string): Scorecard | null {
  const prep = getInterviewPrep(entryId);
  const sc = (prep?.payload as { humanScorecard?: Scorecard } | undefined)?.humanScorecard ?? null;
  return sc;
}

/** The whole CandidateDrawer payload — cross-store items, pipeline events, full
 *  comms, interview outcome and human scorecard — assembled in ONE call so the
 *  drawer opens with a single request. Returns null when the entry is unknown /
 *  not in the caller's workspace (the route answers 404). */
export function candidateDrawerBundle(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): CandidateDrawerBundle | null {
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) return null;
  return {
    items: candidateTimelineForEntry(entry, workspaceId),
    events: listPipelineEventsForEntry(entry.id, EVENTS_LIMIT, workspaceId),
    comms: candidateComms(entry.id, workspaceId),
    interview: candidateInterviewOutcome(entry),
    humanScorecard: candidateHumanScorecard(entry.id),
    consent: candidateConsent(entry, workspaceId),
  };
}
