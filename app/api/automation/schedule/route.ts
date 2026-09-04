import { NextRequest, NextResponse } from "next/server";
import {
  POLICY_JOB,
  REMINDERS_JOB,
  ensureReminderJob,
  getSchedule,
  listRuns,
  setEnabled,
  setIntervalMinutes,
} from "@/app/_lib/scheduler-store";
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

// AUTO6 — both registered jobs ride one payload: the policy pass (schedule/runs,
// the historical shape) plus the reminders job and its recent send/failure runs.
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
  return {
    schedule: getSchedule(),
    runs: listRuns(10, POLICY_JOB, { workspace }),
    reminders: ensureReminderJob(),
    reminderRuns: listRuns(5, REMINDERS_JOB, { workspace }),
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
    const body = (await request.json()) as {
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
    // After the cheap refusal and before ANY write, so a malformed body neither
    // consumes budget nor is masked by the throttle.
    if (body.tick && !rateLimit(`schedule-tick:${clientIpFrom(request.headers)}`, SCHEDULE_TICK_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    if (typeof body.intervalMinutes === "number") setIntervalMinutes(POLICY_JOB, body.intervalMinutes);
    if (typeof body.enabled === "boolean") setEnabled(POLICY_JOB, body.enabled);
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
