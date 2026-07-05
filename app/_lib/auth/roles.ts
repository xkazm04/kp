// Role model (P0). The five membership roles finally carry server-side meaning:
// a capability map the routes gate on, plus a rank so "at least admin" checks are
// one comparison. Pure + import-free so it's unit-testable and usable on either
// side of the client/server boundary (the Organization UI reads the same enum).

export const MEMBER_ROLES = ["owner", "admin", "recruiter", "hiring_manager", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export function isMemberRole(v: unknown): v is MemberRole {
  return typeof v === "string" && (MEMBER_ROLES as readonly string[]).includes(v);
}

// Higher = more privileged. Backs `roleAtLeast` for coarse "min role" gates.
const RANK: Record<MemberRole, number> = {
  viewer: 0,
  hiring_manager: 1,
  recruiter: 2,
  admin: 3,
  owner: 4,
};

// A capability is the fine-grained thing a route actually needs. Prefer gating on
// a capability over a role rank — it survives a role-matrix tweak.
export type Capability =
  | "org:manage" // billing, org profile/settings, delete org — owner only
  | "members:manage" // invite / remove / change a member's role
  | "team:manage" // create/rename teams + membership within a team
  | "pipeline:write" // recruiter operations: move candidates, decisions, comms
  | "read"; // view team data

const CAPS: Record<MemberRole, ReadonlySet<Capability>> = {
  owner: new Set<Capability>(["org:manage", "members:manage", "team:manage", "pipeline:write", "read"]),
  admin: new Set<Capability>(["members:manage", "team:manage", "pipeline:write", "read"]),
  recruiter: new Set<Capability>(["pipeline:write", "read"]),
  hiring_manager: new Set<Capability>(["pipeline:write", "read"]),
  viewer: new Set<Capability>(["read"]),
};

/** Does this role grant the capability? Null/unknown role → false (fail closed). */
export function roleCan(role: MemberRole | null | undefined, cap: Capability): boolean {
  if (!role || !isMemberRole(role)) return false;
  return CAPS[role].has(cap);
}

/** Is this role at least as privileged as `min`? Null/unknown role → false. */
export function roleAtLeast(role: MemberRole | null | undefined, min: MemberRole): boolean {
  if (!role || !isMemberRole(role)) return false;
  return RANK[role] >= RANK[min];
}
