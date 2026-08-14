// Pure helpers for the Workspaces console: member/team lookups shared by the shell
// and its panels. Moved here from settings/organization (was
// organizationMemberHelpers) when member management became workspace-scoped.
import { roleCapabilities } from "@/app/_lib/auth/roles";
import type { MemberTeam, OrgMemberDto } from "./useWorkspaceAdmin";

/** The member's membership on ONE team, or null if they don't belong to it.
 *
 *  This replaced `primaryTeam(m) = m.teams[0]`, the single line that made the whole
 *  app single-team: the data model has always been many-to-many (memberships is
 *  UNIQUE(user_id, workspace_id), and a recruiter can span several teams of an
 *  org), but every surface read seat [0] and pretended the rest weren't there. */
export function teamFor(m: OrgMemberDto, workspaceId: string): MemberTeam | null {
  return m.teams.find((t) => t.workspaceId === workspaceId) ?? null;
}

/** The org members who hold a seat on this team, roster order preserved. */
export function membersOfWorkspace(members: OrgMemberDto[], workspaceId: string): OrgMemberDto[] {
  return members.filter((m) => m.teams.some((t) => t.workspaceId === workspaceId));
}

/** The org members who do NOT hold a seat on this team — the "add someone who is
 *  already here" candidate list, so seating an existing colleague never needs an
 *  invite round-trip. */
export function membersNotInWorkspace(members: OrgMemberDto[], workspaceId: string): OrgMemberDto[] {
  return members.filter((m) => !m.teams.some((t) => t.workspaceId === workspaceId));
}

/** workspaceId -> seat count, derived from the roster the console already holds
 *  (no extra request; the server's own count is authoritative but this keeps the
 *  rail in step with an optimistic reload). */
export function memberCounts(members: OrgMemberDto[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of members) for (const t of m.teams) counts.set(t.workspaceId, (counts.get(t.workspaceId) ?? 0) + 1);
  return counts;
}

/** The pending invites addressed at one team. An invite with no workspaceId
 *  predates per-team invites and belongs to the default team. */
export function invitesForWorkspace<T extends { workspaceId: string | null }>(invites: T[], workspaceId: string, defaultWorkspaceId: string): T[] {
  return invites.filter((i) => (i.workspaceId ?? defaultWorkspaceId) === workspaceId);
}

/** A display name that never renders blank: the person's name, else their email. */
export function memberName(m: OrgMemberDto): string {
  return m.user.name ?? m.user.email;
}

// True when the member's effective capabilities differ from their role's defaults
// (i.e. a per-user override is in play) — surfaced as a "Custom" chip.
export function hasCustomPermissions(team: MemberTeam): boolean {
  const def = roleCapabilities(team.role);
  const cur = new Set(team.capabilities);
  if (def.size !== cur.size) return true;
  for (const c of def) if (!cur.has(c)) return true;
  return false;
}

/** The MACHINE failure signal from a failed org response — the stable `code`
 *  when the route sends one, else the reason string the member routes put in
 *  `error` ("last_owner", "not_member", "cross_org"). The console COMPARES it and
 *  renders its own copy (see app/_lib/use-error-message.ts — the server's English
 *  `error` is never rendered). The invite panel no longer routes through here at
 *  all: it hands the parsed payload to `useErrorMessage()` and falls back to
 *  `workspaceAdmin.members.inviteFailed`. */
export async function readError(r: Response | null): Promise<string | null> {
  if (!r) return null;
  try {
    const { code, error } = (await r.json()) as { error?: string; code?: string };
    return code ?? error ?? null;
  } catch {
    return null;
  }
}
