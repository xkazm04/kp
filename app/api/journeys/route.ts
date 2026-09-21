import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { JOURNEY_DEFAULT_LIMIT, JOURNEY_MAX_LIMIT, journeyBoard } from "@/app/_lib/journey/project";

// GET /api/journeys?role=<jobId>&active=1&limit=&offset=  ->  JourneyBoard (app/_lib/journey/types.ts)
//
// The journey board: one column per candidate, grouped into role clusters, over the
// five append-only logs kp already keeps. A PROJECTION — this route writes nothing.
//
// PAGED BY COLUMN, not by event. A role with 45 candidates is 45 columns and the
// client asks for them 20 at a time, exactly as the sibling decision log pages its
// trail; `totals` describes the WHOLE (filtered) workspace beside it, so the two
// numbers never have to stand in for each other.
//
// AUTH / TENANCY: the posture of its sibling /api/analytics — `currentWorkspace()`
// and no `requireOperator()`, because this is a read of the operator's own analytics
// surface behind the app's fail-closed gate (public-routes.ts does not list it).
//
// THROTTLE: the board reads several bounded tables plus the sealed-decision store per
// request, so a scripted scan is pinned the same way /api/analytics/decisions pins
// its own. 120/10min per IP is generous for a reader paging a large cohort and
// useless to a script.
const JOURNEY_BOARD_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };

/** A query param that must be a number in range. A missing, non-numeric or
 *  out-of-range value falls back to a safe default rather than letting a bad client
 *  param page off the end or pull the whole workspace in one request. Same defensive
 *  posture as /api/analytics/decisions' clampInt. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** The role filter is a job id, which is what the board clusters on. Bounded so a
 *  hostile query string cannot become an unbounded bound parameter. */
const MAX_ROLE_PARAM = 120;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), JOURNEY_DEFAULT_LIMIT, 1, JOURNEY_MAX_LIMIT);
    const offset = clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const role = (searchParams.get("role") ?? "").trim().slice(0, MAX_ROLE_PARAM) || undefined;
    const activeOnly = searchParams.get("active") === "1";
    if (!rateLimit(`journeys:${clientIpFrom(request.headers)}`, JOURNEY_BOARD_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const workspaceId = await currentWorkspace();
    return NextResponse.json(journeyBoard({ workspaceId, role, activeOnly, limit, offset }));
  } catch (error) {
    // Reads across pipeline_entries, four audit logs and the isolated decision store:
    // a locked file, a constraint string or the absolute db path would otherwise reach
    // the board. The code travels; the message does not.
    return safeJsonError(error, "api:journeys", "PIPELINE_TIMELINE_FAILED");
  }
}
