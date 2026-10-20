// Pins the director-record reading of the interview compare grid (challenge-r07
// voice-interview-api/B): per rubric axis, did the directed interview COVER it (a
// topic_covered the director accepted on a verified quote), only ASK it (begun, never
// covered), never REACH it, or never PLAN it — and how many kit must-asks the call
// ended owing. Pure: agenda + event rows in, states out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { axisCoverage, type CoverageEvent } from "./interview-axis-coverage.ts";
import type { AgendaBlock, InterviewAgenda } from "./voice/director-types.ts";

function block(id: string, competency: string | null, scored: boolean, extra: Partial<AgendaBlock> = {}): AgendaBlock {
  return { id, kind: scored ? "topic" : "warmup", title: `Block ${id}`, budgetMin: 5, competency, scored, questions: [`Question ${id}?`], ...extra };
}

function agenda(blocks: AgendaBlock[]): InterviewAgenda {
  return { version: 1, durationMin: 30, hardCapMin: 36, closeReserveMin: 3, blocks };
}

let clock = Date.parse("2026-09-23T10:00:00.000Z");
function ev(kind: CoverageEvent["kind"], blockId: string | null, attempt = 1, payload: Record<string, unknown> = {}): CoverageEvent {
  clock += 1000;
  return { kind, attempt, seq: null, blockId, payload, createdAt: new Date(clock).toISOString() };
}

const AXES = ["ownership", "system_design", "communication"];
const A = agenda([block("b1", "ownership", true), block("b2", "system_design", true), block("b3", null, false)]);

test("pure coverage per axis: covered, asked, not planned; an unscored block contributes no axis", () => {
  const cov = axisCoverage({
    agenda: A,
    events: [ev("topic_begun", "b1"), ev("topic_covered", "b1"), ev("topic_begun", "b2")],
    rubricAxes: AXES,
  });
  assert.ok(cov);
  assert.deepEqual(cov.byAxis, { ownership: "covered", system_design: "asked", communication: "not_planned" });
});

test("never reached: a scored block with no topic event in any attempt; begun in 1 + covered in 2 is covered", () => {
  const none = axisCoverage({ agenda: A, events: [ev("topic_begun", "b1", 1), ev("topic_covered", "b1", 2)], rubricAxes: AXES });
  assert.ok(none);
  assert.equal(none.byAxis.system_design, "not_reached");
  assert.equal(none.byAxis.ownership, "covered", "begun in attempt 1, covered in attempt 2");
});

test("undirected is honest null, never an all-not_reached map", () => {
  assert.equal(axisCoverage({ agenda: null, events: [], rubricAxes: AXES }), null);
  assert.equal(axisCoverage({ agenda: null, events: [ev("topic_begun", "b1")], rubricAxes: AXES }), null);
});

test("must-asks owed: two must_ask_unasked rows after an accepted end -> 2 (a count only)", () => {
  const cov = axisCoverage({
    agenda: A,
    events: [
      ev("end_requested", "b2", 1, { reason: "time" }),
      ev("must_ask_unasked", "b2", 1, { questionId: "q1", question: "Secret one?" }),
      ev("must_ask_unasked", "b2", 1, { questionId: "q2", question: "Secret two?" }),
    ],
    rubricAxes: AXES,
  });
  assert.ok(cov);
  assert.equal(cov.mustAsksUnasked, 2);
  assert.ok(!JSON.stringify(cov).includes("Secret"), "no question text rides the coverage");
});

test("must-asks unknown: no accepted end_interview -> null (the rows are only written there); a refused end does not count", () => {
  const dropped = axisCoverage({ agenda: A, events: [ev("topic_begun", "b1")], rubricAxes: AXES });
  assert.ok(dropped);
  assert.equal(dropped.mustAsksUnasked, null, "a dropped call concluded nothing about must-asks");
  const refused = axisCoverage({ agenda: A, events: [ev("end_requested", "b1", 1, { reason: "complete", refused: true })], rubricAxes: AXES });
  assert.ok(refused);
  assert.equal(refused.mustAsksUnasked, null, "a refused complete is an audit row, not an end");
  const clean = axisCoverage({ agenda: A, events: [ev("end_requested", null, 1, { reason: "complete" })], rubricAxes: AXES });
  assert.ok(clean);
  assert.equal(clean.mustAsksUnasked, 0, "an ended call with nothing owed is a real 0");
});

test("axis keys follow the rubric's spelling; a kit competency outside the rubric keeps its own", () => {
  const cov = axisCoverage({
    agenda: agenda([block("b1", "Ownership", true), block("b2", "kafka_ops", true)]),
    events: [ev("topic_begun", "b2")],
    rubricAxes: ["ownership"],
  });
  assert.ok(cov);
  assert.deepEqual(cov.byAxis, { ownership: "not_reached", kafka_ops: "asked" });
});
