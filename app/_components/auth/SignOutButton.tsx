"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { leaveWorkspace } from "@/app/_lib/auth/session-nav";
import { railIconBtn } from "@/app/_components/ui/recipes";

/*
 * The sidebar RAIL's bottom-most action: expires the session + entry marker and
 * returns to the public landing at '/'. leaveWorkspace() POSTs /api/auth/logout
 * (the only UI path that clears the real `__Host-kp_session` cookie — without it
 * an auth-enforced deploy could never sign out), then hard-navigates home.
 * Best-effort: a failed logout POST still navigates.
 *
 * Icon-only, on the shared rail-control recipe, so it sits with the appearance
 * and language controls in the first level's bottom slot instead of spending a
 * full-width row in the level-2 panel. The name lives in aria-label + sr-only
 * text (and the tooltip), never in visible chrome.
 */
export function SignOutButton() {
  const t = useTranslations("nav");
  const label = t("signOut");
  return (
    <button type="button" onClick={() => void leaveWorkspace()} aria-label={label} title={label} className={railIconBtn(false)}>
      <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="sr-only">{label}</span>
    </button>
  );
}
