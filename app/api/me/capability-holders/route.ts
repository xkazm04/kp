// Who holds a capability in the caller's CURRENT workspace.
//   GET /api/me/capability-holders?cap=<Capability>
//     -> { holders: { name: string | null, email, role }[] }   (<= 5, owner first)
//     400 CAPABILITY_UNKNOWN; 401/403 without `read`.
//
// The names the shell's locked-door panel offers to ask
// (app/features/shell/lockedDoor.ts). A seat that arrives at a tab it cannot open
// (a viewer following a checkout return to ?tab=billing, a g-chord into Models) is
// told which permission opens it and who in this team holds it, instead of meeting
// a 403 rendered as a failed load.
//
// Gated on `read`, and NOT on the public allow-list: the answer is a strict subset
// of GET /api/org/members, which already serves every `read` holder the org's whole
// roster with per-team capabilities. This route serves less — at most HOLDERS_CAP
// rows of {name, email, role}, THIS team only, active accounts of THIS team's org
// only; never a user id, an override or a team list.
//
// Ranked owner-first (MEMBER_ROLES order), then by membership age, so the person
// most likely to grant the access is named first.
import { NextResponse } from "next/server";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { isCapability, MEMBER_ROLES, resolveCapabilities, type MemberRole } from "@/app/_lib/auth/roles";
import { jsonRefusal } from "@/app/_lib/api-response";
import { listMembershipsForWorkspace } from "@/app/_lib/db/memberships";
import { getUserById } from "@/app/_lib/db/users";
import { getWorkspaceOrgId } from "@/app/_lib/db/workspaces";

const HOLDERS_CAP = 5;
const RANK: ReadonlyMap<MemberRole, number> = new Map(MEMBER_ROLES.map((r, i) => [r, i]));

export async function GET(req: Request) {
  const denied = await requireCapability("read");
  if (denied) return denied;
  const cap = new URL(req.url).searchParams.get("cap");
  if (!isCapability(cap)) return jsonRefusal("CAPABILITY_UNKNOWN", 400);

  const workspaceId = await currentWorkspace();
  const orgId = getWorkspaceOrgId(workspaceId);
  const rows: Array<{ name: string | null; email: string; role: MemberRole }> = [];
  for (const m of listMembershipsForWorkspace(workspaceId)) {
    // created_at ASC, so the stable sort below keeps the oldest seat first per role.
    if (!resolveCapabilities(m.role, m.overrides).has(cap)) continue;
    const user = getUserById(m.userId);
    if (!user || user.status === "disabled" || user.orgId !== orgId) continue;
    rows.push({ name: user.name, email: user.email, role: m.role });
  }
  rows.sort((a, b) => (RANK.get(a.role) ?? RANK.size) - (RANK.get(b.role) ?? RANK.size));

  return NextResponse.json({ holders: rows.slice(0, HOLDERS_CAP) });
}
