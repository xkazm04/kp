import {
  isInterviewLinkExpired,
  isInterviewSessionLive,
} from "@/app/_lib/db/interviews";
import { isCandidateInterview } from "@/app/_lib/interview-rehearsal";

// Which card the tokenized candidate portal paints. Completed / revoked /
// expired already had honest closed cards; a LIVE in_progress session used to
// fall through to VoiceInterviewClient and show Start, so a second tab burned
// a /connect and was refused INTERVIEW_ALREADY_LIVE as a generic start failure.
// Live uses the same isInterviewSessionLive window /connect and /create share.

export type InterviewPortalView = "completed" | "inactive" | "live" | "ready";

export type InterviewInactiveCopyKeys = {
  title: "revokedTitle" | "expiredTitle";
  body: "revokedBody" | "expiredBody";
};

/** Closed-card copy for an inactive token. /connect already distinguishes
 *  INTERVIEW_LINK_INACTIVE (revoked) from INTERVIEW_LINK_EXPIRED; the page
 *  used to collapse both onto one "expired or was withdrawn" sentence. */
export function interviewInactiveCopyKeys(session: { status: string }): InterviewInactiveCopyKeys {
  if (session.status === "revoked") {
    return { title: "revokedTitle", body: "revokedBody" };
  }
  return { title: "expiredTitle", body: "expiredBody" };
}

/** What the portal may OFFER beside the call — and what a recruiter's kit REHEARSAL
 *  (a test-mode session, interview-rehearsal.ts) must never be offered:
 *   - `recording`: the audio-recording opt-in. /connect stamps recording consent only
 *     for candidate MODE, but the page used to read the workspace setting for every
 *     session, so a rehearsal in a workspace that records was shown a checkbox that
 *     could never take effect. Now the offer follows /connect's rule exactly (and is
 *     still AND-ed with the workspace setting by the page).
 *   - `statusLink`: the candidate's /status page. Only a candidate interview has one;
 *     minting it is a WRITE against the entry (getOrCreateStatusLink), so a test session
 *     that somehow carried an entry must not mint a candidate's status token either. */
export function interviewPortalOffers(session: {
  mode: "test" | "candidate";
  entryId: string | null;
}): { recording: boolean; statusLink: boolean } {
  return { recording: session.mode === "candidate", statusLink: isCandidateInterview(session) };
}

export function interviewPortalView(session: {
  status: string;
  createdAt: string;
  updatedAt?: string | null;
  lastActivityAt?: string | null;
}): InterviewPortalView {
  if (session.status === "completed") return "completed";
  if (session.status === "revoked" || isInterviewLinkExpired(session)) return "inactive";
  if (
    isInterviewSessionLive({
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt ?? null,
      lastActivityAt: session.lastActivityAt ?? null,
    })
  ) {
    return "live";
  }
  return "ready";
}
