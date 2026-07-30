import type { Metadata } from "next";
import { TrustContent } from "./TrustContent";

/*
 * /trust — the compliance posture board (W0.5). The internal conformity pack
 * (docs/AI_ACT_CONFORMITY.md) carries file:line evidence and a gap register; this is its
 * readable projection: article-by-article posture, subprocessors, data handling, and the
 * disclaimer that refuses to claim certified conformance.
 *
 * INTERNAL FOR NOW (user decision, 2026-07-30). It reads as a public trust page and could
 * become one, but today it is a working board for tracking what is enforced vs
 * outstanding — so it is NOINDEXED rather than published. A page that lists three unmet
 * obligations is the right artifact for us and the wrong first impression for a stranger.
 *
 * The plan is to DELETE this route once every obligation is enforced: at that point the
 * board has nothing left to track, and whatever we say publicly should be written as
 * marketing copy rather than left as a gap register with no gaps.
 */
export const metadata: Metadata = {
  title: "Trust & compliance — KandiDate",
  description:
    "How kp handles a regulated hiring decision: EU AI Act posture article by article, including what is not yet built, plus data handling and subprocessors.",
  // No openGraph: nothing here is meant to unfurl in a chat or a search result yet.
  robots: { index: false, follow: false },
};

// The CONTENT is static (no per-request or per-workspace data), but the per-request
// locale layout reads cookies, so under Cache Components this route is dynamic like its
// /about sibling. Block it rather than prerender a skeleton flash of a compliance page.
export const instant = false;

export default function TrustPage() {
  return <TrustContent />;
}
