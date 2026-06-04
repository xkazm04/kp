// Pins the run-of-show timing contract (idea-c3538d84): the interview plan must
// always land in the documented 15–30 minute band, the chronology must be a
// contiguous timeline whose end equals the reported durationMin, and a sparse
// question set must be padded into a real interview rather than a 7-minute stub.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRunOfShow, MIN_DURATION_MIN, MAX_DURATION_MIN, type PrepQuestion } from "./run-of-show.ts";

const mkQuestions = (n: number): PrepQuestion[] =>
  Array.from({ length: n }, (_, i) => ({
    competency: `Competency ${i + 1}`,
    question: `Question ${i + 1}?`,
    whatsGoodLooksLike: `Good answer ${i + 1}`,
    followUpIfAnswer: `Follow up ${i + 1}`,
  }));

test("the band constants are the documented 15–30 minutes", () => {
  assert.equal(MIN_DURATION_MIN, 15);
  assert.equal(MAX_DURATION_MIN, 30);
  assert.ok(MIN_DURATION_MIN < MAX_DURATION_MIN);
});

test("every question count 0..10 produces a plan inside the band", () => {
  for (let n = 0; n <= 10; n++) {
    const plan = buildRunOfShow(mkQuestions(n), ["focus a", "focus b"], "Alex", "Engineer");
    assert.ok(
      plan.durationMin >= MIN_DURATION_MIN && plan.durationMin <= MAX_DURATION_MIN,
      `n=${n}: durationMin ${plan.durationMin} out of [${MIN_DURATION_MIN}, ${MAX_DURATION_MIN}]`
    );
  }
});

test("the chronology is a contiguous timeline whose end equals durationMin", () => {
  for (let n = 0; n <= 8; n++) {
    const plan = buildRunOfShow(mkQuestions(n), [], null, null);
    assert.equal(plan.chronology[0].fromMin, 0, `n=${n}: first block must start at 0`);
    for (let i = 1; i < plan.chronology.length; i++) {
      assert.equal(
        plan.chronology[i].fromMin,
        plan.chronology[i - 1].toMin,
        `n=${n}: block ${i} must start where block ${i - 1} ends`
      );
    }
    const end = plan.chronology[plan.chronology.length - 1].toMin;
    assert.equal(end, plan.durationMin, `n=${n}: last block end ${end} must equal durationMin ${plan.durationMin}`);
  }
});

test("a sparse question set is padded to the minimum with an open-discussion block", () => {
  for (const n of [0, 1]) {
    const plan = buildRunOfShow(mkQuestions(n), [], null, null);
    assert.equal(plan.durationMin, MIN_DURATION_MIN, `n=${n}: should pad up to the minimum`);
    assert.ok(
      plan.chronology.some((b) => /open discussion/i.test(b.topic)),
      `n=${n}: should insert an open-discussion filler block`
    );
  }
});

test("an interview with no questions still has intro and wrap blocks", () => {
  const plan = buildRunOfShow([], [], null, null);
  assert.ok(plan.chronology.some((b) => /intro/i.test(b.topic)), "intro block present");
  assert.ok(plan.chronology.some((b) => /wrap/i.test(b.topic)), "wrap block present");
});

test("question blocks are capped at six even when more are supplied", () => {
  const plan = buildRunOfShow(mkQuestions(20), [], null, null);
  const questionBlocks = plan.chronology.filter((b) => b.questions.length > 0);
  assert.equal(questionBlocks.length, 6, "no more than six question blocks");
  assert.ok(plan.durationMin <= MAX_DURATION_MIN, "still within the band with the cap applied");
});

test("focus areas are capped and surfaced in the scenario + checklist", () => {
  const plan = buildRunOfShow(mkQuestions(3), ["a", "b", "c", "d", "e", "f", "g"], "Sam", "Designer");
  const signals = plan.checklist[0].items;
  // The first five focus areas lead the checklist; the 6th/7th are dropped.
  assert.ok(signals.slice(0, 5).join("|") === "a|b|c|d|e", "checklist leads with the first five focus areas");
  assert.ok(!signals.includes("f") && !signals.includes("g"), "surplus focus areas are dropped");
  assert.match(plan.scenario, /Sam/);
  assert.match(plan.scenario, /Designer/);
});
