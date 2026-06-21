"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/i18n/actions";
import { LOCALES, type Locale } from "@/i18n/locales";

/*
 * Landing-native language toggle. Same mechanism as the workspace
 * LanguageSwitcher (writes the NEXT_LOCALE cookie via the server action, then
 * router.refresh() so the server re-renders the catalog under the new locale),
 * but re-skinned into Spark's sticker idiom — ink outlines + hard offset
 * shadow — so it sits naturally in the landing footer. Each button shows its
 * own locale code; the full language name ("English" / "Čeština") rides along
 * as the title so a reader who can't read the current UI can still find theirs.
 *
 * First-visit default needs no UI: the locale already follows the browser's
 * Accept-Language via getServerLocale; this just lets a visitor override it.
 */
export function LandingLangSwitch() {
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
    <div role="group" aria-label={t("select")} className="flex items-center gap-1.5">
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => choose(locale)}
            disabled={pending}
            aria-pressed={isActive}
            title={t(locale)}
            className={`rounded-lg border-[3px] border-[#17202a] px-2.5 py-1 text-sm font-bold uppercase tracking-wide transition-all disabled:opacity-60 ${
              isActive
                ? "bg-[#17202a] text-[#fdf8ee] shadow-[2px_2px_0_#17202a]"
                : "bg-white text-[#17202a] hover:translate-x-[1px] hover:translate-y-[1px]"
            }`}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
