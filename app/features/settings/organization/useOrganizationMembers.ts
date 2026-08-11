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
    // Both requests leave together. Invites used to wait for the members payload
    // to prove `canManage`, which made the console's first paint cost two serial
    // round-trips for a roster nobody can act on until both have landed. The
    // permission check still decides what we KEEP: a caller without
    // members:manage gets a 403 here (handled below as "no invites") and the
    // response is discarded either way, so nothing gated is rendered.
    const membersReq = fetch("/api/org/members");
    const invitesReq = fetch("/api/org/invites").catch(() => null);
    return membersReq
      .then(async (r): Promise<void> => {
        // Canonical English, for the console log only — never rendered.
        if (!r.ok) throw new Error("Failed to load members");
        const data = (await r.json()) as MembersResponse;
        setMembers(data.members);
        setCanManage(data.canManage);
        setCallerCaps(data.callerCapabilities);
        // Pending invites are members:manage-gated; only render them when we may see them.
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

  return { members, invites, canManage, callerCaps, loading, error, reload };
}
