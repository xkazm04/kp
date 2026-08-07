import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import MarketPulse from "@/app/landing/spark/MarketPulse";

/*
 * /market — "Market Pulse": a public, indexable marketing surface that
 * visualises the Czech job market (reference salaries, regional demand,
 * trending roles) from open MPSV / ÚP ČR data. Same Spark art direction as
 * /about; thin route shell — metadata + the MarketPulse tree. The data is a
 * committed static snapshot (data/market_pulse.json), so nothing is fetched at
 * request time.
 */
// Localized like /about: this page is indexed in four languages, so the title
// and description a search result shows must follow the reader's locale. Same
// server-side getTranslations pattern as app/jds/[slug]/page.tsx.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("jobMarket.meta");
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    openGraph: { title, description: t("ogDescription") }
  };
}

// The page reads a committed static snapshot (no request-time data), but the
// per-request locale layout makes it dynamic; Block it under Cache Components
// like /about rather than prerender a skeleton flash.
export const instant = false;

export default function MarketPage() {
  return <MarketPulse />;
}
