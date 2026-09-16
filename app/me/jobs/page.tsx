import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { listJobseekerSources } from "@/app/_lib/db/jobseeker-sources";
import { catalogEntryForHost } from "@/app/_lib/jobseeker/sources-catalog";
import { SCAN_JOB_NAME } from "@/app/_lib/jobseeker/types";
import { listRuns } from "@/app/_lib/scheduler-store";
import { JobsFeed, type FeedSource } from "@/app/features/jobseeker/JobsFeed";

// /me/jobs — the feed (docs/features/jobseeker/README.md, "Feed, fit dialog, sources
// UI"). The layout is the gate. This server page reads the CHAIN FACTS the feed's
// empty state needs (a profile exists · a source is enabled · a scan ever ran) plus the
// source labels for the filter, and the client feed fetches the rows itself.
export const instant = false;

export default async function JobsPage() {
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const sources = listJobseekerSources(ws);
  const feedSources: FeedSource[] = sources.map((s) => ({ id: s.id, label: catalogEntryForHost(s.host)?.label ?? s.host }));
  // "A scan ran" is per workspace: a source of THIS workspace carries a lastRunAt, or
  // the manual scan task recorded a run (which it does only when a source ran).
  const hasScanned = sources.some((s) => s.lastRunAt !== null) || listRuns(1, SCAN_JOB_NAME, { workspace: ws }).length > 0;
  return <JobsFeed chain={{ hasProfile: profile !== null, enabledSources: sources.filter((s) => s.enabled).length, hasScanned }} sources={feedSources} />;
}
