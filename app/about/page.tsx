import type { Metadata } from "next";
import AboutHome from "@/app/landing/spark/AboutHome";

/*
 * /about — the public, user-facing concept introduction (marketing tone, Spark
 * art direction). Unlike the old /landing (noindexed) this is meant to be found,
 * and unlike the dev-only About workspace tab it explains the *why* for users,
 * not the architecture for engineers. Thin route shell: metadata + AboutHome.
 */
export const metadata: Metadata = {
  title: "About — KandiDate",
  description:
    "Walk one hire down the whole pipeline: design the role, source, intake, screen, interview, offer, hire. AI does the reading at every step; a human signs every decision.",
  openGraph: {
    title: "About — KandiDate",
    description: "Walk one hire down the whole pipeline — AI does the reading, a human signs every decision."
  }
};

// Renders the marketing AboutHome tree under the per-request locale layout; it
// was already dynamically rendered (layout cookies()), so Block it under Cache
// Components rather than prerender a skeleton flash.
export const instant = false;

export default function AboutPage() {
  return <AboutHome />;
}
