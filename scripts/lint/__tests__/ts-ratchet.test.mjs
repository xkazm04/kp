#!/usr/bin/env node
// Fixtures for the TypeScript suppression ratchet. No deps — run with:
//   node scripts/lint/__tests__/ts-ratchet.test.mjs
//
// Two classes of case, and the second is the one that matters. The first proves
// the five rules fire. The second proves the DETECTOR is a detector: this whole
// gate is a regex over comment text, so the ways it can quietly stop counting —
// reading prose about a suppression as a suppression, missing the block form,
// finding no files at all and calling that a clean tree — are pinned one by one.
// A ratchet that counts zero passes every time and protects nothing.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  REPO_ROOT,
  ROOTS,
  TS_DEBT_PATH,
  countIn,
  parseArgs,
  parseCeilings,
  rulesOf,
  runChecks,
  sourceFiles,
  tighten,
  treeCounts,
} from '../ts-ratchet.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const blocking = (findings) => findings.filter((f) => f.severity === 'blocking');
const counts = (obj) => new Map(Object.entries(obj));

const CEILINGS = {
  'eslint:react-hooks/exhaustive-deps': { max: 5, why: 'effects narrower than their closure' },
  'directive:unreasoned': { max: 3, why: 'directives with no -- why' },
};

// --- counting the real shapes this tree contains -------------------------------

check('the line form is counted, per rule it names', () => {
  const c = countIn('const a = 1;\n// eslint-disable-next-line react-hooks/exhaustive-deps\nuseEffect(f, []);\n');
  assert.equal(c.get('eslint:react-hooks/exhaustive-deps'), 1);
});

check('the block form is counted too, including inside JSX', () => {
  const c = countIn('{/* eslint-disable-next-line jsx-a11y/media-has-caption */}\n<audio />\n');
  assert.equal(c.get('eslint:jsx-a11y/media-has-caption'), 1);
});

check('a blanket disable is counted as `*` — it names no rule and switches off all of them', () => {
  const c = countIn('"use client";\n\n/* eslint-disable */\n');
  assert.equal(c.get('eslint:*'), 1);
});

check('PROSE ABOUT A SUPPRESSION IS NOT A SUPPRESSION', () => {
  // Both shapes are in this tree today and both used to be counted by the
  // obvious regex. `// eslint-disable <word>` is not even a directive: eslint
  // honours the bare form only in a BLOCK comment, so a line comment saying it
  // is a sentence. The second is a test asserting that a file has no directive.
  const prose = [
    '// the tab was hardcoded English behind an',
    '// eslint-disable while ~49 already-translated keys sat orphaned.',
    'assert.doesNotMatch(src, /eslint-disable[^\\n]*i18next/, "still opts out");',
    'const CLASS = /\\b(suppress\\w*|eslint-disable|ts-expect-error)\\b/i;',
  ].join('\n');
  assert.deepEqual([...countIn(prose).entries()], []);
});

check('the reason axis counts the directives that do not carry one', () => {
  const src = [
    '// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore',
    '// eslint-disable-next-line react-hooks/exhaustive-deps',
    '/* eslint-disable */',
  ].join('\n');
  const c = countIn(src);
  assert.equal(c.get('eslint:react-hooks/exhaustive-deps'), 2);
  assert.equal(c.get('directive:unreasoned'), 2, 'the reasoned one, and only it, is excluded');
});

check('a reason is stripped before rule names are read', () => {
  assert.deepEqual(rulesOf(' react-hooks/exhaustive-deps -- intentionally not on `input`, seed once'), [
    'react-hooks/exhaustive-deps',
  ]);
  assert.deepEqual(rulesOf(' i18next/no-literal-string -- fold glyph, not copy */}'), ['i18next/no-literal-string']);
  assert.deepEqual(rulesOf(' a/one, b/two'), ['a/one', 'b/two']);
  assert.deepEqual(rulesOf(' */'), ['*']);
});

check('a `@ts-` directive is counted, and never on the reason axis', () => {
  // `--` is eslint's syntax. A `@ts-expect-error` cannot carry one, so counting
  // it as unreasoned would record a missing reason for a comment that has no
  // place to put one.
  const c = countIn('// @ts-expect-error — deliberately drop a branch\nread(x);\n');
  assert.equal(c.get('ts:@ts-expect-error'), 1);
  assert.equal(c.get('directive:unreasoned'), undefined);
});

check('a directive is not stitched together across two lines', () => {
  // `\s*` would match the newline and read this as one directive. The tool a
  // human verifies the number with is line-oriented, so the check must be too.
  assert.deepEqual([...countIn('//\nfoo eslint-disable-next-line bar\n').entries()], []);
});

// --- the five rules ------------------------------------------------------------

check('a suppression kind with no declared ceiling is blocking', () => {
  const f = runChecks(CEILINGS, counts({ 'ts:@ts-ignore': 1, 'directive:unreasoned': 3 }));
  assert.ok(has(f, 'undeclared'));
  assert.match(f.find((x) => x.rule === 'undeclared').message, /ts:@ts-ignore/);
});

check('debt growing under an existing entry is blocking', () => {
  const f = runChecks(CEILINGS, counts({ 'eslint:react-hooks/exhaustive-deps': 9, 'directive:unreasoned': 3 }));
  assert.ok(has(f, 'grew'));
  assert.match(f.find((x) => x.rule === 'grew').message, /9 time\(s\)/);
  assert.equal(blocking(f).length, 1);
});

check('a ceiling with no `why` is blocking — a number alone does not say it is debt', () => {
  const f = runChecks({ 'eslint:x/y': { max: 2, why: '  ' } }, counts({ 'eslint:x/y': 2 }));
  assert.ok(has(f, 'unexplained'));
  assert.equal(blocking(f).length, 1);
});

check('a ceiling that is not a number is not a ceiling', () => {
  assert.ok(has(runChecks({ 'eslint:x/y': { why: 'no max' } }, counts({})), 'unexplained'));
  assert.ok(has(runChecks({ 'eslint:x/y': { max: -1, why: 'negative' } }, counts({})), 'unexplained'));
});

check('ground gained is a note, not a red build', () => {
  const f = runChecks(CEILINGS, counts({ 'eslint:react-hooks/exhaustive-deps': 2, 'directive:unreasoned': 3 }));
  assert.ok(has(f, 'slack'));
  assert.equal(blocking(f).length, 0);
});

check('a class burnt down to nothing is a note, and the entry survives to lock it at 0', () => {
  const f = runChecks(CEILINGS, counts({ 'directive:unreasoned': 3 }));
  assert.ok(has(f, 'burnt-down'));
  assert.equal(blocking(f).length, 0);
});

check('a tree that exactly matches its ceilings says nothing at all', () => {
  const f = runChecks(CEILINGS, counts({ 'eslint:react-hooks/exhaustive-deps': 5, 'directive:unreasoned': 3 }));
  assert.deepEqual(f, []);
});

check('a ceiling of 0 with nothing left is the goal state and passes', () => {
  assert.deepEqual(runChecks({ 'eslint:x/y': { max: 0, why: 'locked' } }, counts({})), []);
});

// --- refusing to guess ---------------------------------------------------------

check('a config the check cannot read is an error, never an empty set of ceilings', () => {
  assert.equal(parseCeilings('{ not json'), null);
  assert.equal(parseCeilings('{"$comment": ["no ceilings key"]}'), null);
  assert.deepEqual(parseCeilings('{"ceilings":{}}'), {}, 'an EMPTY set is legal and different from an unreadable one');
});

check('a walk that reaches no files is an error, not a clean tree', () => {
  // The dangerous direction: read as zero, every ceiling looks burnt down and a
  // `--tighten` running unattended in autofix.yml would zero the whole file
  // without opening a single source file.
  assert.throws(() => treeCounts({ roots: ['no-such-directory'] }), /not "no debt"/);
});

// --- --tighten -----------------------------------------------------------------

const FILE = `${JSON.stringify({ $comment: ['keep me'], ceilings: CEILINGS }, null, 2)}\n`;

check('a ceiling follows the tree down and is never raised', () => {
  const next = tighten(FILE, counts({ 'eslint:react-hooks/exhaustive-deps': 2, 'directive:unreasoned': 99 }));
  const parsed = JSON.parse(next);
  assert.equal(parsed.ceilings['eslint:react-hooks/exhaustive-deps'].max, 2);
  assert.equal(parsed.ceilings['directive:unreasoned'].max, 3, 'a ratchet must not widen');
});

check('--tighten keeps the reasons, the header and the key order', () => {
  const next = tighten(FILE, counts({ 'eslint:react-hooks/exhaustive-deps': 1, 'directive:unreasoned': 1 }));
  const parsed = JSON.parse(next);
  assert.deepEqual(parsed.$comment, ['keep me']);
  assert.equal(parsed.ceilings['eslint:react-hooks/exhaustive-deps'].why, 'effects narrower than their closure');
  assert.deepEqual(Object.keys(parsed.ceilings), Object.keys(CEILINGS));
});

check('a burnt-down class is locked at 0 rather than deleted', () => {
  // The deliberate divergence from ruff-ratchet, where a dead entry must GO: an
  // ignore that excuses nothing is rot, but a ceiling of 0 is the win, held.
  const parsed = JSON.parse(tighten(FILE, counts({ 'directive:unreasoned': 3 })));
  assert.equal(parsed.ceilings['eslint:react-hooks/exhaustive-deps'].max, 0);
});

check('tightening nothing rewrites nothing — the diff of a no-op job is empty', () => {
  assert.equal(tighten(FILE, counts({ 'eslint:react-hooks/exhaustive-deps': 5, 'directive:unreasoned': 3 })), FILE);
});

check('--tighten and --json are only on when asked for', () => {
  assert.deepEqual(parseArgs([]), { tighten: false, json: false });
  assert.deepEqual(parseArgs(['--tighten']), { tighten: true, json: false });
});

// --- and finally: the real tree, right now --------------------------------------
//
// The cases above prove the rules fire. These prove they are pointed at something.

check('the committed ts-debt.json is readable, and every entry declares a number and a reason', () => {
  const ceilings = parseCeilings(fs.readFileSync(path.join(REPO_ROOT, TS_DEBT_PATH), 'utf8'));
  assert.notEqual(ceilings, null, `${TS_DEBT_PATH} has no \`ceilings\` object the ratchet can read`);
  assert.ok(Object.keys(ceilings).length > 0, 'an empty ceilings map means the ratchet gates nothing');
  for (const [key, entry] of Object.entries(ceilings)) {
    assert.ok(Number.isInteger(entry.max) && entry.max >= 0, `${key} declares no integer max`);
    assert.ok(entry.why && entry.why.trim().length > 20, `${key} declares no real reason`);
  }
});

check('the walk reaches the product tree', () => {
  const files = sourceFiles();
  assert.ok(files.length > 500, `expected the app/packages walk to find the tree, found ${files.length} files`);
  assert.ok(
    files.some((f) => f.startsWith('app/')),
    'app/ must be in the walk — it is where the suppressions are',
  );
});

check('the committed ceilings agree with the committed tree', () => {
  // The case that would have caught a hand-written baseline. It is the check
  // itself, run against the real files: if this is red, `npm run lint:ts-ratchet`
  // is red too and the message names the entry.
  assert.deepEqual(blocking(runChecks(parseCeilings(fs.readFileSync(path.join(REPO_ROOT, TS_DEBT_PATH), 'utf8')), treeCounts())), []);
});

check('the ratchet is wired to an npm script CI can call', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['lint:ts-ratchet'], /scripts\/lint\/ts-ratchet\.mjs/);
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.includes('npm run lint:ts-ratchet'), 'ci.yml must run the ratchet, or it is a script nobody calls');
  const autofix = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/autofix.yml'), 'utf8');
  assert.ok(autofix.includes('ts-ratchet.mjs --tighten'), 'nothing would lower the ceilings without this');
});

check('ROOTS names trees that exist', () => {
  for (const r of ROOTS) assert.ok(fs.existsSync(path.join(REPO_ROOT, r)), `${r}/ is in ROOTS and is not in the tree`);
});

console.log(`\n${passed} checks passed.`);
