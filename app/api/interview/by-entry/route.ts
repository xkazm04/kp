import { NextRequest, NextResponse } from "next/server";
import { interviewStatusByEntries, latestInterviewByEntry } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";
import { parseEntriesParam } from "@/app/_lib/entries-param";

export const runtime = "nodejs";

// GET ?entries=a,b,c → { status: { <entryId>: { sessionId, status, hasTranscript, endedAt } } }
// GET ?entry=<id>    → { session } (the latest interview session for one entry, with transcript + scorecard)
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const entry = sp.get("entry");
    if (entry) {
      return NextResponse.json({ session: latestInterviewByEntry(entry) });
    }
    // Bounded + de-duped at the trust boundary so a crafted/huge `entries` list
    // can't blow the SQLite variable limit or amplify the IN query (idea-191ccc0c).
    const entries = parseEntriesParam(sp.get("entries"));
    return NextResponse.json({ status: interviewStatusByEntries(entries) });
  } catch (error) {
    return safeJsonError(error, "api:interview:by-entry", "INTERVIEW_LOOKUP_FAILED");
  }
}
