import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentSession, requireCapability } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentUserId } from "@/app/_lib/auth/session";
import { advanceFeedAnchor, getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/jobseeker/profile/seen { at, id } — advance the seeker's feed anchor to the
// newest row the page actually RENDERED (docs/features/jobseeker/README.md, "Feed, fit
// dialog, sources UI"). The body is the ordering TUPLE the feed's keyset pager already
// uses, `(first_seen_at, id)`; the store refuses to move backwards, so a beacon that
// arrives out of order, a second tab closing, or a tuple from a page rendered minutes
// ago all land as "nothing to do" rather than rewinding the feed.
//
// The caller is a departure signal (visibilitychange → hidden, pagehide) or the explicit
// "mark all as seen" control, so this is called with a keepalive fetch or sendBeacon and
// its answer is often unread. It still answers the anchor as it stands, because the
// explicit control renders the result.
//
// Posture: operator-gated by the fail-closed proxy AND re-verified here, then the seat
// (a viewer may read the feed, not write the seeker's record), then the limiter — the
// order rate-limit-contract.test.ts pins. The user id comes from the session, never the
// body: a seeker cannot name whose anchor they move.
//
// Codes are reused, never minted: JOBSEEKER_PROFILE_MISSING for a workspace with no
// seeker record, APPLY_SELECTION_INVALID (with the `field`) for a malformed tuple.

const SEEN_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };
const MAX_TUPLE_CHARS = 64;

type SeenBody = { at?: unknown; id?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-feed-seen:${clientIpFrom(request.headers)}`, SEEN_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as SeenBody;
    // A timestamp this store can compare as a string: the ISO form every row carries.
    // Anything else would make the monotonic predicate compare nonsense.
    if (typeof body.at !== "string" || body.at.length > MAX_TUPLE_CHARS || Number.isNaN(Date.parse(body.at))) {
      return jsonRefusal("APPLY_SELECTION_INVALID", 400, { field: "at" });
    }
    if (typeof body.id !== "string" || body.id.length === 0 || body.id.length > MAX_TUPLE_CHARS) {
      return jsonRefusal("APPLY_SELECTION_INVALID", 400, { field: "id" });
    }
    const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
    const profile = getJobseekerProfile(currentUserId(session), ws);
    if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
    const anchor = advanceFeedAnchor(profile.id, { at: body.at, id: body.id }, ws);
    return NextResponse.json({ anchor });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/profile/seen", "JOBSEEKER_STORE_FAILED");
  }
}
