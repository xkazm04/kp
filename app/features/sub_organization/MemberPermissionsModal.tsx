"use client";

import { useState } from "react";
import { Modal } from "@/app/_components/Modal";
import { toast } from "@/app/_components/toast-store";
import { BTN_GHOST, BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { roleCapabilities, type Capability } from "@/app/_lib/auth/roles";
import { CAPABILITY_META, roleLabel } from "./member-ui";
import type { MemberTeam, OrgMemberDto } from "./useOrgMembers";

// Per-user permission editor. Toggles the OVERRIDABLE capabilities on top of the
// member's role defaults; the server computes the grant/revoke delta. A cap the
// acting user doesn't hold themselves can't be toggled (you can only delegate what
// you have) — org:manage is never offered here (owner-role only).
export function MemberPermissionsModal({
  member,
  team,
  callerCaps,
  onClose,
  onSaved,
}: {
  member: OrgMemberDto;
  team: MemberTeam;
  callerCaps: Capability[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const roleDefaults = roleCapabilities(team.role);
  const actorCaps = new Set(callerCaps);
  const [desired, setDesired] = useState<Set<Capability>>(() => new Set(team.capabilities));
  const [saving, setSaving] = useState(false);
  const name = member.user.name ?? member.user.email;

  function toggle(cap: Capability) {
    setDesired((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/org/members/${member.user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: team.workspaceId, capabilities: [...desired] }),
    }).catch(() => null);
    setSaving(false);
    if (r && r.ok) {
      toast.success("Permissions updated");
      onSaved();
      onClose();
    } else {
      toast.error("Couldn't update permissions");
    }
  }

  return (
    <Modal
      title={`Permissions — ${name}`}
      subtitle={`${roleLabel(team.role)} · overrides layer on top of the role defaults`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${BTN_GHOST} h-9 px-3`}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className={`${BTN_PRIMARY} h-9 px-4`}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <ul className="space-y-2">
        {CAPABILITY_META.map(({ cap, label, desc }) => {
          const on = desired.has(cap);
          const isDefault = roleDefaults.has(cap);
          const canToggle = actorCaps.has(cap);
          return (
            <li key={cap} className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  {label}
                  {on !== isDefault ? (
                    <span className="rounded-full bg-coral/10 px-1.5 py-0.5 text-[11px] font-semibold text-coral">
                      {on ? "granted" : "revoked"}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-steel">{desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label}
                disabled={!canToggle}
                title={canToggle ? undefined : "You can only change permissions you hold yourself"}
                onClick={() => toggle(cap)}
                className={`focus-ring relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? "bg-coral" : "bg-stone-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-steel">
        Highlighted rows differ from the {roleLabel(team.role)} default. A recruiter granted “Manage members” becomes a Writer who can
        invite others.
      </p>
    </Modal>
  );
}
