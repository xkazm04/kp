import { NextRequest, NextResponse } from "next/server";
import { listPipelineEvents, listPipelineEventsSince } from "@/app/_lib/db";
import { toPublicPipelineEvent } from "@/app/_lib/pipeline-events-public";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";


// The Activity feed's poll contract (idea-85f043ea). The old shape — "the 40
// newest rows, every poll" — silently LOST events: a burst (an automation pass
// advancing/rejecting many entries plus alerts) pushed earlier events past the
// 40-row window before the next poll, so the operator never saw a reject or
// aging alert happen. Now:
//   GET /api/pipeline/events            → newest 40 (initial page) + cursor
//   GET /api/pipeline/events?since=<id> → everything STRICTLY AFTER <id>,
//        oldest-first, bounded — the client keeps the cursor and never misses
//        an event, catching up across polls when a burst outruns one fetch.
// `cursor` is the id to resume from on the next poll in both modes.
export async function GET(request: NextRequest) {
  try {
    // Tenant scope (P1): every read below scopes to the caller's team. GET
    // /api/pipeline already scopes its board to currentWorkspace(); the three
    // event reads MUST too, or the feed + drawer history read another tenant's
    // audit trail (they fell to DEFAULT_WORKSPACE_ID before this).
    const ws = await currentWorkspace();
    // NOTE: per-candidate history (the `?entry=` branch) was removed here. It
    // served the entry's full, un-anonymized recruiter events (real labels,
    // archetype, rejection detail) with NO requireOperator() gate — unlike the
    // sibling GET /api/pipeline/[id] and /timeline routes, which are all
    // operator-gated because they expose the same PII. The drawer now reads that
    // history through the operator-gated /api/pipeline/[id]/timeline bundle, so
    // the ungated branch was also dead code. Any future per-entry read on this
    // route MUST call requireOperator() first (see [id]/route.ts).
    const sinceRaw = request.nextUrl.searchParams.get("since");
    if (sinceRaw !== null) {
      const since = Number(sinceRaw);
      if (!Number.isSafeInteger(since) || since < 0) {
        return NextResponse.json({ error: "since must be a non-negative integer" }, { status: 400 });
      }
      const events = listPipelineEventsSince(since, 200, ws);
      const cursor = events.length > 0 ? events[events.length - 1].id : since;
      // Public projection (idea-4c41d103): identity reduced to initials, no
      // internal ids — see pipeline-events-public.ts.
      return NextResponse.json({ events: events.map(toPublicPipelineEvent), cursor });
    }
    const events = listPipelineEvents(40, 0, undefined, ws);
    const cursor = events.length > 0 ? events[0].id : 0; // newest-first → [0] is the max id
    return NextResponse.json({ events: events.map(toPublicPipelineEvent), cursor });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:events", "PIPELINE_EVENTS_FAILED");
  }
}
