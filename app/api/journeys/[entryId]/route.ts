import { NextResponse, type NextRequest } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { journeyEntryView } from "@/app/_lib/journey/project";

// GET /api/journeys/[entryId]            -> { column, sharedEvents, sharedEventsUnlinked, details }
// GET /api/journeys/[entryId]?event=<id> -> that ONE JourneyEventDetail
//   (shapes in app/_lib/journey/types.ts)
//
// The second detail layer. A `JourneyEventDetail` is keyed by ONE event id and an
// entry has many, so the event is named in the query string; without it the whole
// column comes back with a detail per row, which is what a caller that wants to
// open several rows in a row should ask for. An `?event=` that matches nothing
// degrades to the full `{ events }` list rather than to a 404: the entry is real,
// the row simply is not on it, and "here is everything, pick yourself" is a more
// useful answer than a refusal.
//
// THE BOARD NEVER RENDERS A RAW TRANSCRIPT. `details[].source` is an excerpt plus a
// label key; the whole transcript stays behind the interview surface that owns it,
// and an entry whose consent has lapsed or been anonymized gets no excerpt at all
// (the same read-time control candidate-timeline.ts applies to the drawer).
//
// AUTH / TENANCY: `currentWorkspace()`, matching the board route beside it. An entry
// from another team answers exactly as an unknown id does, so a cross-tenant probe
// learns nothing from the difference.
/** An event id is `<table>:<pk>` (project.ts). Bounded like every other query param
 *  that reaches a comparison. */
const MAX_EVENT_PARAM = 200;

export async function GET(request: NextRequest, context: { params: Promise<{ entryId: string }> }) {
  try {
    const { entryId } = await context.params;
    const eventId = (new URL(request.url).searchParams.get("event") ?? "").trim().slice(0, MAX_EVENT_PARAM);
    const workspaceId = await currentWorkspace();
    const view = journeyEntryView(entryId, workspaceId);
    if (!view) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    if (eventId) {
      const detail = view.details.find((d) => d.eventId === eventId);
      return NextResponse.json(detail ?? { events: view.details });
    }
    return NextResponse.json(view);
  } catch (error) {
    return safeJsonError(error, "api:journeys/[entryId]", "PIPELINE_TIMELINE_FAILED");
  }
}
