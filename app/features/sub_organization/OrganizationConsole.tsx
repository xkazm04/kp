"use client";

import { useState } from "react";
import { Lock, Trash2, UserPlus } from "lucide-react";
import { initials } from "@/app/_lib/initials";
import { formatRelativeTime } from "@/app/_lib/format";
import { Badge } from "@/app/_components/Badge";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  EYEBROW,
  FIELD,
  INTRO,
  META_LABEL,
  PANEL,
  STAT,
  STAT_LABEL,
  STAT_VALUE,
  TOGGLE_GROUP,
  toggleBtn,
} from "@/app/_components/ui/recipes";
import {
  APP_LANGUAGES,
  MEMBER_ROLES,
  memberStatusBadge,
  roleTone,
  type MemberRole,
  type OrgViewProps,
} from "./mock";

// Variant "Console" — the operational, control-room direction. Everything an
// admin manages is on one dense screen: a stat cluster in the header, a compact
// General settings column on the left, and a members management TABLE on the
// right with an inline invite row, per-row role selects, status, and remove.
// The metaphor is "administer the account", not "admire the brand".
export function OrganizationConsole({ org, onOrgChange, members, onInvite, onRoleChange, onRemove }: OrgViewProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("Recruiter");

  const activeCount = members.filter((m) => m.status !== "disabled").length;
  const invitedCount = members.filter((m) => m.status === "invited").length;

  function submitInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    onInvite(trimmed, role);
    setEmail("");
    setRole("Recruiter");
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
            <span className={STAT_LABEL}>Seats</span>
            <span className={`${STAT_VALUE} text-ink`}>
              {activeCount}
              <span className="text-steel">/{org.seats}</span>
            </span>
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
          <input
            id="org-name-console"
            value={org.name}
            onChange={(e) => onOrgChange({ name: e.target.value })}
            placeholder="Your company"
            className={`${FIELD} mt-1 w-full`}
          />

          <p className={`${META_LABEL} mt-4`}>Primary domain</p>
          <p className="mt-1 flex items-center gap-1.5 text-body text-steel">
            <Lock size={13} aria-hidden /> {org.domain}
          </p>

          <p className={`${META_LABEL} mt-4`}>App language</p>
          <div role="group" aria-label="App language" className={`${TOGGLE_GROUP} mt-1`}>
            {APP_LANGUAGES.map((l) => {
              const isActive = org.language === l.value;
              return (
                <button
                  key={l.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onOrgChange({ language: l.value })}
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
            <h2 className="font-serif text-h3 text-ink">
              Members {invitedCount > 0 ? <span className="text-sm font-normal text-steel">· {invitedCount} pending</span> : null}
            </h2>
          </div>

          {/* Invite row */}
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-5 py-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitInvite()}
              placeholder="Invite by email — name@company.com"
              className={`${FIELD} min-w-0 flex-1`}
            />
            <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} className={FIELD} aria-label="Role for the invite">
              {MEMBER_ROLES.filter((r) => r !== "Owner").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button type="button" onClick={submitInvite} disabled={!email.trim()} className={`${BTN_PRIMARY} h-9 px-3.5`}>
              <UserPlus size={15} aria-hidden /> Invite
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left">
              <thead>
                <tr className="border-b border-stone-200 text-meta uppercase text-steel">
                  <th className="px-5 py-2 font-medium">Member</th>
                  <th className="px-2 py-2 font-medium">Role</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Last active</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {members.map((m) => {
                  const badge = memberStatusBadge(m.status);
                  const disabled = m.status === "disabled";
                  return (
                    <tr key={m.id} className="align-middle">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${roleTone(m.role)} ${
                              disabled ? "opacity-50 grayscale" : ""
                            }`}
                          >
                            {initials(m.name)}
                          </span>
                          <div className="min-w-0">
                            <p className={`truncate text-sm font-medium ${disabled ? "text-steel" : "text-ink"}`}>{m.name}</p>
                            <p className="truncate text-xs text-steel">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <select
                          value={m.role}
                          onChange={(e) => onRoleChange(m.id, e.target.value as MemberRole)}
                          disabled={m.role === "Owner"}
                          aria-label={`Role for ${m.name}`}
                          className={`${FIELD} py-1 text-sm disabled:opacity-60`}
                        >
                          {MEMBER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-3">
                        <Badge {...badge} />
                      </td>
                      <td className="px-2 py-3 text-sm text-steel">
                        {m.lastActiveIso ? formatRelativeTime(m.lastActiveIso) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {m.role !== "Owner" ? (
                          <button
                            type="button"
                            onClick={() => onRemove(m.id)}
                            className={`${BTN_GHOST} h-8 w-8 justify-center`}
                            aria-label={`Remove ${m.name}`}
                            title={`Remove ${m.name}`}
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
        </div>
      </div>
    </section>
  );
}
