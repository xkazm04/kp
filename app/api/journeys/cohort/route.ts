import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { journeyCohort } from "@/app/_lib/journey/project";

// GET /api/journeys/cohort  ->  JourneyCohort (app/_lib/journey/types.ts)
//
// The cohort layer above the journey board: every journey in the workspace, bounded by
// the projection's scan cap, as ordered step kinds with times and actor class. No
// candidate label and no facts travel - the board is where a person meets candidates.
// A PROJECTION - this route writes nothing.
//
// AUTH / TENANCY: the board's own posture (see ../route.ts): `currentWorkspace()`
// behind the app's fail-closed gate, no public-routes entry.
//
// THROTTLE: one request reads the whole workspace, so it is pinned tighter than the
// board's paged read.
const JOURNEY_COHORT_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export async function GET(request: Request) {
  try {
    if (!rateLimit(`journeys-cohort:${clientIpFrom(request.headers)}`, JOURNEY_COHORT_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const workspaceId = await currentWorkspace();
    return NextResponse.json(journeyCohort({ workspaceId }));
  } catch (error) {
    return safeJsonError(error, "api:journeys:cohort", "PIPELINE_TIMELINE_FAILED");
  }
}
