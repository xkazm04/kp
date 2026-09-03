#!/usr/bin/env node
// The git plumbing the release and doc-sync scripts share.
//
// THE GAP THIS CLOSES: `git()` was written out three times byte for byte
// (commit-msg.mjs, prepare.mjs, provenance.mjs), the record-separated commit
// reader twice with one silent difference — one of them attached the files each
// commit touched and the other did not — and `revExists()` twice more. Nothing
// was wrong with any copy; the cost is that a fix lands in one of them. The
// maxBuffer here is the reason to care: `git log` over a long range with bodies
// exceeds node's 1MB default and throws ENOBUFS, and the copy that had not been
// raised yet is the one that fails on the day the range is long.
//
// NOT MERGED WITH scripts/review/diff.mjs, which has the same two helpers: that
// module is the review lenses' unified-diff PARSER and its callers pass a much
// larger buffer for whole diffs. Two small honest modules beat one that has to
// explain which half a caller wants.
//
// Everything here shells out, so none of it is fixture-covered; that is the
// point of keeping it in one file away from the pure rules the fixtures pin.

import { execFileSync } from 'node:child_process';

export const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

/** Run git in the repository root. Throws on a non-zero exit, like every caller expects. */
export function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

/** Does this rev name a commit here? Used to fall back rather than fail on a shallow checkout. */
export function revExists(rev) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** The newest `v*` tag, or null when nothing has been released yet. */
export function lastTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim() || null;
  } catch {
    return null;
  }
}

// ASCII record separator. Commit bodies contain blank lines and every printable
// delimiter someone might reach for, so records are split on a byte a message
// cannot contain.
const RECORD = '\x1e';

/** The paths one commit touches. Empty on anything git will not show (a root commit's parent, a bad rev). */
export function filesInCommit(sha) {
  try {
    return git(['show', '--no-renames', '--pretty=format:', '--name-only', sha])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Commits in `base..head`, merges excluded (their subjects are git's, not ours).
 *
 * `withFiles` costs one `git show` per commit, so it is opt-in: the commit gate
 * needs the paths to judge a type against the diff, the provenance query reads
 * only bodies.
 *
 * @returns {{sha: string, subject: string, body: string, files?: string[]}[]}
 */
export function commitsInRange(base, head, { withFiles = false } = {}) {
  return git(['log', '--no-merges', '--format=%H%n%s%n%b%x1e', `${base}..${head}`])
    .split(RECORD)
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [sha, subject, ...rest] = chunk.split('\n');
      const commit = { sha: sha.trim(), subject: (subject ?? '').trim(), body: rest.join('\n') };
      return withFiles ? { ...commit, files: filesInCommit(commit.sha) } : commit;
    });
}
