"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { initials } from "@/app/_lib/initials";
import { Badge } from "@/app/_components/Badge";
import { Select } from "@/app/_components/Select";
import { BTN_GHOST, BTN_PRIMARY, PANEL } from "@/app/_components/ui/recipes";
import { ASSIGNABLE_ROLES, roleLabel, roleTone, statusBadge } from "@/app/features/shared/memberUi";
import { type MemberRole } from "@/app/_lib/auth/roles";
import { memberName } from "./workspaceAdminHelpers";
import type { OrgMemberDto, WorkspaceDto } from "./useWorkspaceAdmin";

// The Workspaces console — the By-person view. Same data as the By-workspace
// view, pivoted: one row per person, with their memberships as chips.
//
// This is the view that makes the many-to-many model visible. The old console
// rendered `m.teams[0]` and nothing else, so a recruiter who worked two teams
// looked identical to one who worked one, and there was no way to tell which team
// the role on screen belonged to. Here every seat is its own removable chip and
// the "+" adds another.
export function WorkspacePeoplePanel({
  members,
  workspaces,
  loading,
  error,
  canManageMembers,
  busy,
  onSeatMember,
  onConfirmRemoveFromWorkspace,
  onPatchMember,
  onConfirmRemove,
}: {
  members: OrgMemberDto[];
  workspaces: WorkspaceDto[];
  loading: boolean;
  /** The roster fetch failed. A flag, not a message — the copy lives in the catalog. */
  error: boolean;
  canManageMembers: boolean;
  busy: boolean;
  onSeatMember: (userId: string, workspaceId: string, role: MemberRole) => void;
  onConfirmRemoveFromWorkspace: (member: OrgMemberDto, workspaceId: string) => void;
  onPatchMember: (userId: string, body: Record<string, unknown>) => void;
  onConfirmRemove: (member: OrgMemberDto) => void;
}) {
  const t = useTranslations("workspaceAdmin");
  const tm = useTranslations("workspaceAdmin.members");
  // Which row has its "add to another team" control open, so the panel isn't a
  // wall of always-visible selects.
  const [adding, setAdding] = useState<string | null>(null);
  const [addWorkspaceId, setAddWorkspaceId] = useState("");
  const [addRole, setAddRole] = useState<MemberRole>("recruiter");

  const nameOf = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id;

  function openAdd(userId: string) {
    setAdding(userId);
    setAddWorkspaceId("");
    setAddRole("recruiter");
  }

  function commitAdd(userId: string) {
    if (!addWorkspaceId) return;
    onSeatMember(userId, addWorkspaceId, addRole);
    setAdding(null);
  }

  if (loading) return <div className={`${PANEL} reveal-quiet min-h-[18rem] lg:col-span-3`} aria-hidden />;
  if (error) return <p className={`${PANEL} p-6 text-sm text-coral lg:col-span-3`}>{tm("loadError")}</p>;

  return (
    <div className={`${PANEL} overflow-hidden lg:col-span-3`}>
      <ul className="divide-y divide-stone-100">
        {members.map((m) => {
          const disabled = m.user.status === "disabled";
          const displayName = memberName(m);
          const isOwnerSomewhere = m.teams.some((team) => team.role === "owner");
          // Teams they could still join — the chip row already shows the rest.
          const joinable = workspaces.filter((w) => w.canManage && !m.teams.some((team) => team.workspaceId === w.id));
          return (
            <li key={m.user.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
              <div className="flex min-w-[14rem] flex-1 items-center gap-2.5">
                <span
                  aria-hidden
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    m.teams[0] ? roleTone(m.teams[0].role) : "bg-stone-100 text-steel"
                  } ${disabled ? "opacity-50 grayscale" : ""}`}
                >
                  {initials(displayName)}
                </span>
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${disabled ? "text-steel" : "text-ink"}`}>{displayName}</p>
                  <p className="truncate text-xs text-steel">{m.user.email}</p>
                </div>
              </div>

              <div className="flex min-w-[8rem] items-center gap-2">
                <Badge {...statusBadge(m.user.status, tm)} />
                {canManageMembers && !isOwnerSomewhere && m.user.status !== "invited" ? (
                  <button
                    type="button"
                    onClick={() => onPatchMember(m.user.id, { status: disabled ? "active" : "disabled" })}
                    className="text-xs font-medium text-steel underline decoration-dotted underline-offset-2 hover:text-ink"
                  >
                    {disabled ? tm("enable") : tm("disable")}
                  </button>
                ) : null}
              </div>

              {/* The membership chips: one per team this person sits on. */}
              <div className="flex min-w-[16rem] flex-[2] flex-wrap items-center gap-1.5">
                {m.teams.length === 0 ? <span className="text-xs italic text-steel">{t("notInAnyWorkspace")}</span> : null}
                {m.teams.map((team) => (
                  <span
                    key={team.workspaceId}
                    className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 py-0.5 pl-2 pr-1 text-xs text-ink dark:rotate-1"
                  >
                    <span className="font-medium">{nameOf(team.workspaceId)}</span>
                    <span className="text-steel">{roleLabel(team.role, tm)}</span>
                    {canManageMembers && team.role !== "owner" ? (
                      <button
                        type="button"
                        onClick={() => onConfirmRemoveFromWorkspace(m, team.workspaceId)}
                        className="focus-ring grid h-4 w-4 place-items-center rounded-full text-steel hover:bg-stone-200 hover:text-ink"
                        aria-label={t("removeFromWorkspaceChipAria", { name: displayName, workspace: nameOf(team.workspaceId) })}
                      >
                        <X size={11} aria-hidden />
                      </button>
                    ) : null}
                  </span>
                ))}

                {canManageMembers && joinable.length > 0 ? (
                  adding === m.user.id ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <Select
                        value={addWorkspaceId}
                        onChange={setAddWorkspaceId}
                        size="sm"
                        ariaLabel={t("addToWorkspaceAria", { name: displayName })}
                        options={[
                          { value: "", label: t("addToWorkspacePlaceholder") },
                          ...joinable.map((w) => ({ value: w.id, label: w.name ?? w.id })),
                        ]}
                      />
                      <Select
                        value={addRole}
                        onChange={(v) => setAddRole(v as MemberRole)}
                        size="sm"
                        ariaLabel={tm("inviteRoleAria")}
                        options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, tm) }))}
                      />
                      <button type="button" onClick={() => commitAdd(m.user.id)} disabled={!addWorkspaceId || busy} className={`${BTN_PRIMARY} h-7 px-2.5 text-xs`}>
                        {t("addMember")}
                      </button>
                      <button type="button" onClick={() => setAdding(null)} className={`${BTN_GHOST} h-7 w-7 justify-center`} aria-label={tm("confirmRemove.cancel")}>
                        <X size={13} aria-hidden />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openAdd(m.user.id)}
                      className="focus-ring inline-flex items-center gap-0.5 rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-xs text-steel hover:border-coral hover:text-coral"
                    >
                      <Plus size={11} aria-hidden /> {t("addToWorkspace")}
                    </button>
                  )
                ) : null}
              </div>

              {/* The one genuinely destructive action, kept alone at the end of the
                  row: this deletes the account, not a seat. */}
              <div className="ml-auto">
                {canManageMembers && !isOwnerSomewhere ? (
                  <button
                    type="button"
                    onClick={() => onConfirmRemove(m)}
                    className={`${BTN_GHOST} h-8 w-8 justify-center`}
                    aria-label={tm("removeAria", { name: displayName })}
                    title={tm("removeAria", { name: displayName })}
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
