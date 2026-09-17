import type { Metadata, ResolvingMetadata } from "next";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import AboutHome from "@/app/landing/spark/AboutHome";
import { siteUrl } from "@/app/_lib/site-url";
import { sourceRepoHref } from "@/app/_lib/source-repo";
import { ABOUT_STEP_KEYS, aboutStepId } from "@/app/landing/spark/about-art/shared";
import { aboutPageUrl, buildAboutJsonLd, plainIcu, serializeJsonLd } from "./about-jsonld";

// Last-reviewed stamp crawlers see. Bump when ABOUT_STEP_KEYS or aboutPage.steps change.
const ABOUT_PAGE_MODIFIED = "2026-09-17";

/*
 * /about — "About the app", not about us. The page explains what the product
 * does (the pipeline phases, end to end), so the marketing navigation labels
 * it that way: "About the app" / "O aplikaci" / "Über die App" / "À propos de
 * l'app" (landing.nav.about in Topbar + MobileNav, jobMarket.nav.about in
 * MarketPulseApp). The one other inbound link does not: /skill/[token] labels
 * it skillProfile.methodologyLink, "How this is measured". It is the public,
 * user-facing concept introduction (marketing tone, Spark art direction);
 * unlike the old /landing (noindexed) this is meant to be found. The in-app
 * About tab (app/features/insights/about/) is the signed-in companion: it
 * explains the scoring and filtering mechanisms, where this page walks the
 * phases. Thin route shell: metadata + AboutHome.
 */

// The page renders in four languages, so its title and description must too —
// they are the copy a search result and a shared link show, and they were the
// last strings on this page still hardcoded English. Same server-side
// getTranslations pattern as app/jds/[slug]/page.tsx.
//
// Next merges metadata SHALLOWLY: an `openGraph` set here replaces the root
// layout's whole object, so the bare `{ title, description }` this page used to
// return dropped og:type, og:site_name, og:locale and the opengraph-image, and
// twitter:* kept the SITE's title under this page's og:title. Extend the parent's
// resolved objects instead; e2e/public-pages.spec.ts pins the tags against '/'.
export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const t = await getTranslations("aboutPage.meta");
  const { openGraph, twitter } = await parent;
  const title = t("title");
  const description = t("description");
  const shareDescription = t("ogDescription");
  return {
    title,
    description,
    // Own list — Next merges metadata shallowly, so omitting `keywords`
    // would keep the root layout's landing differentiator set.
    keywords: t.raw("keywords") as string[],
    openGraph: {
      ...openGraph,
      title,
      description: shareDescription,
      modifiedTime: ABOUT_PAGE_MODIFIED,
    },
    twitter: { ...twitter, title, description: shareDescription }
  };
}

// Renders the marketing AboutHome tree under the per-request locale layout; it
// was already dynamically rendered (layout cookies()), so Block it under Cache
// Components rather than prerender a skeleton flash.
export const instant = false;

export default async function AboutPage() {
  const t = await getTranslations("aboutPage.meta");
  const tAbout = await getTranslations("aboutPage");
  const locale = await getLocale();
  const origin = siteUrl().href;
  const aboutUrl = aboutPageUrl(origin);
  const steps = tAbout.raw("steps") as Record<string, { title: string; body: string }>;
  const jsonLd = buildAboutJsonLd({
    name: t("title"),
    description: t("description"),
    inLanguage: locale,
    siteOrigin: origin,
    sameAs: sourceRepoHref(),
    howToName: plainIcu(tAbout("hero.title")),
    howToSteps: ABOUT_STEP_KEYS.map((key, i) => ({
      name: steps[key].title,
      text: steps[key].body,
      url: `${aboutUrl}#${aboutStepId(i)}`,
    })),
    breadcrumbHomeName: tAbout("nav.home"),
    dateModified: ABOUT_PAGE_MODIFIED,
  });
  // Same nonce the layout stamps on THEME_INIT — script-src is nonce'd and
  // report-only today, but an un-nonced inline block is what an enforced
  // policy would drop.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <AboutHome />
    </>
  );
}
