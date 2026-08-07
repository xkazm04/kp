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

/** The MACHINE failure signal from a failed org response — the stable `code`
 *  when the route sends one, else the reason string the member routes put in
 *  `error` ("last_owner", "not_member"). The console COMPARES it and renders its
 *  own copy (see app/_lib/use-error-message.ts — the server's English `error` is
 *  never rendered). The invite panel no longer routes through here at all: it
 *  hands the parsed payload to `useErrorMessage()` and falls back to
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
