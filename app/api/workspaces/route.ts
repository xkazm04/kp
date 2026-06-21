import { NextResponse } from "next/server";
import { createWorkspace, listWorkspaces } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { multiWorkspaceEnabled } from "@/app/_lib/workspace-lock";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// Workspace CRUD (P2). Recruiter-gated (the proxy allow-list excludes it). GET
// lists workspaces + the session's active one; POST creates one. Switching the
// active workspace is a separate session action (/api/auth/switch-workspace).
export async function GET() {
  try {
    // multiWorkspace tells the UI whether create/switch are available (the data
    // layer is single-tenant-locked until per-workspace scoping lands — see
    // workspace-lock.ts).
    return NextResponse.json({
      workspaces: listWorkspaces(),
      current: await currentWorkspace(),
      multiWorkspace: multiWorkspaceEnabled(),
    });
  } catch (error) {
    return jsonError(error, "Failed to list workspaces.");
  }
}

export async function POST(request: Request) {
  try {
    // Fail-safe lock: creating a 2nd workspace would expose the first tenant's
    // unscoped data (tri-scan #1). Refuse until KP_MULTI_WORKSPACE is set.
    if (!multiWorkspaceEnabled()) {
      return NextResponse.json(
        {
          error:
            "Additional workspaces are disabled until per-workspace data isolation is complete. Set KP_MULTI_WORKSPACE=1 to enable once every table is scoped.",
        },
        { status: 403 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A workspace name is required." }, { status: 400 });
    return NextResponse.json({ workspace: createWorkspace(name) });
  } catch (error) {
    return jsonError(error, "Failed to create the workspace.");
  }
}
