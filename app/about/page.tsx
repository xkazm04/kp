import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AboutHome from "@/app/landing/spark/AboutHome";

/*
 * /about — "About the app", not about us. The page explains what the product
 * does (the seven pipeline phases, end to end), so every entry point labels it
 * that way: "About the app" / "O aplikaci" / "Über die App" / "À propos de
 * l'app" (landing.nav.about, jobMarket.nav.about). It is the public,
 * user-facing concept introduction (marketing tone, Spark art direction);
 * unlike the old /landing (noindexed) this is meant to be found, and unlike the
 * dev-only About workspace tab it explains the *why* for users, not the
 * architecture for engineers. Thin route shell: metadata + AboutHome.
 */

// The page renders in four languages, so its title and description must too —
// they are the copy a search result and a shared link show, and they were the
// last strings on this page still hardcoded English. Same server-side
// getTranslations pattern as app/jds/[slug]/page.tsx.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aboutPage.meta");
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    openGraph: { title, description: t("ogDescription") }
  };
}

// Renders the marketing AboutHome tree under the per-request locale layout; it
// was already dynamically rendered (layout cookies()), so Block it under Cache
// Components rather than prerender a skeleton flash.
export const instant = false;

export default function AboutPage() {
  return <AboutHome />;
}
