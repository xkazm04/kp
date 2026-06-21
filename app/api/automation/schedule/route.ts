import { NextRequest, NextResponse } from "next/server";
import {
  POLICY_JOB,
  REMINDERS_JOB,
  ensureReminderJob,
  getSchedule,
  listRuns,
  setEnabled,
  setIntervalMinutes,
  setRejectMode,
} from "@/app/_lib/scheduler-store";
import { tickScheduler } from "@/app/_lib/scheduler";
import { requireOperator } from "@/app/_lib/auth/require-operator";

export const runtime = "nodejs";

// AUTO6 — both registered jobs ride one payload: the policy pass (schedule/runs,
// the historical shape) plus the reminders job and its recent send/failure runs.
function schedulePayload() {
  return {
    schedule: getSchedule(),
    runs: listRuns(10),
    reminders: ensureReminderJob(),
    reminderRuns: listRuns(5, REMINDERS_JOB),
  };
}

// Control surface for the automation clock: read status + recent runs, toggle it
// on/off, set the cadence, or force an immediate tick.
export async function GET() {
  // Operator-only: exposes the automation clock state + recent run history.
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json(schedulePayload());
}

export async function POST(request: NextRequest) {
  // Operator-only: toggling the clock / forcing a tick arms autonomous outreach.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json()) as {
      enabled?: boolean;
      intervalMinutes?: number;
      tick?: boolean;
      // AUTO6 — pause/resume candidate reminder sends (the job defaults ON).
      remindersEnabled?: boolean;
      // AUTO1 — autonomy level for clock rejections (approve = queue for a human).
      rejectMode?: string;
    };
    if (body.intervalMinutes !== undefined && !Number.isFinite(body.intervalMinutes)) {
      return NextResponse.json({ error: "intervalMinutes must be a finite number." }, { status: 400 });
    }
    if (typeof body.intervalMinutes === "number") setIntervalMinutes(POLICY_JOB, body.intervalMinutes);
    if (typeof body.enabled === "boolean") setEnabled(POLICY_JOB, body.enabled);
    if (body.rejectMode !== undefined) {
      // AUTO1 retired (UAT M6 / GDPR Art. 22): "auto" (unattended reject) no longer
      // exists — rejections are always queued for a human. Accept the field for
      // back-compat but never store "auto"; coerce any value to "approve".
      setRejectMode(POLICY_JOB, "approve");
    }
    if (typeof body.remindersEnabled === "boolean") {
      ensureReminderJob(); // row exists with the right defaults before toggling
      setEnabled(REMINDERS_JOB, body.remindersEnabled);
    }
    const tick = body.tick ? await tickScheduler({ force: true, trigger: "manual" }) : undefined;
    return NextResponse.json({ ...schedulePayload(), tick });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
