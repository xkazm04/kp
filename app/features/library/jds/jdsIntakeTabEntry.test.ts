// Which half of the Job-intake tab a URL asks for. The rule is pinned because
// getting it wrong is silent: a deep link that lands on the intake dialog drops
// the prefill it carried, since the builder reads its seeds at mount only — the
// guided demo's design step, the Duplicate handoff and a finished build's
// "open it" link would all arrive at an empty conversation instead.

import test from "node:test";
import assert from "node:assert/strict";
import { DUPLICATE_PARAM, NEW_INTAKE_PARAM, hasBuilderHandoff, opensNewIntake, opensOnGenerate } from "./jdsIntakeTabEntry.ts";

const params = (qs: string) => new URLSearchParams(qs);
// What the guided demo hands across in state — the same five fields its design
// chapter used to spell out in the address bar.
const simHandoff = {
  title: "Senior Java Backend Engineer (SIM)",
  company: "Česká spořitelna",
  seniority: "senior",
  roleFamily: "software_engineering",
  need: "Own core banking backend services. Mentor the team.",
};

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

// The guided demo's door: no params at all, the whole JD in app state. This is the
// case the URL used to carry in 252 characters, and the one that would silently
// open the intake dialog over a builder the tour is about to spotlight.
test("an in-app handoff opens Generate with an EMPTY url", () => {
  assert.equal(opensOnGenerate(params(""), simHandoff), true, "the guided demo's design chapter");
  assert.equal(opensOnGenerate(params("tab=intake"), simHandoff), true, "…on the bare tab url the walk now writes");
  assert.equal(hasBuilderHandoff(simHandoff), true);
});

test("no handoff is no handoff, however it is spelled", () => {
  assert.equal(opensOnGenerate(params("tab=intake"), null), false);
  assert.equal(opensOnGenerate(params("tab=intake"), undefined), false);
  assert.equal(opensOnGenerate(params("tab=intake")), false, "the argument is optional — the URL doors still answer alone");
  // An object with nothing in it is not a prefill: opening the builder on it would
  // strand the reader in an empty form instead of the conversation they asked for
  // — the same rule `?jdTitle=` gets below.
  assert.equal(opensOnGenerate(params("tab=intake"), { title: "", need: "" }), false);
  assert.equal(hasBuilderHandoff({ title: "", need: "" }), false);
  assert.equal(hasBuilderHandoff(null), false);
  // Either seed alone is enough — the demo hands over both, a future producer may not.
  assert.equal(hasBuilderHandoff({ title: "Staff Engineer" }), true);
  assert.equal(hasBuilderHandoff({ need: "Owns the platform" }), true);
});

test("an EMPTY handoff param is not a handoff", () => {
  // `?duplicate=` (cleared, not removed) must not strand the reader in a builder
  // with nothing to seed it.
  assert.equal(opensOnGenerate(params(`${DUPLICATE_PARAM}=`)), false);
  assert.equal(opensOnGenerate(params("jdTitle=")), false);
});

// ?intake=new — the palette's "New intake" door. It has a SIDE EFFECT (a
// role_intakes row and a spawned opener), so the predicate is exact rather than
// truthy: a future ?intake=<id> must not be read as "make another one".

test("?intake=new asks for a fresh session; nothing else does", () => {
  assert.equal(opensNewIntake(params(`${NEW_INTAKE_PARAM}=new`)), true);
  assert.equal(opensNewIntake(params("tab=intake&intake=new")), true);
  assert.equal(opensNewIntake(params("")), false);
  assert.equal(opensNewIntake(params("tab=intake")), false);
  assert.equal(opensNewIntake(params("intake=")), false, "a cleared param is not a request");
  assert.equal(opensNewIntake(params("intake=abc123")), false, "an id is not the word new");
  assert.equal(opensNewIntake(params("intake=NEW")), false, "the value is a literal, not a word to guess at");
});

test("a builder handoff outranks it — a conversation must not open over a prefill", () => {
  assert.equal(opensNewIntake(params(`intake=new&${DUPLICATE_PARAM}=my-role`)), false);
  assert.equal(opensNewIntake(params("intake=new&jdTitle=Staff%20Engineer")), false);
  // …and the builder still opens, which is the half that would silently break.
  assert.equal(opensOnGenerate(params("intake=new&jdTask=task_42")), true);
  // The in-app handoff outranks it for the same reason: a run's design chapter
  // must not find a conversation started over the JD it just handed over.
  assert.equal(opensNewIntake(params("intake=new"), simHandoff), false);
  assert.equal(opensNewIntake(params("intake=new"), null), true, "…and without one, the palette's door still opens");
});
