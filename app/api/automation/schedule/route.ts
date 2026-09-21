import { NextRequest, NextResponse } from "next/server";
import {
  POLICY_JOB,
  REMINDERS_JOB,
  ensureRegisteredSchedule,
  ensureReminderJob,
  getSchedule,
  hasVerifiedRun,
  listRuns,
  setEnabled,
  setIntervalMinutes,
} from "@/app/_lib/scheduler-store";
import { SCHEDULER_JOBS, isSchedulerJobName, schedulerJob, type SchedulerJobName } from "@/app/_lib/scheduler-jobs";
import { tickScheduler } from "@/app/_lib/scheduler";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { ensureDb } from "@/app/_lib/db/core";
import { schedulerLiveness, schedulerLivenessReason } from "@/app/_lib/scheduler-health";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// Forcing a tick runs a FULL policy pass — a Python-spawning sweep over every
// active entry that drafts outreach and mutates the board. It is operator-gated,
// but open mode (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op
// for the whole API, so the limiter is the real bound. 10/10min per IP: a pass
// takes minutes, so ten is far above any human "Run now" pace and well below a
// scripted loop's. The GET (status + history) and the cheap config writes are
// deliberately NOT throttled — they spawn nothing.
const SCHEDULE_TICK_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };

// How many recent runs each job's history carries. The policy pass has always
// shipped ten (each row holds the per-candidate decision list the history panel
// unrolls); every other job is a one-line sweep and five is plenty to read a trend.
const POLICY_RUNS = 10;
const JOB_RUNS = 5;

// WP4a — every REGISTERED job (scheduler-jobs.ts) rides one payload as `jobs[]`, and
// the two historical jobs ALSO keep their legacy fields (`schedule`/`runs` for the
// policy pass, `reminders`/`reminderRuns`) with their old names and meanings, so
// the sim dock, older panels and the tenancy source guards keep reading what they
// always read. A third job is a registry entry, not a fourth payload field.
//
// TENANCY (phase 1): the CLOCK is global on purpose (one sweep, one schedule row —
// see the header of scheduler-store.ts), and the operator gate above is what makes
// that blast radius legitimate. The run log's DECISION ROWS are not: they carry the
// candidate labels and rejection reasons of every team the sweep touched, so they are
// filtered to the caller's own workspace here. `scheduleScope` says out loud that the
// toggle the UI renders is installation-wide; `decisionsWorkspace` (per run) says
// which tenant the rows were narrowed to, next to a summary that stays global.
async function schedulePayload() {
  const workspace = await currentWorkspace();
  const jobs = SCHEDULER_JOBS.map((job) => ({
    name: job.name,
    labelKey: job.labelKey,
    schedule: ensureRegisteredSchedule(job),
    runs: listRuns(job.name === POLICY_JOB ? POLICY_RUNS : JOB_RUNS, job.name, { workspace }),
    requiresVerifiedRun: job.requiresVerifiedRun,
    // "At least one run the store marked ok" — the only thing that arms a
    // requiresVerifiedRun job (hasVerifiedRun); the panel disables the toggle on false.
    verified: hasVerifiedRun(job.name),
  }));
  return {
    schedule: getSchedule(),
    runs: listRuns(10, POLICY_JOB, { workspace }),
    reminders: ensureReminderJob(),
    reminderRuns: listRuns(5, REMINDERS_JOB, { workspace }),
    jobs,
    scheduleScope: "global" as const,
    decisionsWorkspace: workspace,
    ...clockLiveness(),
  };
}

// LIVENESS (/perfect 2026-09-03, pipeline-board-3). `schedule.enabled` is a stored
// FLAG — the clock is ARMED. Whether the tick chain is still ALIVE is a separate
// signal that schedulerLiveness() has judged from the heartbeat since
// bug-ui-scan-2026-07-09, and until now ONLY /api/health and /api/ops consumed it:
// the control surface an operator actually uses showed a green "On" over a chain
// that had stopped ticking. The same single indexed read those two probes do, so the
// toolbar can render armed and alive as the two different facts they are.
function clockLiveness() {
  try {
    const beat = ensureDb()
      .prepare(`SELECT last_tick_at FROM scheduler_heartbeat WHERE id = 'clock'`)
      .get() as { last_tick_at?: string } | undefined;
    const lastTickAt = beat?.last_tick_at ?? null;
    const liveness = schedulerLiveness(Date.now(), lastTickAt ? Date.parse(lastTickAt) : null, process.uptime() * 1000);
    return { liveness, livenessReason: schedulerLivenessReason(liveness, lastTickAt), lastTickAt };
  } catch (error) {
    // Best-effort: liveness is a decoration on a payload whose primary job is the
    // schedule itself. A heartbeat read that fails must not take the control bar
    // down with it — the client renders no chip for a null liveness — but an
    // operator would want to know, so it is logged rather than swallowed.
    console.error("[api/automation/schedule] heartbeat read failed", error);
    return { liveness: null, livenessReason: null, lastTickAt: null };
  }
}

// Control surface for the automation clock: read status + recent runs, toggle it
// on/off, set the cadence, or force an immediate tick.
export async function GET() {
  // Operator-only: exposes the automation clock state + recent run history.
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json(await schedulePayload());
}

export async function POST(request: NextRequest) {
  // Operator-only: toggling the clock / forcing a tick arms autonomous outreach.
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above only
  // proves a trusted session is present — in open mode it is true for everyone —
  // so it is identity, never authority. This write is a recruiter operation: ask
  // the seat for `pipeline:write`, so a viewer is refused with a code instead of
  // silently mutating the board.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    // WP4a — two body shapes, one writer. The NEW shape names the job:
    //   { job, enabled?, intervalMinutes?, tick? }
    // The LEGACY shape (every existing caller) names none, and keeps meaning what it
    // always meant: `enabled`/`intervalMinutes`/`tick` are the policy pass,
    // `remindersEnabled` is `{ job: "reminders", enabled }`. Both may ride one body.
    const body = (await request.json()) as {
      job?: unknown;
      enabled?: boolean;
      intervalMinutes?: number;
      tick?: boolean;
      // AUTO6 — pause/resume candidate reminder sends (the job defaults ON).
      remindersEnabled?: boolean;
    };
    // A CODED refusal, not prose: the dock resolves errors.SCHEDULE_INTERVAL_INVALID
    // in the reader's language instead of painting the server's English string.
    if (body.intervalMinutes !== undefined && !Number.isFinite(body.intervalMinutes)) {
      return jsonRefusal("SCHEDULE_INTERVAL_INVALID", 400);
    }
    // A job the registry does not carry. The closest existing code, not a new one:
    // AUTOMATION_TASK_UNKNOWN ("that automation step does not exist") is the
    // vocabulary the [task] door already uses for an unregistered automation name.
    if (body.job !== undefined && !isSchedulerJobName(body.job)) {
      return jsonRefusal("AUTOMATION_TASK_UNKNOWN", 400);
    }
    const job: SchedulerJobName = body.job === undefined ? POLICY_JOB : body.job;
    // "Run now" is a POLICY-PASS door (tickScheduler owns that job's forced run, its
    // off-means-off refusal and its single-flight). No other job offers a manual
    // tick here — refused with the existing AUTOMATION_TASK_NOT_OFFERED rather than
    // a new code the catalogs would have to learn.
    if (body.tick && job !== POLICY_JOB) {
      return jsonRefusal("AUTOMATION_TASK_NOT_OFFERED", 400);
    }
    // After the cheap refusals and before ANY write, so a malformed body neither
    // consumes budget nor is masked by the throttle.
    if (body.tick && !rateLimit(`schedule-tick:${clientIpFrom(request.headers)}`, SCHEDULE_TICK_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // A job that must be proven by hand first (requiresVerifiedRun) cannot be armed
    // before one run the store marked ok exists. 409: the request is well-formed, the
    // resource's state is what refuses it, and a successful manual scan clears it.
    if (body.enabled === true && schedulerJob(job).requiresVerifiedRun && !hasVerifiedRun(job)) {
      return jsonRefusal("JOBSEEKER_SCAN_UNVERIFIED", 409);
    }
    ensureRegisteredSchedule(schedulerJob(job)); // the row exists with the right defaults before any write
    if (typeof body.intervalMinutes === "number") setIntervalMinutes(job, body.intervalMinutes);
    if (typeof body.enabled === "boolean") setEnabled(job, body.enabled);
    if (typeof body.remindersEnabled === "boolean") {
      ensureReminderJob(); // row exists with the right defaults before toggling
      setEnabled(REMINDERS_JOB, body.remindersEnabled);
    }
    const tick = body.tick ? await tickScheduler({ force: true, trigger: "manual" }) : undefined;
    return NextResponse.json({ ...(await schedulePayload()), tick });
  } catch (error) {
    // The thrown error here is a better-sqlite3 / spawned-pass exception: it quotes
    // the db file path, SQLite constraint text and Python tracebacks. Server log
    // keeps the detail; the client gets the code.
    return safeJsonError(error, "api:automation/schedule", "SCHEDULE_UPDATE_FAILED");
  }
}
