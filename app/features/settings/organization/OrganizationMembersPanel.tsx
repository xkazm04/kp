"use client";

import { useState } from "react";
import { Copy, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { type MemberRole } from "@/app/_lib/auth/roles";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { BTN_GHOST, BTN_PRIMARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { ASSIGNABLE_ROLES, roleLabel } from "@/app/features/shared/memberUi";
import { OrganizationMembersTable } from "./OrganizationMembersTable";
import type { InviteDto, MemberTeam, OrgMemberDto } from "./useOrganizationMembers";

// Organization console — right panel: invite row, members table, and pending
// invites. Split out of OrganizationConsole.tsx; behaviour (fetches, confirms)
// stays owned by the console, this panel only renders + calls back up.
export function OrganizationMembersPanel({
  members,
  invites,
  canManage,
  loading,
  error,
  reload,
  onPatchMember,
  onEditPermissions,
  onConfirmRemove,
  onCopyInviteLink,
  onConfirmRevoke,
}: {
  members: OrgMemberDto[];
  invites: InviteDto[];
  canManage: boolean;
  loading: boolean;
  /** The roster fetch failed. A flag, not a message — the copy lives in the catalog. */
  error: boolean;
  reload: () => Promise<void> | void;
  onPatchMember: (userId: string, body: Record<string, unknown>) => void;
  onEditPermissions: (member: OrgMemberDto, team: MemberTeam) => void;
  onConfirmRemove: (member: OrgMemberDto) => void;
  onCopyInviteLink: (token: string) => void;
  onConfirmRevoke: (invite: { token: string; email: string }) => void;
}) {
  const t = useTranslations("workspaceAdmin.members");
  const errMsg = useErrorMessage();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("recruiter");
  // bug-ui-scan-2026-07-09 (organizations-members-invites #5): in-flight lock so a
  // second click / Enter-repeat during the invite POST can't mint a duplicate
  // pending invite (each is an independently redeemable token).
  const [submitting, setSubmitting] = useState(false);

  async function submitInvite() {
    const trimmed = email.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    const r = await fetch("/api/org/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed, role }),
    }).catch(() => null);
    if (r && r.ok) {
      setEmail("");
      setRole("recruiter");
      toast.success(t("inviteCreated"));
      await reload();
    } else {
      // The route's English `error` is never rendered (docs/architecture/localization.md).
      // NOTE: POST /api/org/invites currently sends NO `code` on any of its three
      // refusals (invalid address 400 / role above your own 403 / already an active
      // member 409), so the resolver always lands on the localized fallback and the
      // specific reason is lost in all four languages. Closing that means giving the
      // route real codes + `errors.*` entries — deliberately not faked here.
      const payload = r ? ((await r.json().catch(() => null)) as ApiErrorPayload | null) : null;
      toast.error(errMsg(payload, t("inviteFailed")));
    }
    setSubmitting(false);
  }

  return (
    <div className={`${PANEL} overflow-hidden lg:col-span-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-5 py-4">
        <h2 className="font-serif text-h3 text-ink">{t("title")}</h2>
      </div>

      {/* Invite row (members:manage only) */}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-5 py-3">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitInvite()}
            placeholder={t("invitePlaceholder")}
            sizeVariant="sm"
            className="min-w-0 flex-1"
            aria-label={t("inviteEmailAria")}
            disabled={submitting}
          />
          <Select
            value={role}
            onChange={(v) => setRole(v as MemberRole)}
            size="sm"
            ariaLabel={t("inviteRoleAria")}
            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, t) }))}
          />
          {/* bug-ui-scan-2026-07-09 (organizations-members-invites #5): disabled while the
              POST is in flight (aria-busy) so a rapid second click can't double-submit. */}
          <button
            type="button"
            onClick={submitInvite}
            disabled={!email.trim() || submitting}
            aria-busy={submitting}
            className={`${BTN_PRIMARY} h-9 px-3.5`}
          >
            <UserPlus size={15} aria-hidden /> {submitting ? t("inviting") : t("invite")}
          </button>
        </div>
      ) : null}

      <OrganizationMembersTable
        members={members}
        loading={loading}
        error={error}
        canManage={canManage}
        onPatchMember={onPatchMember}
        onEditPermissions={onEditPermissions}
        onConfirmRemove={onConfirmRemove}
      />

      {/* Pending invites (members:manage only) */}
      {canManage && invites.length > 0 ? (
        <div className="border-t border-stone-200 px-5 py-4">
          <p className={`${META_LABEL} mb-2`}>{t("pendingTitle")}</p>
          <ul className="space-y-1.5">
            {invites.map((inv) => (
              <li key={inv.token} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{inv.email}</p>
                  <p className="text-xs text-steel">{roleLabel(inv.role, t)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onCopyInviteLink(inv.token)} className={`${BTN_GHOST} h-8 gap-1 px-2 text-sm`}>
                    <Copy size={14} aria-hidden /> {t("copyLink")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirmRevoke({ token: inv.token, email: inv.email })}
                    className={`${BTN_GHOST} h-8 w-8 justify-center`}
                    aria-label={t("revokeAria", { email: inv.email })}
                    title={t("revoke")}
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
