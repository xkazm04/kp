"use client";

import { useCallback, useEffect, useState } from "react";
import type { Capability, MemberRole } from "@/app/_lib/auth/roles";
import type { MemberStatus } from "@/app/features/shared/memberUi";

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

export function useOrganizationMembers() {
  const [members, setMembers] = useState<OrgMemberDto[]>([]);
  const [invites, setInvites] = useState<InviteDto[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [callerCaps, setCallerCaps] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  // A FLAG, not a message. This is a plain module with no translator, and both
  // failure paths (bad response / network throw) render the same line, so the
  // copy lives in the catalog and the table resolves it — no English can leak
  // out of here (docs/architecture/localization.md).
  const [error, setError] = useState(false);

  // Non-async .then-chain (not an `async` body) so the mount effect below doesn't
  // trip react-hooks/set-state-in-effect — the setState calls live in promise
  // callbacks, deferred off the effect's synchronous pass. Still returns the
  // promise so action handlers can `await reload()` after a mutation.
  const reload = useCallback(() => {
    return fetch("/api/org/members")
      .then(async (r): Promise<void> => {
        // Canonical English, for the console log only — never rendered.
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

  return { members, invites, canManage, callerCaps, loading, error, reload };
}
