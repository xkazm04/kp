"use client";

import { useState } from "react";
import { Copy, Lock, SlidersHorizontal, Trash2, UserPlus, X } from "lucide-react";
import { initials } from "@/app/_lib/initials";
import { Badge } from "@/app/_components/Badge";
import { toast } from "@/app/_components/toast-store";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { roleCapabilities, type MemberRole } from "@/app/_lib/auth/roles";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  EYEBROW,
  INTRO,
  META_LABEL,
  PANEL,
  STAT,
  STAT_LABEL,
  STAT_VALUE,
  TOGGLE_GROUP,
  toggleBtn,
} from "@/app/_components/ui/recipes";
import { APP_LANGUAGES, ASSIGNABLE_ROLES, roleLabel, roleTone, statusBadge, type AppLanguage } from "./member-ui";
import { MemberPermissionsModal } from "./MemberPermissionsModal";
import { useOrgMembers, type MemberTeam, type OrgMemberDto } from "./useOrgMembers";

// The member's team membership (single-team default). Every seeded/invited member
// has exactly one; guard for the empty case defensively.
function primaryTeam(m: OrgMemberDto): MemberTeam | null {
  return m.teams[0] ?? null;
}

// True when the member's effective capabilities differ from their role's defaults
// (i.e. a per-user override is in play) — surfaced as a "Custom" chip.
function hasCustomPermissions(team: MemberTeam): boolean {
  const def = roleCapabilities(team.role);
  const cur = new Set(team.capabilities);
  if (def.size !== cur.size) return true;
  for (const c of def) if (!cur.has(c)) return true;
  return false;
}

async function readError(r: Response | null): Promise<string | null> {
  if (!r) return null;
  try {
    return ((await r.json()) as { error?: string }).error ?? null;
  } catch {
    return null;
  }
}

export function OrganizationConsole({
  name,
  domain,
  language,
  onNameChange,
  onLanguageChange,
}: {
  name: string;
  domain: string;
  language: AppLanguage;
  onNameChange: (v: string) => void;
  onLanguageChange: (v: AppLanguage) => void;
}) {
  const { members, invites, canManage, callerCaps, loading, error, reload } = useOrgMembers();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("recruiter");
  const [editing, setEditing] = useState<{ member: OrgMemberDto; team: MemberTeam } | null>(null);

  const activeCount = members.filter((m) => m.user.status !== "disabled").length;

  async function submitInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;
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
  }

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
    if (typeof window !== "undefined" && !window.confirm(`Remove ${who} from the organization? This deletes their account and access.`)) return;
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
    <section className="mx-auto max-w-6xl space-y-6">
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
        {/* Left — General settings */}
        <div className={`${PANEL} h-fit p-5 lg:col-span-1`}>
          <h2 className="font-serif text-h3 text-ink">General</h2>

          <label htmlFor="org-name-console" className={`${META_LABEL} mt-4 block`}>
            Organization name
          </label>
          <TextInput
            id="org-name-console"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Your company"
            className="mt-1"
          />

          <p className={`${META_LABEL} mt-4`}>Primary domain</p>
          <p className="mt-1 flex items-center gap-1.5 text-body text-steel">
            <Lock size={13} aria-hidden /> {domain}
          </p>

          <p className={`${META_LABEL} mt-4`}>App language</p>
          <div role="group" aria-label="App language" className={`${TOGGLE_GROUP} mt-1`}>
            {APP_LANGUAGES.map((l) => {
              const isActive = language === l.value;
              return (
                <button
                  key={l.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onLanguageChange(l.value)}
                  className={`focus-ring rounded px-3 py-1.5 text-sm font-medium transition-colors ${toggleBtn(isActive)}`}
                >
                  {l.native}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right — Members management */}
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
              />
              <Select
                value={role}
                onChange={(v) => setRole(v as MemberRole)}
                size="sm"
                ariaLabel="Role for the invite"
                options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
              />
              <button type="button" onClick={submitInvite} disabled={!email.trim()} className={`${BTN_PRIMARY} h-9 px-3.5`}>
                <UserPlus size={15} aria-hidden /> Invite
              </button>
            </div>
          ) : null}

          {/* Members table */}
          <div className="overflow-x-auto">
            {loading ? (
              <p className="px-5 py-6 text-sm text-steel">Loading members…</p>
            ) : error ? (
              <p className="px-5 py-6 text-sm text-coral">{error}</p>
            ) : (
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
                              onChange={(v) => patchMember(m.user.id, { workspaceId: team.workspaceId, role: v })}
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
                                onClick={() => patchMember(m.user.id, { status: disabled ? "active" : "disabled" })}
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
                              onClick={() => setEditing({ member: m, team })}
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
                              onClick={() => removeMember(m)}
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
            )}
          </div>

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
                      <button type="button" onClick={() => copyInviteLink(inv.token)} className={`${BTN_GHOST} h-8 gap-1 px-2 text-sm`}>
                        <Copy size={14} aria-hidden /> Copy link
                      </button>
                      <button
                        type="button"
                        onClick={() => revoke(inv.token)}
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
      </div>

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
