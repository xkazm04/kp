import { NextResponse } from "next/server";
import { dumpWorkspace } from "@/app/_lib/db-portability";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { multiWorkspaceEnabled } from "@/app/_lib/workspace-lock";


// DATA3 — download the ENTIRE kp database as one portable kp-db-dump JSON file
// (the db-dump.mjs format; db-load.mjs and the import endpoint both restore
// it). Skips gemini_cache + tasks by default, same as the script's documented
// suggestion.
//
// SCOPE NOTE (tri-scan #2): this is a WHOLE-DATABASE dump, NOT a per-workspace
// export — dumpWorkspace() reads every table regardless of the caller's workspace.
// That is safe only under the single-tenant lock (workspace-lock.ts), so the guard
// below refuses it outright once KP_MULTI_WORKSPACE is on. Reworking this to a
// per-workspace export (filter every table by workspace_id, and the import to
// restore into one workspace) is what lifts the guard.
//
// SECURITY NOTE: this exports FULL PII (candidates, contacts, transcripts). Like
// every recruiter API it relies on the proxy auth gate (active when
// KP_OPERATOR_PASSWORD is set); see auth-sessions-tenancy.md #3 for fail-open-by-default.
export async function GET() {
  // Defense-in-depth beyond the proxy session gate: this streams FULL PII for every
  // table, so it must be operator-only. requireOperator() also rejects the anonymous
  // demo session (which the proxy would otherwise accept).
  const denied = await requireOperator();
  if (denied) return denied;
  // Hard mode-guard, the READ half of the pair the import route already carries.
  // Only import grew this check, which left the exfiltration half open: `dumpWorkspace()`
  // reads EVERY table with no workspace filter, and `requireOperator()` is deliberately
  // coarse — open mode or any valid non-demo session passes it, and it reads no
  // membership or role. So with multi-workspace on, any signed-in member of any team
  // could download every other team's candidates, contacts, transcripts, decision
  // records and consent events in one request. Refuse until the per-workspace export
  // exists; a single-tenant deployment is unaffected.
  if (multiWorkspaceEnabled()) {
    return NextResponse.json(
      {
        error:
          "Whole-database export is disabled in multi-workspace mode: it would hand one team every other team's data. Unset KP_MULTI_WORKSPACE for a single-tenant backup, or wait for per-workspace export.",
      },
      { status: 503 }
    );
  }
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
