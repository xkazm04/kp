import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { acknowledgeGigSource, getGigSource, pauseGigSource, resumeGigSource } from "@/app/_lib/db/gigs-sources";
import { gigCatalogEntry, gigSourceTermsCurrent } from "@/app/_lib/gigs/sources-catalog";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// PATCH /api/gigs/sources/[id] - the operator's controls on one source:
//   { action: "acknowledge", termsHash }  tier B: record the acknowledgement of the terms
//                                         summary AS IT READS NOW. A hash that is not the
//                                         catalog's current one -> 409
//                                         GIG_SOURCE_TERMS_CHANGED with the current
//                                         `termsHash` (the panel re-shows the summary).
//                                         Enables the source and lifts a `terms_review`
//                                         pause - and only that pause. Tier A has nothing
//                                         to acknowledge (409 GIG_ACTION_NOT_ALLOWED).
//   { action: "pause" }                   paused `owner`.
//   { action: "resume" }                  lifts any pause (and the invalid streak); a
//                                         tier-B source whose acknowledgement is missing
//                                         or stale -> 409 GIG_SOURCE_TERMS_REQUIRED.

const ACTIONS = ["acknowledge", "pause", "resume"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-sources-write:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; termsHash?: unknown };
    if (typeof body.action !== "string" || !(ACTIONS as readonly string[]).includes(body.action)) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "action", allowed: ACTIONS });
    }
    const ws = await currentWorkspace();
    const source = getGigSource(ws, id);
    if (!source) return jsonRefusal("GIG_SOURCE_NOT_FOUND", 404);
    const currentHash = gigCatalogEntry(source.adapter).termsHash;

    if (body.action === "acknowledge") {
      if (source.tier !== "B" || currentHash === null) return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { tier: source.tier });
      if (typeof body.termsHash !== "string" || body.termsHash !== currentHash) {
        return jsonRefusal("GIG_SOURCE_TERMS_CHANGED", 409, { termsHash: currentHash });
      }
      const acked = acknowledgeGigSource(ws, id, currentHash);
      if (!acked) return jsonRefusal("GIG_SOURCE_NOT_FOUND", 404);
      return NextResponse.json({ source: { ...acked, termsCurrent: gigSourceTermsCurrent(acked) } });
    }

    if (body.action === "pause") {
      const paused = pauseGigSource(ws, id, "owner");
      if (!paused) return jsonRefusal("GIG_SOURCE_NOT_FOUND", 404);
      return NextResponse.json({ source: { ...paused, termsCurrent: gigSourceTermsCurrent(paused) } });
    }

    // resume: a stale acknowledgement is not consent to the terms as they read now.
    if (!gigSourceTermsCurrent(source)) return jsonRefusal("GIG_SOURCE_TERMS_REQUIRED", 409, { termsHash: currentHash });
    const resumed = resumeGigSource(ws, id);
    if (!resumed.ok) {
      return resumed.reason === "not_found"
        ? jsonRefusal("GIG_SOURCE_NOT_FOUND", 404)
        : jsonRefusal("GIG_SOURCE_TERMS_REQUIRED", 409, { termsHash: currentHash });
    }
    return NextResponse.json({ source: { ...resumed.source, termsCurrent: gigSourceTermsCurrent(resumed.source) } });
  } catch (error) {
    return safeJsonError(error, "api:gigs/sources/[id]", "GIG_STORE_FAILED");
  }
}
