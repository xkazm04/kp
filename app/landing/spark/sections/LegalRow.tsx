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
 *
 * TWO tones, because the row now has two kinds of host. The Spark pages (/, /about,
 * /market) are a FIXED cream art direction that does not follow the theme, so their
 * copy is a literal hex. The legal pages (/privacy, /terms, /trust) are Studio-light
 * surfaces that DO follow `[data-theme]`, and the same literal would leave the row
 * near-invisible on the dark ground. `tone="studio"` resolves through the neutral
 * tokens instead, so each host gets a row that is legible in the theme it actually
 * renders in.
 */
export type LegalRowTone = "spark" | "studio";

const TONE: Record<LegalRowTone, { row: string; link: string }> = {
  spark: { row: "text-[#42606f]", link: "hover:text-[#17202a]" },
  studio: { row: "text-steel", link: "hover:text-ink" },
};
const LEGAL_LINKS = [
  { href: "/privacy", key: "privacy" },
  { href: "/terms", key: "terms" },
  { href: "/trust", key: "trust" }
] as const;

export default function LegalRow({ tone = "spark" }: { tone?: LegalRowTone } = {}) {
  const t = useTranslations("landing");
  const skin = TONE[tone];
  return (
    <nav aria-label={t("footer.legalNav")} className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${skin.row}`}>
      {LEGAL_LINKS.map((link) => (
        <a key={link.key} href={link.href} className={`font-bold underline-offset-4 hover:underline ${skin.link}`}>
          {t(`footer.${link.key}`)}
        </a>
      ))}
    </nav>
  );
}
