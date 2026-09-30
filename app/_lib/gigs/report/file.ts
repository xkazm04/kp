import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { asciiSlug, gigsRoot, gigWorkdirSlug, isInsideRoot, type GigWorkdirRootOptions } from "../workdir";
import { gigTypeOf } from "../gig-type";
import type { Gig } from "../types";

// Where a gig's report file lives, and how it is written.
//
//   <gigs root>/_reports/<type>/<yyyy-mm-dd>-<title slug>-<last 6 of the id>.html
//   ... and beside it <same name>.prev.html, the version before the last rewrite
//
// The gigs root and the slug are workdir.ts's (KP_GIGS_ROOT, else ../gigs beside the repo),
// the type gig-type.ts's - so a report sits in a tree that reads like the gigs' own folders
// but OUTSIDE any gig's folder: the agent working a gig never sees (or edits) the report
// written about it. A path already recorded on the gig is kept while it is still under
// `_reports` (a retitled listing does not move its report); anything else is recomputed.
//
// Writes are atomic: the new HTML goes to a temp file beside the target, the current file
// (when there is one) is copied to `.prev.html`, then the temp file is renamed over the
// target. A reader never sees half a report. Reading a report back (the GET route) is
// serve.ts, a leaf that keeps this module's graph off the route.

export const GIG_REPORTS_DIR = "_reports";

/** The reports root, absolute (serve.ts resolves the same path without this module's graph;
 *  report.test.ts holds the two equal). */
export function gigReportsRoot(opts: GigWorkdirRootOptions = {}): string {
  return path.join(gigsRoot(opts), GIG_REPORTS_DIR);
}

/** The report file for a gig: the recorded path when it is still under the reports root,
 *  else `<reports root>/<type>/<slug>.html`. Null when the result would leave the root (a
 *  bug upstream - every part is sanitized). Pure. */
export function gigReportPathFor(
  reportsRoot: string,
  gig: Pick<Gig, "id" | "arena" | "title" | "createdAt" | "brief"> & { report: { path: string } | null }
): string | null {
  const recorded = gig.report?.path;
  if (recorded && recorded.endsWith(".html") && !recorded.endsWith(".prev.html") && isInsideRoot(reportsRoot, recorded)) return path.resolve(recorded);
  const file = path.resolve(reportsRoot, asciiSlug(gigTypeOf(gig), 32), `${gigWorkdirSlug(gig)}.html`);
  return isInsideRoot(reportsRoot, file) ? file : null;
}

/** `<name>.prev.html` beside `<name>.html`. Pure. */
export function previousReportPath(file: string): string {
  return file.replace(/\.html$/i, "") + ".prev.html";
}

/** Write the report atomically, keeping the previous one as `.prev.html`. Throws on an I/O
 *  failure (the runner records it as the report's `failed` status). */
export function writeGigReportFile(file: string, html: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, html, { encoding: "utf8" });
  try {
    if (existsSync(file)) copyFileSync(file, previousReportPath(file));
    renameSync(tmp, file);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best-effort: a temp file left behind is inert, the error below is what matters
    }
    throw error;
  }
}

export type { GigWorkdirRootOptions };
