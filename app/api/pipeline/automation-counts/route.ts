import { NextResponse } from "next/server";
import { automationCountsSince } from "@/app/_lib/db/automation-counts";
import { AUTOMATION_COUNT_WINDOW_DAYS } from "@/app/_lib/automation-counts";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";

// The Pipeline overview's "automated actions this week": measured counts only, scoped to the caller's
// workspace. Same posture as the sibling /api/pipeline/events read (aggregate counts, no identities).
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const counts = automationCountsSince(Date.now(), AUTOMATION_COUNT_WINDOW_DAYS, ws);
    return NextResponse.json({ ...counts, days: AUTOMATION_COUNT_WINDOW_DAYS });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:automation-counts", "PIPELINE_EVENTS_FAILED");
  }
}
