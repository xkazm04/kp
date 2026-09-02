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
// THE SECOND GAP, AND WHY THE FIRST ONE WAS NOT ENOUGH: a prefix is not a
// description. Every subject in this history carries a conventional type and a
// growing number of them read like this —
//
//     fix: Done. Here's what I found and did
//     fix: All four items are settled. Here's what I found and did
//     fix: Done. Three of the four were already answered in-tree; one was
//
// — which passes every rule above: `fix` is a known type, the summary is longer
// than three characters, the line is under the cap. It is a SESSION REPORT that
// happens to start with a prefix, and the third one stops mid-clause because it
// was sliced out of an agent's closing message. With ~43% of commits written by
// an agent, that is the primary record of what those agents did, and a log of
// them cannot be bisected, cut into a changelog, or read after an incident.
//
// So checkShape() below adds the smallest rule an automated lane can satisfy
// WITHOUT a human editing messages: the subject is ONE CLAUSE ABOUT THE CHANGE.
// Not one sentence of several (`. ` mid-subject is a narrative that was pasted
// in), not a report about the session (`Done`, `Here's what`, first person), and
// not a line that stops on a word nothing follows (`… one was`). The boundary is
// deliberate — the narrative is welcome, in the BODY, which is unlimited and
// which `git log --format=%s` never shows.
//
// THE SAME RULE HAS A SECOND SHAPE, and this history carries it too: a subject
// that reports the SESSION rather than the change — a timeout, a budget, a run
// that was cut short. It is accurate and it is the one kind of true subject a
// bisecting reader learns nothing from, because every commit was written by a
// session and only this one talks about it. SESSION_LIFECYCLE below rejects it
// and names where it goes instead: the tree that was left behind is the subject,
// and `Session-interrupted: <why>` in the BODY is the fact about the run.
//
// checkTypeAgainstFiles() closes the third one: nearly every agent commit is
// typed `fix:` whatever it did, which makes the prefix useless to the release
// cut it exists for. It is a narrow, mechanical claim — a change that touches
// only documentation is not a `fix`, a change that touches only tests is not a
// `feat` — checked against the files the commit actually carries, so it can only
// fire on a type the diff contradicts.
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
// AND ONE RULE THAT READS THE BODY: `checkTrailers` from
// scripts/release/provenance.mjs — the single entry point for a body's trailers.
// It judges the non-agent vocabulary itself and hands every `Agent-*` line to
// scripts/agent/provenance.mjs, which owns BOTH spellings of agent provenance
// (the four-key `Agent-model`/`Agent-harness`/`Agent-prompt`/`Agent-run` block
// and the one-line `Agent-Provenance: agent=…; model=…` compact form). It is
// silent on a commit that claims no provenance and fires on one that claims half
// of it, because three of four keys cannot be joined on.
//
// It used to be TWO calls, and they contradicted each other: the compact trailer
// CONTRIBUTING.md tells an outside lane to write failed this gate as one
// undefined key plus four missing ones, because each half of the rule had only
// ever been read against its own half of the vocabulary.
//
// WAIVER: a `Commit-convention-exemption: <why>` trailer in the commit body,
// the same shape as `Gate-exemption:` and `Doc-sync:`. A sentence in `git log` a
// reviewer can read and disagree with, deliberately not a suppression flag.
//
// EXIT CODES: 0 every subject conforms (or was exempt) · 1 at least one does not.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SECTIONS } from './prepare.mjs';
import { checkTrailers } from './provenance.mjs';

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

// --- the shape rules ----------------------------------------------------------
//
// Each one below fires on a shape observed in this repository's own log, and
// each names the body as the place the rejected text belongs. They judge the
// SUMMARY (everything after `type(scope): `), never the prefix.

/**
 * Openers that announce a session rather than a change. Kept deliberately short
 * and literal: a list that tries to detect "bad writing" in general starts
 * rejecting honest subjects, and a gate that rejects honest work gets bypassed.
 *
 * Not here on purpose: "All X are Y" and other descriptive noun phrases. This
 * repository's own style is descriptive rather than strictly imperative
 * ("ideation nights, graded on the holder's own ideas"), and the narrative
 * variants of those are already caught by the multi-sentence rule.
 */
export const NARRATIVE_OPENERS = [
  [/^done\b/i, '"Done" reports that a session ended, which every commit does'],
  [/^here(?:'|’)?s\b|^here is\b|^here are\b/i, '"Here\'s what…" introduces a report; the report is the body'],
  [/^what\b/i, 'a subject answers "what changed", it does not ask it'],
  [/^(?:successfully|finished|complete|completed)\b/i, 'success is implied by the commit existing'],
  [/^as (?:requested|asked|discussed)\b/i, 'who asked belongs in the body or a trailer'],
  [/^(?:summary|report)\b/i, 'a subject is not a heading for a report'],
  [/^this (?:commit|change|pr|patch|session)\b/i, 'a subject describes the change, it does not refer to it'],
  [/^no (?:changes?|op)\b|^nothing\b/i, 'a commit that changed nothing should not exist'],
];

/**
 * Subjects that report the SESSION's fate rather than the change's. The sibling
 * of NARRATIVE_OPENERS and a different shape: these can appear anywhere in the
 * line, and they are the only subjects in this history that are accurate and
 * still useless — `chore: session timed out at 45 minutes` is true, and a
 * bisecting reader learns from it that a clock ran out, not what the tree now
 * holds.
 *
 * A stopped session still leaves a tree, and that tree is what the commit is
 * about: name what landed, then say the session was cut short in the BODY, where
 * `Session-interrupted: <why>` is the trailer for it (CONTRIBUTING.md). Anything
 * genuinely unsummarisable has the ordinary waiver.
 *
 * ANCHORED AT THE START of the summary, for the same reason NARRATIVE_OPENERS is:
 * "session", "timed out" and "limit" are all ordinary vocabulary in a product
 * that has HMAC sessions, interview sessions, a child-process timeout and a rate
 * limiter. `fix(extract-text): the child process timed out on a 40MB scan` is a
 * real subject and stays legal. A subject that OPENS on the run's fate is the
 * shape that only a session report has.
 */
export const SESSION_LIFECYCLE = [
  [/^(?:the\s+)?session\s+(?:timed?\s+out|ended|expired|ran\s+out|stopped|interrupted|aborted|limit)\b/i,
    'the subject opens on what happened to the session, not on what happened to the tree'],
  [/^(?:timed\s+out|timeout|ran\s+out\s+of\s+time|out\s+of\s+time|hit\s+the\s+(?:time|token|context|turn)\s+limit)\b/i,
    'running out of time is a fact about the run, not about the change it left behind'],
  [/^(?:context|token|turn)\s+(?:limit|window|budget)\b/i, 'a budget the harness exhausted is a fact about the harness'],
  [/^(?:partial|incomplete|unfinished)\s+(?:work|progress|session|run|state|changes?)\b/i,
    'say WHAT landed; that it is partial belongs in the body, with what is still missing'],
  [/^(?:wip|work\s+in\s+progress)\b/i, '"WIP" names the author\'s state, not the commit\'s content'],
  [/^(?:interrupted|stopped\s+early|cut\s+short|aborted)\b/i, 'how the run ended says nothing about what it left'],
];

/**
 * Words a subject does not end on. A line that stops here was cut, not written:
 * every one of them needs a following word to mean anything.
 */
export const DANGLING_TAIL = new Set([
  'and', 'or', 'but', 'so', 'then', 'than', 'as', 'if', 'while', 'when', 'because',
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'which', 'who', 'whose', 'it', 'its', 'one',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'into', 'onto', 'over', 'under',
  'about', 'after', 'before', 'per', 'via', 'between', 'through',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
]);

/** Punctuation a subject does not end on — each one opens something. */
const CUT_TAIL_RE = /[,;:\-–—/&+([{]$|\.{2,}$|…$/;

/** Delimiters that must balance: a subject that opens one and never closes it was cut. */
const PAIRS = [
  ['`', null, 'a backtick'],
  ['(', ')', 'a parenthesis'],
  ['[', ']', 'a bracket'],
  ['"', null, 'a double quote'],
];

const countOf = (s, ch) => s.split(ch).length - 1;

/**
 * Judge the summary text of a subject that already parsed as conventional.
 * Pure. Returns problems; empty means the summary is one clause about a change.
 */
export function checkShape(text) {
  const s = String(text ?? '').trim();
  const problems = [];
  if (!s) return problems;

  // A sentence terminator with more words after it: two sentences were pasted
  // into a one-line field. This is the rule that catches the observed shape.
  if (/[.!?]["'’)]?\s+\S/.test(s)) {
    problems.push(
      'the subject holds more than one sentence — keep the first clause about the change and move the ' +
        'rest into the commit body, which `git log --format=%s` never shows and which has no length limit',
    );
  }
  if (/\.$/.test(s) && !/\b[a-z]\.[a-z]\.$/i.test(s)) {
    problems.push('the subject ends in a full stop — it is a title, not a sentence');
  }

  for (const [re, why] of NARRATIVE_OPENERS) {
    if (re.test(s)) {
      problems.push(`the subject opens with a session narrative (${why}) — say what the change does instead`);
      break;
    }
  }

  for (const [re, why] of SESSION_LIFECYCLE) {
    if (re.test(s)) {
      problems.push(
        `the subject records the session rather than the change (${why}) — name what the tree now holds, and ` +
          'put the interruption in the body as a `Session-interrupted: <why>` trailer',
      );
      break;
    }
  }

  // First person is the reliable tell of a message assembled from an agent's own
  // closing words. `I` is matched case-sensitively so `i18n` is untouched.
  if (/\bI\b|\bI['’](?:m|ve|ll|d)\b|\bmy\b/.test(s)) {
    problems.push('the subject is written in the first person — a commit subject is about the code, not the author');
  }

  const last = (s.match(/[A-Za-z][A-Za-z'’-]*$/) ?? [''])[0].toLowerCase();
  if (DANGLING_TAIL.has(last)) {
    problems.push(
      `the subject stops on "${last}", a word that needs whatever came next — it was truncated rather than written`,
    );
  }
  if (CUT_TAIL_RE.test(s)) {
    problems.push('the subject ends on punctuation that opens something — it was cut mid-line');
  }
  for (const [open, close, name] of PAIRS) {
    const unbalanced = close === null ? countOf(s, open) % 2 === 1 : countOf(s, open) !== countOf(s, close);
    if (unbalanced) {
      problems.push(`the subject opens ${name} it never closes — it was truncated`);
      break;
    }
  }

  return problems;
}

// --- does the type match what the commit actually touched? --------------------

/** Files that are documentation and nothing else. */
const DOC_FILE_RE = /^docs\/|\.mdx?$|^(?:CHANGELOG|README|CONTRIBUTING|SECURITY|AGENTS|CLAUDE|CLA|CODE_OF_CONDUCT)\b/i;
/** Every shape a test lives in here — the same set dispatch.mjs refuses to delete. */
const TEST_FILE_RE = /(?:\.test\.[cm]?[jt]sx?|_test\.py|\/test_[\w-]+\.py|\/__tests__\/|^e2e\/|\/tests?\/)/;

/** Types that may legitimately describe a documentation-only or test-only change. */
const DOC_TYPES = new Set(['docs', 'chore', 'deps']);
const TEST_TYPES = new Set(['test', 'chore', 'ci', 'deps']);

/**
 * Judge a type against the files the commit carries. Pure — the caller supplies
 * the paths, so the rule is fixture-covered and the git plumbing is not.
 *
 * Deliberately only two claims, both of which the diff settles outright. A
 * general "does `fix` describe this change" is a judgement, and it already has
 * an owner: the agent review lens in scripts/review/agent-review.mjs.
 */
export function checkTypeAgainstFiles(subject, files) {
  const m = String(subject ?? '').trim().match(SUBJECT_RE);
  if (!m || !Array.isArray(files) || files.length === 0) return [];
  const type = m[1];
  const problems = [];

  if (files.every((f) => DOC_FILE_RE.test(f)) && !DOC_TYPES.has(type)) {
    problems.push(
      `every file in this commit is documentation, but it is typed "${type}" — prepare.mjs would file it under ` +
        `${type === 'feat' ? '"Added"' : `"${type}"`}'s section of a release note that ships no such change. Use "docs".`,
    );
  }
  if (files.every((f) => TEST_FILE_RE.test(f)) && !TEST_TYPES.has(type)) {
    problems.push(
      `every file in this commit is a test, but it is typed "${type}" — a release note reader would see a ` +
        'user-visible change that does not exist. Use "test".',
    );
  }
  return problems;
}

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
  problems.push(...checkShape(text));
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
    // The paths this commit carries, when the caller could find them out. The
    // type rule is skipped rather than guessed when it cannot: a check that
    // invents its own evidence is worse than one that says it did not run.
    const files = typeof c === 'string' ? null : (c.files ?? null);
    const waiver = body.match(EXEMPTION_RE)?.[1]?.trim() ?? null;
    // …and the trailers, which are the only machine-readable thing a commit
    // carries. ONE CALL (scripts/release/provenance.mjs): it covers the whole
    // vocabulary, agent provenance included. NARROW BY CONSTRUCTION — a trailer
    // that is absent is fine, a trailer that is present and unparseable is not —
    // it looks like a fact that was recorded and answers no query.
    const problems = [
      ...checkSubject(subject),
      ...checkTrailers(body),
      ...(files?.length ? checkTypeAgainstFiles(subject, files) : []),
    ];
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
    '',
    'The subject is ONE CLAUSE ABOUT THE CHANGE. Everything else a session wants to say —',
    'what was explored, what was found, what was left out — belongs in the BODY, which has',
    'no length limit and which `git log --format=%s` never prints. An automated lane meets',
    'this by writing a subject for the diff instead of slicing its own closing message.',
    '',
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

/** Commits in `base..head`, merges excluded (their subjects are git's, not ours). */
export function commitsInRange(base, head) {
  const out = git(['log', '--no-merges', '--format=%H%n%s%n%b%x1e', `${base}..${head}`]);
  return out
    .split(RECORD)
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [sha, subject, ...rest] = chunk.split('\n');
      return { sha: sha.trim(), subject: (subject ?? '').trim(), body: rest.join('\n'), files: filesInCommit(sha.trim()) };
    });
}

/**
 * What the commit being written is about to carry. The commit-msg hook runs
 * after staging, so the index IS the commit — and this is the only moment the
 * type rule can see the change locally.
 */
export function stagedFiles() {
  try {
    return git(['diff', '--cached', '--name-only'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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
    const { ok, report } = review([
      { subject: subjectFromMessage(message), body: message, files: stagedFiles() },
    ]);
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
