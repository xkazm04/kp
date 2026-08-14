import { NextResponse, type NextRequest } from "next/server";
import { renameWorkspace } from "@/app/_lib/db/workspaces";
import { requireWorkspaceCapability } from "@/app/_lib/auth/current-user";
import { jsonError } from "@/app/_lib/api-response";

// Rename a team (P2). `team:manage` ON THE TARGET workspace — which an org-wide
// admin holds over every team in their org, and nobody holds over another org's
// (requireWorkspaceCapability answers 404 there, so a cross-org probe learns
// nothing). Renaming is the only workspace field the console edits; deletion is
// deliberately absent (a team's data outlives the label).
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const denied = await requireWorkspaceCapability(id, "team:manage");
    if (denied) return denied;
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A workspace name is required." }, { status: 400 });
    const workspace = renameWorkspace(id, name);
    if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ workspace });
  } catch (error) {
    return jsonError(error, "Failed to rename the workspace.");
  }
}
