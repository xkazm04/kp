import assert from 'node:assert/strict';
import test from 'node:test';

import { mappedFamilyOf } from '../build-market-pulse.mjs';

test('CZ-ISCO mapping distinguishes an explicit family from the fallback', () => {
  assert.equal(mappedFamilyOf('CzIsco/25121'), 'software_engineering');
  assert.equal(mappedFamilyOf('CzIsco/99999'), null);
  assert.equal(mappedFamilyOf(''), null);
});
