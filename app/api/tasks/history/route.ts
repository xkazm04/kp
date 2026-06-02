import { NextResponse } from "next/server";
import { countTaskHistory, listTaskHistory } from "@/app/_lib/db";
import { recentTaskCutoffIso } from "@/app/_lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Parse an offset/limit query param defensively: a missing, non-numeric, or
// out-of-range value falls back to a safe default rather than paging off the end
// or pulling the whole history in one request.
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// Offset-paged history of finished tasks older than the recent window. The
// Background-tasks tab loads this 20 at a time once the user opts into "show
// history", so the full (potentially huge) trail is never pulled at once. Shape
// mirrors /api/analytics/decisions: hasMore/nextOffset chain the pages, total
// powers the "showing X of Y" footer.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const before = recentTaskCutoffIso();
    const total = countTaskHistory(before);
    const tasks = listTaskHistory(before, limit, offset);
    const nextOffset = offset + tasks.length;
    return NextResponse.json({ tasks, total, hasMore: nextOffset < total, nextOffset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load task history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
