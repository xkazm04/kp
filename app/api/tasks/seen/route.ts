import { NextRequest, NextResponse } from "next/server";
import { markTasksSeen } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

// POST { ids: string[] } — acknowledge finished tasks (read/unread). Stamps
// seen_at on the given TERMINAL rows; active rows are ignored so a finish that
// lands after the ack still counts as unread. The Background-tasks tab calls
// this after the rows have actually been on screen (a short dwell), so the
// TasksIndicator badge clears only for outcomes the recruiter has really seen.
const MAX_IDS = 200;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_IDS)
      : [];
    if (ids.length === 0) return NextResponse.json({ seen: 0 });
    // Scoped so an ack can only clear THIS team's unread flags — the store already
    // filters on it, the route just never supplied one.
    return NextResponse.json({ seen: markTasksSeen(ids, await currentWorkspace()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to mark tasks seen." },
      { status: 500 }
    );
  }
}
