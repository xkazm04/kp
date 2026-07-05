import type { Metadata } from "next";
import MarketPulse from "@/app/landing/spark/MarketPulse";

/*
 * /market — "Market Pulse": a public, indexable marketing surface that
 * visualises the Czech job market (reference salaries, regional demand,
 * trending roles) from open MPSV / ÚP ČR data. Same Spark art direction as
 * /about; thin route shell — metadata + the MarketPulse tree. The data is a
 * committed static snapshot (data/market_pulse.json), so nothing is fetched at
 * request time.
 */
export const metadata: Metadata = {
  title: "Market Pulse — KandiDate",
  description:
    "The Czech job market at a glance: reference salaries by role, hiring demand across all 14 regions, trending occupations and real job-description references — from open MPSV / Labour Office data.",
  openGraph: {
    title: "Market Pulse — KandiDate",
    description:
      "Reference salaries, regional hiring demand and trending roles across the Czech Republic — built on open labour-market data."
  }
};

// The page reads a committed static snapshot (no request-time data), but the
// per-request locale layout makes it dynamic; Block it under Cache Components
// like /about rather than prerender a skeleton flash.
export const instant = false;

export default function MarketPage() {
  return <MarketPulse />;
}
