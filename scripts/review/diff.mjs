#!/usr/bin/env node
// Unified-diff parsing shared by the two review lenses.
//
// Deliberately dependency-free and deliberately small: it understands exactly
// what `git diff` emits and nothing else. Anything it cannot parse is skipped
// rather than guessed at — a review tool that invents line numbers is worse
// than no review tool.

import { execFileSync } from 'node:child_process';

export const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

export function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
}

export function revExists(rev) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the range to review. Falls back to the parent commit when the base is
 * absent (shallow CI checkout, unfetched branch) — a narrow range beats a
 * skipped review.
 */
export function resolveRange({ base, head = 'HEAD' }, exists = revExists) {
  if (base && exists(base)) return { base, head };
  return { base: `${head}~1`, head };
}

function emptyFlags() {
  return { isNew: false, isDeleted: false, isRename: false, oldPath: null };
}

/**
 * Parse a unified diff.
 *
 * @returns Map<path, {
 *   path, isNew, isDeleted, isRename,
 *   added:   [{ line, text }],   // line = line number in the NEW file
 *   removed: [{ line, text }],   // line = line number in the OLD file
 * }>
 */
export function parseDiff(text) {
  const files = new Map();
  let current = null;
  let flags = emptyFlags();
  let newLine = 0;
  let oldLine = 0;

  for (const raw of String(text).split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = null;
      flags = emptyFlags();
      continue;
    }
    if (raw.startsWith('new file mode ')) {
      flags.isNew = true;
      continue;
    }
    if (raw.startsWith('deleted file mode ')) {
      flags.isDeleted = true;
      continue;
    }
    if (raw.startsWith('rename from ') || raw.startsWith('rename to ')) {
      flags.isRename = true;
      continue;
    }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4);
      flags.oldPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      // `+++ /dev/null` is a deletion; the file is named on the `---` line.
      const path = p === '/dev/null' ? flags.oldPath : p.replace(/^b\//, '');
      if (!path) {
        current = null;
        flags = emptyFlags();
        continue;
      }
      current = files.get(path) ?? {
        path,
        isNew: flags.isNew,
        isDeleted: flags.isDeleted || p === '/dev/null',
        isRename: flags.isRename,
        added: [],
        removed: [],
      };
      files.set(path, current);
      flags = emptyFlags();
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
      }
      continue;
    }
    if (!current) continue;

    if (raw.startsWith('+')) {
      current.added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      current.removed.push({ line: oldLine, text: raw.slice(1) });
      oldLine++;
    } else if (raw.startsWith(' ')) {
      newLine++;
      oldLine++;
    }
    // '\\ No newline at end of file' and anything else: ignored on purpose.
  }

  return files;
}

/** Read the diff for a range from git. */
export function diffForRange({ base, head }) {
  return git(['diff', '--no-color', '--no-ext-diff', `${base}...${head}`]);
}

/** Every commit message body in the range, concatenated. */
export function messagesForRange({ base, head }) {
  return git(['log', '--format=%B', `${base}..${head}`]);
}
