import { NextResponse } from "next/server";
import { createWorkspace, listWorkspaces } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// Workspace CRUD (P2). Recruiter-gated (the proxy allow-list excludes it). GET
// lists workspaces + the session's active one; POST creates one. Switching the
// active workspace is a separate session action (/api/auth/switch-workspace).
export async function GET() {
  try {
    return NextResponse.json({ workspaces: listWorkspaces(), current: await currentWorkspace() });
  } catch (error) {
    return jsonError(error, "Failed to list workspaces.");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A workspace name is required." }, { status: 400 });
    return NextResponse.json({ workspace: createWorkspace(name) });
  } catch (error) {
    return jsonError(error, "Failed to create the workspace.");
  }
}
