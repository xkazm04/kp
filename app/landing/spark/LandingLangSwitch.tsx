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
 *
 * Two sizes, ONE component. Accept-Language covers most Czech visitors, but a
 * Czech buyer browsing in English used to read all 7 300 px of the page before
 * meeting the switch in the footer — so a `size="compact"` instance also rides
 * in the topbar (and, where the topbar collapses, in the phone menu). Same
 * sticker idiom either way; compact only trims padding and type so it does not
 * crowd the topbar at 1024–1440 px. The instances need no shared state: each
 * one writes the same NEXT_LOCALE cookie through `setLocale` and then
 * `router.refresh()`, and `active` comes from the server-rendered locale, so
 * every instance re-reads the same truth after any of them is used.
 */
export function LandingLangSwitch({ size = "default" }: { size?: "default" | "compact" } = {}) {
  const compact = size === "compact";
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
      className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}
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
            title={t(locale)}
            className={`rounded-lg border-[3px] border-[#17202a] font-bold uppercase tracking-wide transition-all disabled:opacity-60 ${
              compact ? "px-1.5 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
            } ${
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
