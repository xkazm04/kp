"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "@/app/_components/toast-store";
import { EYEBROW, INTRO, STAT, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import { countActiveMembers, type AppLanguage } from "@/app/features/shared/memberUi";
import { OrganizationGeneralPanel } from "./OrganizationGeneralPanel";
import { OrganizationMembersPanel } from "./OrganizationMembersPanel";
import { OrganizationMemberConfirmModals } from "./OrganizationMemberConfirmModals";
import { readError } from "./organizationMemberHelpers";
import { useOrganizationMembers, type MemberTeam, type OrgMemberDto } from "./useOrganizationMembers";

// Tier 3 (docs/LOADING_CHOREOGRAPHY.md): the permissions editor is a click-only
// dialog — most sessions never open it — so it gets its own chunk instead of
// riding along in the tab's entry payload. No reserved-height loading affordance:
// it is an overlay, not a region in the page's flow.
const MemberPermissionsModal = dynamic(
  () => import("./OrganizationMemberPermissionsModal").then((m) => ({ default: m.MemberPermissionsModal })),
  { loading: () => null }
);

export function OrganizationConsole({
  name,
  nameSave = "idle",
  domain,
  language,
  onNameChange,
  onLanguageChange,
}: {
  name: string;
  /** Autosave state of the debounced org-name write, rendered beside the field. */
  nameSave?: "idle" | "saving" | "saved" | "error";
  domain: string;
  language: AppLanguage;
  onNameChange: (v: string) => void;
  onLanguageChange: (v: AppLanguage) => void;
}) {
  const { members, invites, canManage, callerCaps, loading, error, reload } = useOrganizationMembers();
  const [editing, setEditing] = useState<{ member: OrgMemberDto; team: MemberTeam } | null>(null);
  // Destructive confirms — the shared themed Modal, not window.confirm (the one
  // dialog the theme system can't style; see JobPostingModal). Removing a member
  // deletes their account; revoking kills an already-shared invite link — both
  // were one misclick away (revoke had NO confirmation at all).
  const [confirmingRemove, setConfirmingRemove] = useState<OrgMemberDto | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<{ token: string; email: string } | null>(null);

  // bug-ui-scan-2026-07-09 (organizations-members-invites #5): count only truly
  // `active` seats — the old `!== "disabled"` test counted pending `invited` seats.
  const activeCount = countActiveMembers(members);

  async function patchMember(userId: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/org/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (r && r.ok) {
      await reload();
      return;
    }
    const err = await readError(r);
    toast.error(err === "last_owner" ? "The organization must keep at least one owner." : "Update failed");
  }

  async function removeMember(m: OrgMemberDto) {
    const who = m.user.name ?? m.user.email;
    const r = await fetch(`/api/org/members/${m.user.id}`, { method: "DELETE" }).catch(() => null);
    if (r && r.ok) {
      toast.success(`Removed ${who}`);
      await reload();
    } else {
      const err = await readError(r);
      toast.error(err === "last_owner" ? "The organization must keep at least one owner." : "Couldn't remove the member");
    }
  }

  async function revoke(token: string) {
    const r = await fetch(`/api/org/invites/${token}`, { method: "DELETE" }).catch(() => null);
    if (r && r.ok) {
      toast.success("Invitation revoked");
      await reload();
    } else {
      toast.error("Couldn't revoke the invite");
    }
  }

  async function copyInviteLink(token: string) {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Copy failed — the link is in the console");
      console.log("[invite link]", url);
    }
  }

  return (
    // Tier 1: header, General settings and the Members panel frame all render with
    // no data (name/domain/language are already hydrated by the caller); aria-busy
    // covers only the first member-roster fetch — a later reload() never re-arms it
    // (useOrganizationMembers's `loading` only ever goes true -> false once).
    <section className="stagger-children mx-auto max-w-6xl space-y-6" aria-busy={loading}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-stone-200 pb-5">
        <div>
          <p className={EYEBROW}>Settings</p>
          <h1 className="mt-1 font-serif text-display text-ink">Organization</h1>
          <p className={`mt-2 max-w-xl ${INTRO}`}>Account identity, default language, and member administration.</p>
        </div>
        <div className="flex gap-2.5">
          <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>Members</span>
            <span className={`${STAT_VALUE} text-ink`}>{members.length}</span>
          </div>
          <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>Active</span>
            <span className={`${STAT_VALUE} text-moss`}>{activeCount}</span>
          </div>
          <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>Pending</span>
            <span className={`${STAT_VALUE} text-ink`}>{invites.length}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <OrganizationGeneralPanel
          name={name}
          nameSave={nameSave}
          domain={domain}
          language={language}
          onNameChange={onNameChange}
          onLanguageChange={onLanguageChange}
        />
        <OrganizationMembersPanel
          members={members}
          invites={invites}
          canManage={canManage}
          loading={loading}
          error={error}
          reload={reload}
          onPatchMember={patchMember}
          onEditPermissions={(member, team) => setEditing({ member, team })}
          onConfirmRemove={setConfirmingRemove}
          onCopyInviteLink={copyInviteLink}
          onConfirmRevoke={setConfirmingRevoke}
        />
      </div>

      <OrganizationMemberConfirmModals
        confirmingRemove={confirmingRemove}
        onCancelRemove={() => setConfirmingRemove(null)}
        onConfirmRemove={(m) => void removeMember(m)}
        confirmingRevoke={confirmingRevoke}
        onCancelRevoke={() => setConfirmingRevoke(null)}
        onConfirmRevoke={(token) => void revoke(token)}
      />

      {editing ? (
        <MemberPermissionsModal
          member={editing.member}
          team={editing.team}
          callerCaps={callerCaps}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      ) : null}
    </section>
  );
}
