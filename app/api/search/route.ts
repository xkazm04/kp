import { NextResponse } from "next/server";
import { searchEntities } from "@/app/_lib/db/analytics";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// SHELL1 — the command palette's cross-entity search. Read-only LIKE lookup
// across profiles / pipeline entries / jobs / saved JDs / analyses (capped per
// type in searchEntities); the palette maps each hit's type to its deep link.
// Input is bounded BEFORE it reaches SQL: a sub-minimum query returns an empty
// result (not an error — the palette clears as the user deletes), and an
// over-long one is truncated, never rejected mid-keystroke.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 64;

// Per-client throttle (/perfect wave 17, api-workspace). One hit here is FIVE
// `LIKE '%q%'` scans - leading wildcards, so SQLite can use no index on any of them
// and every one is a full table walk over profiles / pipeline_entries / jds / jobs /
// analyses. That is the most expensive read per byte of input in the app, it takes an
// unauthenticated path in open mode (KP_OPERATOR_PASSWORD gates nothing there), and it
// had no limiter at all.
//
// THE BUDGET IS DELIBERATELY HUGE, and the reason is the shared-bucket trap documented
// on `clientIpFrom`: with KP_TRUSTED_PROXY unset - the default for a directly-exposed
// self-host - every caller resolves to SHARED_CLIENT_KEY, so `search:local` is ONE
// bucket for the entire deployment. Unlike an apply or a login door, a tripped bucket
// here DENIES A FEATURE to every colleague at once, and the palette is a navigation
// primitive. 3000 / 10 min is 5 requests a second for the whole box: a twenty-person
// team typing into the palette all window cannot reach it (the client debounces), while
// a scripted scan crosses it in seconds. A ceiling people cannot plausibly hit is the
// only kind this route may carry.
const SEARCH_RATE_LIMIT = { limit: 3000, windowMs: 10 * 60_000 };

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    // BEFORE the limiter: a sub-minimum query runs no SQL, and the palette clears
    // itself by sending them as the user deletes - charging for that would spend the
    // window on the cheapest possible request (the contract's servedBefore).
    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ results: [] });
    }
    if (!rateLimit(`search:${clientIpFrom(request.headers)}`, SEARCH_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    return NextResponse.json({ results: searchEntities(q, 5, await currentWorkspace()) });
  } catch (error) {
    return safeJsonError(error, "api:search", "SEARCH_FAILED");
  }
}
