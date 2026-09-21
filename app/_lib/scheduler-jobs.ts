// The scheduler JOB REGISTRY — one authority for "which named clock jobs exist".
//
// Until this file existed the two jobs (policy_pass, reminders) were named literally
// in four places: the clock (instrumentation-node.ts), the GET/POST payload of
// /api/automation/schedule, the SchedulerControl panel, and the catalogs. A third job
// meant editing all four and hoping they agreed. The registry is the wizard-flows
// rule applied to automations: navigation, indicator and commit derive from one list.
//
// WP4a: the route (/api/automation/schedule), the clock loop (instrumentation-node.ts)
// and the SchedulerControl panel iterate THIS list; the only job named literally
// anywhere is `policy_pass`, because tickScheduler owns its run path (the forced
// "Run now" tick, the single-flight pass) and the legacy payload fields keep their
// names for old callers. `jobseeker_scan` is registered here DISABLED and unwired —
// WP4c hands it a real handler; until then the clock records its (never-due) run as
// `skipped`. Store-free on purpose (the browser bundle imports it for labels): the
// store is app/_lib/scheduler-store.ts.

export const SCHEDULER_JOB_NAMES = ["policy_pass", "reminders", "jobseeker_scan"] as const;
export type SchedulerJobName = (typeof SCHEDULER_JOB_NAMES)[number];

export function isSchedulerJobName(v: unknown): v is SchedulerJobName {
  return typeof v === "string" && (SCHEDULER_JOB_NAMES as readonly string[]).includes(v);
}

export type SchedulerJobDef = {
  name: SchedulerJobName;
  /** Catalog key under `pipeline.scheduler.job.<labelKey>` (camelCase of the name). */
  labelKey: string;
  defaultIntervalMinutes: number;
  /** Whether `ensureSchedule` creates the row ON. New jobs default OFF (a created
   *  schedule is not consent to run tonight); reminders is the documented exception. */
  defaultEnabled: boolean;
  /** Schedules are deployment-global rows (scheduler-store.ts:11-25); a job whose WORK
   *  fans out per tenant says so here so the run log can be filtered per workspace. */
  fanOut: "none" | "per-workspace";
  /** Jobs that must not be enabled before a manual run succeeded (a crawler cadence
   *  is a courtesy decision — verify first). */
  requiresVerifiedRun: boolean;
};

export const SCHEDULER_JOBS: readonly SchedulerJobDef[] = [
  { name: "policy_pass", labelKey: "policyPass", defaultIntervalMinutes: 15, defaultEnabled: false, fanOut: "per-workspace", requiresVerifiedRun: false },
  { name: "reminders", labelKey: "reminders", defaultIntervalMinutes: 1, defaultEnabled: true, fanOut: "per-workspace", requiresVerifiedRun: false },
  // Twice a day: a job board changes on a human cadence, and a crawler that asks more
  // often is discourteous to the source without learning anything new. OFF until one
  // manual scan succeeded (requiresVerifiedRun) — the route refuses to arm it before
  // that with JOBSEEKER_SCAN_UNVERIFIED (409).
  { name: "jobseeker_scan", labelKey: "jobseekerScan", defaultIntervalMinutes: 720, defaultEnabled: false, fanOut: "per-workspace", requiresVerifiedRun: true },
];

export function schedulerJob(name: SchedulerJobName): SchedulerJobDef {
  const def = SCHEDULER_JOBS.find((j) => j.name === name);
  if (!def) throw new Error(`scheduler job not registered: ${name}`);
  return def;
}
