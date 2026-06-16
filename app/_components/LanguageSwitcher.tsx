"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/i18n/actions";
import { LOCALES, type Locale } from "@/i18n/locales";
import { TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";

// Compact locale toggle for the studio sidebar. Writes the NEXT_LOCALE cookie via
// the server action, then refreshes so the server re-renders under the new
// locale. Each locale's button is labelled in its OWN language ("English" /
// "Čeština") — the conventional switcher affordance, so a reader who can't read
// the current UI language can still find their own.
export function LanguageSwitcher() {
  const active = useLocale();
  const t = useTranslations("language");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale): void {
    if (next === active) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("select")}
      className={TOGGLE_GROUP}
    >
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => choose(locale)}
            disabled={pending}
            aria-pressed={isActive}
            className={`focus-ring rounded px-2 py-1 text-sm font-medium uppercase tracking-wide transition-colors disabled:opacity-60 ${toggleBtn(isActive)}`}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
