"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { leaveWorkspace } from "@/app/_lib/auth/session-nav";

/*
 * The sidebar's bottom-most action: expires the session + entry marker and returns
 * to the public landing at '/'. leaveWorkspace() POSTs /api/auth/logout (the only
 * UI path that clears the real `__Host-kp_session` cookie — without it an auth-
 * enforced deploy could never sign out), then hard-navigates home. Best-effort: a
 * failed logout POST still navigates. Styled as a quiet nav row so it reads as the
 * tail of the menu, not a primary CTA.
 */
export function SignOutButton() {
  const t = useTranslations("nav");
  return (
    <button
      type="button"
      onClick={() => void leaveWorkspace()}
      className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-base font-medium text-steel transition-colors hover:bg-stone-100 hover:text-ink"
    >
      <LogOut className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">{t("signOut")}</span>
    </button>
  );
}
