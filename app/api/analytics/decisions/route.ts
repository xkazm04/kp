import { NextResponse } from "next/server";
import { countPipelineEvents, listPipelineEvents } from "@/app/_lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Parse an offset/limit query param defensively: a missing, non-numeric, or
// out-of-range value falls back to a safe default rather than letting a bad
// client param page off the end or pull the whole table in one request.
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// Cursor-by-offset page of the decision log. The analytics tab loads this 20 at
// a time on scroll so the full audit trail is never pulled into the client at
// once. `hasMore`/`nextOffset` let the client chain pages without re-deriving
// the math, and `total` powers the "showing X of Y" footer.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const total = countPipelineEvents();
    const decisions = listPipelineEvents(limit, offset);
    const nextOffset = offset + decisions.length;
    return NextResponse.json({ decisions, total, hasMore: nextOffset < total, nextOffset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the decision log.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
