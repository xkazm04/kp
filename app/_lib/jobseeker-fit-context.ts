import { getJobseekerPosting, listJobseekerPostings } from "./db/jobseeker-postings";
import type { JobseekerTurnInput } from "./jobseeker-run";

// What a `fit` dialog turn carries beside the profile (WP5): the posting the seeker is
// deciding about, its stored MatchResult, and the seeker's last dismissals as a taste
// signal ("you dismissed three roles for salary; this one states no pay"). Read once
// per turn by the create and message routes, BEFORE the spawn, off the same store the
// feed reads: the engine never sees more of the ad than the page shows.
//
// The posting rides as a compact projection (never the raw JSON-LD, never the
// structured Job: the coach reasons over the words the ad used and the match the
// engine computed, not over a parser's intermediate).

const MAX_BODY_CHARS = 12_000;
const DISMISSALS = 10;

export type FitTurnContext = Pick<JobseekerTurnInput, "posting" | "match" | "dismissals">;

export function fitTurnContext(postingId: string | null, workspaceId: string): FitTurnContext | null {
  if (!postingId) return null;
  const posting = getJobseekerPosting(postingId, workspaceId);
  if (!posting) return null;
  const dismissals = listJobseekerPostings({ status: "dismissed", sort: "seen", limit: DISMISSALS }, workspaceId).rows.map((r) => ({
    reason: r.dismissReason ?? "other",
    note: r.dismissNote,
    title: r.title,
  }));
  return {
    posting: {
      id: posting.id,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      country: posting.country,
      workMode: posting.workMode,
      postedAt: posting.postedAt,
      salaryMin: posting.salaryMin,
      salaryMax: posting.salaryMax,
      salaryCurrency: posting.salaryCurrency,
      salaryPeriod: posting.salaryPeriod,
      bodyText: posting.bodyText.slice(0, MAX_BODY_CHARS),
      url: posting.url,
      matchTotal: posting.matchTotal,
      fitTier: posting.fitTier,
      reasoning: posting.reasoning,
    },
    match: posting.match,
    dismissals,
  };
}
