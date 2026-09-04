#!/usr/bin/env node
// Fixtures for the devbench baseline. No deps, no dev server — run with:
//   node scripts/perf/__tests__/devbench.test.mjs
//   npm run test:perf
//
// devbench.mjs measured honestly and remembered nothing: its rows went to a
// gitignored .next/devbench.jsonl that every `--cold` run wipes and that exists
// on exactly one machine. A dev-server regression was therefore invisible between
// sessions — the tool could tell you today's number and never that it had doubled.
//
// The pure half below is what turns a measurement into a ratchet, so it is what
// these fixtures pin: which runs are comparable to each other, when a slowdown is
// jitter and when it is a regression, and that `--record` moves the number
// explicitly rather than as a side effect. The last check runs the COMMITTED
// baseline file, because a ratchet whose committed state is malformed is a gate
// that silently never fires.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BASELINE_FILE,
  COMPARED_METRICS,
  DEFAULT_TOLERANCE,
  compareToBaseline,
  loadBaseline,
  variantKey,
  withRecorded,
} from '../devbench.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const row = (over = {}) => ({
  label: 'run', cold: false, burst: false, code: 200,
  bootMs: 700, firstMs: 4200, burstMs: 4200, warmMs: 140,
  assetCount: 24, assetKB: 6554, assetMs: 0, totalMs: 4900, ...over,
});

// --- what is comparable to what ------------------------------------------------

check('the variant is the key, not the label — two labels for the same run compare', () => {
  assert.equal(variantKey(row({ label: 'before-refactor' })), 'warm');
  assert.equal(variantKey(row({ label: 'after-refactor' })), 'warm');
  // A cold run and a warm run measure different things; comparing them would report
  // a 3x "regression" every time somebody passed --cold.
  assert.equal(variantKey(row({ cold: true })), 'cold');
  assert.equal(variantKey(row({ burst: true })), 'warm+burst');
  assert.equal(variantKey(row({ cold: true, burst: true })), 'cold+burst');
});

check('a variant with no entry is reported, not silently passed as ok', () => {
  const v = compareToBaseline(row({ burst: true }), { warm: { bootMs: 700 } });
  assert.equal(v.verdict, 'unbaselined');
  assert.equal(v.key, 'warm+burst');
});

// --- the gate itself ------------------------------------------------------------

const BASE = { warm: { bootMs: 700, firstMs: 4200, warmMs: 140, totalMs: 4900, platform: 'win32' } };

check('a run inside the tolerance passes', () => {
  const v = compareToBaseline(row({ firstMs: 4200 * 1.3, totalMs: 4900 * 1.2 }), BASE);
  assert.equal(v.verdict, 'ok', JSON.stringify(v.regressions));
  assert.equal(v.regressions.length, 0);
});

check('a run past the tolerance regresses, and names the metric and the ratio', () => {
  const v = compareToBaseline(row({ firstMs: 9000, totalMs: 9700 }), BASE);
  assert.equal(v.verdict, 'regressed');
  assert.deepEqual(v.regressions.map((r) => r.metric).sort(), ['firstMs', 'totalMs']);
  const first = v.regressions.find((r) => r.metric === 'firstMs');
  assert.equal(first.baseline, 4200);
  assert.equal(first.measured, 9000);
  assert.ok(first.ratio > 2, 'the ratio must carry the size of the regression, not just its existence');
});

check('every duration metric can trip the gate — a regression cannot hide in one of them', () => {
  for (const metric of COMPARED_METRICS) {
    const v = compareToBaseline(row({ [metric]: BASE.warm[metric] * 3 }), BASE);
    assert.equal(v.verdict, 'regressed', `${metric} moved 3x and the gate said ok`);
    assert.deepEqual(v.regressions.map((r) => r.metric), [metric]);
  }
});

check('a large improvement is reported too — a baseline nobody tightens is a rubber stamp', () => {
  const v = compareToBaseline(row({ firstMs: 1000, totalMs: 1700 }), BASE);
  assert.equal(v.verdict, 'ok');
  assert.ok(v.improvements.some((i) => i.metric === 'firstMs'), 'a 4x speedup went unmentioned');
});

check('a baseline from another platform still compares, but says so', () => {
  const v = compareToBaseline(row(), { warm: { ...BASE.warm, platform: 'definitely-not-this-one' } });
  assert.equal(v.platformChanged, true);
  assert.equal(v.verdict, 'ok');
});

check('a missing or zero baseline metric is skipped, never divided by', () => {
  const v = compareToBaseline(row({ bootMs: 99999 }), { warm: { bootMs: 0, firstMs: 4200 } });
  assert.equal(v.verdict, 'ok');
  assert.equal(v.regressions.length, 0);
});

// --- --record -------------------------------------------------------------------

check('--record replaces only its own variant and keeps the rest', () => {
  const before = { entries: { warm: { bootMs: 1, firstMs: 1 }, cold: { bootMs: 42 } }, tolerance: 0.35 };
  const after = withRecorded(before, row({ cold: true, firstMs: 10900 }), new Date('2026-09-04T10:00:00Z'));
  assert.deepEqual(after.entries.warm, { bootMs: 1, firstMs: 1 }, '--record clobbered a variant it did not measure');
  assert.equal(after.entries.cold.firstMs, 10900);
  assert.equal(after.entries.cold.recordedAt, '2026-09-04T10:00:00.000Z');
  assert.equal(after.entries.cold.platform, process.platform, 'a recorded entry must say where it was measured');
  assert.equal(after.tolerance, 0.35);
  assert.ok(after._doc, 'the recorded file must keep explaining itself');
  // Pure: the input is not mutated, so a caller can diff before against after.
  assert.equal(before.entries.cold.bootMs, 42);
});

check('a recorded entry is immediately ok against itself', () => {
  const measured = row({ firstMs: 6000, totalMs: 7000 });
  const recorded = withRecorded({ entries: {} }, measured);
  assert.equal(compareToBaseline(measured, recorded.entries).verdict, 'ok');
});

// --- the committed file ---------------------------------------------------------

check('the COMMITTED baseline is readable, and its numbers are usable', () => {
  assert.ok(fs.existsSync(BASELINE_FILE), 'scripts/perf/devbench-baseline.json is missing — the gate can never fire');
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
  const { entries, missing } = loadBaseline();
  assert.equal(missing, false);
  assert.ok(Object.keys(entries).length >= 2, 'the committed baseline covers fewer variants than warm plus cold');
  assert.ok(parsed._provenance, 'a baseline must say where its numbers came from, or nobody can judge them');
  assert.equal(parsed.tolerance, DEFAULT_TOLERANCE, 'the file states a tolerance the tool does not apply');
  for (const [key, entry] of Object.entries(entries)) {
    assert.match(key, /^(warm|cold)(\+burst)?$/, `unreachable variant key ${key}`);
    for (const metric of COMPARED_METRICS) {
      assert.equal(typeof entry[metric], 'number', `${key}.${metric} is not a number`);
      assert.ok(entry[metric] > 0, `${key}.${metric} is ${entry[metric]} — a non-positive baseline never fires`);
    }
  }
  // The relationship the numbers must satisfy whatever machine recorded them: a
  // cold start compiles from nothing and cannot be faster than a warm one, and a
  // second request to an already-compiled page cannot be slower than the first.
  assert.ok(entries.cold.firstMs > entries.warm.firstMs, 'the cold baseline is not slower than the warm one');
  assert.ok(entries.warm.warmMs < entries.warm.firstMs, 'the warm re-request is not faster than the first compile');
});

console.log(`\ndevbench: ${passed} checks passed.`);
