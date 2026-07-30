import type { Metadata } from "next";
import { TrustContent } from "./TrustContent";

/*
 * /trust — the public compliance posture (W0.5). The internal conformity pack
 * (docs/AI_ACT_CONFORMITY.md) carries file:line evidence and a gap register; this is its
 * public projection: article-by-article posture, subprocessors, data handling, and the
 * disclaimer that refuses to claim certified conformance.
 *
 * Meant to be FOUND — a procurement reviewer looking for evidence rather than a badge is
 * exactly the reader this exists for.
 */
export const metadata: Metadata = {
  title: "Trust & compliance — KandiDate",
  description:
    "How kp handles a regulated hiring decision: EU AI Act posture article by article, including what is not yet built, plus data handling and subprocessors.",
  openGraph: {
    title: "Trust & compliance — KandiDate",
    description: "EU AI Act posture, article by article — including the obligations kp does not yet meet.",
  },
};

// The CONTENT is static (no per-request or per-workspace data), but the per-request
// locale layout reads cookies, so under Cache Components this route is dynamic like its
// /about sibling. Block it rather than prerender a skeleton flash of a compliance page.
export const instant = false;

export default function TrustPage() {
  return <TrustContent />;
}
