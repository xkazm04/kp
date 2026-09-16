import { notFound } from "next/navigation";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { latestFitDialogForPosting } from "@/app/_lib/db/jobseeker-dialogs";
import { getJobseekerPosting } from "@/app/_lib/db/jobseeker-postings";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { getJobseekerSource } from "@/app/_lib/db/jobseeker-sources";
import { catalogEntryForHost } from "@/app/_lib/jobseeker/sources-catalog";
import { PostingDetail } from "@/app/features/jobseeker/PostingDetail";
import { postingDetailView } from "@/app/features/jobseeker/postingView";

// /me/jobs/[id] — one posting: the text, the match, the reasoning, the fit dialog.
// A SERVER page over the store (WP4c exposes no GET /api/jobseeker/postings/[id]; the
// layout is the gate and the point read binds the workspace), handing the client a
// PROJECTION (postingView.ts): the raw JSON-LD, the structured Job and the full
// MatchResult stay on the server; the page needs the body, the skill lists, the
// breakdown and the reasoning, and that is what crosses.
//
// The fit VERDICT crosses too. It is produced in an overlay, but it is the seeker's
// conclusion about this posting, so the page reads the latest CLOSED fit dialog for the
// row (`latestFitDialogForPosting`, workspace-bound) and renders it beside the match.
// While the overlay is open the client holds the newer one; this read is what survives
// the reload.
export const instant = false;

export default async function PostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const posting = getJobseekerPosting(id, ws);
  if (!posting) notFound();
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const source = getJobseekerSource(posting.sourceId, ws);
  const sourceLabel = source ? (catalogEntryForHost(source.host)?.label ?? source.host) : posting.sourceId;
  const attribution = source ? (catalogEntryForHost(source.host)?.attribution ?? null) : null;
  const settled = latestFitDialogForPosting(posting.id, ws);
  const fit = settled?.artifact && "verdict" in settled.artifact ? { artifact: settled.artifact, at: settled.updatedAt } : null;
  return (
    <PostingDetail
      view={postingDetailView(posting, sourceLabel, attribution)}
      salaryFloor={profile?.preferences.salaryFloor ?? null}
      profileId={profile?.id ?? null}
      fit={fit}
    />
  );
}
