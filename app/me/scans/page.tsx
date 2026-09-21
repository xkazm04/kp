import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { listJobseekerSources } from "@/app/_lib/db/jobseeker-sources";
import { catalogEntryForHost } from "@/app/_lib/jobseeker/sources-catalog";
import { SCAN_JOB_NAME } from "@/app/_lib/jobseeker/types";
import { schedulerJob } from "@/app/_lib/scheduler-jobs";
import { ensureRegisteredSchedule, hasVerifiedRun, listRuns, type SchedulerRun as StoredRun } from "@/app/_lib/scheduler-store";
import type { SchedulerJobView, SchedulerRun } from "@/app/features/hiring/pipeline/SchedulerSummaryBadges";
import { ScansPage } from "@/app/features/jobseeker/ScansPage";

// /me/scans — the seeker's view of the shared scheduler registry's `jobseeker_scan`
// job (docs/features/jobseeker/README.md, "Scheduler"). The layout is the gate.
//
// SERVER-FIRST, the shape /me and /me/jobs already use: the clock row, its recent runs
// and the source labels the history names are read here and handed down as `initial`,
// so the clock frame and the run list paint on the first frame instead of the grey
// panel skeleton this page used to flash on every navigation (loading-choreography.md:
// "chrome always renders", "no skeletons").
//
// The client still owns every write (enable, cadence, "Scan now") and re-reads
// /api/automation/schedule in the background, which is what keeps a running scan's
// history current without the page ever blanking.
export const instant = false;

// The same window the API route gives a registry job — five one-line sweeps is enough
// to read a trend, and the two must not disagree about what "recent" means.
const JOB_RUNS = 5;

/** The store types `summary` and `decisions` as `unknown` on purpose (free-form JSON
 *  columns); the client view names their shapes. This is the same narrowing the API
 *  route performs implicitly by round-tripping the row through JSON. */
function toRunView(r: StoredRun): SchedulerRun {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    summary: r.summary as SchedulerRun["summary"],
    decisions: r.decisions as SchedulerRun["decisions"],
    decisionCount: r.decisionCount,
    decisionsWorkspace: r.decisionsWorkspace,
    error: r.error,
    startedAt: r.startedAt,
  };
}

export default async function MeScansPage() {
  const ws = await currentWorkspace();
  const def = schedulerJob(SCAN_JOB_NAME);
  // `ensureRegisteredSchedule`, not `getSchedule`: the row must be created with the
  // REGISTRY's defaults (off, twice a day, verification required), never the policy
  // pass's — the same door /api/automation/schedule opens.
  const schedule = ensureRegisteredSchedule(def);
  const job: SchedulerJobView = {
    name: SCAN_JOB_NAME,
    labelKey: def.labelKey,
    schedule: {
      enabled: schedule.enabled,
      intervalMinutes: schedule.intervalMinutes,
      lastRunAt: schedule.lastRunAt,
      lastSummary: schedule.lastSummary as SchedulerJobView["schedule"]["lastSummary"],
    },
    runs: listRuns(JOB_RUNS, SCAN_JOB_NAME, { workspace: ws }).map(toRunView),
    requiresVerifiedRun: def.requiresVerifiedRun,
    verified: hasVerifiedRun(SCAN_JOB_NAME),
  };
  // The history names a source by its catalog label; reading the labels here is what
  // lets the table say "Greenhouse" on the first frame instead of an opaque stored id.
  const sources = listJobseekerSources(ws);
  return (
    <ScansPage
      initialJob={job}
      initialSources={sources}
      initialLabels={sources.map((s) => [s.id, catalogEntryForHost(s.host)?.label ?? s.host] as [string, string])}
    />
  );
}
