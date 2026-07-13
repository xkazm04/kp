"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { initials } from "@/app/_lib/initials";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";
import { Select } from "@/app/_components/Select";
// bug-ui-scan-2026-07-09 (organizations-members-invites #4): the invite step now uses
// the REAL role slugs (auth/roles) + the shared Organization presenter (member-ui) —
// the same ASSIGNABLE_ROLES the console offers — instead of the retired mock enum, so
// the wizard emits server-valid slugs with no label→slug translation.
import { ASSIGNABLE_ROLES, roleLabel, roleTone } from "@/app/features/sub_organization/member-ui";
import type { MemberRole } from "@/app/_lib/auth/roles";
import type { OnboardingCtrl } from "./steps";

// Shared invite step body — used by BOTH onboarding variants (hoisted per the
// /prototype "extract the moment two variants render the same structure" rule).
// `dense` tightens it for the footer bar; the default is the roomy wizard layout.
export function InviteEditor({ ctrl, dense = false }: { ctrl: OnboardingCtrl; dense?: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("recruiter");

  function add() {
    const trimmed = email.trim();
    if (!trimmed) return;
    ctrl.addInvite({ email: trimmed, role });
    setEmail("");
    setRole("recruiter");
  }

  return (
    <div className={dense ? "flex flex-col gap-2" : "space-y-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="name@company.com"
          sizeVariant="sm"
          className="min-w-0 flex-1"
        />
        <Select
          value={role}
          onChange={(v) => setRole(v as MemberRole)}
          size="sm"
          ariaLabel="Role for the invite"
          options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
        />
        <button type="button" onClick={add} disabled={!email.trim()} className={`${BTN_SECONDARY} h-9 px-3`}>
          <Plus size={15} aria-hidden /> Add
        </button>
      </div>

      {ctrl.state.invites.length > 0 ? (
        <ul className={`flex flex-wrap gap-2 ${dense ? "max-h-16 overflow-y-auto" : ""}`}>
          {ctrl.state.invites.map((inv, i) => (
            <li
              key={`${inv.email}-${i}`}
              className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white py-1 pl-1 pr-2 text-sm dark:-rotate-1"
            >
              <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${roleTone(inv.role)}`}>
                {initials(inv.email)}
              </span>
              <span className="max-w-[12rem] truncate text-ink">{inv.email}</span>
              <span className="text-steel">· {roleLabel(inv.role)}</span>
              <button
                type="button"
                onClick={() => ctrl.removeInvite(i)}
                className="focus-ring rounded-full text-steel hover:text-coral"
                aria-label={`Remove invite for ${inv.email}`}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-steel">No invites yet — add teammates by email, or skip and invite them later.</p>
      )}
    </div>
  );
}
