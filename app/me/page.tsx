import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { listJobseekerSources } from "@/app/_lib/db/jobseeker-sources";
import { sourcesCatalog } from "@/app/_lib/jobseeker/sources-catalog";
import { SCAN_JOB_NAME } from "@/app/_lib/jobseeker/types";
import { listRuns } from "@/app/_lib/scheduler-store";
import { SieveFlow } from "@/app/features/jobseeker/sieve/SieveFlow";

// /me — the job seeker's flow, "The Sieve" (docs/features/jobseeker/README.md, "The
// flow"). The layout is the gate. SERVER-FIRST: this page reads everything the first
// frame needs — the seeker's row, the research catalog and THIS workspace's sources,
// and when a scan last ran — so the rail, the arrival and the sources lanes paint at
// once; the client then pages the postings in behind them.
//
// "When a scan last ran" is the later of the newest `jobseeker_scan` scheduler run for
// this workspace and the newest source run, and null when neither exists (the sieve
// then says "not scanned yet" rather than writing "never").
//
// `?open=<postingId>` lands on the Weigh step with that posting open — the address the
// old /me/jobs/[id] page redirects to.
export const instant = false;

export default async function MeHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, ws, params] = await Promise.all([currentSession(), currentWorkspace(), searchParams]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const sources = listJobseekerSources(ws);
  const lastRun = listRuns(1, SCAN_JOB_NAME, { workspace: ws })[0] ?? null;
  const lastSourceRunAt = sources.reduce<string | null>((newest, s) => (s.lastRunAt && (!newest || s.lastRunAt > newest) ? s.lastRunAt : newest), null);
  const lastScanAt = [lastRun?.finishedAt ?? lastRun?.startedAt ?? null, lastSourceRunAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const open = typeof params.open === "string" && params.open.length <= 64 ? params.open : null;
  return <SieveFlow initial={{ profile, sources, catalog: sourcesCatalog(), lastScanAt, openId: open }} />;
}
