"use client";

import { LogOut, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { initials } from "@/app/_lib/initials";
import { Badge } from "@/app/_components/Badge";
import { Select } from "@/app/_components/Select";
import { BTN_GHOST, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { ASSIGNABLE_ROLES, roleLabel, roleTone, statusBadge } from "@/app/features/shared/memberUi";
import { hasCustomPermissions, holdsOwnerSeat, memberName, teamFor } from "./workspaceAdminHelpers";
import type { MemberTeam, OrgMemberDto } from "./useWorkspaceAdmin";

// The roster of ONE team: role select, account status, permissions, and "remove
// from this team". Moved here from settings/organization (was
// OrganizationMembersTable) and re-keyed from primaryTeam(m) — seat [0] — to
// teamFor(m, workspaceId), so a person who belongs to three teams now shows three
// different roles instead of the same one three times.
//
// The trailing action is deliberately NOT account deletion any more: taking
// somebody off a team is reversible and routine, deleting their account is neither.
// That lives in the By-person view, where the blast radius is legible.
export function WorkspaceMembersTable({
  members,
  workspaceId,
  loading,
  error,
  canManage,
  pendingMembers,
  onPatchMember,
  onEditPermissions,
  onConfirmRemoveFromWorkspace,
}: {
  members: OrgMemberDto[];
  workspaceId: string;
  loading: boolean;
  /** The roster fetch failed. A flag, not a message — the copy lives in the catalog. */
  error: boolean;
  canManage: boolean;
  /** Rows with a role/status write in flight — locked until the reload lands. */
  pendingMembers: string[];
  onPatchMember: (userId: string, body: Record<string, unknown>) => void;
  onEditPermissions: (member: OrgMemberDto, team: MemberTeam) => void;
  onConfirmRemoveFromWorkspace: (member: OrgMemberDto) => void;
}) {
  const t = useTranslations("workspaceAdmin.members");
  // Tier 2: the roster fetch is in flight and there is nothing to show yet — hold
  // the table's height and stay invisible for 150ms so a warm response never
  // flashes a false "no members" empty state.
  return (
    <div className="overflow-x-auto">
      {loading ? (
        <div className="reveal-quiet min-h-[14rem]" aria-hidden />
      ) : error ? (
        <p role="alert" className="px-5 py-6 text-sm text-coral">{t("loadError")}</p>
      ) : members.length === 0 ? (
        <p className="px-5 py-6 text-sm text-steel">{t("noMembers")}</p>
      ) : (
        <div className="animate-arrive-in">
          <table className="w-full min-w-[38rem] text-left">
            <thead>
              <tr className="border-b border-stone-200 text-meta uppercase text-steel">
                <th className="px-5 py-2 font-medium">{t("colMember")}</th>
                <th className="px-2 py-2 font-medium">{t("colRole")}</th>
                <th className="px-2 py-2 font-medium">{t("colStatus")}</th>
                <th className="px-2 py-2 font-medium">{t("colPermissions")}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {members.map((m) => {
                const team = teamFor(m, workspaceId);
                const isOwner = team?.role === "owner";
                // Enable/Disable writes the ACCOUNT's status org-wide, so it asks
                // the org-wide question. `isOwner` (this team's seat) is the right
                // gate for the membership-scoped controls beside it — role, seat
                // permissions, remove-from-team — and the wrong one here: a
                // co-owner sitting on this team as a recruiter would have been
                // offered a Disable that locks them out of every team they own.
                const ownerSomewhere = holdsOwnerSeat(m);
                const disabled = m.user.status === "disabled";
                const custom = team ? hasCustomPermissions(team) : false;
                const displayName = memberName(m);
                const pending = pendingMembers.includes(m.user.id);
                return (
                  <tr key={m.user.id} className="align-middle" aria-busy={pending}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-micro font-semibold ${team ? roleTone(team.role) : "bg-stone-100 text-steel"} ${
                            disabled ? "opacity-50 grayscale" : ""
                          }`}
                        >
                          {initials(displayName)}
                        </span>
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-medium ${disabled ? "text-steel" : "text-ink"}`}>{displayName}</p>
                          <p className="truncate text-micro text-steel">{m.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {canManage && team && !isOwner ? (
                        <Select
                          value={team.role}
                          onChange={(v) => onPatchMember(m.user.id, { workspaceId, role: v })}
                          ariaLabel={t("roleAria", { name: displayName })}
                          disabled={pending}
                          size="sm"
                          options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, t) }))}
                        />
                      ) : (
                        <span className="text-sm text-ink">{team ? roleLabel(team.role, t) : "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                        <Badge {...statusBadge(m.user.status, t)} />
                        {canManage && !ownerSomewhere && m.user.status !== "invited" ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => onPatchMember(m.user.id, { status: disabled ? "active" : "disabled" })}
                            className="text-micro font-medium text-steel underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-50"
                          >
                            {disabled ? t("enable") : t("disable")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {isOwner ? (
                        <span className="text-micro text-steel">{t("fullAccess")}</span>
                      ) : canManage && team ? (
                        <button
                          type="button"
                          onClick={() => onEditPermissions(m, team)}
                          className={`${BTN_GHOST} h-8 gap-1.5 px-2 text-sm`}
                        >
                          <SlidersHorizontal size={14} aria-hidden />
                          {custom ? (
                            <span className={`${CHIP_QUIET} bg-coral/10 text-micro font-semibold text-coral`}>{t("custom")}</span>
                          ) : (
                            t("edit")
                          )}
                        </button>
                      ) : (
                        <span className="text-micro text-steel">{custom ? t("custom") : t("roleDefault")}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canManage && !isOwner ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => onConfirmRemoveFromWorkspace(m)}
                          className={`${BTN_GHOST} h-8 w-8 justify-center`}
                          aria-label={t("removeFromWorkspaceAria", { name: displayName })}
                          title={t("removeFromWorkspace")}
                        >
                          <LogOut size={15} aria-hidden />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
