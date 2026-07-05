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

// ---- Per-user capability overrides -----------------------------------------
// A membership may tune its capabilities on top of the role defaults: an owner/
// admin (anyone with members:manage) can grant a recruiter members:manage to make
// them a "Writer" who can invite, or revoke pipeline:write to make a seat
// read-only. Stored on the membership as JSON; resolved live so a change lands on
// the next request.

export type CapabilityOverride = { grant: Capability[]; revoke: Capability[] };

/** Every capability — for building the per-user permission UI and validating input. */
export const ALL_CAPABILITIES: readonly Capability[] = ["org:manage", "members:manage", "team:manage", "pipeline:write", "read"];

// Capabilities that MAY be tuned per user. org:manage is deliberately excluded —
// it stays bound to the owner role and is never grantable via an override, so no
// members:manage holder can escalate anyone (incl. themselves) to owner control.
export const OVERRIDABLE_CAPABILITIES: readonly Capability[] = ["members:manage", "team:manage", "pipeline:write", "read"];

export function isCapability(v: unknown): v is Capability {
  return typeof v === "string" && (ALL_CAPABILITIES as readonly string[]).includes(v);
}

/** The baseline capabilities a role grants (before per-user overrides). */
export function roleCapabilities(role: MemberRole): ReadonlySet<Capability> {
  return new Set(CAPS[role]);
}

/** Effective capabilities = role defaults ∪ grants − revokes. `org:manage` can
 *  never be ADDED by a grant (owner-role only); a revoke can remove anything. */
export function resolveCapabilities(
  role: MemberRole | null | undefined,
  overrides?: CapabilityOverride | null,
): ReadonlySet<Capability> {
  const set = role && isMemberRole(role) ? new Set<Capability>(CAPS[role]) : new Set<Capability>();
  if (overrides) {
    for (const c of overrides.grant ?? []) if (isCapability(c) && c !== "org:manage") set.add(c);
    for (const c of overrides.revoke ?? []) if (isCapability(c)) set.delete(c);
  }
  return set;
}

/** Does role+overrides grant the capability? */
export function capable(role: MemberRole | null | undefined, overrides: CapabilityOverride | null | undefined, cap: Capability): boolean {
  return resolveCapabilities(role, overrides).has(cap);
}

/** Normalize arbitrary input into a clean override: drops unknown/`org:manage`
 *  grants, de-dupes, and lets revoke win when a cap is in both lists. Returns null
 *  when nothing survives (store NULL = pure role defaults). */
export function sanitizeOverride(input: { grant?: unknown; revoke?: unknown } | null | undefined): CapabilityOverride | null {
  const clean = (arr: unknown): Capability[] => (Array.isArray(arr) ? [...new Set(arr.filter(isCapability))] : []);
  const revoke = clean(input?.revoke);
  const grant = clean(input?.grant).filter((c) => c !== "org:manage" && !revoke.includes(c));
  if (grant.length === 0 && revoke.length === 0) return null;
  return { grant, revoke };
}
