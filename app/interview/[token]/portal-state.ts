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
