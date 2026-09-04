import type { Capability, MemberRole } from "@/app/_lib/auth/roles";
import type { Workspace } from "@/app/_lib/db/workspaces";
import type { MemberStatus } from "@/app/features/shared/memberUi";

// The Workspaces console's load state machine, as a pure function.
//
// `useWorkspaceAdmin` fires THREE requests in parallel (members, workspaces,
// invites) and folds them into one snapshot, and the interesting part is what it
// does when only some of them arrive. That logic lived inline in a promise chain
// with eleven setState calls and nothing pinned it: the rules it encodes are real
// decisions — a failed invites request is NOT an error (a caller without
// `members:manage` is legitimately refused there, which is why the console only
// KEEPS the response when the permission says so), while a failed members request
// makes the whole console unusable and must say so — and both were invisible.
//
// Pulled out here so they can be stated once and tested. The hook keeps the
// fetching; this owns the folding.

export type MemberTeam = { workspaceId: string; role: MemberRole; capabilities: Capability[] };
export type OrgMemberDto = {
  user: { id: string; email: string; name: string | null; status: MemberStatus; createdAt: string };
  teams: MemberTeam[];
};
export type InviteDto = { token: string; email: string; role: MemberRole; workspaceId: string | null; createdAt: string; expiresAt: string | null };
/** A team row as the console renders it: the workspace plus the caller's standing. */
export type WorkspaceDto = Workspace & { memberCount: number; role: MemberRole | null; canManage: boolean };

export type MembersResponse = { members: OrgMemberDto[]; canManage: boolean; callerCapabilities: Capability[] };
export type WorkspacesResponse = {
  workspaces: WorkspaceDto[];
  current: string;
  defaultWorkspace: string;
  multiWorkspace: boolean;
  canManage: boolean;
};

/** Everything the console renders from. */
export type WorkspaceAdminSnapshot = {
  members: OrgMemberDto[];
  canManageMembers: boolean;
  callerCaps: Capability[];
  workspaces: WorkspaceDto[];
  current: string | null;
  defaultWorkspace: string | null;
  multiWorkspace: boolean;
  canManageTeams: boolean;
  invites: InviteDto[];
  /** The roster itself could not be loaded — the console has nothing to show. */
  error: boolean;
  /** The roster loaded but a SECONDARY request did not, so what is on screen is
   *  partly the previous reading. Distinct from `error`: the page still works. */
  partial: boolean;
};

export const EMPTY_WORKSPACE_ADMIN: WorkspaceAdminSnapshot = {
  members: [],
  canManageMembers: false,
  callerCaps: [],
  workspaces: [],
  current: null,
  defaultWorkspace: null,
  multiWorkspace: false,
  canManageTeams: false,
  invites: [],
  error: false,
  partial: false,
};

/** One reload's three answers. `null` means "that request did not come back
 *  usable" — a rejected fetch, a non-ok status, or a body that would not parse. */
export type WorkspaceAdminArrivals = {
  members: MembersResponse | null;
  workspaces: WorkspacesResponse | null;
  invites: InviteDto[] | null;
};

/**
 * Fold one reload onto the snapshot already on screen.
 *
 * The three rules, each of which was previously only implied by the order of
 * setState calls in a promise chain:
 *
 *  1. **No roster, no console.** A failed members request is the error state. The
 *     previous reading is KEPT rather than blanked — a transient failure that
 *     empties a roster an administrator is working in reads as "everybody is
 *     gone", which is a worse lie than stale data under an explicit error line.
 *  2. **Invites are permission-gated, so a missing invites answer is ordinary.**
 *     Only a caller with `members:manage` may read them; anyone else gets a 403.
 *     The console therefore keeps them only when the roster says the caller may
 *     manage members, and an absent list for such a caller is an empty list, not
 *     a failure. For a caller who MAY manage them, a missing answer IS a partial
 *     load — the pending-invite section would silently claim there are none.
 *  3. **A missing teams answer keeps the previous list and flags `partial`.**
 *     Blanking it would drop the roster into "no workspaces" while the members it
 *     just loaded plainly sit on some.
 */
export function foldWorkspaceAdminLoad(previous: WorkspaceAdminSnapshot, arrivals: WorkspaceAdminArrivals): WorkspaceAdminSnapshot {
  if (!arrivals.members) return { ...previous, error: true, partial: false };

  const canManageMembers = arrivals.members.canManage;
  const teams = arrivals.workspaces;
  // An invites list is expected only when the caller may manage members; for
  // anyone else "no list" is the correct, complete answer.
  const invitesMissing = canManageMembers && arrivals.invites === null;

  return {
    members: arrivals.members.members,
    canManageMembers,
    callerCaps: arrivals.members.callerCapabilities,
    workspaces: teams ? teams.workspaces : previous.workspaces,
    current: teams ? teams.current : previous.current,
    defaultWorkspace: teams ? teams.defaultWorkspace : previous.defaultWorkspace,
    multiWorkspace: teams ? teams.multiWorkspace : previous.multiWorkspace,
    canManageTeams: teams ? teams.canManage : previous.canManageTeams,
    invites: canManageMembers ? (arrivals.invites ?? previous.invites) : [],
    error: false,
    partial: !teams || invitesMissing,
  };
}
