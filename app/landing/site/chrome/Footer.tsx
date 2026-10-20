import { getTranslations } from "next-intl/server";
import { sourceRepoHref } from "@/app/_lib/source-repo";
import { BrandMark } from "./Brand";
import { BRAND, GLYPH } from "./glyphs";
import { LangChips } from "./LangChips";
import { LEGAL_LINKS } from "./legal";
import type { MkMode } from "./MkRoot";

/*
 * The prototype's footer (`.foot`) carrying today's real links: the three policy
 * pages (a public product that takes candidate PII shows them from every front
 * door), About, the AGPL source link (sourceRepoHref, the §13 source offer), and
 * the language chips. `#top` exists on both pages (landing hero, About hero).
 */
export default async function Footer({ page }: { page: MkMode }) {
  const t = await getTranslations("siteChrome");
  const tl = await getTranslations("landing");
  const onAbout = page === "about";
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-top">
          <a
            className="brand"
            href={onAbout ? "/" : "#top"}
            aria-label={onAbout ? t("brand.home", { brand: BRAND.name }) : t("brand.toTop", { brand: BRAND.name })}
          >
            <BrandMark />
          </a>
          <p>{tl("footer.tagline")}</p>
          <a className="totop" href="#top">
            <span aria-hidden="true">{GLYPH.up}</span> {tl("nav.top")}
          </a>
        </div>
        <div className="foot-row">
          <nav className="foot-legal" aria-label={tl("footer.legalNav")}>
            {LEGAL_LINKS.map((link) => (
              <a key={link.key} href={link.href}>
                {tl(`footer.${link.key}`)}
              </a>
            ))}
          </nav>
          <a href="/about" aria-current={onAbout ? "page" : undefined}>
            {tl("nav.about")}
          </a>
          <a href={sourceRepoHref()} target="_blank" rel="noopener noreferrer">
            {tl("footer.license")}
          </a>
          <LangChips />
        </div>
        <p className="legal">{t("footer.legal")}</p>
      </div>
    </footer>
  );
}
