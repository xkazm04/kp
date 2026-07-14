import { NextResponse } from "next/server";
import { countPipelineEvents, listPipelineEvents } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { DECISION_META } from "@/app/_lib/decision-attribution";


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

// ANA5 — resolve the optional ?kind=/?attribution= params to a kind set, both
// allow-listed against the shared decision-attribution map (an invalid value
// falls back to unfiltered, never an error). A specific kind wins over the
// broader attribution bucket when both are sent.
function resolveKindFilter(kindRaw: string | null, attributionRaw: string | null): string[] | undefined {
  if (kindRaw && kindRaw in DECISION_META) return [kindRaw];
  if (attributionRaw === "auto" || attributionRaw === "human") {
    return Object.entries(DECISION_META)
      .filter(([, meta]) => meta.auto === (attributionRaw === "auto"))
      .map(([kind]) => kind);
  }
  return undefined;
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
    const kinds = resolveKindFilter(searchParams.get("kind"), searchParams.get("attribution"));
    // P1 — the decision log is a per-team audit trail; scope both the count and
    // the page to the caller's workspace (previously unscoped → every team saw
    // the default workspace's trail).
    const ws = await currentWorkspace();
    const total = countPipelineEvents(kinds, ws);
    const decisions = listPipelineEvents(limit, offset, kinds, ws);
    const nextOffset = offset + decisions.length;
    return NextResponse.json({ decisions, total, hasMore: nextOffset < total, nextOffset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the decision log.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
