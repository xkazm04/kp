import { NextResponse } from "next/server";
import { createWorkspace, listWorkspacesByOrg, listWorkspacesForUser, DEFAULT_WORKSPACE_ID, type Workspace } from "@/app/_lib/db/workspaces";
import { listMembershipsForWorkspace, upsertMembership } from "@/app/_lib/db/memberships";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { callerOrgCapabilities, currentUser, requireCapability, requireOrgCapability } from "@/app/_lib/auth/current-user";
import { multiWorkspaceEnabled } from "@/app/_lib/workspace-lock";
import { jsonError } from "@/app/_lib/api-response";
import type { MemberRole } from "@/app/_lib/auth/roles";

// Workspace CRUD (P2). A workspace IS a team; the console at Settings -> Workspaces
// reads this. Switching the active workspace is a separate session action
// (/api/auth/switch-workspace); per-workspace membership lives on
// /api/workspaces/[id]/members/[userId].

/** What the console renders per row: the workspace plus the caller's standing in
 *  it. `role` is null for a workspace the caller administers without belonging to. */
export type WorkspaceListRow = Workspace & { memberCount: number; role: MemberRole | null; canManage: boolean };

export async function GET() {
  try {
    // Any member may see the workspace list; WHICH workspaces they see depends on
    // their authority (below). This route used to have no gate at all and returned
    // listWorkspaces() — every workspace row in the database, across every org.
    const denied = await requireCapability("read");
    if (denied) return denied;

    const { userId, orgId: sessionOrg } = await currentUser();
    const orgId = sessionOrg ?? DEFAULT_ORG_ID;
    const orgCaps = await callerOrgCapabilities();
    // Org-wide admins (team:manage / members:manage held anywhere in the org — see
    // auth/org-authority.ts) administer every team, so they see the full org list.
    // Everyone else sees only the teams they belong to. An operator/open-dev caller
    // carries no userId and falls back to the org list.
    const canAdminister = orgCaps.has("team:manage") || orgCaps.has("members:manage");
    const workspaces = canAdminister || !userId ? listWorkspacesByOrg(orgId) : listWorkspacesForUser(userId);

    const rows: WorkspaceListRow[] = workspaces.map((w) => {
      const members = listMembershipsForWorkspace(w.id);
      return {
        ...w,
        memberCount: members.length,
        role: (userId ? members.find((m) => m.userId === userId)?.role : null) ?? null,
        canManage: canAdminister,
      };
    });

    return NextResponse.json({
      workspaces: rows,
      current: await currentWorkspace(),
      // The tenant every workspace-less record falls back to. The console needs it
      // to bucket legacy invites (invites.workspace_id is nullable), and a client
      // component cannot import it — db/workspaces.ts opens better-sqlite3.
      defaultWorkspace: DEFAULT_WORKSPACE_ID,
      // Whether create/switch are available at all (the deployment-level lock —
      // see workspace-lock.ts). Orthogonal to `canManage`, which is about the caller.
      multiWorkspace: multiWorkspaceEnabled(),
      canManage: canAdminister,
    });
  } catch (error) {
    return jsonError(error, "Failed to list workspaces.");
  }
}

export async function POST(request: Request) {
  try {
    // Creating a team is an org-level administrative act: `team:manage` held
    // anywhere in the org. Previously this route had NO capability check.
    const denied = await requireOrgCapability("team:manage");
    if (denied) return denied;
    // Deployment lock: refuse until KP_MULTI_WORKSPACE is set. The data layer is
    // fully scoped (tenancy.ts) but the flag is the operator's explicit opt-in.
    if (!multiWorkspaceEnabled()) {
      return NextResponse.json(
        {
          error:
            "Additional workspaces are disabled until multi-workspace is enabled for this deployment. Set KP_MULTI_WORKSPACE=1 to turn it on.",
        },
        { status: 403 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A workspace name is required." }, { status: 400 });

    // Stamp the CALLER's org, not DEFAULT_ORG_ID — a second org's admin was
    // otherwise creating teams inside the first org.
    const { userId, orgId } = await currentUser();
    const workspace = createWorkspace(name, orgId ?? DEFAULT_ORG_ID);
    // Seat the creator as owner so the team is never an orphan nobody can reach
    // (switch-workspace now requires membership). An operator/open-dev session
    // carries no user identity, so there is nobody to seat — it administers every
    // workspace regardless.
    if (userId) upsertMembership(userId, workspace.id, "owner");
    return NextResponse.json({ workspace });
  } catch (error) {
    return jsonError(error, "Failed to create the workspace.");
  }
}
