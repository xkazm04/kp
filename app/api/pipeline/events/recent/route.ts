import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { listPipelineEventsSince, listRecentPipelineEvents } from "@/app/_lib/db/pipeline";

// GET /api/pipeline/events/recent            → { events, cursor } — the last 7 days, newest first
// GET /api/pipeline/events/recent?since=<id> → { events, cursor } — everything STRICTLY AFTER <id>
//                                               within the window, oldest first
// Response event: { id, candidateLabel, jobTitle, kind, fromStage, toStage, detail, createdAt }
//
// The board's activity feed, with FULL candidate names. The sibling GET
// /api/pipeline/events is ungated and therefore serves a privacy projection
// (initials, no ids — pipeline-events-public.ts); this door is operator-gated and
// workspace-scoped like /api/pipeline/[id]/timeline, so the recruiter reading their
// own board sees who did what. `cursor` is the id to resume from on the next poll.
export const ACTIVITY_WINDOW_DAYS = 7;
const WINDOW_CAP = 500;

export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const fromIso = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString();
    const sinceRaw = request.nextUrl.searchParams.get("since");
    if (sinceRaw !== null) {
      const since = Number(sinceRaw);
      if (!Number.isSafeInteger(since) || since < 0) return jsonRefusal("PIPELINE_EVENTS_CURSOR_INVALID", 400);
      const events = listPipelineEventsSince(since, 200, ws).filter((e) => e.createdAt >= fromIso);
      const cursor = events.length > 0 ? events[events.length - 1].id : since;
      return NextResponse.json({ events: events.map(wire), cursor, windowDays: ACTIVITY_WINDOW_DAYS });
    }
    const events = listRecentPipelineEvents(fromIso, WINDOW_CAP, ws);
    const cursor = events.length > 0 ? events[0].id : 0;
    return NextResponse.json({ events: events.map(wire), cursor, windowDays: ACTIVITY_WINDOW_DAYS });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:events/recent", "PIPELINE_EVENTS_FAILED");
  }
}

/** The feed's row: the internal entry id, archetype and actor stay off the wire —
 *  the feed reads none of them, and the entry id is the IDOR handle the public
 *  projection exists to strip. */
function wire(e: ReturnType<typeof listRecentPipelineEvents>[number]) {
  return {
    id: e.id,
    candidateLabel: e.candidateLabel,
    jobTitle: e.jobTitle,
    kind: e.kind,
    fromStage: e.fromStage,
    toStage: e.toStage,
    detail: e.detail,
    createdAt: e.createdAt,
  };
}
