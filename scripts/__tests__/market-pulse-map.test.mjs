import assert from 'node:assert/strict';
import test from 'node:test';

import { mappedFamilyOf, validateSnapshot } from '../build-market-pulse.mjs';

test('CZ-ISCO mapping distinguishes an explicit family from the fallback', () => {
  assert.equal(mappedFamilyOf('CzIsco/25121'), 'software_engineering');
  assert.equal(mappedFamilyOf('CzIsco/99999'), null);
  assert.equal(mappedFamilyOf(''), null);
});

test('snapshot gate rejects an excessive fallback-family share', () => {
  const snapshot = {
    reference_salaries: Array(8).fill({}),
    regions: Array(14).fill({ code: 'CZ010', medianSalary: 50000 }),
    demand: { top_occupations: Array(10).fill({}) },
    meta: { national_median: 50000, default_family_share: 0.05 },
  };
  assert.deepEqual(validateSnapshot(snapshot), []);
  assert.match(validateSnapshot({ ...snapshot, meta: { ...snapshot.meta, default_family_share: 0.11 } }).join('; '), /11\.0%/);
  assert.match(validateSnapshot({ ...snapshot, meta: { national_median: 50000 } }).join('; '), /default-family share/);
});
