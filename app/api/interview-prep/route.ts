import { NextRequest, NextResponse } from "next/server";
import { getInterviewPrep, listPreparedEntries } from "@/app/_lib/interview-prep";
import { safeJsonError } from "@/app/_lib/api-response";
import { parseEntriesParam } from "@/app/_lib/entries-param";

export const runtime = "nodejs";

// Read interview-prep artifacts (generated via the background task interview_prep).
//   GET ?entry=<id>          → the artifact for one pipeline entry (or null)
//   GET ?entries=a,b,c       → { prepared: { <entryId>: createdAt } }
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const entry = sp.get("entry");
    if (entry) {
      return NextResponse.json({ prep: getInterviewPrep(entry) });
    }
    // Bounded + de-duped at the trust boundary so a crafted/huge `entries` list
    // can't blow the SQLite variable limit or amplify the IN query (idea-191ccc0c).
    const entries = parseEntriesParam(sp.get("entries"));
    return NextResponse.json({ prepared: listPreparedEntries(entries) });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep", "INTERVIEW_PREP_FAILED");
  }
}
