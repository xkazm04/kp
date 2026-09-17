import {
  isInterviewLinkExpired,
  isInterviewSessionLive,
} from "@/app/_lib/db/interviews";

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

export function interviewPortalView(session: {
  status: string;
  createdAt: string;
  updatedAt?: string | null;
}): InterviewPortalView {
  if (session.status === "completed") return "completed";
  if (session.status === "revoked" || isInterviewLinkExpired(session)) return "inactive";
  if (
    isInterviewSessionLive({
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt ?? null,
    })
  ) {
    return "live";
  }
  return "ready";
}
