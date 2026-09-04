#!/usr/bin/env node
// Fixtures for the shared ratchet protocol. No deps — run with:
//   node scripts/lint/__tests__/ratchet.test.mjs
//
// scripts/lint/ratchet.mjs is what the two ratchets stopped duplicating: the
// verdict ladder, the report, the flags, the exit codes, and the rule that a
// no-op `--tighten` writes nothing. Those used to be typed twice, which meant
// they could disagree without anything noticing — the ruff side answered
// "suppresses nothing" before "over the ceiling" and the TypeScript side after,
// and only one of them was documented anywhere.
//
// The last section is the point of the file: the two ratchets are supposed to
// diverge in EXACTLY ONE place, and it is pinned here rather than left as a
// paragraph in two headers.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BLOCKING, NOTE, classify, finding, hasBlocking, parseArgs, renderFindings, runRatchetCli } from '../ratchet.mjs';
import { REPO_ROOT, runChecks as ruffChecks, parseIgnores } from '../ruff-ratchet.mjs';
import { runChecks as tsChecks } from '../ts-ratchet.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const counts = (obj) => new Map(Object.entries(obj));

// --- the ladder ---------------------------------------------------------------

check('every rung of the ladder, in the order the ladder asks its questions', () => {
  assert.equal(classify({ ceiling: null, actual: 3 }), 'undeclared');
  assert.equal(classify({ ceiling: undefined, actual: 0 }), 'undeclared');
  assert.equal(classify({ ceiling: 1.5, actual: 3 }), 'unexplained');
  assert.equal(classify({ ceiling: -1, actual: 3 }), 'unexplained');
  assert.equal(classify({ ceiling: 5, actual: 3, explained: false }), 'unexplained');
  assert.equal(classify({ ceiling: 5, actual: 9 }), 'grew');
  assert.equal(classify({ ceiling: 5, actual: 3 }), 'slack');
  assert.equal(classify({ ceiling: 5, actual: 5 }), 'met');
  assert.equal(classify({ ceiling: 0, actual: 0 }), 'zero');
  assert.equal(classify({ ceiling: 5, actual: 0 }), 'zero');
});

check('"suppresses nothing" is answered BEFORE "over the ceiling"', () => {
  // The order is the whole reason this is one function. A ceiling of 0 with
  // nothing left must read as `zero` — which the ruff side turns into a deletion
  // and the TypeScript side into silence — and not as `met`, which would make
  // ruff's dead-entry rule miss the entry that is most dead.
  assert.equal(classify({ ceiling: 0, actual: 0 }), 'zero');
  // …and a ceiling of 0 that has been breached is still growth, not a zero.
  assert.equal(classify({ ceiling: 0, actual: 1 }), 'grew');
});

check('an unexplained ceiling is judged before the tree is compared to it', () => {
  // Otherwise an entry with a valid number and no reason would report as `met`
  // and the reason would never be asked for.
  assert.equal(classify({ ceiling: 3, actual: 3, explained: false }), 'unexplained');
});

// --- the report ---------------------------------------------------------------

const F = [
  finding(BLOCKING, 'grew', 'ruff.toml', 'F401 grew', 'fix it', { line: 12 }),
  finding(NOTE, 'slack', 'ts-debt.json', 'x has slack', 'tighten it', { key: 'eslint:x' }),
];

check('a location is printed only when the debt format can point at one', () => {
  const out = renderFindings(F, 'clean');
  assert.match(out, /BLOCK {2}ruff\.toml:12 {2}\[grew\]/);
  assert.match(out, / note {2}ts-debt\.json {2}\[slack\]/, 'a JSON entry has no line, and none is invented');
});

check('the trailer counts blocking and notes apart', () => {
  assert.match(renderFindings(F, 'clean'), /\n1 blocking, 1 note\(s\)\.$/);
});

check('nothing to say is said in the ratchet’s own words', () => {
  assert.equal(renderFindings([], 'ruff-ratchet: the list is clean.'), 'ruff-ratchet: the list is clean.');
});

check('only a blocking finding stops a build', () => {
  assert.equal(hasBlocking(F), true);
  assert.equal(hasBlocking([F[1]]), false);
  assert.equal(hasBlocking([]), false);
});

check('--tighten and --json are only on when asked for', () => {
  assert.deepEqual(parseArgs([]), { tighten: false, json: false });
  assert.deepEqual(parseArgs(['--tighten', '--json']), { tighten: true, json: true });
});

// --- the CLI ------------------------------------------------------------------

const driver = (over = {}) => {
  const out = [];
  const errs = [];
  const written = [];
  const spec = {
    name: 'demo-ratchet',
    argv: [],
    load: () => ({ text: 'before', entries: ['e'] }),
    unreadable: 'the debt file lost its shape',
    measure: () => counts({ a: 1 }),
    check: () => [],
    tighten: () => ({ text: 'after', log: ['  moved: a 5 -> 1.'] }),
    write: (t) => written.push(t),
    tightenMessages: { none: 'nothing to tighten', done: 'lowered the ceilings' },
    clean: 'demo-ratchet: clean',
    log: (m) => out.push(String(m)),
    err: (m) => errs.push(String(m)),
    ...over,
  };
  return { code: runRatchetCli(spec), out, errs, written };
};

check('a debt file the ratchet cannot read is exit 1, never an empty set of ceilings', () => {
  const r = driver({ load: () => null });
  assert.equal(r.code, 1);
  assert.match(r.errs.join('\n'), /demo-ratchet: the debt file lost its shape/);
  assert.deepEqual(r.written, [], 'and nothing is rewritten on the way out');
});

check('a clean check prints the clean sentence and exits 0', () => {
  const r = driver();
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['demo-ratchet: clean']);
});

check('notes do not stop a build; a blocking finding does', () => {
  assert.equal(driver({ check: () => [F[1]] }).code, 0);
  assert.equal(driver({ check: () => F }).code, 1);
});

check('--json prints the findings verbatim rather than the report', () => {
  const r = driver({ argv: ['--json'], check: () => [F[1]] });
  assert.deepEqual(JSON.parse(r.out[0]), [F[1]]);
});

check('--tighten writes the new text and says what moved', () => {
  const r = driver({ argv: ['--tighten'] });
  assert.equal(r.code, 0);
  assert.deepEqual(r.written, ['after']);
  assert.deepEqual(r.out, ['  moved: a 5 -> 1.', 'demo-ratchet: lowered the ceilings']);
});

check('a --tighten that changes nothing writes NOTHING', () => {
  // autofix.yml runs `--tighten` unattended on every pull request. A rewrite that
  // reflowed or re-saved an unchanged file would put the whole debt file in the
  // diff of a job whose only job is to change two numbers.
  const r = driver({ argv: ['--tighten'], tighten: () => ({ text: 'before', log: ['should not print'] }) });
  assert.deepEqual(r.written, []);
  assert.deepEqual(r.out, ['demo-ratchet: nothing to tighten']);
});

check('a measurement that throws is not caught here — it must reach the exit-1 handler', () => {
  assert.throws(
    () =>
      driver({
        measure: () => {
          throw new Error('ruff did not answer with JSON');
        },
      }),
    /did not answer with JSON/,
  );
});

// --- the one place the two ratchets are allowed to disagree ---------------------
//
// Both ask the same question of the same ladder. Only the answer to "this entry
// suppresses nothing" differs, because only there do the two debt formats mean
// different things by an entry: ruff's IS the ignore, ts-debt.json's is a CEILING
// on one. Everything else drifting apart is a bug, and this is where it shows.

const RUFF = ['[lint]', 'ignore = [', '    # ratchet: F401 <= 5', '    "F401",', ']', ''].join('\n');
const TS = { 'eslint:x/y': { max: 5, why: 'a real reason, stated at length enough to be one' } };

check('a suppression that now suppresses nothing: blocking for ruff, a note for TypeScript', () => {
  const ruff = ruffChecks(parseIgnores(RUFF), counts({}));
  assert.deepEqual(
    ruff.map((f) => [f.rule, f.severity]),
    [['dead', BLOCKING]],
    'a live ignore that excuses nothing is rot, and --tighten deletes it',
  );

  const ts = tsChecks(TS, counts({}));
  assert.deepEqual(
    ts.map((f) => [f.rule, f.severity]),
    [['burnt-down', NOTE]],
    'a ceiling is worth keeping at 0 — that is the lock, not the rot',
  );
});

check('every other rung answers the same way on both sides', () => {
  const rules = (findings) => findings.map((f) => `${f.rule}:${f.severity}`);
  // grew
  assert.deepEqual(rules(ruffChecks(parseIgnores(RUFF), counts({ F401: 9 }))), ['grew:blocking']);
  assert.deepEqual(rules(tsChecks(TS, counts({ 'eslint:x/y': 9 }))), ['grew:blocking']);
  // slack
  assert.deepEqual(rules(ruffChecks(parseIgnores(RUFF), counts({ F401: 3 }))), ['slack:note']);
  assert.deepEqual(rules(tsChecks(TS, counts({ 'eslint:x/y': 3 }))), ['slack:note']);
  // met — silence on both
  assert.deepEqual(ruffChecks(parseIgnores(RUFF), counts({ F401: 5 })), []);
  assert.deepEqual(tsChecks(TS, counts({ 'eslint:x/y': 5 })), []);
});

check('both ratchets are wired to npm scripts, and both are run by CI', () => {
  // The protocol is only worth having if both users of it are connected. A third
  // language arriving is a new debt file and a new `measure` — if it ever arrives
  // as a third copy of the ladder, this list is where that gets noticed.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  const autofix = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/autofix.yml'), 'utf8');
  for (const [script, file] of [
    ['lint:ruff-ratchet', 'ruff-ratchet.mjs'],
    ['lint:ts-ratchet', 'ts-ratchet.mjs'],
  ]) {
    assert.ok(pkg.scripts[script]?.includes(file), `${script} must run ${file}`);
    assert.ok(ci.includes(`npm run ${script}`), `ci.yml must run ${script}`);
    assert.ok(autofix.includes(`${file} --tighten`), `autofix.yml must tighten ${file}, or the ceilings never fall`);
  }
});

check('every ratchet script reads the protocol from one file', () => {
  // The mechanical half of "defined once": if a ratchet stops importing the
  // shared ladder, it has started keeping its own.
  for (const f of ['ruff-ratchet.mjs', 'ts-ratchet.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lint', f), 'utf8');
    assert.match(src, /from '\.\/ratchet\.mjs'/, `${f} must take the ladder from ratchet.mjs, not re-type it`);
  }
});

console.log(`\n${passed} checks passed.`);
