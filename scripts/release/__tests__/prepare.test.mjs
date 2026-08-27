#!/usr/bin/env node
// Fixtures for the release preparer. No deps — run with:
//   node scripts/release/__tests__/prepare.test.mjs
//
// The last block runs the real coherence check against the committed tree, so
// this file is also the thing that fails when package.json, Chart.yaml and
// CHANGELOG.md drift apart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changelogHasVersion,
  checkCoherence,
  classify,
  parseArgs,
  readChartVersions,
  readVersionFromPackage,
  renderSection,
  setChartAppVersion,
} from '../prepare.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// --- classification ---------------------------------------------------------
check('conventional types map to changelog sections', () => {
  assert.equal(classify('feat(bench): add a scenario').section, 'Added');
  assert.equal(classify('fix(auth): stop the leak').section, 'Fixed');
  assert.equal(classify('security(deps): next 16.3.3').section, 'Security');
  assert.equal(classify('perf(puml): quadratic blowup').section, 'Performance');
  assert.equal(classify('docs(readme): rewrite').section, 'Documentation');
  assert.equal(classify('chore(scan): batch 13').section, 'Internal');
});

check('the scope is kept and the type is dropped', () => {
  const c = classify('fix(auth): stop the leak');
  assert.equal(c.scope, 'auth');
  assert.equal(c.text, 'stop the leak');
});

check('a scopeless commit classifies fine', () => {
  const c = classify('feat: a thing');
  assert.equal(c.section, 'Added');
  assert.equal(c.scope, null);
});

check('a `!` marks a breaking change and outranks its type', () => {
  const c = classify('feat(api)!: drop the v1 route');
  assert.equal(c.breaking, true);
  assert.equal(c.section, 'Breaking changes');
});

check('an unconventional subject lands in Other — never dropped', () => {
  const c = classify('Merge branch of doom');
  assert.equal(c.section, 'Other');
  assert.equal(c.text, 'Merge branch of doom');
});

// --- rendering --------------------------------------------------------------
check('a section renders in reader order: security before features', () => {
  const md = renderSection('0.2.0', '2026-09-01', [
    'feat(a): one',
    'security(b): two',
    'fix(c): three',
  ]);
  assert.match(md, /^## \[0\.2\.0\] - 2026-09-01/);
  assert.ok(md.indexOf('### Security') < md.indexOf('### Added'));
  assert.ok(md.indexOf('### Added') < md.indexOf('### Fixed'));
  assert.match(md, /- \*\*b:\*\* two/);
});

check('internal churn is excluded by default and included on request', () => {
  const subjects = ['chore(x): tidy'];
  assert.match(renderSection('0.2.0', '2026-09-01', subjects), /No user-visible change/);
  assert.match(
    renderSection('0.2.0', '2026-09-01', subjects, { includeInternal: true }),
    /### Internal/,
  );
});

check('breaking changes lead the section', () => {
  const md = renderSection('1.0.0', '2026-09-01', ['fix(a): one', 'feat(b)!: two']);
  assert.ok(md.indexOf('### Breaking changes') < md.indexOf('### Fixed'));
});

// --- version files ----------------------------------------------------------
check('chart versions are read without reformatting the file', () => {
  const chart = '# comment\nversion: 0.1.0\n# app comment\nappVersion: "0.1.0"\nhome: x\n';
  assert.deepEqual(readChartVersions(chart), { version: '0.1.0', appVersion: '0.1.0' });
  const bumped = setChartAppVersion(chart, '0.2.0');
  assert.match(bumped, /appVersion: "0\.2\.0"/);
  assert.match(bumped, /^version: 0\.1\.0$/m, 'chart version must not move with appVersion');
  assert.match(bumped, /# app comment/, 'comments must survive');
});

check('changelog version detection is exact, not a prefix match', () => {
  const cl = '# Changelog\n\n## [0.1.0] - 2026-08-26\n\n### Added\n- a\n';
  assert.equal(changelogHasVersion(cl, '0.1.0'), true);
  assert.equal(changelogHasVersion(cl, '0.1'), false);
  assert.equal(changelogHasVersion(cl, '0.2.0'), false);
});

// --- coherence --------------------------------------------------------------
const coherent = {
  pkgVersion: '0.1.0',
  chart: { version: '0.1.0', appVersion: '0.1.0' },
  changelog: '## [0.1.0] - 2026-08-26\n',
};

check('a coherent tree has no problems', () => {
  assert.deepEqual(checkCoherence(coherent), []);
});

check('appVersion drift is caught — it IS the operator-facing image tag', () => {
  const problems = checkCoherence({ ...coherent, chart: { version: '0.1.0', appVersion: '0.0.9' } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /version drift/);
});

check('a version with no release notes is caught', () => {
  const problems = checkCoherence({ ...coherent, changelog: '# Changelog\n' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no "## \[0\.1\.0\]" section/);
});

check('the chart version may move independently of appVersion', () => {
  assert.deepEqual(checkCoherence({ ...coherent, chart: { version: '0.3.1', appVersion: '0.1.0' } }), []);
});

check('cli args parse', () => {
  assert.deepEqual(parseArgs(['--check']), {
    check: true,
    version: null,
    dryRun: false,
    includeInternal: false,
    date: null,
  });
  assert.equal(parseArgs(['--version', '1.2.3']).version, '1.2.3');
});

// --- the real tree ----------------------------------------------------------
check('real tree: package.json, Chart.yaml and CHANGELOG.md agree', () => {
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const problems = checkCoherence({
    pkgVersion: readVersionFromPackage(read('package.json')),
    chart: readChartVersions(read('deploy/helm/kp/Chart.yaml')),
    changelog: read('CHANGELOG.md'),
  });
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

check('real tree: the CHANGELOG carries the marker the preparer inserts at', () => {
  const cl = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  assert.ok(cl.includes('<!-- next-release -->'), 'the <!-- next-release --> marker is gone');
});

console.log(`\n${passed} checks passed.`);
