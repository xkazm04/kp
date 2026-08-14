"use client";

import { useCallback, useEffect, useState } from "react";
import type { Capability, MemberRole } from "@/app/_lib/auth/roles";
import type { Workspace } from "@/app/_lib/db/workspaces";
import type { MemberStatus } from "@/app/features/shared/memberUi";

// Data hook for the Workspaces console: the org's teams (/api/workspaces), its
// member roster with EVERY membership each person holds, and the pending invites
// (/api/org/*). One hook, because the console's whole point is showing people and
// teams against each other — a member row is meaningless without the team list to
// place it in, and a team row's member count is derived from the roster.
//
// Moved here from settings/organization (was useOrganizationMembers) when member
// management became workspace-scoped.

export type MemberTeam = { workspaceId: string; role: MemberRole; capabilities: Capability[] };
export type OrgMemberDto = {
  user: { id: string; email: string; name: string | null; status: MemberStatus; createdAt: string };
  teams: MemberTeam[];
};
export type InviteDto = { token: string; email: string; role: MemberRole; workspaceId: string | null; createdAt: string; expiresAt: string | null };
/** A team row as the console renders it: the workspace plus the caller's standing. */
export type WorkspaceDto = Workspace & { memberCount: number; role: MemberRole | null; canManage: boolean };

type MembersResponse = { members: OrgMemberDto[]; canManage: boolean; callerCapabilities: Capability[] };
type WorkspacesResponse = {
  workspaces: WorkspaceDto[];
  current: string;
  defaultWorkspace: string;
  multiWorkspace: boolean;
  canManage: boolean;
};

export function useWorkspaceAdmin() {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [defaultWorkspace, setDefaultWorkspace] = useState<string | null>(null);
  const [multiWorkspace, setMultiWorkspace] = useState(false);
  const [members, setMembers] = useState<OrgMemberDto[]>([]);
  const [invites, setInvites] = useState<InviteDto[]>([]);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [canManageTeams, setCanManageTeams] = useState(false);
  const [callerCaps, setCallerCaps] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  // A FLAG, not a message. This is a plain module with no translator, and every
  // failure path renders the same line, so the copy lives in the catalog and the
  // components resolve it — no English can leak out of here
  // (docs/architecture/localization.md).
  const [error, setError] = useState(false);

  // Non-async .then-chain (not an `async` body) so the mount effect below doesn't
  // trip react-hooks/set-state-in-effect — the setState calls live in promise
  // callbacks, deferred off the effect's synchronous pass. Still returns the
  // promise so action handlers can `await reload()` after a mutation.
  const reload = useCallback(() => {
    // All three requests leave together. Invites are members:manage-gated, so a
    // caller without it gets a 403 there; the permission check decides only what we
    // KEEP, never what we WAIT for (a serial members -> invites chain used to cost
    // the console two round-trips before first paint).
    const workspacesReq = fetch("/api/workspaces").catch(() => null);
    const membersReq = fetch("/api/org/members");
    const invitesReq = fetch("/api/org/invites").catch(() => null);
    return membersReq
      .then(async (r): Promise<void> => {
        // Canonical English, for the console log only — never rendered.
        if (!r.ok) throw new Error("Failed to load members");
        const data = (await r.json()) as MembersResponse;
        setMembers(data.members);
        setCanManageMembers(data.canManage);
        setCallerCaps(data.callerCapabilities);

        const rw = await workspacesReq;
        if (rw && rw.ok) {
          const ws = (await rw.json()) as WorkspacesResponse;
          setWorkspaces(ws.workspaces);
          setCurrent(ws.current);
          setDefaultWorkspace(ws.defaultWorkspace);
          setMultiWorkspace(ws.multiWorkspace);
          setCanManageTeams(ws.canManage);
        }

        const ri = data.canManage ? await invitesReq : null;
        setInvites(ri && ri.ok ? ((await ri.json()) as { invites: InviteDto[] }).invites : []);
        setError(false);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    workspaces,
    current,
    /** The tenant a workspace-less record (a legacy invite) belongs to. */
    defaultWorkspace,
    multiWorkspace,
    members,
    invites,
    /** May seat/unseat/re-role people (members:manage). */
    canManageMembers,
    /** May create and rename teams (team:manage, org-wide). */
    canManageTeams,
    callerCaps,
    loading,
    error,
    reload,
  };
}
