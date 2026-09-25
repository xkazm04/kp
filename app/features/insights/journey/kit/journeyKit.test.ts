// The kit lane board's model: lane mapping (entry -> cells with shape and reason), step counting
// ("N of M", "N stop here", a step nobody could reach) and role reach. Every assertion is an
// honesty rule the Broadsheet encoded in type and marks, now carried by ShapeMark shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { JourneyColumn, JourneyEvent, JourneyRailStep } from "@/app/_lib/journey/types";
import { cohortReach, KIT_STEPS, laneCells, stepOfKind } from "./journeyKitSteps.ts";
import { laneRow, laneStatus, listLanes, NO_LANE_FILTERS, railCohort, railSteps } from "./journeyKitModel.ts";
import { gapDays, paneSteps, trailRows } from "./journeyKitPaneModel.ts";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const hasKey = (k: string) => k.startsWith("absence.") && k !== "absence.unknownReason";
const opts = { observedOnly: false, hasKey };
const at = (k: string) => KIT_STEPS.indexOf(k as (typeof KIT_STEPS)[number]);

let seq = 0;
function ev(kind: string, day: string, over: Partial<JourneyEvent> = {}): JourneyEvent {
  seq += 1;
  const iso = `${day}T10:00:00.000Z`;
  return { id: `e${seq}`, phase: "screening", kind, facts: {}, occurredAt: iso, recordedAt: iso, actor: null, sourceRef: { table: "t", id: String(seq) }, ...over };
}
function col(id: string, events: JourneyEvent[], over: Partial<JourneyColumn> = {}): JourneyColumn {
  return {
    entryId: id, candidateLabel: id, stage: "Screened", active: true, matchScore: null, locale: "en", origin: { kind: "live" },
    phases: {
      "job-definition": { present: false, absenceReasonKey: "journey.absence.intakeMissing" },
      case: { present: false, absenceReasonKey: "journey.absence.caseNotRun" },
      screening: { present: true },
    },
    events, ...over,
  };
}

test("every kind files under the cohort layer's stage; analysis and case are their own steps", () => {
  assert.equal(stepOfKind("analysis"), "analysed");
  assert.equal(stepOfKind("matched"), "source");
  assert.equal(stepOfKind("screening_hold"), "screen");
  assert.equal(stepOfKind("advanced"), "screen", "kind-only: the cohort payload has no facts to route by");
  assert.equal(stepOfKind("case_opened"), "case", "a case event is a case step, even where the cohort files it under screen");
  assert.equal(stepOfKind("onboarding_started"), "onboard");
  assert.equal(stepOfKind("rejection_sent"), null, "a decision marker is no step; the trail still shows it");
});

test("lane shape carries provenance: observed solid, name-only half, generated ring", () => {
  const c = laneCells(col("a", [ev("analysis", "2026-05-01", { confidence: "label-only" }), ev("matched", "2026-05-02")]), opts);
  assert.equal(c[at("analysed")].shape, "half");
  assert.equal(c[at("source")].shape, "solid");
  const run = laneCells(col("b", [ev("matched", "2026-05-02")], { origin: { kind: "test-run", runId: "uat" } }), opts);
  assert.equal(run[at("source")].shape, "ring");
  const mixed = laneCells(col("c", [ev("analysis", "2026-05-01", { confidence: "label-only" }), ev("analysis", "2026-05-03")]), opts);
  assert.equal(mixed[at("analysed")].shape, "solid", "one certain row proves the step");
});

test("absence: a phase with its reason is dashed with that reason; an unresolvable reason is never recorded", () => {
  const c = laneCells(col("a", [ev("matched", "2026-05-02")]), opts);
  assert.deepEqual([c[at("case")].shape, c[at("case")].reason, c[at("case")].absenceKey], ["dashed", "absent", "absence.caseNotRun"]);
  const odd = col("b", [ev("matched", "2026-05-02")]);
  odd.phases.case = { present: false, absenceReasonKey: "absence.unknownReason" };
  assert.equal(laneCells(odd, opts)[at("case")].absenceKey, null);
});

test("skipped sits before the last reached step, never-reached after it: two different facts", () => {
  const c = laneCells(col("a", [ev("matched", "2026-05-02"), ev("interview_session", "2026-05-09")]), opts);
  assert.equal(c[at("screen")].reason, "skipped");
  assert.equal(c[at("offer")].reason, "notReached");
  assert.equal(c[at("screen")].shape, "none");
});

test("observed-only hides a step's rows and says so, instead of reading as never reached", () => {
  const c = laneCells(col("a", [ev("analysis", "2026-05-01", { confidence: "label-only" }), ev("matched", "2026-05-02")]), { ...opts, observedOnly: true });
  assert.deepEqual([c[at("analysed")].shape, c[at("analysed")].reason], ["dashed", "hidden"]);
});

test("the rail counts N of M and who stopped where; a step nobody could reach carries the shared reason", () => {
  const lanes = [
    laneRow(col("a", [ev("matched", "2026-05-02")]), "open", opts, NOW),
    laneRow(col("b", [ev("matched", "2026-05-02"), ev("screening_hold", "2026-05-04")]), undefined, opts, NOW),
    laneRow(col("c", [ev("matched", "2026-05-02"), ev("advanced", "2026-05-04")]), "hired", opts, NOW),
  ];
  const rail = railSteps(lanes);
  const source = rail[at("source")];
  const screen = rail[at("screen")];
  assert.deepEqual([source.reached, source.of, source.stopped], [3, 3, 1]);
  assert.deepEqual([screen.reached, screen.stopped], [2, 1], "the hired journey reached screen but did not stop there");
  assert.equal(rail[at("case")].absent, "absence.caseNotRun");
  assert.equal(rail[at("offer")].absent, null, "nobody reached offer, but no lane says why: 0 of 3, not absent");
});

test("status: waiting on you is an active journey held for review; the cohort outcome wins otherwise", () => {
  assert.equal(laneStatus(col("a", [ev("screening_hold", "2026-05-04")]), "stalled"), "needs");
  assert.equal(laneStatus(col("a", [ev("matched", "2026-05-04")]), "hired"), "hired");
  assert.equal(laneStatus(col("a", []), undefined), "empty");
  assert.equal(laneStatus(col("a", [ev("rejection_sent", "2026-05-04")], { active: false }), undefined), "rejected");
});

test("the list: needs first, then furthest; the stop filter keeps journeys under way; test runs stay out", () => {
  const lanes = [
    laneRow(col("far", [ev("matched", "2026-05-02"), ev("interview_session", "2026-05-09")]), "open", opts, NOW),
    laneRow(col("held", [ev("matched", "2026-05-02"), ev("screening_hold", "2026-05-04")]), "stalled", opts, NOW),
    laneRow(col("run", [ev("matched", "2026-05-02")], { origin: { kind: "test-run", runId: "u" } }), "open", opts, NOW),
  ];
  assert.deepEqual(listLanes(lanes, NO_LANE_FILTERS).map((l) => l.column.entryId), ["held", "far"]);
  assert.equal(railCohort(lanes, { testRuns: true }).length, 3);
  assert.deepEqual(listLanes(lanes, { ...NO_LANE_FILTERS, stop: "screen" }).map((l) => l.column.entryId), ["held"]);
  assert.equal(lanes[1].quietDays, 144);
});

test("role reach counts each instance once per step", () => {
  const reach = cohortReach([{ steps: [{ kind: "analysis" }, { kind: "matched" }, { kind: "added" }] }, { steps: [{ kind: "matched" }] }]);
  assert.equal(reach[at("analysed")], 1);
  assert.equal(reach[at("source")], 2);
  assert.equal(reach[at("offer")], 0);
});

test("the pane's kind rail keeps present, skipped and never reached apart", () => {
  const rail: JourneyRailStep[] = ["analysis", "matched", "screening_hold", "advanced"].map((kind, index) => ({ index, phase: "screening", kind, reached: 1, cohort: 1, byMachine: 0 }));
  const steps = paneSteps(rail, col("a", [ev("analysis", "2026-05-01"), ev("screening_hold", "2026-05-04")]));
  assert.deepEqual(steps.map((s) => s.state), ["present", "skipped", "present", "never-reached"]);
});

test("the trail prints silences, clock jumps and each missing phase with its reason", () => {
  const rows = trailRows(col("a", [ev("analysis", "2024-01-01"), ev("matched", "2026-05-02"), ev("screening_hold", "2026-05-12")]), { hasKey, underWay: true, now: NOW });
  assert.deepEqual(rows.map((r) => r.kind), ["phase", "phase", "event", "jump", "event", "silence", "event", "silence"]);
  const jump = rows.find((r) => r.kind === "jump");
  assert.equal(jump?.kind === "jump" ? jump.years : 0, 2.3);
  assert.equal(gapDays("2026-05-02T00:00:00Z", "2026-05-01T00:00:00Z"), 0);
});
