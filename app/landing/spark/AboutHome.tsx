import "../site/about/styles";
import { getTranslations } from "next-intl/server";
import { signupEnabled } from "@/app/_lib/workspace-lock";
import MkRoot from "../site/chrome/MkRoot";
import Header from "../site/chrome/Header";
import Footer from "../site/chrome/Footer";
import CtaDock from "../site/chrome/CtaDock";
import { aboutMono } from "../site/chrome/fontMono";
import AboutPage from "../site/about/AboutPage";

/*
 * The public /about page: the fused prototype's About (app/landing/site/, see its
 * README). The route shell only: the site root with its fonts (plus About's mono
 * face), the shared header / footer / phone dock, and the page. The /about route
 * (app/about/page.tsx) keeps its metadata and JSON-LD and just renders this.
 * `../site/about/styles` is imported first on purpose: it is About's whole
 * stylesheet list, in cascade order.
 *
 * `signupOpen` is read here, server-side, with the same predicate app/page.tsx
 * uses for the landing (a pure env read), so every "Start hiring free" on About
 * picks /signup over /login exactly as the landing's does.
 */
export default async function AboutHome() {
  const t = await getTranslations("siteChrome");
  const signupOpen = signupEnabled();
  return (
    <MkRoot mode="about" className={aboutMono.variable}>
      <a className="skip" href="#line">
        {t("skip.about")}
      </a>
      <Header page="about" signupOpen={signupOpen} />
      <AboutPage signupOpen={signupOpen} />
      <Footer page="about" />
      <CtaDock signupOpen={signupOpen} placement="about-dock" />
    </MkRoot>
  );
}
