"use client";

import { useState } from "react";
import { Check, Copy, LogIn, Pencil, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST, BTN_PRIMARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { ASSIGNABLE_ROLES, roleLabel } from "@/app/features/shared/memberUi";
import { type MemberRole } from "@/app/_lib/auth/roles";
import { WorkspaceMembersTable } from "./WorkspaceMembersTable";
import { invitesForWorkspace, memberName, membersNotInWorkspace, membersOfWorkspace } from "./workspaceAdminHelpers";
import type { InviteDto, MemberTeam, OrgMemberDto, WorkspaceDto } from "./useWorkspaceAdmin";

// The Workspaces console — right column: everything about ONE team. Its name
// (renameable in place), the roster, the two ways to add somebody, and the invites
// still outstanding for it.
//
// "Add" is deliberately two doors on one row, because the two cases are different
// jobs: a colleague who already has an account joins instantly (seat them), while
// a stranger needs an invite link. The old console only had the second door, which
// is why putting an existing recruiter on a second team was impossible from the UI.
export function WorkspaceDetailPanel({
  workspace,
  members,
  invites,
  defaultWorkspaceId,
  isCurrent,
  canSwitch,
  canManageMembers,
  canManageTeams,
  loading,
  error,
  busy,
  onSwitch,
  onRename,
  onSeatMember,
  onInvite,
  onPatchMember,
  onEditPermissions,
  onConfirmRemoveFromWorkspace,
  onCopyInviteLink,
  onConfirmRevoke,
}: {
  workspace: WorkspaceDto;
  members: OrgMemberDto[];
  invites: InviteDto[];
  defaultWorkspaceId: string;
  isCurrent: boolean;
  canSwitch: boolean;
  canManageMembers: boolean;
  canManageTeams: boolean;
  loading: boolean;
  error: boolean;
  busy: boolean;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSeatMember: (userId: string, workspaceId: string, role: MemberRole) => void;
  onInvite: (email: string, role: MemberRole, workspaceId: string) => Promise<void> | void;
  onPatchMember: (userId: string, body: Record<string, unknown>) => void;
  onEditPermissions: (member: OrgMemberDto, team: MemberTeam) => void;
  onConfirmRemoveFromWorkspace: (member: OrgMemberDto) => void;
  onCopyInviteLink: (token: string) => void;
  onConfirmRevoke: (invite: { token: string; email: string }) => void;
}) {
  const t = useTranslations("workspaceAdmin");
  const tm = useTranslations("workspaceAdmin.members");

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [addMode, setAddMode] = useState<"existing" | "email">("existing");
  const [seatUserId, setSeatUserId] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("recruiter");
  // In-flight lock so a second click / Enter-repeat during the invite POST can't
  // mint a duplicate pending invite (each is an independently redeemable token).
  const [submitting, setSubmitting] = useState(false);

  const seated = membersOfWorkspace(members, workspace.id);
  const available = membersNotInWorkspace(members, workspace.id);
  const pending = invitesForWorkspace(invites, workspace.id, defaultWorkspaceId);

  function startRename() {
    setDraftName(workspace.name ?? "");
    setRenaming(true);
  }

  function commitRename(e: React.FormEvent) {
    e.preventDefault();
    const clean = draftName.trim();
    setRenaming(false);
    if (clean && clean !== workspace.name) onRename(workspace.id, clean);
  }

  function seat() {
    if (!seatUserId) return;
    onSeatMember(seatUserId, workspace.id, role);
    setSeatUserId("");
  }

  async function invite() {
    const trimmed = email.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    await onInvite(trimmed, role, workspace.id);
    setEmail("");
    setSubmitting(false);
  }

  return (
    <div className={`${PANEL} overflow-hidden lg:col-span-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-5 py-4">
        <div className="min-w-0">
          {renaming ? (
            <form onSubmit={commitRename} className="flex items-center gap-2">
              <TextInput
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                sizeVariant="sm"
                autoFocus
                aria-label={t("renameAria", { workspace: workspace.name ?? workspace.id })}
                className="min-w-0"
              />
              <button type="submit" className={`${BTN_GHOST} h-8 w-8 justify-center`} aria-label={t("rename")}>
                <Check size={15} aria-hidden />
              </button>
            </form>
          ) : (
            <h2 className="flex items-center gap-2 font-serif text-h3 text-ink">
              {workspace.name ?? workspace.id}
              {canManageTeams ? (
                <button
                  type="button"
                  onClick={startRename}
                  className={`${BTN_GHOST} h-7 w-7 justify-center`}
                  aria-label={t("renameAria", { workspace: workspace.name ?? workspace.id })}
                  title={t("rename")}
                >
                  <Pencil size={13} aria-hidden />
                </button>
              ) : null}
            </h2>
          )}
          <p className="mt-0.5 font-mono text-xs text-stone-400">{workspace.id}</p>
        </div>
        {isCurrent ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-moss">
            <Check className="h-4 w-4" aria-hidden />
            {t("current")}
          </span>
        ) : canSwitch ? (
          <button type="button" onClick={() => onSwitch(workspace.id)} disabled={busy} className={`${BTN_GHOST} h-9 gap-1.5 px-3 text-sm`}>
            <LogIn size={15} aria-hidden /> {t("switch")}
          </button>
        ) : null}
      </div>

      {/* Add a person: seat an existing colleague, or invite a new address. Both
          write against THIS workspace, which is what makes multi-team membership
          reachable at all. */}
      {canManageMembers ? (
        <div className="border-b border-stone-200 bg-stone-50 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("addMember")} className="inline-flex items-center gap-0.5 rounded-md border border-stone-200 bg-white p-0.5">
              {(["existing", "email"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={addMode === mode}
                  onClick={() => setAddMode(mode)}
                  className={`focus-ring rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    addMode === mode ? "bg-ink text-white" : "text-steel hover:text-ink"
                  }`}
                >
                  {mode === "existing" ? t("addExisting") : t("addByEmail")}
                </button>
              ))}
            </div>

            {addMode === "existing" ? (
              <>
                <Select
                  value={seatUserId}
                  onChange={setSeatUserId}
                  size="sm"
                  ariaLabel={t("addExistingAria")}
                  options={[
                    { value: "", label: t("addExistingPlaceholder") },
                    ...available.map((m) => ({ value: m.user.id, label: memberName(m) })),
                  ]}
                />
                <Select
                  value={role}
                  onChange={(v) => setRole(v as MemberRole)}
                  size="sm"
                  ariaLabel={tm("inviteRoleAria")}
                  options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, tm) }))}
                />
                <button type="button" onClick={seat} disabled={!seatUserId || busy} className={`${BTN_PRIMARY} h-9 px-3.5`}>
                  <UserPlus size={15} aria-hidden /> {t("addMember")}
                </button>
              </>
            ) : (
              <>
                <TextInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void invite()}
                  placeholder={tm("invitePlaceholder")}
                  sizeVariant="sm"
                  className="min-w-0 flex-1"
                  aria-label={tm("inviteEmailAria")}
                  disabled={submitting}
                />
                <Select
                  value={role}
                  onChange={(v) => setRole(v as MemberRole)}
                  size="sm"
                  ariaLabel={tm("inviteRoleAria")}
                  options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, tm) }))}
                />
                <button
                  type="button"
                  onClick={() => void invite()}
                  disabled={!email.trim() || submitting}
                  aria-busy={submitting}
                  className={`${BTN_PRIMARY} h-9 px-3.5`}
                >
                  <UserPlus size={15} aria-hidden /> {submitting ? tm("inviting") : tm("invite")}
                </button>
              </>
            )}
          </div>
          {addMode === "existing" && available.length === 0 && !loading ? (
            <p className="mt-2 text-xs text-steel">{t("everyoneSeated")}</p>
          ) : null}
        </div>
      ) : null}

      <WorkspaceMembersTable
        members={seated}
        workspaceId={workspace.id}
        loading={loading}
        error={error}
        canManage={canManageMembers}
        onPatchMember={onPatchMember}
        onEditPermissions={onEditPermissions}
        onConfirmRemoveFromWorkspace={onConfirmRemoveFromWorkspace}
      />

      {/* Pending invites for THIS team (members:manage only). */}
      {canManageMembers && pending.length > 0 ? (
        <div className="border-t border-stone-200 px-5 py-4">
          <p className={`${META_LABEL} mb-2`}>{tm("pendingTitle")}</p>
          <ul className="space-y-1.5">
            {pending.map((inv) => (
              <li key={inv.token} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{inv.email}</p>
                  <p className="text-xs text-steel">{roleLabel(inv.role, tm)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onCopyInviteLink(inv.token)} className={`${BTN_GHOST} h-8 gap-1 px-2 text-sm`}>
                    <Copy size={14} aria-hidden /> {tm("copyLink")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirmRevoke({ token: inv.token, email: inv.email })}
                    className={`${BTN_GHOST} h-8 w-8 justify-center`}
                    aria-label={tm("revokeAria", { email: inv.email })}
                    title={tm("revoke")}
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
