import { NextRequest, NextResponse } from "next/server";
import { getInterviewPrep, listPreparedEntries, saveInterviewPrepProgress } from "@/app/_lib/interview-prep";
import { safeJsonError } from "@/app/_lib/api-response";
import { parseEntriesParam } from "@/app/_lib/entries-param";

export const runtime = "nodejs";

// Caps for the interviewer-progress write (PREP2). Bounded so a crafted body can't
// balloon the artifact payload: the checklist has a few dozen keys, notes is a
// scratchpad, not a document.
const MAX_NOTES_LENGTH = 8 * 1024;
const MAX_CHECKED_KEYS = 200;

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

// PUT ?entry=<id> → persist the interviewer's checklist + notes onto an existing
// prep artifact (PREP2). Validated at the boundary: a bounded checked map of
// booleans + a length-capped notes string. 404 when no artifact exists yet (the
// plan must be generated before progress can attach).
export async function PUT(request: NextRequest) {
  try {
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > 120) {
      return NextResponse.json({ error: "entry is required" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as { checked?: unknown; notes?: unknown };

    const checked: Record<string, boolean> = {};
    if (body.checked && typeof body.checked === "object") {
      for (const [k, v] of Object.entries(body.checked as Record<string, unknown>)) {
        if (Object.keys(checked).length >= MAX_CHECKED_KEYS) break;
        if (typeof k === "string" && k.length <= 64 && v === true) checked[k] = true;
      }
    }
    const notes = typeof body.notes === "string" ? body.notes.slice(0, MAX_NOTES_LENGTH) : "";

    const ok = saveInterviewPrepProgress(entry, { checked, notes });
    if (!ok) {
      return NextResponse.json({ error: "No interview prep to update — generate it first." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep", "INTERVIEW_PREP_FAILED");
  }
}
