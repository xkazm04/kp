// The scheduler JOB REGISTRY — one authority for "which named clock jobs exist".
//
// Until this file existed the two jobs (policy_pass, reminders) were named literally
// in four places: the clock (instrumentation-node.ts), the GET/POST payload of
// /api/automation/schedule, the SchedulerControl panel, and the catalogs. A third job
// meant editing all four and hoping they agreed. The registry is the wizard-flows
// rule applied to automations: navigation, indicator and commit derive from one list.
//
// WP0 pre-seed: the registry carries exactly today's two jobs so behaviour is
// unchanged; WP4 adds `jobseeker_scan` here and makes the route + panel iterate the
// list instead of naming jobs. Store-free on purpose (the browser bundle imports it
// for labels): the store is app/_lib/scheduler-store.ts.

export const SCHEDULER_JOB_NAMES = ["policy_pass", "reminders"] as const;
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
];

export function schedulerJob(name: SchedulerJobName): SchedulerJobDef {
  const def = SCHEDULER_JOBS.find((j) => j.name === name);
  if (!def) throw new Error(`scheduler job not registered: ${name}`);
  return def;
}
