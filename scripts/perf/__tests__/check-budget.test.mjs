#!/usr/bin/env node
// Fixtures for the static import-graph budget. No deps — run with:
//   node scripts/perf/__tests__/check-budget.test.mjs
//   npm run test:perf
//
// This tool shipped complete and unreachable: no perf-budget.json, no npm
// script, no fixtures, and a missing-file error that named neither. So the last
// case here is the one that matters — it runs the COMMITTED budget against the
// real tree, which is what turns a measurement into a ceiling. Everything above
// it proves the pieces refuse correctly, because a budget that cannot fail is a
// number with an exit code.
//
// It reads the tree and does not build it: ~200 route graphs in under a second,
// which is why it can live inside a fixture suite CI already runs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUDGET_FILE,
  REPO_ROOT,
  evaluate,
  expandGlob,
  globToRegExp,
  loadBudget,
  parseImports,
  parseTypeOnlyImports,
  record,
  resolveSpecifier,
  tighten,
} from '../check-budget.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// --- reading imports ----------------------------------------------------------

check('every import shape that costs bytes is counted', () => {
  const deps = parseImports(
    [
      "import a from './a.ts';",
      "import { b } from './b.ts';",
      "import './side-effect.ts';",
      "export { c } from './c.ts';",
      "const d = await import('./d.ts');",
    ].join('\n'),
  );
  for (const spec of ['./a.ts', './b.ts', './side-effect.ts', './c.ts', './d.ts']) {
    assert.ok(deps.includes(spec), `${spec} was not counted`);
  }
});

check('a type-only import is erased before bundling, so it is not a cost', () => {
  const src = "import type { T } from './t.ts';\nimport { v } from './v.ts';";
  assert.deepEqual(parseTypeOnlyImports(src), ['./t.ts']);
  assert.ok(parseImports(src).includes('./v.ts'));
});

// --- the glob -----------------------------------------------------------------

check('`**/` matches zero directories, which is what makes one pattern cover both shapes', () => {
  const re = globToRegExp('app/api/**/route.ts');
  assert.ok(re.test('app/api/route.ts'), 'a flat route');
  assert.ok(re.test('app/api/jobs/[id]/route.ts'), 'a nested route with a dynamic segment');
  assert.ok(!re.test('app/api/jobs/helper.ts'));
});

check('the route glob resolves against this repository, not a fixture', () => {
  const routes = expandGlob('app/api/**/route.ts');
  assert.ok(routes.length > 100, `expected the real route tree, found ${routes.length}`);
  assert.ok(routes.every((r) => r.endsWith('/route.ts')));
});

check('a specifier that resolves nowhere is not silently treated as free', () => {
  assert.equal(resolveSpecifier('./nope-not-a-file', path.join(REPO_ROOT, 'app/page.tsx')), null);
  assert.equal(resolveSpecifier('next/server', path.join(REPO_ROOT, 'app/page.tsx')), null, 'node_modules is not first-party');
});

// --- the budget file must be believable ---------------------------------------

check('a budget that cannot be believed throws rather than widening the ceiling', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-perf-budget-'));
  const write = (o) => fs.writeFileSync(path.join(dir, BUDGET_FILE), JSON.stringify(o));
  const bad = (o, re) => {
    write(o);
    assert.throws(() => loadBudget(dir), re);
  };
  bad({ version: 2 }, /unsupported version/);
  bad({ version: 1 }, /slackPercent must be a number/);
  bad({ version: 1, slackPercent: 15 }, /'entries' must be an object/);
  bad(
    { version: 1, slackPercent: 15, entries: { 'a.ts': { maxKb: 1, why: 'x' } }, groups: {}, barrels: {} },
    /has no numeric maxModules/,
  );
  bad(
    { version: 1, slackPercent: 15, entries: { 'a.ts': { maxModules: 1, maxKb: 1 } }, groups: {}, barrels: {} },
    /has no 'why'/,
  );
  bad(
    { version: 1, slackPercent: 15, entries: {}, groups: {}, barrels: { 'b.ts': { maxValueImporters: 1 } } },
    /barrel 'b.ts' has no 'why'/,
  );
});

// THE ERROR THAT SENT THIS FILE BACK TO THE SHELF. A missing budget used to
// surface as a raw ENOENT, which says the file is gone and not that `--record`
// is the thing that writes it.
check('a missing budget names its own fix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-perf-empty-'));
  assert.throws(() => loadBudget(dir), /--record/);
  assert.throws(() => loadBudget(dir), /does not exist/);
});

check('--record refuses to overwrite a budget somebody already signed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-perf-existing-'));
  fs.writeFileSync(path.join(dir, BUDGET_FILE), '{}');
  assert.equal(record(dir), 1, 'raising a ceiling is an edit somebody makes, never a re-record');
});

// --- the ratchet --------------------------------------------------------------

check('--tighten lowers a ceiling to the measurement plus slack, and never raises one', () => {
  const budget = {
    version: 1,
    slackPercent: 10,
    entries: { 'a.ts': { maxModules: 100, maxKb: 100, why: 'x' } },
    groups: {},
    barrels: {},
  };
  const lowered = tighten(budget, [{ kind: 'entry', target: 'a.ts', modules: 10, kb: 10 }]);
  assert.equal(lowered.budget.entries['a.ts'].maxModules, 11);
  assert.equal(lowered.budget.entries['a.ts'].why, 'x', 'tightening a number never deletes its reason');

  const over = tighten(budget, [{ kind: 'entry', target: 'a.ts', modules: 400, kb: 400 }]);
  assert.equal(over.budget.entries['a.ts'].maxModules, 100, 'an over-budget tree is a finding, never a new ceiling');
  assert.equal(over.changed, 0);
  assert.equal(budget.entries['a.ts'].maxModules, 100, 'the input budget is not mutated');
});

// --- against the real tree ----------------------------------------------------
//
// The committed budget IS the fixture. A ceiling recorded from a tree that has
// since grown past it fails here, on every push, in under a second — which is
// the whole difference between this file and the state it was found in.

check(`the committed ${BUDGET_FILE} parses and every target it names still exists`, () => {
  const budget = loadBudget();
  for (const rel of Object.keys(budget.entries)) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `${BUDGET_FILE} budgets ${rel}, which has moved`);
  }
  for (const rel of Object.keys(budget.barrels)) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `${BUDGET_FILE} budgets barrel ${rel}, which has moved`);
  }
  for (const pattern of Object.keys(budget.groups)) {
    assert.ok(expandGlob(pattern).length > 0, `${BUDGET_FILE} budgets group ${pattern}, which now matches nothing`);
  }
});

check('this tree is inside its import-graph budget', () => {
  const { findings, measurements } = evaluate(loadBudget());
  assert.ok(measurements.length > 100, 'the graph walk measured the real tree');
  assert.deepEqual(
    findings.map((f) => `${f.target}: ${f.message}`),
    [],
    'over budget — fix the graph (import the slice, not the barrel), or raise the ceiling with a why',
  );
});

console.log(`\ncheck-budget fixtures: ${passed} checks passed.`);
