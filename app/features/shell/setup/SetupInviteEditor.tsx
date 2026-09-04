"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { initials } from "@/app/_lib/initials";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";
import { Select } from "@/app/_components/Select";
// bug-ui-scan-2026-07-09 (organizations-members-invites #4): the invite step now uses
// the REAL role slugs (auth/roles) + the shared Organization presenter (member-ui) —
// the same ASSIGNABLE_ROLES the console offers — instead of the retired mock enum, so
// the wizard emits server-valid slugs with no label→slug translation.
import { ASSIGNABLE_ROLES, roleLabel, roleTone } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";
import { SETUP_PROSE } from "./setupProse";
import type { OnboardingCtrl } from "./setupSteps";

// Address shape, checked HERE because nothing downstream can in time: staged
// invites are only POSTed at finish(), three steps later. An address the route
// refuses (400 "A valid email is required.") used to be accepted as a chip,
// counted on the hand-off summary ("1 teammate invited") and then quietly
// dropped. Same shape the rest of the app calls an address — a local copy of the
// regex in signup-service.ts / comms-recipient.ts, by the convention those
// modules state.
const INVITE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared invite step body — used by BOTH onboarding variants (hoisted per the
// /prototype "extract the moment two variants render the same structure" rule).
// `dense` tightens it for the footer bar; the default is the roomy wizard layout.
export function InviteEditor({ ctrl, dense = false }: { ctrl: OnboardingCtrl; dense?: boolean }) {
  const t = useTranslations("setup.team");
  // Role NAMES are owned by the Organization console's catalog — the wizard shows
  // the same five labels, so it reads the same keys rather than forking them.
  const tRole = useTranslations("workspaceAdmin.members");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("recruiter");
  // Half-typed is not wrong: the error tone waits for the operator to leave the
  // field (or to try Add), so "jana@comp" isn't scolded mid-word.
  const [blurred, setBlurred] = useState(false);

  const trimmed = email.trim();
  const emailValid = INVITE_EMAIL_RE.test(trimmed);

  function add() {
    if (!emailValid) {
      setBlurred(true);
      return;
    }
    ctrl.addInvite({ email: trimmed, role });
    setEmail("");
    setBlurred(false);
    setRole("recruiter");
  }

  return (
    <div className={dense ? "flex flex-col gap-2" : "space-y-3"}>
      {/* The FORM keeps a reading-comfortable width even though the pane is wide
          (the wizard's prose runs to 90% — setupProse.ts — but a 45rem email
          field is a worse field, not a wider one). */}
      <div className={`flex flex-wrap items-center gap-2 ${dense ? "" : "max-w-xl"}`}>
        <TextInput
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setBlurred(false);
          }}
          onBlur={() => setBlurred(true)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={t("emailPlaceholder")}
          sizeVariant="sm"
          // The error tone (and aria-invalid) only once there is something to be
          // wrong about. No new copy: the placeholder already spells the shape
          // out, and `invalid` is the canonical dual-theme signal (TextInput.tsx).
          invalid={blurred && trimmed !== "" && !emailValid}
          className="min-w-0 flex-1"
        />
        <Select
          value={role}
          onChange={(v) => setRole(v as MemberRole)}
          sizeVariant="sm"
          ariaLabel={t("roleAria")}
          options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, tRole) }))}
        />
        <button type="button" onClick={add} disabled={!emailValid} className={`${BTN_SECONDARY} h-9 px-3`}>
          <Plus size={15} aria-hidden /> {t("add")}
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
              <span className="text-steel">· {roleLabel(inv.role, tRole)}</span>
              <button
                type="button"
                onClick={() => ctrl.removeInvite(i)}
                className="focus-ring rounded-full text-steel hover:text-coral"
                aria-label={t("removeAria", { email: inv.email })}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        // Description, not a control: it runs to the pane's prose width.
        <p className={`text-sm text-steel ${dense ? "" : SETUP_PROSE}`}>{t("empty")}</p>
      )}
    </div>
  );
}
