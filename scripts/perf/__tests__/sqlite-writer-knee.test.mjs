#!/usr/bin/env node
// Pin: sqlite-writer-knee openLikeTheApp uses the same pragma set as openStore().
// Run with:
//   node scripts/perf/__tests__/sqlite-writer-knee.test.mjs
//   npm run test:perf
//
// The probe claims to measure the app's real connection. openStore() also sets
// foreign_keys=ON; a ceiling re-measure against a connection that does not
// enforce FKs is not a measure of the app. Text-scan both sources (same shape
// as toolchain-pin): the pragma string set must be equal.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function sliceFn(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  const ret = src.indexOf('return d;', start);
  assert.ok(ret >= 0, `${marker} has no return d`);
  return src.slice(start, ret);
}

function pragmaSet(src) {
  return new Set(
    [...src.matchAll(/\.pragma\(\s*["']([^"']+)["']/g)].map((m) => m[1].replace(/\s+/g, ' ').trim().toLowerCase()),
  );
}

const storeSrc = fs.readFileSync(path.join(REPO_ROOT, 'app/_lib/db-path.ts'), 'utf8');
const probeSrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts/perf/sqlite-writer-knee.mjs'), 'utf8');
const store = pragmaSet(sliceFn(storeSrc, 'export function openStore'));
const probe = pragmaSet(sliceFn(probeSrc, 'function openLikeTheApp'));

assert.ok(store.size >= 4, `openStore should declare the four canonical pragmas, found ${[...store].join(', ') || 'none'}`);
assert.ok([...store].some((p) => p.includes('foreign_keys')), 'foreign_keys is part of the openStore set');
assert.deepEqual(
  [...probe].sort(),
  [...store].sort(),
  `probe pragmas drifted from openStore()\n  probe: ${[...probe].sort().join(' | ')}\n  store: ${[...store].sort().join(' | ')}`,
);

console.log(`sqlite-writer-knee pragmas: ${store.size} of ${store.size} match openStore (${[...store].sort().join(', ')}).`);
