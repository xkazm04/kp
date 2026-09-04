// Which half of the Job-intake tab a URL asks for. The rule is pinned because
// getting it wrong is silent: a deep link that lands on the intake dialog drops
// the prefill it carried, since the builder reads its seeds at mount only — the
// guided demo's design step, the Duplicate handoff and a finished build's
// "open it" link would all arrive at an empty conversation instead.

import test from "node:test";
import assert from "node:assert/strict";
import { DUPLICATE_PARAM, opensOnGenerate } from "./jdsIntakeTabEntry.ts";

const params = (qs: string) => new URLSearchParams(qs);

test("a bare tab visit opens the intake dialog", () => {
  assert.equal(opensOnGenerate(params("")), false);
  assert.equal(opensOnGenerate(params("tab=intake")), false);
  // A param that belongs to another tab must not drag this one to the builder.
  assert.equal(opensOnGenerate(params("tab=intake&profile=cand1&quick=aging")), false);
});

test("every builder handoff opens Generate", () => {
  assert.equal(opensOnGenerate(params(`${DUPLICATE_PARAM}=my-role`)), true, "Duplicate from the ledger");
  assert.equal(opensOnGenerate(params("jdTask=task_42")), true, "a finished build being rehydrated");
  assert.equal(opensOnGenerate(params("jdTitle=Staff%20Engineer")), true, "the guided demo's prefill");
  assert.equal(opensOnGenerate(params("jdNeed=Owns%20the%20platform")), true);
  assert.equal(opensOnGenerate(params("jdCompany=Acme")), true);
  assert.equal(opensOnGenerate(params("jdSeniority=senior")), true);
  assert.equal(opensOnGenerate(params("jdFamily=software_engineering")), true);
});

test("an EMPTY handoff param is not a handoff", () => {
  // `?duplicate=` (cleared, not removed) must not strand the reader in a builder
  // with nothing to seed it.
  assert.equal(opensOnGenerate(params(`${DUPLICATE_PARAM}=`)), false);
  assert.equal(opensOnGenerate(params("jdTitle=")), false);
});
