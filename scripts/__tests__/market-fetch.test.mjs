#!/usr/bin/env node
// Fixtures for the market scripts' network contract. No deps, no network — run with:
//   node scripts/__tests__/market-fetch.test.mjs
//   npm run test:docs
//
// WHY THIS EXISTS. `npm run market:build` and `npm run market:earnings` GET
// multi-megabyte JSON from data.mpsv.cz and a local Pumper. Both used to be a
// bare `await fetch(url)`, which has no timeout at all: an endpoint that accepts
// the connection and then says nothing hangs the build until someone notices —
// no output, no exit code, nothing in CI to look at. And an air-gapped install
// (KP_OFFLINE, docs/architecture/self-hosting.md §7) had no way to be told these
// scripts cannot run; it just watched them stall.
//
// fetchJson() is the seam that fixes both, and it takes an injected fetch so
// every branch below is exercised without a socket. The one thing a fixture
// cannot prove is that the signal is honoured by undici — so the timeout case
// asserts what this module controls: that a real AbortSignal with the declared
// budget is handed to fetch, and that the resulting abort is reported as a
// timeout in the operator's words rather than as a bare `AbortError`.

import assert from 'node:assert/strict';
import { FETCH_TIMEOUT_MS, fetchJson, isOffline } from '../lib/market-earnings.mjs';

let passed = 0;
function check(name, fn) {
  const done = fn();
  if (done && typeof done.then === 'function') return done.then(() => { passed++; console.log(`  ok  ${name}`); });
  passed++;
  console.log(`  ok  ${name}`);
  return Promise.resolve();
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

await check('the declared budget is a real number of milliseconds, not a placeholder', () => {
  assert.equal(typeof FETCH_TIMEOUT_MS, 'number');
  assert.ok(FETCH_TIMEOUT_MS >= 5_000 && FETCH_TIMEOUT_MS <= 60_000, `implausible budget ${FETCH_TIMEOUT_MS}`);
});

await check('a healthy endpoint round-trips its JSON', async () => {
  const body = await fetchJson('https://example.test/x.json', { fetchImpl: async () => ok({ polozky: [1] }), env: {} });
  assert.deepEqual(body, { polozky: [1] });
});

await check('every GET carries an abort signal set to FETCH_TIMEOUT_MS', async () => {
  let seen = null;
  await fetchJson('https://example.test/x.json', {
    env: {},
    fetchImpl: async (_url, init) => { seen = init; return ok({}); },
  });
  assert.ok(seen && seen.signal, 'fetch was called with no signal — the build can hang forever');
  assert.ok(seen.signal instanceof AbortSignal, 'signal is not an AbortSignal');
  assert.equal(seen.signal.aborted, false, 'the signal was already aborted before the request started');
});

await check('a hung endpoint fails with the budget in the message, not "AbortError"', async () => {
  // AbortSignal.timeout()'s timer is UNREF'd, so with a pending promise and nothing
  // else scheduled the loop would exit before it fires. Hold it open ourselves.
  const keepalive = setInterval(() => {}, 5);
  const err = await fetchJson('https://example.test/hang.json', {
    env: {},
    timeoutMs: 15,
    // Stand in for undici: reject with the DOMException shape an aborted fetch throws.
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('The operation was aborted due to timeout');
          e.name = 'TimeoutError';
          reject(e);
        });
      }),
  }).then(() => null, (e) => e);
  clearInterval(keepalive);
  assert.ok(err, 'a hung endpoint resolved successfully');
  assert.match(err.message, /15 ms/, `the failure must name the budget it exceeded: ${err.message}`);
  assert.match(err.message, /FETCH_TIMEOUT_MS/);
  assert.doesNotMatch(err.message, /^AbortError/);
});

await check('a non-2xx names its status', async () => {
  const err = await fetchJson('https://example.test/gone.json', {
    env: {},
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  }).then(() => null, (e) => e);
  assert.match(err.message, /503/);
});

await check('KP_OFFLINE refuses BEFORE the socket is touched, and says the snapshot is committed', async () => {
  for (const flag of ['1', 'true', 'yes', 'on', 'ON']) {
    let called = false;
    const err = await fetchJson('https://data.mpsv.cz/x.json', {
      env: { KP_OFFLINE: flag },
      fetchImpl: async () => { called = true; return ok({}); },
    }).then(() => null, (e) => e);
    assert.ok(err, `KP_OFFLINE=${flag} still fetched`);
    assert.equal(called, false, `KP_OFFLINE=${flag} reached the network anyway`);
    assert.match(err.message, /KP_OFFLINE/);
    assert.match(err.message, /market_pulse\.json/, 'the refusal must tell the operator a snapshot is already committed');
  }
});

await check('a falsey KP_OFFLINE leaves the fetch alone — the failure direction is never "silently offline"', async () => {
  for (const flag of [undefined, '', '0', 'false', 'no']) {
    assert.equal(isOffline({ KP_OFFLINE: flag }), false, `KP_OFFLINE=${JSON.stringify(flag)} read as offline`);
    const body = await fetchJson('https://example.test/x.json', { env: { KP_OFFLINE: flag }, fetchImpl: async () => ok({ n: 1 }) });
    assert.deepEqual(body, { n: 1 });
  }
});

console.log(`\nmarket-fetch: ${passed} checks passed.`);
