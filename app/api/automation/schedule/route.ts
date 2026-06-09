import { NextRequest, NextResponse } from "next/server";
import { POLICY_JOB, getSchedule, listRuns, setEnabled, setIntervalMinutes } from "@/app/_lib/scheduler-store";
import { tickScheduler } from "@/app/_lib/scheduler";

export const runtime = "nodejs";

// Control surface for the automation clock: read status + recent runs, toggle it
// on/off, set the cadence, or force an immediate tick.
export async function GET() {
  return NextResponse.json({ schedule: getSchedule(), runs: listRuns(10) });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { enabled?: boolean; intervalMinutes?: number; tick?: boolean };
    if (body.intervalMinutes !== undefined && !Number.isFinite(body.intervalMinutes)) {
      return NextResponse.json({ error: "intervalMinutes must be a finite number." }, { status: 400 });
    }
    if (typeof body.intervalMinutes === "number") setIntervalMinutes(POLICY_JOB, body.intervalMinutes);
    if (typeof body.enabled === "boolean") setEnabled(POLICY_JOB, body.enabled);
    const tick = body.tick ? await tickScheduler({ force: true, trigger: "manual" }) : undefined;
    return NextResponse.json({ schedule: getSchedule(), runs: listRuns(10), tick });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
