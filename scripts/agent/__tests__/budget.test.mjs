#!/usr/bin/env node
// Fixtures for the agent spend meter. No deps — run with:
//   node scripts/agent/__tests__/budget.test.mjs
//   npm run test:agent
//
// The meter is only worth anything if it is FAIL-CLOSED and if something
// actually holds it. Both halves are pinned here: a lane with no declared
// ceiling must refuse to start, a call that would cross a ceiling must be
// refused BEFORE it is made, and `scripts/agent/dispatch.mjs` — the one lane
// that exists today — must name a lane the committed budget declares. The last
// one is the check that would have caught the state this file was written in:
// budget.mjs was complete, correct and imported by nothing at all.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BUDGET_FILE,
  BudgetExceeded,
  Meter,
  estimateTokens,
  loadBudget,
  priceOf,
  readLedger,
  render,
  summarise,
  usageTokens,
} from '../budget.mjs';
import { LANE } from '../dispatch.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const BUDGET = {
  version: 1,
  lanes: {
    dispatch: { maxTokens: 1000, maxCalls: 2, why: 'two rounds' },
  },
  prices: { models: { 'priced-model': { inputPerMTok: 3, outputPerMTok: 15 } } },
};

// --- the budget file ----------------------------------------------------------

check('a budget that cannot be believed throws rather than widening the lane', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-agent-budget-'));
  const write = (o) => fs.writeFileSync(path.join(dir, BUDGET_FILE), JSON.stringify(o));
  const bad = (o, re) => {
    write(o);
    assert.throws(() => loadBudget(dir), re);
  };
  bad({ version: 2 }, /unsupported version/);
  bad({ version: 1 }, /'lanes' must be an object/);
  bad({ version: 1, lanes: { a: { maxCalls: 1, why: 'x' } } }, /lane 'a' has no numeric maxTokens/);
  bad({ version: 1, lanes: { a: { maxTokens: 1, maxCalls: 1 } } }, /lane 'a' has no 'why'/);
});

// --- the meter fails closed ---------------------------------------------------

check('a lane with no declared ceiling cannot start — a new lane is a new bill', () => {
  assert.throws(() => new Meter({ lane: 'brand-new', budget: BUDGET }), /has no entry in/);
});

check('a call is refused BEFORE it is made, not reported after it was', () => {
  const meter = new Meter({ lane: 'dispatch', budget: BUDGET });
  // 8000 characters is roughly 2000 tokens — past the 1000-token ceiling with
  // nothing spent yet, so the refusal cannot be blamed on accumulation.
  assert.throws(() => meter.assertRoom('x'.repeat(8000)), BudgetExceeded);
  assert.equal(meter.calls, 0, 'a refused call must not be recorded as a call');
});

check('the call ceiling is what a retry loop runs into', () => {
  const meter = new Meter({ lane: 'dispatch', budget: BUDGET });
  meter.record({ model: 'm', usage: null });
  meter.record({ model: 'm', usage: null });
  assert.throws(() => meter.assertRoom('short'), /2 model call\(s\)/);
});

check('an accumulating run stops at the ceiling even when each call fits', () => {
  const meter = new Meter({ lane: 'dispatch', budget: BUDGET });
  meter.record({ model: 'm', usage: { input_tokens: 900, output_tokens: 0 } });
  assert.throws(() => meter.assertRoom('x'.repeat(800)), /past its ceiling of 1000/);
});

// --- what a call cost ---------------------------------------------------------

check('cache reads and writes count toward the bill, and no usage is never zero', () => {
  assert.equal(usageTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 4 }), 7);
  assert.equal(usageTokens(null), null, 'a backend that reports nothing is unknown, never free');
  assert.equal(estimateTokens('abcd'.repeat(10)), 10);
});

check('an ESTIMATED entry is never given a price, even when its model has one', () => {
  const exact = { model: 'priced-model', usage: { input_tokens: 1_000_000, output_tokens: 0 } };
  assert.ok(priceOf(exact, BUDGET.prices.models) > 0);
  assert.equal(
    priceOf({ ...exact, estimated: true }, BUDGET.prices.models),
    null,
    'four-characters-per-token is a guess; pricing it would print a dollar figure nobody measured',
  );
});

check('an estimated run still spends its ceiling, and the report says the number is a guess', () => {
  const entries = [{ lane: 'dispatch', model: 'priced-model', usage: { input_tokens: 600, output_tokens: 0 }, estimated: true }];
  const result = summarise(entries, BUDGET);
  assert.equal(result.rows[0].tokens, 600, 'an estimate still counts against the ceiling');
  assert.equal(result.rows[0].estimatedCalls, 1);
  const text = render(result, BUDGET);
  assert.match(text, /~600/, 'the tokens column must mark an estimate as one');
});

check('over either ceiling is a finding that names the ceiling and its reason', () => {
  const over = summarise(
    [
      { lane: 'dispatch', model: 'm', usage: { input_tokens: 2000, output_tokens: 0 } },
      { lane: 'dispatch', model: 'm', usage: { input_tokens: 1, output_tokens: 0 } },
      { lane: 'dispatch', model: 'm', usage: { input_tokens: 1, output_tokens: 0 } },
    ],
    BUDGET,
  );
  assert.equal(over.findings.length, 2, 'both the token and the call ceiling are breached');
  assert.match(render(over, BUDGET), /two rounds/);
});

check('a lane the budget never declared is reported, not folded in silently', () => {
  const result = summarise([{ lane: 'ghost', model: 'm', usage: { input_tokens: 5, output_tokens: 0 } }], BUDGET);
  assert.match(result.findings[0].message, /has no ceiling/);
});

check('a ledger line that is not JSON is dropped, never crashes the report', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kp-agent-ledger-')), 'l.jsonl');
  fs.writeFileSync(file, '{"lane":"dispatch","model":"m","usage":null}\nnot json\n\n');
  assert.equal(readLedger(file).length, 1);
  assert.deepEqual(readLedger(null), []);
});

// --- the coupling this file exists to protect ---------------------------------
//
// A meter nothing holds is a module, not a budget. This asserts the dispatch
// lane is metered by NAME against the committed budget, so deleting the wiring
// or renaming the lane fails here rather than by quietly going unmetered.

check('the dispatch lane is declared in the committed budget and named by the driver', () => {
  const committed = loadBudget();
  assert.equal(typeof LANE, 'string', 'dispatch.mjs must export the lane name it meters under');
  assert.ok(
    committed.lanes[LANE],
    `scripts/agent/dispatch.mjs meters lane "${LANE}", which ${BUDGET_FILE} does not declare — the lane would fail closed`,
  );
  // A Meter can actually be built for it: the fail-closed constructor is the
  // thing that would stop the real lane, so it has to pass here.
  assert.ok(new Meter({ lane: LANE, budget: committed }) instanceof Meter);
});

console.log(`\nagent-budget fixtures: ${passed} checks passed.`);
