"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_WORKSPACE_ADMIN,
  foldWorkspaceAdminLoad,
  type InviteDto,
  type MembersResponse,
  type WorkspaceAdminSnapshot,
  type WorkspacesResponse,
} from "./workspaceAdminLoad";

// Data hook for the Workspaces console: the org's teams (/api/workspaces), its
// member roster with EVERY membership each person holds, and the pending invites
// (/api/org/*). One hook, because the console's whole point is showing people and
// teams against each other — a member row is meaningless without the team list to
// place it in, and a team row's member count is derived from the roster.
//
// Moved here from settings/organization (was useOrganizationMembers) when member
// management became workspace-scoped.
//
// The FOLDING lives in workspaceAdminLoad.ts, as a pure function over the three
// answers: what a partial arrival should keep, blank or flag was previously stated
// only by the order of eleven setState calls inside the promise chain below, and
// nothing could test it.

export type { InviteDto, MemberTeam, OrgMemberDto, WorkspaceDto } from "./workspaceAdminLoad";

/** Read a fetch answer, or null when it did not come back usable. `null` is the
 *  vocabulary the fold speaks: a rejected fetch, a refusal, and an unparseable
 *  body are the same fact to the console. */
async function readJson<T>(res: Response | null): Promise<T | null> {
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export function useWorkspaceAdmin() {
  const [snapshot, setSnapshot] = useState<WorkspaceAdminSnapshot>(EMPTY_WORKSPACE_ADMIN);
  const [loading, setLoading] = useState(true);

  // Non-async .then-chain (not an `async` body) so the mount effect below doesn't
  // trip react-hooks/set-state-in-effect — the setState calls live in promise
  // callbacks, deferred off the effect's synchronous pass. Still returns the
  // promise so action handlers can `await reload()` after a mutation.
  const reload = useCallback(() => {
    // All three requests leave together. Invites are members:manage-gated, so a
    // caller without it gets a 403 there; the permission check decides only what we
    // KEEP, never what we WAIT for (a serial members -> invites chain used to cost
    // the console two round-trips before first paint).
    const all = Promise.all([
      fetch("/api/org/members").catch(() => null),
      fetch("/api/workspaces").catch(() => null),
      fetch("/api/org/invites").catch(() => null),
    ]);
    return all
      .then(async ([rm, rw, ri]) => {
        const members = await readJson<MembersResponse>(rm);
        const workspaces = await readJson<WorkspacesResponse>(rw);
        const invites = (await readJson<{ invites: InviteDto[] }>(ri))?.invites ?? null;
        setSnapshot((prev) => foldWorkspaceAdminLoad(prev, { members, workspaces, invites }));
      })
      .catch(() => {
        // A throw here is a bug in the fold, not a failed request (every fetch is
        // already caught above) — surface it as the error state rather than
        // leaving the console spinning on a stale reading.
        console.error("[useWorkspaceAdmin] reload folded badly");
        setSnapshot((prev) => ({ ...prev, error: true }));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    workspaces: snapshot.workspaces,
    current: snapshot.current,
    /** The tenant a workspace-less record (a legacy invite) belongs to. */
    defaultWorkspace: snapshot.defaultWorkspace,
    multiWorkspace: snapshot.multiWorkspace,
    members: snapshot.members,
    invites: snapshot.invites,
    /** May seat/unseat/re-role people (members:manage). */
    canManageMembers: snapshot.canManageMembers,
    /** May create and rename teams (team:manage, org-wide). */
    canManageTeams: snapshot.canManageTeams,
    callerCaps: snapshot.callerCaps,
    loading,
    /** The roster itself failed. A FLAG, not a message: this is a plain module with
     *  no translator, and the copy lives in the catalog
     *  (docs/architecture/localization.md). */
    error: snapshot.error,
    /** The roster loaded but the teams or invites did not — what is on screen is
     *  partly the previous reading, and the console says so. */
    partial: snapshot.partial,
    reload,
  };
}
