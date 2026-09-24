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

export const SCHEDULER_JOB_NAMES = [
  "policy_pass",
  "reminders",
  "jobseeker_scan",
  "interview_recording_retention",
  "gig_scan",
  "gig_sync",
] as const;
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
  // Opt-in interview-audio retention (spark ai-interview-parity, WP3). DAILY: the two
  // windows it enforces are measured in days (30 after the hiring decision, 180 after
  // the call), so a tighter cadence would spend a scan to learn the same thing.
  //
  // ON BY DEFAULT — the one exception beside `reminders`, and for a stronger reason:
  // this is a STATUTORY retention duty (storage limitation) over candidate audio the
  // candidate was PROMISED would be deleted, not a discretionary automation. A job
  // registered OFF would mean every deployment silently keeps recordings forever until
  // someone notices a toggle. (The read-time gate in the playback door is the backstop
  // for a clock that is nonetheless not running.) `fanOut: "none"`: one deployment-wide
  // sweep, scoping each write to the workspace the row names — the same shape as the
  // consent-expiry sweep.
  {
    name: "interview_recording_retention",
    labelKey: "interviewRecordingRetention",
    defaultIntervalMinutes: 1440,
    defaultEnabled: true,
    fanOut: "none",
    requiresVerifiedRun: false,
  },
  // Gigs (app/_lib/gigs): the listing scan over the workspace's enabled gig sources
  // (official APIs only - gigs/adapters). Same courtesy rule and cadence as the
  // job-seeker scan: twice a day, OFF, and not armable before one manual scan succeeded.
  { name: "gig_scan", labelKey: "gigScan", defaultIntervalMinutes: 720, defaultEnabled: false, fanOut: "per-workspace", requiresVerifiedRun: true },
  // Gigs: pull in-flight specialist runs from the local Personas app and land finished
  // drafts (gigs/sync.ts). Every 15 minutes - it asks a loopback app about rows kp
  // already holds, so there is no third party to be courteous to - but OFF by default:
  // a created schedule is not consent, and a deployment with no Personas pairing has
  // nothing to ask.
  { name: "gig_sync", labelKey: "gigSync", defaultIntervalMinutes: 15, defaultEnabled: false, fanOut: "per-workspace", requiresVerifiedRun: false },
];

export function schedulerJob(name: SchedulerJobName): SchedulerJobDef {
  const def = SCHEDULER_JOBS.find((j) => j.name === name);
  if (!def) throw new Error(`scheduler job not registered: ${name}`);
  return def;
}
