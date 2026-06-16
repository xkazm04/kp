// Seed-anchored diff evidence for dev-case submissions (idea-c364a44d). Every
// candidate starts from the SAME materialized seed (seed_materializer plants each
// cover-probe's trap in a concrete file), so which of those planted files a
// submission actually TOUCHED is mechanically comparable across people in a way
// prose-judging never is. reflect/assess judge from commit shape + messages; this
// adds grounded "did they engage the planted seam, or never open it" evidence
// from the git change set — the seed becomes the answer key the evaluation points
// into.
//
// This is the robust file-LEVEL signal (touched vs untouched planted files),
// computed from the changed paths the GitHub commits API already returns. Mapping
// each probe to its exact seam file and threading into the Python rubric is the
// deeper follow-up; the file-level engagement is the load-bearing, low-risk core.
//
// Pure + import-free so the contract is unit-testable.

type SeedFileLike = { path?: string };

export type SeedFileTouch = { path: string; touched: boolean };

export type SeedDiff = {
  files: SeedFileTouch[];
  touched: number;
  total: number;
  untouched: string[]; // planted files the submission never modified
};

// Normalize a repo path for comparison: forward slashes, trimmed, leading "./"
// stripped, lower-cased (lenient — a case mismatch should not read as "untouched").
function norm(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/** Collect the distinct set of file paths a submission changed across its
 *  commits' file lists (GitHub commit detail `files[].filename`). Pure so the
 *  union/normalization is testable apart from the network fetch. */
export function unionChangedPaths(commitFiles: { filename?: string }[][]): string[] {
  const seen = new Set<string>();
  for (const files of commitFiles) {
    for (const f of files) {
      if (f?.filename) seen.add(f.filename.trim().replace(/\\/g, "/").replace(/^\.\//, ""));
    }
  }
  return [...seen];
}

/** Which planted seed files did the submission touch? `changedPaths` is the union
 *  of files the submission modified; compared case-insensitively against the
 *  seed's file paths. */
export function seedDiffEvidence(seedFiles: SeedFileLike[], changedPaths: string[]): SeedDiff {
  const changed = new Set(changedPaths.map(norm));
  const files: SeedFileTouch[] = [];
  for (const f of seedFiles) {
    const path = (f.path ?? "").trim();
    if (!path) continue;
    files.push({ path, touched: changed.has(norm(path)) });
  }
  const touched = files.filter((f) => f.touched).length;
  return {
    files,
    touched,
    total: files.length,
    untouched: files.filter((f) => !f.touched).map((f) => f.path),
  };
}
