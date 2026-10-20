// The Overview's pure half ("The Orbit, Lit"): its queues and columns, who is first up (and the
// honest answers when nobody can be), the waiting breakdown, the SLA totals, and the equal-density
// ring bands the orbit is cut into. The wire geometry is the kit's (app/_components/kit/scene/wireGeometry.test.ts).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry, StageDef } from "../../../../shared/pipelineTypes.ts";
import type { RailBucket } from "../../pipelineBoardPopulation.ts";
import { buildOrbit } from "../orbitModel.ts";
import { hubHole, ringBands } from "../orbitRings.ts";
import { layoutOrbit, wedgeForLabels } from "../orbitLayout.ts";
import { NO_LIT, firstUp, litNow, litStep, mainStage, overviewQueues, slaTotals, urgentFirst, waitBreakdown } from "./overviewModel.ts";

const AXIS: StageDef[] = [
  { id: "Accepted", label: "Accepted", role: "entry" },
  { id: "Screened", label: "Screened", role: "screening" },
  { id: "Interview", label: "Interview", role: "interview" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Hired", label: "Hired", role: "terminal" },
];
const SLA = [2, 5, 7, 4, 0];
const NOW = Date.parse("2026-09-30T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

let n = 0;
function entry(p: Partial<Entry>): Entry {
  n++;
  return {
    id: `e${n}`, candidateId: null, candidateLabel: `Person ${n}`, archetype: null, roleFamily: "software_engineering",
    jobId: "job-1", jobTitle: "Backend Engineer", stage: "Accepted", matchScore: null, status: "active",
    approvalKind: null, approvalDetail: null, createdAt: daysAgo(30), stageChangedAt: null, ...p,
  };
}
const stale = (e: Entry) => {
  const i = AXIS.findIndex((s) => s.id === e.stage);
  return e.stageChangedAt != null && SLA[i] > 0 && (NOW - Date.parse(e.stageChangedAt)) / 86_400_000 >= SLA[i];
};
const build = (entries: Entry[]) => buildOrbit({ entries, jobs: null, axis: AXIS, isStale: stale, score: (e) => e.matchScore });

test("queues: the decisions queue leads the needs column; scorecards and drafted offers need you; the rest is in motion", () => {
  const dec = entry({ approvalKind: "decision" });
  const scr = entry({ approvalKind: "screening_review" });
  const card = entry({ approvalKind: "scorecard_review" });
  const slot = entry({ approvalKind: "calendar" });
  const rows: RailBucket[] = [
    { key: "inbound", entries: [dec, scr], stage: "Accepted" },
    { key: "scorecards", entries: [card], tab: "decisions" },
    { key: "awaitingSlot", entries: [slot], tab: "schedule" },
  ];
  const qs = overviewQueues(rows, [dec, scr, card, slot], AXIS);
  assert.deepEqual(qs.map((q) => [q.key, q.needs]), [["decisions", true], ["inbound", false], ["scorecards", true], ["awaitingSlot", false]]);
  assert.deepEqual(qs[0].entries.map((e) => e.id), [dec.id, scr.id], "decision + screening review, not the scorecard (its own row) or the slot (Schedule)");
  assert.equal(qs[0].tab, "decisions");
  assert.equal(qs[1].stage, "Accepted");
  assert.deepEqual(overviewQueues([], [entry({})], AXIS), [], "nobody waiting: no decisions queue");
});

test("the decisions card counts a subset of the head's population, never a different one", () => {
  const kinds = ["decision", "screening_review", "rejection_review", "scorecard_review", "offer_review", "calendar"] as const;
  const people = kinds.map((k) => entry({ approvalKind: k, stage: "Screened", stageChangedAt: daysAgo(1) }));
  const offAxis = entry({ approvalKind: "decision", stage: "Retired column" });
  const m = build([...people, offAxis]);
  const card = overviewQueues([], [...people, offAxis], AXIS)[0];
  assert.equal(card.key, "decisions");
  assert.deepEqual(card.entries.map((e) => e.approvalKind), ["decision", "screening_review", "rejection_review"], "the Decisions tab's kinds minus the ones with their own card");
  assert.ok(!card.entries.includes(offAxis), "an off-axis person is not drawn, so the head does not count them and neither does the card");
  const head = new Set(m.people.filter((p) => p.waiting).map((p) => p.id));
  assert.equal(m.total.wait, 6, "the head counts every drawn person with any approval kind");
  for (const e of card.entries) assert.ok(head.has(e.id), `${e.approvalKind} is in the head's population`);
});

test("names on a card: waiting first, then late, then longest on the stage", () => {
  const calm = entry({ stageChangedAt: daysAgo(1) });
  const late = entry({ stage: "Screened", stageChangedAt: daysAgo(9) });
  const wait = entry({ approvalKind: "decision", stageChangedAt: daysAgo(0) });
  const old = entry({ stageChangedAt: daysAgo(1.5) });
  const m = build([calm, late, wait, old]);
  assert.deepEqual(urgentFirst([calm, late, wait, old], m).map((e) => e.id), [wait.id, late.id, old.id, calm.id]);
});

test("a queue's wire goes to the ring most of its people stand on; undrawn people fall back to the named stage", () => {
  const a = entry({ stage: "Screened" });
  const b = entry({ stage: "Interview" });
  const c = entry({ stage: "Interview" });
  const m = build([a, b, c]);
  assert.equal(mainStage([a, b, c], m), 2);
  assert.equal(mainStage([a, b], m), 1, "a tie takes the outer ring");
  assert.equal(mainStage([entry({ status: "hired" })], m, 4), 4);
  assert.equal(mainStage([], m), null);
});

test("the waiting count, by kind: most first, ties in the given order", () => {
  const parts = waitBreakdown([{ waiting: "calendar" }, { waiting: "decision" }, { waiting: "decision" }, { waiting: "scorecard_review" }, { waiting: null }], ["decision", "scorecard_review", "calendar"]);
  assert.deepEqual(parts, [{ kind: "decision", count: 2 }, { kind: "scorecard_review", count: 1 }, { kind: "calendar", count: 1 }]);
  assert.deepEqual(waitBreakdown([], []), []);
});

test("first up: the waiting person furthest over the SLA, only among people with a clock", () => {
  const m = build([
    entry({ candidateLabel: "Placed Waiter", approvalKind: "decision" }), // placed, never moved: no clock
    entry({ candidateLabel: "Slightly Late", stage: "Screened", approvalKind: "screening_review", stageChangedAt: daysAgo(6) }),
    entry({ candidateLabel: "Very Late", stage: "Accepted", approvalKind: "decision", stageChangedAt: daysAgo(9) }),
    entry({ candidateLabel: "Late, not waiting", stage: "Interview", stageChangedAt: daysAgo(40) }),
  ]);
  const f = firstUp(m.people, SLA, NOW);
  assert.equal(f.state, "ok");
  if (f.state === "ok") {
    assert.equal(f.person.name, "Very Late");
    assert.deepEqual([f.days, f.sla, f.over], [9, 2, true]);
  }
});

test("first up is honest: nobody waiting, or nobody waiting has a clock, or nobody is over", () => {
  assert.deepEqual(firstUp(build([entry({ stageChangedAt: daysAgo(3) })]).people, SLA, NOW), { state: "none" });
  const placed = build([entry({ approvalKind: "decision" }), entry({ approvalKind: "calendar", stage: "Hired", stageChangedAt: daysAgo(3) })]);
  assert.deepEqual(firstUp(placed.people, SLA, NOW), { state: "noClock", waiting: 2 }, "placed never moved and the terminal stage have no clock");
  const early = firstUp(build([entry({ stage: "Interview", approvalKind: "decision", stageChangedAt: daysAgo(3) }), entry({ stage: "Interview", approvalKind: "decision", stageChangedAt: daysAgo(1) })]).people, SLA, NOW);
  assert.equal(early.state === "ok" && early.over, false);
  assert.equal(early.state === "ok" && early.days, 3, "nearest its SLA when nobody is over");
});

test("SLA totals measure only people with a clock", () => {
  const m = build([entry({}), entry({ stage: "Screened", stageChangedAt: daysAgo(9) }), entry({ stage: "Screened", stageChangedAt: daysAgo(1) }), entry({ stage: "Hired", stageChangedAt: daysAgo(1) })]);
  assert.deepEqual(slaTotals(m.people), { measured: 2, inside: 1, over: 1 });
});

test("ring bands: area follows people, a floor keeps a thin stage readable, an empty board splits evenly", () => {
  const R = 300;
  const b = ringBands([17, 20, 12, 43, 6], R);
  assert.equal(b.length, 5);
  assert.equal(b[0][1], 1, "the entry ring is the rim");
  assert.equal(b[4][0], hubHole(R), "the hub keeps its hole");
  for (let i = 1; i < 5; i++) assert.equal(b[i][1], b[i - 1][0], "bands touch");
  const area = (i: number) => b[i][1] ** 2 - b[i][0] ** 2;
  assert.ok(area(3) > area(1) * 1.6, "43 people get more area than 20");
  assert.ok(b.every(([a, z]) => (z - a) * R >= 20 - 1e-6), "no band under 20px");
  const skew = ringBands([0, 0, 0, 900, 0], R);
  assert.ok(skew.every(([a, z]) => (z - a) * R >= 20 - 1e-6), "a dominant ring cannot squeeze the others below the floor");
  const even = ringBands([0, 0, 0], R);
  assert.ok(Math.abs(even[0][1] - even[0][0] - (even[2][1] - even[2][0])) < 1e-9);
  assert.deepEqual(ringBands([], R), []);
});

test("the layout takes the ring spec, and the wedge widens for longer labels", () => {
  const m = build([entry({}), entry({ stage: "Offer", stageChangedAt: daysAgo(1) })]);
  const g = layoutOrbit([m.total], 5, 600, 600, { counts: [1, 0, 0, 1, 0], labels: [20, 20, 20, 20, 20] });
  assert.equal(g.rings[0][1], 1);
  assert.equal(g.dots.length, 2);
  const narrow = wedgeForLabels(g.R, g.rings, [20, 20, 20, 20, 20]);
  const wide = wedgeForLabels(g.R, g.rings, [90, 90, 90, 90, 20]);
  assert.ok(wide > narrow);
});

test("the lit set follows the pointer while it points, and falls back to the focused card when it leaves", () => {
  const A = { key: "decisions" };
  const B = { key: "scorecards" };
  const W = { key: "__waiting" };
  let s = litStep(NO_LIT, "focus", B, true);
  assert.equal(litNow(s), B, "keyboard focus in B lights B");
  s = litStep(s, "pointer", A, true);
  assert.equal(litNow(s), A, "pointing at A lights A");
  s = litStep(s, "pointer", A, false);
  assert.equal(litNow(s), B, "leaving A falls back to B, which still holds focus (the bug: nobody was lit)");
  s = litStep(s, "focus", B, false);
  assert.equal(litNow(s), null, "blurring B with nothing pointed lights nobody");
  // A stale 'off' from a set that no longer holds the slot changes nothing.
  s = litStep(litStep(NO_LIT, "focus", W, true), "focus", B, false);
  assert.equal(litNow(s), W);
  // Pointer over the focused card and leaving it keeps it lit through focus.
  s = litStep(litStep(litStep(NO_LIT, "focus", B, true), "pointer", B, true), "pointer", B, false);
  assert.equal(litNow(s), B);
});
