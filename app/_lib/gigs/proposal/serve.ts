import path from "node:path";

// The read side of the proposal file, for GET /api/gigs/[id]/proposal: a LEAF (node builtins
// only), so the route does not carry file.ts's graph. The root is resolved exactly as
// workdir.ts gigsRoot + file.ts GIG_PROPOSALS_DIR resolve it (KP_GIGS_ROOT, else `../gigs`
// against the repo root, then `_proposals`); proposal.test.ts holds the two equal. The file
// itself is read with report/serve.ts readGigReportFile (the same root guard) and served
// under the report's sandbox policy.

/** The proposals root, absolute. */
export function servedProposalsRoot(env: Record<string, string | undefined> = process.env, repoRoot: string = process.cwd()): string {
  return path.join(path.resolve(repoRoot, env.KP_GIGS_ROOT?.trim() || "../gigs"), "_proposals");
}

/** The download name for a proposal file: `<title slug>-proposal.html`, from the file's own
 *  `<yyyy-mm-dd>-<slug>-<id6>.html` name (ASCII by construction; anything else is dropped). */
export function proposalDownloadName(file: string): string {
  const base = path.basename(file).replace(/\.html$/i, "");
  const slug = base
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/-[a-z0-9]{6}$/, "")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 80);
  return `${slug || "gig"}-proposal.html`;
}
