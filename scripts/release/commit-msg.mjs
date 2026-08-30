#!/usr/bin/env node
// The commit-subject gate. One rule, enforced in two places.
//
// THE GAP THIS CLOSES: every commit in this history is conventional-prefixed,
// and `scripts/release/prepare.mjs` CUTS THE CHANGELOG from that prefix — it is
// what decides whether a commit appears under "Added", "Security" or nothing at
// all. Nothing checked it. A subject written in a hurry (`fixed the token bug`)
// does not fail anything: it silently lands in "Other", and a release note that
// an operator reads to decide whether to upgrade quietly stops being accurate.
// Agents infer conventions from what passes, not from what is written down, so
// the first unchecked subject is also the one the next agent copies.
//
// THE VOCABULARY IS NOT INVENTED HERE. It is derived from prepare.mjs's
// SECTIONS table — the types the release script can actually file — so the gate
// and the changelog cut cannot disagree. Teach prepare.mjs a new type and this
// accepts it in the same commit.
//
//   node scripts/release/commit-msg.mjs --file .git/COMMIT_EDITMSG   # the hook
//   node scripts/release/commit-msg.mjs --base origin/main --head HEAD   # CI
//   node scripts/release/commit-msg.mjs --subject "feat(api): add a route"
//   npm run commit:check                                             # HEAD~1..HEAD
//
// WHERE IT RUNS: `.githooks/commit-msg` (core.hooksPath is set by the `prepare`
// npm script, so it is live after `npm install`) and the `commit-convention` job
// in .github/workflows/ci.yml, over every commit in the pushed range. The hook
// is the fast feedback; CI is the teeth, because a hook only binds the machine
// that has it installed.
//
// WAIVER: a `Commit-convention-exemption: <why>` trailer in the commit body,
// the same shape as `Gate-exemption:` and `Doc-sync:`. A sentence in `git log` a
// reviewer can read and disagree with, deliberately not a suppression flag.
//
// EXIT CODES: 0 every subject conforms (or was exempt) · 1 at least one does not.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SECTIONS } from './prepare.mjs';

export const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

/** The types prepare.mjs can file. Anything else lands in "Other" — the failure. */
export const KNOWN_TYPES = [...new Set(SECTIONS.flatMap(([, types]) => types))].sort();

/** The same shape prepare.mjs's classify() parses. One regex, one meaning. */
export const SUBJECT_RE = /^([a-z]+)(\(([^)]*)\))?(!)?:\s*(.+)$/;

export const EXEMPTION_RE = /^Commit-convention-exemption:\s*(.+)$/im;

// Subjects git itself writes, or that carry their own meaning. Rejecting these
// would mean rejecting `git revert` and `git merge` output, which is a gate
// nobody can comply with and everybody learns to bypass.
const EXEMPT_PATTERNS = [
  /^Merge\b/,
  /^Revert\s+"/,
  /^Reapply\s+"/,
  /^fixup!\s/,
  /^squash!\s/,
  /^amend!\s/,
  /^Initial commit$/,
];

/** A generous cap: the longest subject in this history is ~106 characters. */
export const MAX_SUBJECT = 120;

export function isExempt(subject) {
  return EXEMPT_PATTERNS.some((re) => re.test(subject));
}

function truncate(s, n = 72) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Judge one subject line.
 * Pure, so the fixtures cover the rule rather than the plumbing.
 * @returns string[] problems (empty = conforms)
 */
export function checkSubject(subject) {
  const s = String(subject ?? '').trim();
  if (!s) return ['empty subject line'];
  if (isExempt(s)) return [];

  const m = s.match(SUBJECT_RE);
  if (!m) {
    return [
      `no conventional prefix — expected "type(scope): summary", got "${truncate(s)}". ` +
        'scripts/release/prepare.mjs files an unprefixed subject under "Other", so it ' +
        'disappears from the release note a self-hoster reads.',
    ];
  }

  const [, type, , scope, , text] = m;
  const problems = [];
  if (!KNOWN_TYPES.includes(type)) {
    problems.push(
      `unknown type "${type}" — the release script has no section for it and would file ` +
        `the commit under "Other". Known types: ${KNOWN_TYPES.join(', ')}.`,
    );
  }
  if (scope !== undefined && scope.trim() === '') {
    problems.push('empty scope — write "type: summary" or "type(scope): summary", not "type(): summary"');
  }
  if (text.trim().length < 3) {
    problems.push(`summary is too short to be a release-note line: "${text.trim()}"`);
  }
  if (s.length > MAX_SUBJECT) {
    problems.push(`subject is ${s.length} characters; keep it under ${MAX_SUBJECT} and put the detail in the body`);
  }
  return problems;
}

/** The first non-comment, non-empty line of a commit message file. */
export function subjectFromMessage(message) {
  for (const line of String(message).split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    if (line.trim() === '') continue;
    return line.trim();
  }
  return '';
}

/**
 * Render the verdict for a set of commits (`{ subject, body }`, or bare subjects).
 * @returns { ok: boolean, report: string }
 */
export function review(commits) {
  const rows = commits.map((c) => {
    const subject = typeof c === 'string' ? c : c.subject;
    const body = typeof c === 'string' ? '' : (c.body ?? '');
    const waiver = body.match(EXEMPTION_RE)?.[1]?.trim() ?? null;
    const problems = checkSubject(subject);
    return { subject, problems: waiver ? [] : problems, waiver: problems.length ? waiver : null };
  });

  const bad = rows.filter((r) => r.problems.length);
  const lines = [];

  for (const waived of rows.filter((row) => row.waiver)) {
    lines.push(`~ waived: "${truncate(waived.subject)}"`, `    Commit-convention-exemption: ${waived.waiver}`);
  }
  if (!bad.length) {
    lines.push(
      `commit-msg ✓ ${rows.length} subject(s) conform to the convention the changelog is cut from.`,
    );
    return { ok: true, report: lines.join('\n') };
  }

  lines.push(`commit-msg ✗ ${bad.length} of ${rows.length} subject(s) do not conform:`, '');
  for (const r of bad) {
    lines.push(`  "${truncate(r.subject)}"`);
    for (const p of r.problems) lines.push(`    - ${p}`);
  }
  lines.push(
    '',
    `Types: ${KNOWN_TYPES.join(', ')} (a trailing "!" marks a breaking change).`,
    'Examples: feat(schedule): honour the candidate timezone · fix(auth): stop the leak',
    'Fix the last message with `git commit --amend`, or waive it deliberately with a',
    '`Commit-convention-exemption: <why>` trailer in the body. See CONTRIBUTING.md.',
  );
  return { ok: false, report: lines.join('\n') };
}

// --- git plumbing (not pure; not covered by fixtures) -----------------------

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function revExists(rev) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// ASCII record separator. Commit bodies contain blank lines and every printable
// delimiter someone might reach for, so records are split on a byte a message
// cannot contain.
const RECORD = '\x1e';

/** Commits in `base..head`, merges excluded (their subjects are git's, not ours). */
export function commitsInRange(base, head) {
  const out = git(['log', '--no-merges', '--format=%s%n%b%x1e', `${base}..${head}`]);
  return out
    .split(RECORD)
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [subject, ...rest] = chunk.split('\n');
      return { subject: subject.trim(), body: rest.join('\n') };
    });
}

export function parseArgs(argv) {
  const out = { file: null, subject: null, base: null, head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') out.file = argv[++i];
    else if (argv[i] === '--subject') out.subject = argv[++i];
    else if (argv[i] === '--base') out.base = argv[++i];
    else if (argv[i] === '--head') out.head = argv[++i];
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);

  if (args.subject !== null) {
    const { ok, report } = review([{ subject: args.subject, body: '' }]);
    process[ok ? 'stdout' : 'stderr'].write(`${report}\n`);
    return ok ? 0 : 1;
  }

  if (args.file) {
    const message = fs.readFileSync(args.file, 'utf8');
    const { ok, report } = review([{ subject: subjectFromMessage(message), body: message }]);
    process[ok ? 'stdout' : 'stderr'].write(`${report}\n`);
    return ok ? 0 : 1;
  }

  // Range mode. A missing base (shallow clone, unfetched branch) narrows to the
  // parent commit rather than passing vacuously — the same fallback the review
  // lenses use, for the same reason.
  const base = args.base && revExists(args.base) ? args.base : `${args.head}~1`;
  if (!revExists(base)) {
    process.stdout.write(`commit-msg: no comparable base (${base}) — nothing to check.\n`);
    return 0;
  }
  const commits = commitsInRange(base, args.head);
  if (!commits.length) {
    process.stdout.write(`commit-msg: no commits in ${base}..${args.head}.\n`);
    return 0;
  }
  const { ok, report } = review(commits);
  process[ok ? 'stdout' : 'stderr'].write(`${report}\n`);
  return ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('commit-msg.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
