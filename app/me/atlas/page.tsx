import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { listJobseekerSources } from "@/app/_lib/db/jobseeker-sources";
import { sourcesCatalog } from "@/app/_lib/jobseeker/sources-catalog";
import { SCAN_JOB_NAME } from "@/app/_lib/jobseeker/types";
import { listRuns } from "@/app/_lib/scheduler-store";
import { AtlasFlow } from "@/app/features/jobseeker/atlas/AtlasFlow";

// /me/atlas — the job seeker's flow as THE SKY ATLAS (docs/features/jobseeker/README.md, "The Sky
// Atlas"; the contest winner me-hub A/3): a second VIEW of the same search, beside the Sieve at /me.
// It reads exactly what /me reads (the seeker's row, the research catalog, THIS workspace's sources
// and when a scan last ran) and hands it to a client that pages the postings in behind the first
// frame; every action it offers goes through the same /api/jobseeker routes the Sieve uses. The
// layout (app/me/layout.tsx) is the gate: the module flag, the operator check, the error boundary.
//
// `?open=<postingId>` lands on that posting weighed over the sky, once the market is open.
export const instant = false;

export default async function MeAtlasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, ws, params] = await Promise.all([currentSession(), currentWorkspace(), searchParams]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const sources = listJobseekerSources(ws);
  const lastRun = listRuns(1, SCAN_JOB_NAME, { workspace: ws })[0] ?? null;
  const lastSourceRunAt = sources.reduce<string | null>((newest, s) => (s.lastRunAt && (!newest || s.lastRunAt > newest) ? s.lastRunAt : newest), null);
  const lastScanAt = [lastRun?.finishedAt ?? lastRun?.startedAt ?? null, lastSourceRunAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const open = typeof params.open === "string" && params.open.length <= 64 ? params.open : null;
  return <AtlasFlow initial={{ profile, sources, catalog: sourcesCatalog(), lastScanAt, openId: open }} />;
}
