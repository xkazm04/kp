#!/usr/bin/env node
// Fixtures for the ruff ignore ratchet. No deps — run with:
//   node scripts/lint/__tests__/ruff-ratchet.test.mjs
//
// The failure mode every case here exists to prevent is the one the ratchet was
// written for in the first place: a check that reads well, passes, and is no
// longer connected to anything. Two shapes of that are specifically pinned —
// a parse that quietly finds no entries (everything would pass), and a ruff
// invocation that quietly returns nothing (everything would look dead, and
// `--tighten` would delete the whole list).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MARKER_RE,
  REPO_ROOT,
  RUFF_CONFIG_PATH,
  countByCode,
  parseArgs,
  parseIgnores,
  pruneEntries,
  ruffCounts,
  runChecks,
  tightenCeilings,
} from '../ruff-ratchet.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const blocking = (findings) => findings.filter((f) => f.severity === 'blocking');
const counts = (obj) => new Map(Object.entries(obj));

const CONFIG = [
  '[lint]',
  'select = ["E4", "E7", "E9", "F"]',
  'ignore = [',
  '    # 5x unused imports (auto-fixable).',
  '    # ratchet: F401 <= 5',
  '    "F401",',
  '    # 2x f-strings without placeholders.',
  '    # ratchet: F541 <= 2',
  '    "F541",',
  ']',
  '',
].join('\n');

// --- reading the ignore list --------------------------------------------------

check('every entry is read with the ceiling declared above it', () => {
  const entries = parseIgnores(CONFIG);
  assert.deepEqual(
    entries.map((e) => ({ code: e.code, ceiling: e.ceiling })),
    [
      { code: 'F401', ceiling: 5 },
      { code: 'F541', ceiling: 2 },
    ],
  );
});

check('a marker belongs to the entry it names, not merely to the block above it', () => {
  // A stale marker left behind by a deleted entry must not silently license the
  // next one down.
  const text = CONFIG.replace('# ratchet: F541 <= 2', '# ratchet: F999 <= 2');
  const entries = parseIgnores(text);
  assert.equal(entries[1].code, 'F541');
  assert.equal(entries[1].ceiling, null);
});

check('a missing ignore list is not an empty one', () => {
  // An empty list is the goal state and must pass. A list this parser could not
  // FIND means ruff.toml changed shape, and reading that as "nothing to check"
  // is how the gate goes quiet.
  assert.equal(parseIgnores('[lint]\nselect = ["F"]\n'), null);
  assert.deepEqual(parseIgnores('[lint]\nignore = [\n]\n'), []);
});

check('the marker is only a marker in the shape the check writes', () => {
  assert.ok(MARKER_RE.test('    # ratchet: F401 <= 5'));
  assert.equal(MARKER_RE.test('    # ratchet: F401 is fine'), false);
});

// --- the four rules -----------------------------------------------------------

check('an ignore with no declared ceiling is blocking', () => {
  const entries = parseIgnores(CONFIG.replace('    # ratchet: F401 <= 5\n', ''));
  const f = runChecks(entries, counts({ F401: 5, F541: 2 }));
  assert.ok(has(f, 'undeclared'));
  assert.equal(blocking(f).length, 1);
});

check('an ignore that suppresses nothing is blocking — this is the F821 case', () => {
  const f = runChecks(parseIgnores(CONFIG), counts({ F401: 5 }));
  assert.ok(has(f, 'dead'));
  assert.match(f.find((x) => x.rule === 'dead').message, /F541/);
  assert.equal(blocking(f).length, 1);
});

check('debt growing under an existing entry is blocking', () => {
  const f = runChecks(parseIgnores(CONFIG), counts({ F401: 9, F541: 2 }));
  assert.ok(has(f, 'grew'));
  assert.match(f.find((x) => x.rule === 'grew').message, /9 time\(s\)/);
  assert.equal(blocking(f).length, 1);
});

check('ground gained is a note, not a red build', () => {
  const f = runChecks(parseIgnores(CONFIG), counts({ F401: 3, F541: 2 }));
  assert.ok(has(f, 'slack'));
  assert.equal(blocking(f).length, 0);
});

check('a list that exactly matches its ceilings says nothing at all', () => {
  assert.deepEqual(runChecks(parseIgnores(CONFIG), counts({ F401: 5, F541: 2 })), []);
});

check('an empty ignore list is clean — the ratchet is allowed to finish', () => {
  assert.deepEqual(runChecks([], counts({})), []);
});

// --- counting -----------------------------------------------------------------

check('diagnostics are counted per rule, and a codeless one is skipped', () => {
  const c = countByCode([{ code: 'F401' }, { code: 'F401' }, { code: 'E741' }, { code: null }, {}]);
  assert.equal(c.get('F401'), 2);
  assert.equal(c.get('E741'), 1);
  assert.equal(c.size, 2);
});

check('ruff answering with something that is not JSON is an error, never "no violations"', () => {
  // The dangerous direction: if this were read as zero, every entry would look
  // dead and `--tighten` would delete the ignore list.
  assert.throws(
    () => ruffCounts({ spawn: () => ({ stdout: 'error: unknown option --config\n', stderr: '' }) }),
    /must not be read as/,
  );
  assert.throws(() => ruffCounts({ spawn: () => ({ stdout: '{"code":"F401"}' }) }), /not an array/);
});

check('ruff not being installed says so instead of passing', () => {
  assert.throws(() => ruffCounts({ spawn: () => ({ error: Object.assign(new Error('spawn ruff ENOENT'), { code: 'ENOENT' }) }) }), /ENOENT/);
});

check('a real ruff answer becomes counts', () => {
  const stdout = JSON.stringify([{ code: 'F401' }, { code: 'F401' }, { code: 'F541' }]);
  const c = ruffCounts({ spawn: () => ({ stdout }) });
  assert.equal(c.get('F401'), 2);
});

// --- --tighten ----------------------------------------------------------------

check('a ceiling is lowered to what the tree actually carries, and never raised', () => {
  const entries = parseIgnores(CONFIG);
  const next = tightenCeilings(CONFIG, entries, counts({ F401: 3, F541: 9 }));
  assert.match(next, /# ratchet: F401 <= 3/);
  assert.match(next, /# ratchet: F541 <= 2/, 'a ceiling is a ratchet, so --tighten must not widen it');
});

check('a dead entry is deleted with the comment block that explains it', () => {
  const next = pruneEntries(CONFIG, ['F401']);
  assert.deepEqual(
    parseIgnores(next).map((e) => e.code),
    ['F541'],
  );
  assert.equal(next.includes('5x unused imports'), false, 'an explanation outliving its entry is the same rot');
  assert.ok(next.includes('# ratchet: F541 <= 2'), 'the surviving entry keeps its own block');
});

check('pruning nothing rewrites nothing — line endings included', () => {
  assert.equal(pruneEntries(CONFIG, []), CONFIG);
  assert.equal(pruneEntries(CONFIG, ['E402']), CONFIG);
  const crlf = CONFIG.replace(/\n/g, '\r\n');
  assert.ok(pruneEntries(crlf, ['F401']).includes('\r\n'), 'a CRLF checkout stays CRLF');
});

check('a config with no list to splice is left alone rather than mangled', () => {
  // Together with the self-check inside pruneEntries, this is why --tighten may
  // run unattended in autofix.yml: a rewrite it cannot re-read is a no-op, not
  // a commit.
  const notAList = '[lint]\nselect = ["F"]\n';
  assert.equal(pruneEntries(notAList, ['F401']), notAList);
});

check('--tighten and --json are only on when asked for', () => {
  assert.deepEqual(parseArgs([]), { tighten: false, json: false });
  assert.deepEqual(parseArgs(['--tighten']), { tighten: true, json: false });
});

// --- and finally: the real tree, right now ------------------------------------
//
// The cases above prove the rules fire. This one proves they are pointed at
// something — the committed ruff.toml, in the shape the check has to read.

check('the committed ruff.toml is readable by the check, and every ignore declares a ceiling', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, RUFF_CONFIG_PATH), 'utf8');
  const entries = parseIgnores(text);
  assert.notEqual(entries, null, `${RUFF_CONFIG_PATH} has no \`ignore = [\` list the ratchet can read`);
  for (const e of entries) {
    assert.notEqual(e.ceiling, null, `${e.code} (line ${e.line}) declares no \`# ratchet: ${e.code} <= N\` ceiling`);
  }
});

check('the ratchet is wired to an npm script CI can call', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['lint:ruff-ratchet'], /scripts\/lint\/ruff-ratchet\.mjs/);
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.includes('npm run lint:ruff-ratchet'), 'ci.yml must run the ratchet, or it is a script nobody calls');
});

console.log(`\n${passed} checks passed.`);
