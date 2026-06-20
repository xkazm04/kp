"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOutDev } from "@/app/_lib/auth/devAuth";

/*
 * The sidebar's bottom-most action: clears the dev sign-in flag and returns to
 * the public landing at '/'. Styled as a quiet nav row so it reads as the tail
 * of the menu, not a primary CTA.
 */
export function SignOutButton() {
  const t = useTranslations("nav");
  return (
    <button
      type="button"
      onClick={() => signOutDev()}
      className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-base font-medium text-steel transition-colors hover:bg-stone-100 hover:text-ink"
    >
      <LogOut className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">{t("signOut")}</span>
    </button>
  );
}
