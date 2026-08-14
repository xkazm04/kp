import { resolveCapabilities, type Capability, type CapabilityOverride, type MemberRole } from "./roles";

// Cross-workspace authority (P2). `roles.ts` answers "what can this membership
// do?"; this module answers "what can this PERSON do across their organization?".
//
// The problem it solves: a role lives on a MEMBERSHIP, so it is per workspace
// (= per team). resolveCaller() in current-user.ts therefore resolves capabilities
// against the session's workspace only — which makes "an admin can administer any
// team in the company" impossible to express, even though org-service.ts has
// always ASSUMED it (orgOwnerUserIds/isSoleOwner union owners across every
// workspace of the org, and GET /api/org/members returns the whole org roster).
//
// The rule, made explicit here:
//
//   ADMINISTRATIVE capability (org:manage / members:manage / team:manage) is
//   ORG-WIDE — holding it in ANY workspace of the org confers it over EVERY
//   workspace of that org.
//
//   OPERATIONAL capability (read / pipeline:write) stays strictly PER-WORKSPACE —
//   being an owner of team A never grants you sight of team B's candidates.
//
// That split is the whole point: administering seats is a company-level job, but
// candidate data is exactly what a workspace exists to separate. Nothing here
// crosses an ORG boundary — the caller assembles the membership list from one
// org's workspaces and must never mix two.
//
// Pure + import-free apart from roles.ts (same doctrine as workspace-lock.ts /
// tenancy.ts) so the policy is unit-testable without a DB or a request.

/** The capabilities that are administrative — conferred org-wide rather than
 *  per-workspace. Deliberately excludes `read` and `pipeline:write`. */
export const ORG_ADMIN_CAPABILITIES: readonly Capability[] = ["org:manage", "members:manage", "team:manage"];

export type MembershipGrant = { role: MemberRole; overrides?: CapabilityOverride | null };

/** The ADMIN capabilities a person holds across an org: the union of every
 *  membership's effective capabilities, narrowed to ORG_ADMIN_CAPABILITIES.
 *  An empty membership list yields an empty set (fail closed). */
export function orgAdminCapabilities(memberships: readonly MembershipGrant[]): ReadonlySet<Capability> {
  const out = new Set<Capability>();
  for (const m of memberships) {
    const caps = resolveCapabilities(m.role, m.overrides ?? null);
    for (const admin of ORG_ADMIN_CAPABILITIES) if (caps.has(admin)) out.add(admin);
  }
  return out;
}

/** A person's EFFECTIVE capabilities on one workspace: what their own membership
 *  there grants, plus the org-wide admin caps. `orgMemberships` must already be
 *  filtered to a single org (see callerWorkspaceCapabilities in current-user.ts) —
 *  passing another org's memberships would grant authority across tenants. */
export function workspaceCapabilities(
  inWorkspace: ReadonlySet<Capability>,
  orgMemberships: readonly MembershipGrant[],
): ReadonlySet<Capability> {
  return new Set<Capability>([...inWorkspace, ...orgAdminCapabilities(orgMemberships)]);
}

/** Everything the person holds ANYWHERE in the org — the ceiling on what they may
 *  hand to someone else.
 *
 *  DELEGATION ONLY. Never authorize a read or a write with this: it deliberately
 *  includes operational capabilities from OTHER teams, which is exactly what
 *  `workspaceCapabilities` refuses to do. The delegation question is different from
 *  the access question — "may I grant a recruiter seat on team B" is not "may I read
 *  team B". An admin staffing a team they don't sit on holds `pipeline:write` on
 *  their own team and could seat themselves on B at that role anyway, so refusing
 *  the grant protects nothing and would make org-wide administration unusable
 *  (`canAssignRole` reads the target ROLE's whole capability set, operational caps
 *  included). `org:manage` still cannot be handed out by anyone who lacks it. */
export function orgCapabilityCeiling(orgMemberships: readonly MembershipGrant[]): ReadonlySet<Capability> {
  const out = new Set<Capability>();
  for (const m of orgMemberships) for (const c of resolveCapabilities(m.role, m.overrides ?? null)) out.add(c);
  return out;
}
