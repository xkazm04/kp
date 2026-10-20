#!/usr/bin/env node
// Behavioral fixtures for the test-only ESM resolver. Each probe starts a fresh
// Node process so it exercises registration through --import, not an exported
// helper that production would never call.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const prefix = [
  '--import', './scripts/test-alias-loader.mjs',
  '--experimental-transform-types',
  '--disable-warning=ExperimentalWarning',
  '--input-type=module', '-e',
];

function probe(code) {
  return spawnSync(process.execPath, [...prefix, code], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

const loaded = probe(`
  import { jdJobId } from '@/app/_lib/jd-limits';
  import { validateJdFields } from './app/_lib/jd-limits';
  import messages from './messages/en.json';
  console.log(JSON.stringify({ id: jdJobId('fixture'), valid: validateJdFields('A', 'B').ok, catalog: typeof messages.errors }));
`);
assert.equal(loaded.status, 0, loaded.stderr);
assert.deepEqual(JSON.parse(loaded.stdout.trim()), { id: 'jd-fixture', valid: true, catalog: 'object' });
console.log('  ok  root alias, extensionless relative import and JSON attribute');

const absent = probe("import './app/_lib/does-not-exist';");
assert.notEqual(absent.status, 0, 'an unresolved path must still fail');
assert.match(absent.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
console.log('  ok  missing paths still fail closed');
