import { Clock, MinusCircle } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { BadgeContent } from "@/app/_components/Badge";
import type { Capability, MemberRole } from "@/app/_lib/auth/roles";

// Presentational helpers for the REAL role slugs (auth/roles), replacing the mock
// module on the Organization page. Colours resolve through the token seam, so both
// themes hold (docs/design/README.md).
//
// COPY: this is a plain `.ts` module, so `useTranslations` (a hook) cannot be
// called here. Every label-producing helper therefore TAKES a bound translator
// from its caller — the same shape `pipelineTranslator.ts` names for the pipeline
// split, and the "a pure builder takes its copy as a parameter" rule in
// docs/architecture/localization.md. Roles/statuses read from
// `workspaceAdmin.members`, capabilities from `workspaceAdmin.permissions`; the
// caller is always a client component that already holds the namespace.

/** The `workspaceAdmin.members` translator — roles and member statuses. */
export type MembersTranslator = ReturnType<typeof useTranslations<"workspaceAdmin.members">>;
/** The `workspaceAdmin.permissions` translator — capability labels/descriptions. */
export type PermissionsTranslator = ReturnType<typeof useTranslations<"workspaceAdmin.permissions">>;

// The two app languages the org can run in. `native` is each language's own
// endonym — a proper noun in every locale, so it is deliberately NOT translated
// (docs/architecture/localization.md, "named constants that are not copy").
export type AppLanguage = "en" | "cs";
export const APP_LANGUAGES: { value: AppLanguage; native: string }[] = [
  { value: "en", native: "English" },
  { value: "cs", native: "Čeština" },
];

// Roles assignable from the invite + per-member dropdowns. Owner is excluded —
// ownership moves by promotion, not a casual dropdown pick, and the last-owner
// guard protects the org either way.
export const ASSIGNABLE_ROLES: MemberRole[] = ["admin", "recruiter", "hiring_manager", "viewer"];

export function roleLabel(role: MemberRole, t: MembersTranslator): string {
  return t(`role.${role}`);
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

// bug-ui-scan-2026-07-09 (organizations-members-invites #5): the "Active" stat must
// count only truly-active seats. The console previously counted `status !== "disabled"`,
// which folded still-`invited` (pending) seats into Active and inflated the number.
export function countActiveMembers(members: { user: { status: MemberStatus } }[]): number {
  return members.filter((m) => m.user.status === "active").length;
}

/** Member status → semantic Badge props. Active pulses a live dot; a pending invite
 *  reads as info; a disabled seat recedes (muted) so it never competes. */
export function statusBadge(status: MemberStatus, t: MembersTranslator): BadgeContent & { dot?: boolean; muted?: boolean } {
  if (status === "active") return { tone: "positive", label: t("status.active"), dot: true };
  if (status === "invited") return { tone: "info", label: t("status.invited"), icon: Clock };
  return { tone: "neutral", label: t("status.disabled"), icon: MinusCircle, muted: true };
}

// The overridable capabilities, for the per-user permission editor. Order = most-
// to least-privileged operationally. The slug carries a colon, which is not a
// catalog-key character, so each row names its own `key` under
// `workspaceAdmin.permissions.caps.*`.
export const CAPABILITY_ORDER: { cap: Capability; key: "manageMembers" | "manageTeams" | "editPipeline" | "view" }[] = [
  { cap: "members:manage", key: "manageMembers" },
  { cap: "team:manage", key: "manageTeams" },
  { cap: "pipeline:write", key: "editPipeline" },
  { cap: "read", key: "view" },
];

/** The capability rows with their localized label + one-line description. */
export function capabilityMeta(t: PermissionsTranslator): { cap: Capability; label: string; desc: string }[] {
  return CAPABILITY_ORDER.map(({ cap, key }) => ({
    cap,
    label: t(`caps.${key}.label`),
    desc: t(`caps.${key}.desc`),
  }));
}
