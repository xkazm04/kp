import type { Metadata } from "next";
import { TrustContent } from "./TrustContent";

/*
 * /trust — the compliance posture board (W0.5). The internal conformity pack
 * (docs/features/compliance/ai-act-conformity.md) carries file:line evidence and a gap register; this is its
 * readable projection: article-by-article posture, subprocessors, data handling, and the
 * disclaimer that refuses to claim certified conformance.
 *
 * PUBLIC (flipped 2026-08-05, reversing the 2026-07-30 internal-for-now call). The
 * positioning work (docs/product/competitor-talentpilot.md §4) made auditable, verified
 * hiring the headline claim, and a headline claim needs its evidence page indexable: the
 * article-by-article posture, gaps included, is the checkable artifact competitors'
 * "compliant" badges are not. The gap rows stay — trust-posture.ts already carries only
 * the public projection (no internal evidence paths, no gap ids), and a page that admits
 * what is outstanding is the entire differentiator. The no-certification disclaimer stays
 * with it. Linked from the landing footer; listed in sitemap.ts and public-routes.ts.
 */
const TITLE = "Trust & compliance — KandiDate";
const DESCRIPTION =
  "How KandiDate handles a regulated hiring decision: EU AI Act posture article by article, including what is not yet built, plus data handling and subprocessors.";
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
};

// The CONTENT is static (no per-request or per-workspace data), but the per-request
// locale layout reads cookies, so under Cache Components this route is dynamic like its
// /about sibling. Block it rather than prerender a skeleton flash of a compliance page.
export const instant = false;

export default function TrustPage() {
  return <TrustContent />;
}
