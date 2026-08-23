import fs from "node:fs";
import path from "node:path";
import { parseRepoRef } from "./repo-snapshot";

// What a repo scan is allowed to point at (App master P2, docs/concepts/app-master.md
// §3 step 1). Split out of repo-scan.ts and kept import-light on purpose: this is the
// trust boundary, so it must be unit-testable without a database, a task runner or a
// running server.
//
// Two shapes are accepted and they are gated very differently:
//
//   repoUrl   a GitHub HTTPS URL. Public-ish, cheap to check: the owner/repo grammar
//             is already hardened in repo-snapshot.ts (parseRepoRef), which exists
//             precisely so a crafted ref like `x/..` can't survive normalization.
//
//   rootPath  a directory on the machine kp is running on. This is the dangerous one:
//             a server that will read any local path you name and hand the contents
//             back is a filesystem oracle. So it is FAIL-CLOSED — refused outright
//             unless the operator has declared an allow-list in
//             KP_APP_MASTER_REPO_ROOTS, and then refused again unless the REAL path
//             (symlinks resolved) is inside one of those roots.
//
// The env var takes a platform path-separator list (`;` on Windows, `:` elsewhere),
// matching PATH, so an operator writes it the way they write every other path list.

export const REPO_ROOTS_ENV = "KP_APP_MASTER_REPO_ROOTS";

export type ScanTarget = {
  /** The GitHub HTTPS URL, normalized to `https://github.com/<owner>/<repo>`. */
  repoUrl: string | null;
  /** The resolved REAL path (symlinks followed), or null for a URL-only scan. */
  rootPath: string | null;
};

export type TargetResolution =
  | { ok: true; target: ScanTarget }
  | { ok: false; status: number; reason: string };

function refuse(reason: string, status = 400): TargetResolution {
  return { ok: false, status, reason };
}

/** The operator's declared roots, resolved to real paths. Unreadable / nonexistent
 *  entries are dropped rather than approximated — an allow-list entry that does not
 *  resolve cannot contain anything, and silently keeping the un-resolved string
 *  would let a symlinked root compare equal to a path it does not actually own. */
export function allowedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[REPO_ROOTS_ENV];
  if (!raw || !raw.trim()) return [];
  const out: string[] = [];
  for (const entry of raw.split(path.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const real = fs.realpathSync(path.resolve(trimmed));
      if (fs.statSync(real).isDirectory() && !out.includes(real)) out.push(real);
    } catch {
      // A root that does not exist on this box is not an error the caller can act
      // on — it is a typo in the operator's own config. Skip it; if that empties
      // the list, resolveRootPath refuses with the "no roots configured" reason,
      // which is the message that actually helps.
    }
  }
  return out;
}

/** Is `child` the same as, or inside, `parent`? Segment-aware (so `/srv/apps-old`
 *  is NOT inside `/srv/apps`) and platform-correct (win32 `path.relative` compares
 *  case-insensitively, which is what NTFS does). Both arguments must already be
 *  real paths — this function does no I/O and cannot see through a symlink. */
export function isInsideRoot(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** True when the path as WRITTEN contains a traversal segment. Checked before
 *  resolution and reported separately: `path.resolve` would flatten `a/../../etc`
 *  into a perfectly innocent-looking absolute path, so an operator who typo'd a
 *  traversal deserves to be told that is what they typed, and an attacker probing
 *  the allow-list gets no partial-success signal from it either way. */
export function hasTraversalSegment(input: string): boolean {
  return input
    .split(/[\\/]+/)
    .some((segment) => segment === "..");
}

/** Resolve + gate a local path. Fail-closed at every step. */
export function resolveRootPath(
  rootPath: string,
  env: NodeJS.ProcessEnv = process.env
): TargetResolution {
  const raw = rootPath.trim();
  if (!raw) return refuse("A local path was requested but none was given.");

  const roots = allowedRoots(env);
  if (roots.length === 0) {
    // The env var is the operator's explicit consent to let kp read local disk.
    // Without it there is no safe default, so say exactly what is missing rather
    // than 403-ing anonymously.
    return refuse(
      `Local repository paths are disabled. Set ${REPO_ROOTS_ENV} to a ${path.delimiter}-separated ` +
        "list of directories kp may scan, then retry.",
      400
    );
  }

  if (hasTraversalSegment(raw)) {
    return refuse("A repository path may not contain '..' segments.");
  }

  let real: string;
  try {
    real = fs.realpathSync(path.resolve(raw));
  } catch {
    // Do NOT distinguish "does not exist" from "not permitted": both answers would
    // let a caller map the filesystem one probe at a time.
    return refuse("That path is not a readable directory inside an allowed root.", 400);
  }

  try {
    if (!fs.statSync(real).isDirectory()) {
      return refuse("That path is not a readable directory inside an allowed root.", 400);
    }
  } catch {
    return refuse("That path is not a readable directory inside an allowed root.", 400);
  }

  // realpathSync resolved every symlink on the way in, so a link that points out of
  // an allowed root is compared at its TARGET and refused here.
  if (!roots.some((root) => isInsideRoot(real, root))) {
    return refuse("That path is not a readable directory inside an allowed root.", 400);
  }

  return { ok: true, target: { repoUrl: null, rootPath: real } };
}

/** Accept ONLY a GitHub HTTPS URL, normalized. `git@`/ssh and the bare
 *  `owner/repo` shorthand that parseRepoRef also understands are refused here: the
 *  scan clones what it is given, and the operator typing a URL into a form means a
 *  URL, not an ambient credential-bearing transport. */
export function resolveRepoUrl(repoUrl: string): TargetResolution {
  const raw = repoUrl.trim();
  if (!raw) return refuse("A repository URL was requested but none was given.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("Enter a GitHub repository URL, e.g. https://github.com/owner/repo.");
  }
  if (url.protocol !== "https:") {
    return refuse("Only https:// GitHub URLs can be scanned.");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return refuse("Only github.com repositories can be scanned.");
  }
  // The owner/repo grammar (and its traversal refusals) is already hardened in
  // repo-snapshot.ts — reuse it rather than writing a second, weaker copy.
  const parsed = parseRepoRef(raw);
  if (!parsed) {
    return refuse("Enter a GitHub repository URL, e.g. https://github.com/owner/repo.");
  }
  return {
    ok: true,
    target: { repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`, rootPath: null },
  };
}

/** The one entry point the route and the runner both use.
 *
 *  Exactly one of the two shapes must be supplied. Both at once is refused rather
 *  than silently preferring one: they can name different repositories, and a scan
 *  that quietly ignored half its own input would produce a dossier bound to a repo
 *  the operator did not think they asked about. */
export function resolveScanTarget(
  input: { repoUrl?: string | null; rootPath?: string | null },
  env: NodeJS.ProcessEnv = process.env
): TargetResolution {
  const hasUrl = typeof input.repoUrl === "string" && input.repoUrl.trim() !== "";
  const hasPath = typeof input.rootPath === "string" && input.rootPath.trim() !== "";
  if (hasUrl && hasPath) {
    return refuse("Give either a repository URL or a local path, not both.");
  }
  if (hasUrl) return resolveRepoUrl(input.repoUrl!);
  if (hasPath) return resolveRootPath(input.rootPath!, env);
  return refuse("Give a GitHub repository URL or a local path to scan.");
}
