import path from "node:path";
import { gigTypeOf } from "../gig-type";
import { writeGigReportFile } from "../report/file";
import type { Gig } from "../types";
import { asciiSlug, gigsRoot, gigWorkdirSlug, isInsideRoot, type GigWorkdirRootOptions } from "../workdir";

// Where a gig's client proposal lives, and how it is written - the report's layout under its
// own directory:
//
//   <gigs root>/_proposals/<type>/<yyyy-mm-dd>-<title slug>-<last 6 of the id>.html
//   ... and beside it <same name>.prev.html, the version before the last rewrite
//
// OUTSIDE every gig's folder, like the report. A path already recorded on the gig is kept while
// it is still under `_proposals`. The write is the report's (report/file.ts writeGigReportFile):
// a temp file beside the target, the current one copied to `.prev.html`, then a rename, so a
// reader never sees half a proposal. Reading it back (the GET route) is serve.ts, a leaf.

export const GIG_PROPOSALS_DIR = "_proposals";

/** The proposals root, absolute (serve.ts resolves the same path; proposal.test.ts holds the two equal). */
export function gigProposalsRoot(opts: GigWorkdirRootOptions = {}): string {
  return path.join(gigsRoot(opts), GIG_PROPOSALS_DIR);
}

/** The proposal file for a gig: the recorded path when it is still under the root, else
 *  `<root>/<type>/<slug>.html`. Null when the result would leave the root. Pure. */
export function gigProposalPathFor(
  proposalsRoot: string,
  gig: Pick<Gig, "id" | "arena" | "title" | "createdAt" | "brief"> & { proposal: { path: string } | null }
): string | null {
  const recorded = gig.proposal?.path;
  if (recorded && recorded.endsWith(".html") && !recorded.endsWith(".prev.html") && isInsideRoot(proposalsRoot, recorded)) return path.resolve(recorded);
  const file = path.resolve(proposalsRoot, asciiSlug(gigTypeOf(gig), 32), `${gigWorkdirSlug(gig)}.html`);
  return isInsideRoot(proposalsRoot, file) ? file : null;
}

/** Write the proposal atomically, keeping the previous one as `.prev.html`. Throws on I/O. */
export function writeGigProposalFile(file: string, html: string): void {
  writeGigReportFile(file, html);
}
