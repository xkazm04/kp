import { NextResponse } from "next/server";
import { dumpWorkspace } from "@/app/_lib/db-portability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DATA3 — download the whole workspace as one portable kp-db-dump JSON file
// (the db-dump.mjs format; db-load.mjs and the import endpoint both restore
// it). Skips gemini_cache + tasks by default, same as the script's documented
// suggestion.
//
// SECURITY NOTE: this exports the FULL PII workspace (candidates, contacts,
// transcripts). Like every recruiter API in the app it currently ships with no
// auth layer — it must ride the same app-wide auth decision tracked as the
// rejected-idea follow-up ccb4d851.
export async function GET() {
  try {
    const payload = dumpWorkspace();
    const stamp = payload.createdAt.replace(/[:.]/g, "-");
    return new NextResponse(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="kp-dump-${stamp}.json"`,
      },
    });
  } catch (error) {
    console.error("[api/workspace/export] dump failed", error);
    const message = error instanceof Error ? error.message : "Failed to export the workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
