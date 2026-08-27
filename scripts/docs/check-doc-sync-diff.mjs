#!/usr/bin/env node
// Doc-sync as a CI gate, over a git range.
//
// The doc-sync obligation is stated in .claude/CLAUDE.md and enforced by a Stop
// hook (check-doc-sync.mjs) that reads the AGENT TRANSCRIPT. That covers one
// agent session on one machine and nothing else: a human commit, a Dependabot
// PR, a second tool, or an agent that simply dismissed the reminder all land
// with the doc untouched and nothing notices. This script applies the SAME
// pure rule (`evaluate`, imported from the hook) to a git range, so the
// obligation is checkable rather than trusted.
//
//   node scripts/docs/check-doc-sync-diff.mjs --base origin/main --head HEAD
//   node scripts/docs/check-doc-sync-diff.mjs            # defaults to HEAD~1..HEAD
//
// FAILS when the range changes source mapped in feature-doc-map.json and
// touches no file under docs/features/, docs/architecture/ or docs/design/.
//
// THE DISMISSAL IS EXPLICIT, NOT SILENT. The same escape the Stop hook offers
// in conversation is available here as a commit trailer, on any commit in the
// range:
//
//   Doc-sync: internal-only — extracted a helper, no behaviour change
//
// A reviewer reading `git log` sees the claim and can disagree with it. That is
// the whole point: the trade is one line of justification, not a suppression.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { evaluate } from './check-doc-sync.mjs';

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MAP_PATH = path.join(REPO_ROOT, 'scripts/docs/feature-doc-map.json');

// Recognised on any commit in the range. Deliberately permissive about the
// separator (em dash, hyphen, colon) and case — a gate that fails on
// punctuation teaches people to hate it.
export const DISMISS_RE = /^\s*Doc-sync:\s*(.+)$/im;

export function parseArgs(argv) {
  const out = { base: null, head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') out.base = argv[++i];
    else if (argv[i] === '--head') out.head = argv[++i];
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/** Resolve the range endpoints, falling back to the parent commit. */
export function resolveRange({ base, head }, revExists) {
  if (base && revExists(base)) return { base, head };
  // No base (or an unfetched one, e.g. a shallow CI checkout): compare against
  // the parent of head. Better a narrow range than a skipped check.
  return { base: `${head}~1`, head };
}

function main(argv) {
  const args = parseArgs(argv);
  const revExists = (rev) => {
    try {
      git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };

  const range = resolveRange(args, revExists);
  if (!revExists(range.base)) {
    // A single-commit repository or an unresolvable base. Nothing to compare;
    // say so rather than passing quietly.
    process.stdout.write(`doc-sync: no comparable base (${range.base}) — check skipped.\n`);
    return 0;
  }

  const changed = git(['diff', '--name-only', `${range.base}...${range.head}`])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (changed.length === 0) {
    process.stdout.write('doc-sync: no files changed in range.\n');
    return 0;
  }

  let map;
  try {
    map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch (err) {
    process.stderr.write(`doc-sync: cannot read ${MAP_PATH}: ${err.message}\n`);
    return 1;
  }

  const { hits, missing } = evaluate(changed, map);
  if (!missing) {
    const note = hits.size > 0 ? ` (${hits.size} mapped doc(s) touched alongside the source)` : '';
    process.stdout.write(`doc-sync: ✓ ${changed.length} changed file(s)${note}.\n`);
    return 0;
  }

  const messages = git(['log', '--format=%B', `${range.base}..${range.head}`]);
  const dismissal = messages.match(DISMISS_RE);
  if (dismissal) {
    process.stdout.write(`doc-sync: dismissed by commit trailer — "${dismissal[1].trim()}"\n`);
    return 0;
  }

  const summary = [...hits.entries()]
    .map(([doc, files]) => {
      const head = files.slice(0, 6).join(', ');
      const tail = files.length > 6 ? ` (+${files.length - 6} more)` : '';
      return `  - ${doc}\n      <- ${head}${tail}`;
    })
    .join('\n');

  process.stderr.write(
    `doc-sync: ✗ this range changed feature source but no docs/features/*, ` +
      `docs/architecture/* or docs/design/* file.\n\n` +
      `Doc(s) likely stale:\n${summary}\n\n` +
      `Fix it one of two ways:\n` +
      `  1. Update the named doc in this change (entry points, flows, surface table, ` +
      `data model, known gaps).\n` +
      `  2. If the change really is internal-only, say so in a commit body:\n` +
      `       Doc-sync: internal-only — <one line saying why>\n\n` +
      `New feature area? Add its entry to scripts/docs/feature-doc-map.json here too.\n`,
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-doc-sync-diff.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
