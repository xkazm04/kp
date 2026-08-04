"use client";

import { useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import Wordmark from "../Wordmark";
import { LandingLangSwitch } from "../LandingLangSwitch";

/*
 * Landing footer. The language switcher lives here and only here — the same
 * rule across all three marketing pages, so a visitor learns one place to
 * change language.
 */
export default function Footer() {
  const t = useTranslations("landing");
  return (
    <footer className="border-t-[3px] border-[#17202a] bg-[#fdf8ee]">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[15px]">
        <div className="flex items-center gap-2 font-bold">
          <Wordmark size="sm" />
          <span>· {t("footer.tagline")}</span>
        </div>
        <div className="flex items-center gap-3 text-[#42606f]">
          <Languages className="h-4 w-4" aria-hidden />
          <LandingLangSwitch />
        </div>
      </div>
    </footer>
  );
}
