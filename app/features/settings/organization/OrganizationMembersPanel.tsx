"use client";

import { useState } from "react";
import { Copy, UserPlus, X } from "lucide-react";
import { toast } from "@/app/_components/toast-store";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { type MemberRole } from "@/app/_lib/auth/roles";
import { BTN_GHOST, BTN_PRIMARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { ASSIGNABLE_ROLES, roleLabel } from "@/app/features/shared/memberUi";
import { readError } from "./organizationMemberHelpers";
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
  error: string | null;
  reload: () => Promise<void> | void;
  onPatchMember: (userId: string, body: Record<string, unknown>) => void;
  onEditPermissions: (member: OrgMemberDto, team: MemberTeam) => void;
  onConfirmRemove: (member: OrgMemberDto) => void;
  onCopyInviteLink: (token: string) => void;
  onConfirmRevoke: (invite: { token: string; email: string }) => void;
}) {
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
      toast.success("Invitation created — copy the link to share it");
      await reload();
    } else {
      toast.error((await readError(r)) ?? "Couldn't create the invite");
    }
    setSubmitting(false);
  }

  return (
    <div className={`${PANEL} overflow-hidden lg:col-span-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-5 py-4">
        <h2 className="font-serif text-h3 text-ink">Members</h2>
      </div>

      {/* Invite row (members:manage only) */}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-5 py-3">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitInvite()}
            placeholder="Invite by email — name@company.com"
            sizeVariant="sm"
            className="min-w-0 flex-1"
            aria-label="Invite email"
            disabled={submitting}
          />
          <Select
            value={role}
            onChange={(v) => setRole(v as MemberRole)}
            size="sm"
            ariaLabel="Role for the invite"
            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
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
            <UserPlus size={15} aria-hidden /> {submitting ? "Inviting…" : "Invite"}
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
          <p className={`${META_LABEL} mb-2`}>Pending invitations</p>
          <ul className="space-y-1.5">
            {invites.map((inv) => (
              <li key={inv.token} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{inv.email}</p>
                  <p className="text-xs text-steel">{roleLabel(inv.role)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onCopyInviteLink(inv.token)} className={`${BTN_GHOST} h-8 gap-1 px-2 text-sm`}>
                    <Copy size={14} aria-hidden /> Copy link
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirmRevoke({ token: inv.token, email: inv.email })}
                    className={`${BTN_GHOST} h-8 w-8 justify-center`}
                    aria-label={`Revoke invite for ${inv.email}`}
                    title="Revoke"
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
