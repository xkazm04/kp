import { NextRequest, NextResponse } from "next/server";
import { interviewStatusByEntries, latestInterviewByEntry } from "@/app/_lib/db";

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
    const entries = (sp.get("entries") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return NextResponse.json({ status: interviewStatusByEntries(entries) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
