import { NextResponse } from "next/server";
import { dumpWorkspace } from "@/app/_lib/db-portability";
import { requireOperator } from "@/app/_lib/auth/require-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DATA3 — download the ENTIRE kp database as one portable kp-db-dump JSON file
// (the db-dump.mjs format; db-load.mjs and the import endpoint both restore
// it). Skips gemini_cache + tasks by default, same as the script's documented
// suggestion.
//
// SCOPE NOTE (tri-scan #2): this is a WHOLE-DATABASE dump, NOT a per-workspace
// export — dumpWorkspace() reads every table regardless of the caller's workspace.
// That is safe today only because the app is single-tenant-locked (workspace-lock.ts);
// before KP_MULTI_WORKSPACE is enabled, this endpoint MUST be reworked to filter by
// workspace_id (and the import to restore into one workspace) or it becomes a
// cross-tenant exfiltration channel.
//
// SECURITY NOTE: this exports FULL PII (candidates, contacts, transcripts). Like
// every recruiter API it relies on the proxy auth gate (active when
// KP_OPERATOR_PASSWORD is set); see auth-sessions-tenancy.md #3 for fail-open-by-default.
export async function GET() {
  // Defense-in-depth beyond the proxy session gate: this streams FULL PII for every
  // table, so it must be operator-only. requireOperator() also rejects the anonymous
  // demo session (which the proxy would otherwise accept) — closing the one-request
  // cross-tenant exfiltration channel.
  const denied = await requireOperator();
  if (denied) return denied;
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
