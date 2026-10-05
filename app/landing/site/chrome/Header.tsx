import { getTranslations } from "next-intl/server";
import { sourceRepoHref } from "@/app/_lib/source-repo";
import { BrandMark } from "./Brand";
import { DemoCta, SignIn, StartCta } from "./Ctas";
import { BRAND } from "./glyphs";
import { HeaderShell } from "./HeaderShell";
import { LangChips } from "./LangChips";
import type { MkMode } from "./MkRoot";

/*
 * The one header of the landing and About (the prototype's `.bar`): logo and
 * wordmark, the section nav, the language chips, sign in, the two calls to
 * action, and the Menu button with the phone menu (HeaderShell).
 *
 * Section links are same-page anchors on the landing (`#proof`) and lead back to
 * the landing from About (`/#proof`); About is marked current on About. Plain
 * <a>, never next/link: the two pages load different stylesheets, and a full
 * navigation is what keeps one page's CSS off the other.
 *
 * On the landing, `.nav a.is-cur` (scroll-spy) is the landing's to toggle.
 */
export default async function Header({ page, signupOpen }: { page: MkMode; signupOpen: boolean }) {
  const t = await getTranslations("siteChrome");
  const tl = await getTranslations("landing");
  const onAbout = page === "about";
  const sec = (id: string) => (onAbout ? `/#${id}` : `#${id}`);
  const aboutCurrent = onAbout ? ("page" as const) : undefined;

  const bar = (
    <>
      <a
        className="brand"
        href={onAbout ? "/" : "#top"}
        aria-label={onAbout ? t("brand.home", { brand: BRAND.name }) : t("brand.toTop", { brand: BRAND.name })}
      >
        <BrandMark />
      </a>
      <nav className="nav" aria-label={tl("nav.sections")}>
        <a href={sec("proof")}>{tl("nav.proof")}</a>
        <a href={sec("features")}>{tl("nav.features")}</a>
        <a href={sec("voice")}>{t("nav.voice")}</a>
        <a href={sec("human")}>{t("nav.human")}</a>
        <a href={sec("pricing")}>{tl("nav.pricing")}</a>
        <a
          className={onAbout ? "to-page is-cur" : "to-page"}
          href="/about"
          aria-label={t("nav.aboutAria")}
          aria-current={aboutCurrent}
        >
          {t("nav.about")}
        </a>
      </nav>
      <div className="bar-right">
        <LangChips />
        <SignIn className="bar-sign" />
        <StartCta signupOpen={signupOpen} placement={onAbout ? "about-header" : "header"} />
        <DemoCta />
      </div>
    </>
  );

  const menu = (
    <>
      <nav aria-label={tl("nav.sections")}>
        <a href={sec("proof")}>{tl("nav.proof")}</a>
        <a href={sec("features")}>{tl("nav.features")}</a>
        <a href={sec("voice")}>{tl("nav.voice")}</a>
        <a href={sec("human")}>{t("menu.human")}</a>
        <a href={sec("pricing")}>{tl("nav.pricing")}</a>
        <a href="/about" aria-current={aboutCurrent}>
          {t("menu.about")}
        </a>
        <a href={sourceRepoHref()} target="_blank" rel="noopener noreferrer">
          {t("menu.source")}
        </a>
        <SignIn className="menu-sign" />
      </nav>
      <p className="menu-langs">
        {t("menu.languages")} <LangChips />
      </p>
    </>
  );

  return (
    <HeaderShell solid={onAbout} menu={menu}>
      {bar}
    </HeaderShell>
  );
}
