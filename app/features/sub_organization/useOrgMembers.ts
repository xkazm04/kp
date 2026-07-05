"use client";

import { useCallback, useEffect, useState } from "react";
import type { Capability, MemberRole } from "@/app/_lib/auth/roles";
import type { MemberStatus } from "./member-ui";

// Data hook for the Organization page: loads the real member roster + pending
// invites from /api/org/*, exposes the caller's own capabilities (so the UI knows
// which controls to show and which permissions it can delegate), and a reload.

export type MemberTeam = { workspaceId: string; role: MemberRole; capabilities: Capability[] };
export type OrgMemberDto = {
  user: { id: string; email: string; name: string | null; status: MemberStatus; createdAt: string };
  teams: MemberTeam[];
};
export type InviteDto = { token: string; email: string; role: MemberRole; workspaceId: string | null; createdAt: string; expiresAt: string | null };

type MembersResponse = { members: OrgMemberDto[]; canManage: boolean; callerCapabilities: Capability[] };

export function useOrgMembers() {
  const [members, setMembers] = useState<OrgMemberDto[]>([]);
  const [invites, setInvites] = useState<InviteDto[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [callerCaps, setCallerCaps] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/org/members");
      if (!r.ok) throw new Error("Failed to load members");
      const data = (await r.json()) as MembersResponse;
      setMembers(data.members);
      setCanManage(data.canManage);
      setCallerCaps(data.callerCapabilities);
      // Pending invites are members:manage-gated; only fetch them when we may see them.
      if (data.canManage) {
        const ri = await fetch("/api/org/invites");
        setInvites(ri.ok ? ((await ri.json()) as { invites: InviteDto[] }).invites : []);
      } else {
        setInvites([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { members, invites, canManage, callerCaps, loading, error, reload };
}
