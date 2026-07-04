import { NextResponse } from "next/server";
import { listScheduleInvites } from "@/app/_lib/schedule-store";
import { safeJsonError } from "@/app/_lib/api-response";


// W6-3 (SCH1) — the recruiter's read over the invite lifecycle. The store
// deliberately persists operator flags ("recruiter must open more times",
// "booked but the pipeline didn't advance") that previously terminated in a
// server console; this serves them to the Schedule tab's lifecycle panel
// along with the booked agenda and un-booked invites.
export async function GET() {
  try {
    return NextResponse.json({ invites: listScheduleInvites() });
  } catch (error) {
    return safeJsonError(error, "api:schedule", "SCHEDULE_LOOKUP_FAILED");
  }
}
