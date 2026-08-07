"use client";

import { useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import Wordmark from "../Wordmark";
import { LandingLangSwitch } from "../LandingLangSwitch";

/*
 * Landing footer. The language switcher lives here and only here — the same
 * rule across all three marketing pages, so a visitor learns one place to
 * change language.
 *
 * The legal row (Privacy / Terms / Trust) also lives here: a public product
 * that captures candidate PII must expose its policies from its front door,
 * and /trust is the evidence page behind the landing's headline claims, so it
 * earns a footer link rather than a buried route.
 */
const LEGAL_LINKS = [
  { href: "/privacy", key: "privacy" },
  { href: "/terms", key: "terms" },
  { href: "/trust", key: "trust" }
] as const;

export default function Footer() {
  const t = useTranslations("landing");
  return (
    <footer className="border-t-[3px] border-[#17202a] bg-[#fdf8ee]">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[17px]">
        <div className="flex items-center gap-2 font-bold">
          <Wordmark size="sm" />
          <span>· {t("footer.tagline")}</span>
        </div>
        <nav aria-label={t("footer.legalNav")} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[#42606f]">
          {LEGAL_LINKS.map((link) => (
            <a key={link.key} href={link.href} className="font-bold underline-offset-4 hover:text-[#17202a] hover:underline">
              {t(`footer.${link.key}`)}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-[#42606f]">
          <Languages className="h-4 w-4" aria-hidden />
          <LandingLangSwitch />
        </div>
      </div>
    </footer>
  );
}
