import { NextRequest, NextResponse } from "next/server";
import { getInterviewPrep, listPreparedEntries } from "@/app/_lib/interview-prep";

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
    const entries = (sp.get("entries") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return NextResponse.json({ prepared: listPreparedEntries(entries) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
