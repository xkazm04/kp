import { readFileSync } from "node:fs";
import path from "node:path";

// The read side of the report file, for GET /api/gigs/[id]/report: a LEAF (node builtins
// only), so the route does not carry file.ts's graph (workdir.ts, the deliverable contract).
// The root is resolved exactly as workdir.ts gigsRoot + file.ts GIG_REPORTS_DIR resolve it
// (KP_GIGS_ROOT, else `../gigs` against the repo root, then `_reports`); report.test.ts holds
// the two equal.

/** The policy the route serves the file under: an opaque origin (sandbox with no allow-*),
 *  no script, no request of any kind, no form, no base - the body was written by a model from
 *  strangers' text, so it never runs in kp's origin. */
export const GIG_REPORT_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/** The reports root, absolute. */
export function servedReportsRoot(env: Record<string, string | undefined> = process.env, repoRoot: string = process.cwd()): string {
  return path.join(path.resolve(repoRoot, env.KP_GIGS_ROOT?.trim() || "../gigs"), "_reports");
}

/** The report's HTML when `file` is an .html file strictly inside `reportsRoot` and exists;
 *  null otherwise (the route answers 404). The root check is the guard against a path column
 *  that points anywhere else on disk. */
export function readGigReportFile(reportsRoot: string, file: string): string | null {
  const root = path.resolve(reportsRoot);
  const target = path.resolve(file);
  const rel = path.relative(root, target);
  if (!target.endsWith(".html") || rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  try {
    return readFileSync(target, "utf8");
  } catch {
    // missing or unreadable: the route answers "no report yet"
    return null;
  }
}
