#!/usr/bin/env node
// Fixtures for the bill of materials. No deps — run with:
//   node scripts/release/__tests__/sbom.test.mjs
//
// The last block runs the real generator against the committed package-lock.json,
// so this file is what fails if a lockfile format change ever turns the SBOM into
// an empty list. An SBOM that silently lists nothing is the failure mode: it looks
// like an answer and is not one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_NPM_COMPONENTS,
  buildSbom,
  checkSbom,
  componentsFromLockfile,
  componentsFromPipList,
  hashesFromIntegrity,
  parseArgs,
  purlNpm,
  purlPypi,
  resolveTimestamp,
  serialFor,
} from '../sbom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const LOCK = {
  name: 'kp',
  version: '9.9.9',
  lockfileVersion: 3,
  packages: {
    '': { name: 'kp', version: '9.9.9' },
    'node_modules/left-pad': {
      version: '1.3.0',
      resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
      integrity: 'sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==',
      license: 'WTFPL',
    },
    'node_modules/@scope/pkg': { version: '2.0.0', license: 'MIT OR Apache-2.0' },
    'node_modules/dev-only': { version: '4.0.0', dev: true },
    'node_modules/a/node_modules/left-pad': { version: '1.3.0' },
    'node_modules/linked': { link: true, resolved: 'packages/linked' },
    'node_modules/no-version': { resolved: 'https://example.test/x.tgz' },
  },
};

// --- purls -------------------------------------------------------------------
check('a scoped npm name percent-encodes its @, per the purl spec', () => {
  assert.equal(purlNpm('@scope/pkg', '2.0.0'), 'pkg:npm/%40scope/pkg@2.0.0');
  assert.equal(purlNpm('left-pad', '1.3.0'), 'pkg:npm/left-pad@1.3.0');
  assert.equal(purlPypi('PyPDF', '5.4.0'), 'pkg:pypi/pypdf@5.4.0');
});

// --- the lockfile reader -----------------------------------------------------
check('production packages are listed, dev packages are not', () => {
  const names = componentsFromLockfile(LOCK).map((c) => c.name);
  assert.ok(names.includes('left-pad'));
  assert.ok(names.includes('@scope/pkg'));
  assert.ok(!names.includes('dev-only'), 'a dev dependency is not in the image');
});

check('--include-dev widens it deliberately', () => {
  const names = componentsFromLockfile(LOCK, { includeDev: true }).map((c) => c.name);
  assert.ok(names.includes('dev-only'));
});

check('the same package at the same version is listed once, however nested', () => {
  const leftPads = componentsFromLockfile(LOCK).filter((c) => c.name === 'left-pad');
  assert.equal(leftPads.length, 1);
});

check('symlinked and version-less entries are skipped, not guessed at', () => {
  const names = componentsFromLockfile(LOCK).map((c) => c.name);
  assert.ok(!names.includes('linked'));
  assert.ok(!names.includes('no-version'));
});

check('the root project is the SUBJECT of the document, never a dependency of itself', () => {
  assert.ok(!componentsFromLockfile(LOCK).some((c) => c.name === 'kp'));
});

check('components are sorted, so two runs of the same tree diff cleanly', () => {
  const purls = componentsFromLockfile(LOCK).map((c) => c.purl);
  assert.deepEqual(purls, [...purls].sort((a, b) => a.localeCompare(b)));
});

check('npm integrity becomes a CycloneDX hash in hex', () => {
  const [hash] = componentsFromLockfile(LOCK).find((c) => c.name === 'left-pad').hashes;
  assert.equal(hash.alg, 'SHA-512');
  assert.match(hash.content, /^[0-9a-f]{128}$/);
  assert.equal(hashesFromIntegrity(undefined), undefined);
  assert.equal(hashesFromIntegrity('unknown-abc'), undefined);
});

check('an SPDX expression is recorded as a name, a bare id as an id', () => {
  const byName = Object.fromEntries(componentsFromLockfile(LOCK).map((c) => [c.name, c]));
  assert.deepEqual(byName['left-pad'].licenses, [{ license: { id: 'WTFPL' } }]);
  assert.deepEqual(byName['@scope/pkg'].licenses, [{ license: { name: 'MIT OR Apache-2.0' } }]);
});

// --- the python half ---------------------------------------------------------
check('pip list rows become pypi components', () => {
  const py = componentsFromPipList([
    { name: 'pypdf', version: '5.4.0' },
    { name: 'pydantic', version: '2.12.5' },
    { name: 'broken' },
  ]);
  assert.equal(py.length, 2);
  assert.equal(py[0].purl, 'pkg:pypi/pydantic@2.12.5');
});

// --- the document ------------------------------------------------------------
check('the document is CycloneDX 1.5 with the release as its subject', () => {
  const doc = buildSbom({
    version: '0.1.0',
    commit: 'abc123',
    image: 'ghcr.io/xkazm04/kp:0.1.0',
    npm: componentsFromLockfile(LOCK),
    python: componentsFromPipList([{ name: 'pypdf', version: '5.4.0' }]),
    timestamp: '2026-08-30T00:00:00.000Z',
  });
  assert.equal(doc.bomFormat, 'CycloneDX');
  assert.equal(doc.specVersion, '1.5');
  assert.equal(doc.metadata.component.version, '0.1.0');
  assert.match(doc.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  const props = Object.fromEntries(doc.metadata.properties.map((p) => [p.name, p.value]));
  assert.equal(props['kp:commit'], 'abc123');
  assert.equal(props['kp:image'], 'ghcr.io/xkazm04/kp:0.1.0');
  // The scope has to travel WITH the document: a reader must be able to tell
  // that dev dependencies are absent by design rather than by omission.
  assert.match(props['kp:npm:scope'], /dev dependencies excluded/);
});

check('the serial number is derived from the contents, not from a clock', () => {
  const a = serialFor(componentsFromLockfile(LOCK));
  const b = serialFor(componentsFromLockfile(LOCK));
  assert.equal(a, b);
  assert.notEqual(a, serialFor(componentsFromPipList([{ name: 'x', version: '1' }])));
});

// --- reproducibility ----------------------------------------------------------
//
// Everything else about this document is already content-derived: the component
// lists are sorted and the serial number is a hash of them. The wall clock was
// the one input that made two builds of one tag differ byte for byte, which is
// exactly the claim an operator wants to check ("is the SBOM attached to v0.1.0
// the one this tree produces?") and could not.
check('SOURCE_DATE_EPOCH pins the timestamp, so two builds are byte-identical', () => {
  const before = process.env.SOURCE_DATE_EPOCH;
  process.env.SOURCE_DATE_EPOCH = '1756771200';
  try {
    const inputs = { version: '0.1.0', commit: 'abc123', npm: componentsFromLockfile(LOCK), python: [] };
    const a = JSON.stringify(buildSbom({ ...inputs }), null, 2);
    const b = JSON.stringify(buildSbom({ ...inputs }), null, 2);
    assert.equal(a, b, 'two runs over the same inputs must produce the same bytes');
    assert.equal(JSON.parse(a).metadata.timestamp, '2025-09-02T00:00:00.000Z');
  } finally {
    if (before === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = before;
  }
});

check('a timestamp is read as epoch seconds or as an ISO instant, and nothing else', () => {
  assert.equal(resolveTimestamp('1756771200'), '2025-09-02T00:00:00.000Z');
  assert.equal(resolveTimestamp('2025-09-02T00:00:00Z'), '2025-09-02T00:00:00.000Z');
  // A value that cannot be read is null — the caller refuses rather than
  // silently stamping the wall clock onto a document asked to be reproducible.
  assert.equal(resolveTimestamp('yesterday'), null);
  assert.equal(resolveTimestamp(''), null);
  assert.equal(resolveTimestamp(undefined), null);
});

check('with no pin the document still carries a real timestamp', () => {
  const before = process.env.SOURCE_DATE_EPOCH;
  delete process.env.SOURCE_DATE_EPOCH;
  try {
    const doc = buildSbom({ version: '0.1.0', npm: componentsFromLockfile(LOCK), python: [] });
    assert.match(doc.metadata.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    if (before !== undefined) process.env.SOURCE_DATE_EPOCH = before;
  }
});

check('an empty or half-read document is refused, not published', () => {
  const empty = buildSbom({ version: '0.1.0', npm: [], python: [] });
  const problems = checkSbom(empty);
  assert.ok(problems.some((p) => /npm components/.test(p)));
  assert.ok(problems.some((p) => /python components/.test(p)));
  assert.ok(checkSbom({ bomFormat: 'nonsense' }).some((p) => /CycloneDX/.test(p)));
});

check('--npm-only stops the python floor from firing, and nothing else', () => {
  const doc = buildSbom({
    version: '0.1.0',
    npm: Array.from({ length: MIN_NPM_COMPONENTS }, (_, i) => ({ purl: `pkg:npm/p${i}@1.0.0` })),
    python: [],
  });
  assert.deepEqual(checkSbom(doc, { requirePython: false }), []);
  assert.ok(checkSbom(doc).length > 0);
});

check('cli args parse', () => {
  const args = parseArgs(['--out', 'dist/x.json', '--version', '1.2.3', '--npm-only']);
  assert.equal(args.out, 'dist/x.json');
  assert.equal(args.version, '1.2.3');
  assert.equal(args.npmOnly, true);
  assert.equal(args.includeDev, false);
  assert.equal(args.timestamp, null);
  assert.equal(parseArgs(['--timestamp', '2025-09-02T00:00:00Z']).timestamp, '2025-09-02T00:00:00Z');
});

// --- against the real tree ---------------------------------------------------
check('the committed lockfile yields a real, hash-bearing component list', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  const npm = componentsFromLockfile(lock);
  assert.ok(
    npm.length >= MIN_NPM_COMPONENTS,
    `expected at least ${MIN_NPM_COMPONENTS} production components, got ${npm.length}`,
  );
  assert.ok(npm.some((c) => c.name === 'next'), 'next is a production dependency of this app');
  assert.ok(npm.every((c) => c.purl && c.version), 'every component carries a purl and a version');
  assert.ok(npm.some((c) => c.hashes?.length), 'the lockfile integrity hashes made it into the document');
});

console.log(`\nsbom fixtures: ${passed} checks passed.`);
