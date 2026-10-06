import { NextResponse } from "next/server";
import { listEntryNotes } from "@/app/_lib/db/entry-notes";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// The entry's authored note thread (db/entry-notes.ts), oldest first. Written through
// POST /api/pipeline/[id] action add_note. Gated exactly like its siblings (a note is
// recruiter prose about a candidate): requireOperator, then the thread is read in the
// caller's workspace only — a foreign or unknown entry answers 404.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    if (!getPipelineEntry(id, ws)) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    return NextResponse.json({ notes: listEntryNotes(id, ws) });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:notes", "PIPELINE_LIST_FAILED");
  }
}
