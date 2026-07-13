import { NextRequest, NextResponse } from "next/server";
import { listPipelineEvents, listPipelineEventsForEntry, listPipelineEventsSince } from "@/app/_lib/db";
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
    // Per-candidate history for the drawer (PIPE3): full, oldest-first events for
    // one entry. Recruiter context (keyed by the internal entry id, not exposed on
    // the public feed), so NOT run through the anonymizing public projection — the
    // timeline needs the real stage transitions + detail.
    const entry = request.nextUrl.searchParams.get("entry");
    if (entry !== null) {
      if (!entry.trim() || entry.length > 120) {
        return NextResponse.json({ error: "entry must be a non-empty id" }, { status: 400 });
      }
      return NextResponse.json({ events: listPipelineEventsForEntry(entry, 50, ws) });
    }

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
