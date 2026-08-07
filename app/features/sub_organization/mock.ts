// Mocked organization + member data for the Organization settings prototype.
// No API/DB yet — the /prototype round is about the surface, not persistence.
// Shaped so a real /api/organization payload can drop in later unchanged.

import type { LucideIcon } from "lucide-react";
import { Clock, MinusCircle } from "lucide-react";
import type { BadgeTone } from "@/app/_components/Badge";

export type MemberRole = "Owner" | "Admin" | "Recruiter" | "Hiring manager" | "Viewer";
export const MEMBER_ROLES: MemberRole[] = ["Owner", "Admin", "Recruiter", "Hiring manager", "Viewer"];

export type MemberStatus = "active" | "invited" | "disabled";

export type OrgMember = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  /** ISO of last sign-in; null while an invite is still pending. */
  lastActiveIso: string | null;
};

export type AppLanguage = "en" | "cs";
export const APP_LANGUAGES: { value: AppLanguage; native: string }[] = [
  { value: "en", native: "English" },
  { value: "cs", native: "Čeština" },
];

export type OrgProfile = {
  name: string;
  domain: string;
  language: AppLanguage;
  seats: number;
};

export const MOCK_ORG: OrgProfile = {
  name: "Česká spořitelna",
  domain: "csas.cz",
  language: "en",
  seats: 25,
};

// Deterministic ISO timestamps (relative to early July 2026) so formatRelativeTime
// renders a stable "N days ago" without a runtime clock in the fixture.
export const MOCK_MEMBERS: OrgMember[] = [
  { id: "u1", name: "Petra Nováková", email: "petra.novakova@csas.cz", role: "Owner", status: "active", lastActiveIso: "2026-07-04T08:12:00Z" },
  { id: "u2", name: "Jan Dvořák", email: "jan.dvorak@csas.cz", role: "Admin", status: "active", lastActiveIso: "2026-07-03T16:40:00Z" },
  { id: "u3", name: "Markéta Svobodová", email: "marketa.svobodova@csas.cz", role: "Recruiter", status: "active", lastActiveIso: "2026-07-02T10:05:00Z" },
  { id: "u4", name: "Tomáš Horák", email: "tomas.horak@csas.cz", role: "Hiring manager", status: "active", lastActiveIso: "2026-06-30T09:00:00Z" },
  { id: "u5", name: "Lucie Marková", email: "lucie.markova@csas.cz", role: "Recruiter", status: "invited", lastActiveIso: null },
  { id: "u6", name: "David Beneš", email: "david.benes@csas.cz", role: "Viewer", status: "disabled", lastActiveIso: "2026-05-20T10:00:00Z" },
];

export type MemberStatusBadge = { tone: BadgeTone; label: string; icon?: LucideIcon; dot?: boolean; muted?: boolean };

/** Member status → semantic Badge props. Active pulses a live dot; a pending
 *  invite reads as info; a disabled seat recedes (muted) so it never competes. */
export function memberStatusBadge(status: MemberStatus): MemberStatusBadge {
  if (status === "active") return { tone: "positive", label: "Active", dot: true };
  if (status === "invited") return { tone: "info", label: "Invited", icon: Clock };
  return { tone: "neutral", label: "Disabled", icon: MinusCircle, muted: true };
}

/** Role → a theme-mapped tint pair for the monogram/avatar. Encodes a real fact
 *  (the member's role) in colour instead of a decorative hash. Every shade here
 *  already carries a dark mapping (it's a Badge tone shade), so both themes hold. */
export function roleTone(role: MemberRole): string {
  switch (role) {
    case "Owner":
      return "bg-coral/12 text-coral";
    case "Admin":
      return "bg-moss/15 text-moss";
    case "Recruiter":
      return "bg-blue-50 text-blue-700";
    case "Hiring manager":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-stone-100 text-steel";
  }
}

/** Derive a display name from an invited email's local part ("jan.dvorak" → "Jan Dvořák"-ish). */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || email;
}

// Shared prop contract — every Organization variant consumes exactly this, so the
// switcher host owns the (mocked) state and the consumers stay untouched.
export type OrgViewProps = {
  org: OrgProfile;
  onOrgChange: (patch: Partial<OrgProfile>) => void;
  members: OrgMember[];
  onInvite: (email: string, role: MemberRole) => void;
  onRoleChange: (id: string, role: MemberRole) => void;
  onRemove: (id: string) => void;
};
