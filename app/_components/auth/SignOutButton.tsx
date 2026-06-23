"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOutDev } from "@/app/_lib/auth/devAuth";

/*
 * The sidebar's bottom-most action: clears BOTH sign-in mechanisms and returns to
 * the public landing at '/'. POSTs /api/auth/logout first to expire the real
 * `__Host-kp_session` cookie (the only UI path that does — without it an
 * auth-enforced deploy could never sign out), then clears the dev gate flag.
 * Best-effort: a failed logout POST still falls through to the dev-gate clear +
 * navigation. Styled as a quiet nav row so it reads as the tail of the menu, not
 * a primary CTA.
 */
export function SignOutButton() {
  const t = useTranslations("nav");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          /* network/offline — still clear the dev gate and leave */
        }
        signOutDev();
      }}
      className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-base font-medium text-steel transition-colors hover:bg-stone-100 hover:text-ink"
    >
      <LogOut className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">{t("signOut")}</span>
    </button>
  );
}
