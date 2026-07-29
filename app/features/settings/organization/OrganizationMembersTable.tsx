"use client";

import { SlidersHorizontal, Trash2 } from "lucide-react";
import { initials } from "@/app/_lib/initials";
import { Badge } from "@/app/_components/Badge";
import { Select } from "@/app/_components/Select";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { ASSIGNABLE_ROLES, roleLabel, roleTone, statusBadge } from "@/app/features/shared/memberUi";
import { hasCustomPermissions, primaryTeam } from "./organizationMemberHelpers";
import type { MemberTeam, OrgMemberDto } from "./useOrganizationMembers";

// Organization console — the members table itself (roster rows: role select,
// status/disable toggle, permissions edit, remove). Split out of
// OrganizationMembersPanel.tsx.
export function OrganizationMembersTable({
  members,
  loading,
  error,
  canManage,
  onPatchMember,
  onEditPermissions,
  onConfirmRemove,
}: {
  members: OrgMemberDto[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  onPatchMember: (userId: string, body: Record<string, unknown>) => void;
  onEditPermissions: (member: OrgMemberDto, team: MemberTeam) => void;
  onConfirmRemove: (member: OrgMemberDto) => void;
}) {
  // Members table. Tier 2: the roster fetch is in flight and there is
  // nothing to show yet — hold the table's height and stay invisible for
  // 150ms so a warm response never flashes a false "no members" empty
  // state. (Was a bare "Loading members…" line, same anti-pattern as an
  // empty gap: it painted immediately and told the user nothing useful.)
  return (
    <div className="overflow-x-auto">
      {loading ? (
        <div className="reveal-quiet min-h-[14rem]" aria-hidden />
      ) : error ? (
        <p className="px-5 py-6 text-sm text-coral">{error}</p>
      ) : (
        <div className="animate-arrive-in">
          <table className="w-full min-w-[38rem] text-left">
            <thead>
              <tr className="border-b border-stone-200 text-meta uppercase text-steel">
                <th className="px-5 py-2 font-medium">Member</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Permissions</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {members.map((m) => {
                const team = primaryTeam(m);
                const isOwner = team?.role === "owner";
                const disabled = m.user.status === "disabled";
                const custom = team ? hasCustomPermissions(team) : false;
                const displayName = m.user.name ?? m.user.email;
                return (
                  <tr key={m.user.id} className="align-middle">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${team ? roleTone(team.role) : "bg-stone-100 text-steel"} ${
                            disabled ? "opacity-50 grayscale" : ""
                          }`}
                        >
                          {initials(displayName)}
                        </span>
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-medium ${disabled ? "text-steel" : "text-ink"}`}>{displayName}</p>
                          <p className="truncate text-xs text-steel">{m.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {canManage && team && !isOwner ? (
                        <Select
                          value={team.role}
                          onChange={(v) => onPatchMember(m.user.id, { workspaceId: team.workspaceId, role: v })}
                          ariaLabel={`Role for ${displayName}`}
                          size="sm"
                          options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                        />
                      ) : (
                        <span className="text-sm text-ink">{team ? roleLabel(team.role) : "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                        <Badge {...statusBadge(m.user.status)} />
                        {canManage && !isOwner && m.user.status !== "invited" ? (
                          <button
                            type="button"
                            onClick={() => onPatchMember(m.user.id, { status: disabled ? "active" : "disabled" })}
                            className="text-xs font-medium text-steel underline decoration-dotted underline-offset-2 hover:text-ink"
                          >
                            {disabled ? "Enable" : "Disable"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {isOwner ? (
                        <span className="text-xs text-steel">Full access</span>
                      ) : canManage && team ? (
                        <button
                          type="button"
                          onClick={() => onEditPermissions(m, team)}
                          className={`${BTN_GHOST} h-8 gap-1.5 px-2 text-sm`}
                        >
                          <SlidersHorizontal size={14} aria-hidden />
                          {custom ? <span className="rounded-full bg-coral/10 px-1.5 py-0.5 text-[11px] font-semibold text-coral">Custom</span> : "Edit"}
                        </button>
                      ) : (
                        <span className="text-xs text-steel">{custom ? "Custom" : "Role default"}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canManage && !isOwner ? (
                        <button
                          type="button"
                          onClick={() => onConfirmRemove(m)}
                          className={`${BTN_GHOST} h-8 w-8 justify-center`}
                          aria-label={`Remove ${displayName}`}
                          title={`Remove ${displayName}`}
                        >
                          <Trash2 size={15} aria-hidden />
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
