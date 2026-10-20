"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/i18n/actions";
import { LOCALES, type Locale } from "@/i18n/locales";

/*
 * The prototype's EN / CS / DE / FR chips, as the real locale switch: the same
 * mechanism as app/landing/spark/LandingLangSwitch.tsx (write NEXT_LOCALE through
 * the server action, then router.refresh() so the server re-renders the catalog).
 * Every instance (header, phone menu, footer) reads the active locale from the
 * server, so they agree after any of them is used. The full language name is the
 * title, for a reader who cannot read the current UI.
 */
export function LangChips() {
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
    <span className="langs" role="group" aria-label={t("select")}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          aria-pressed={locale === active}
          disabled={pending}
          title={t(locale)}
          onClick={() => choose(locale)}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
