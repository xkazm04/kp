"use client";

import { useTranslations } from "next-intl";

/*
 * The legal row — Privacy / Terms / Trust.
 *
 * It lived inline in Footer.tsx, which made it the LANDING's legal row rather
 * than the product's: /about is in the sitemap and links to the same policies
 * from the same phone menu, and it shipped without any of them. A public
 * product that captures candidate PII must expose its policies from every
 * front door, not from one of them, so the row is a component and each page's
 * footer renders it.
 *
 * Copy stays in the `landing.footer.*` keys it has always used — the row is
 * shared chrome, so it owns its namespace rather than asking each host page to
 * re-declare the same three labels. Landing art direction (literal hexes) is
 * the docs/design/README.md exemption.
 */
const LEGAL_LINKS = [
  { href: "/privacy", key: "privacy" },
  { href: "/terms", key: "terms" },
  { href: "/trust", key: "trust" }
] as const;

export default function LegalRow() {
  const t = useTranslations("landing");
  return (
    <nav aria-label={t("footer.legalNav")} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[#42606f]">
      {LEGAL_LINKS.map((link) => (
        <a key={link.key} href={link.href} className="font-bold underline-offset-4 hover:text-[#17202a] hover:underline">
          {t(`footer.${link.key}`)}
        </a>
      ))}
    </nav>
  );
}
