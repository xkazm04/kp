import { Clock, MinusCircle } from "lucide-react";
import type { BadgeContent } from "@/app/_components/Badge";
import type { Capability, MemberRole } from "@/app/_lib/auth/roles";

// Presentational helpers for the REAL role slugs (auth/roles), replacing the mock
// module on the Organization page. Colours resolve through the token seam, so both
// themes hold (docs/DESIGN.md).

export type AppLanguage = "en" | "cs";
export const APP_LANGUAGES: { value: AppLanguage; native: string }[] = [
  { value: "en", native: "English" },
  { value: "cs", native: "Čeština" },
];

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  viewer: "Viewer",
};

// Roles assignable from the invite + per-member dropdowns. Owner is excluded —
// ownership moves by promotion, not a casual dropdown pick, and the last-owner
// guard protects the org either way.
export const ASSIGNABLE_ROLES: MemberRole[] = ["admin", "recruiter", "hiring_manager", "viewer"];

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** Role → monogram tint (encodes the role in colour; every shade carries a dark
 *  mapping via the Badge tone shades, so both themes hold). */
export function roleTone(role: MemberRole): string {
  switch (role) {
    case "owner":
      return "bg-coral/12 text-coral";
    case "admin":
      return "bg-moss/15 text-moss";
    case "recruiter":
      return "bg-blue-50 text-blue-700";
    case "hiring_manager":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-stone-100 text-steel";
  }
}

export type MemberStatus = "active" | "invited" | "disabled";

/** Member status → semantic Badge props. Active pulses a live dot; a pending invite
 *  reads as info; a disabled seat recedes (muted) so it never competes. */
export function statusBadge(status: MemberStatus): BadgeContent & { dot?: boolean; muted?: boolean } {
  if (status === "active") return { tone: "positive", label: "Active", dot: true };
  if (status === "invited") return { tone: "info", label: "Invited", icon: Clock };
  return { tone: "neutral", label: "Disabled", icon: MinusCircle, muted: true };
}

// The overridable capabilities with human labels + one-line descriptions, for the
// per-user permission editor. Order = most- to least-privileged operationally.
export const CAPABILITY_META: { cap: Capability; label: string; desc: string }[] = [
  { cap: "members:manage", label: "Manage members", desc: "Invite people and adjust their permissions (a “Writer”)." },
  { cap: "team:manage", label: "Manage teams", desc: "Create and rename teams." },
  { cap: "pipeline:write", label: "Edit pipeline", desc: "Move candidates, run decisions, send comms." },
  { cap: "read", label: "View", desc: "See the team’s candidates and data." },
];
