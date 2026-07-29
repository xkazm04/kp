// Pure helpers for the Organization console: member/team lookups shared by the
// console shell and its members panel. Split out of OrganizationConsole.tsx.
import { roleCapabilities } from "@/app/_lib/auth/roles";
import type { MemberTeam, OrgMemberDto } from "./useOrganizationMembers";

// The member's team membership (single-team default). Every seeded/invited member
// has exactly one; guard for the empty case defensively.
export function primaryTeam(m: OrgMemberDto): MemberTeam | null {
  return m.teams[0] ?? null;
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

export async function readError(r: Response | null): Promise<string | null> {
  if (!r) return null;
  try {
    return ((await r.json()) as { error?: string }).error ?? null;
  } catch {
    return null;
  }
}
