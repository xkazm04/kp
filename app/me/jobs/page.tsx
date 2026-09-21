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
  // The same two facts answer "has a scan ever run" and "when": the newest scheduler run
  // for this workspace, else the newest source run — the header states the later of them
  // and stays silent when neither exists rather than writing "never".
  const lastRun = listRuns(1, SCAN_JOB_NAME, { workspace: ws })[0] ?? null;
  const lastSourceRunAt = sources.reduce<string | null>((newest, s) => (s.lastRunAt && (!newest || s.lastRunAt > newest) ? s.lastRunAt : newest), null);
  const lastScanAt = [lastRun?.finishedAt ?? lastRun?.startedAt ?? null, lastSourceRunAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const hasScanned = lastScanAt !== null;
  // `countries` rides with the chain (not a client fetch): the `no_sources` state offers
  // one click that enables EURES for the seeker's OWN markets, and the button has to be
  // able to NAME them before it is pressed.
  return (
    <JobsFeed
      chain={{
        hasProfile: profile !== null,
        enabledSources: sources.filter((s) => s.enabled).length,
        hasScanned,
        countries: profile?.preferences.countries ?? [],
        lastScanAt,
      }}
      sources={feedSources}
    />
  );
}
