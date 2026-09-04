// The field mapping behind the card's Mandate section. Pure, so it is testable
// at all — the point of splitting it out of the JSX is that "target rendered
// where the baseline should be" is invisible in a component review and loud
// here.
//
// Runner: node:test with type stripping — `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mandateSections } from "./mandate-view.ts";

type Spec = Parameters<typeof mandateSections>[0];

function spec(patch: Record<string, unknown> = {}): Spec {
  return {
    schemaVersion: 1,
    role: { title: "App master", population: "agent", seniority: "senior", rubricVersion: "v1" },
    app: { name: "kp", repo: { url: null, rootPath: null, mainBranch: "main" }, contextMapRef: null, dossierId: null },
    objectives: [
      { kpiKey: "gate_pass_rate", label: "Gate pass rate", baseline: 0.71, target: 0.95, unit: "ratio", direction: "gte", windowDays: 30 },
      { kpiKey: "p95_latency", label: "p95 latency", baseline: 900, target: 400, unit: "ms", direction: "lte", windowDays: 14 },
    ],
    mandate: {
      scopeRung: 2,
      forbiddenClasses: ["test_deletion_or_skip"],
      approvalGates: ["npm run typecheck", "  ", "npm run test:unit"],
      owner: "platform-lead",
    },
    cadence: { triggers: [] },
    budget: { monthlyUsd: 120, reservationPolicy: "fixed", onCap: "drain" },
    tenure: { probationDays: 30, reviewCadenceDays: 14, retireCriteria: ["two windows below the bar", ""] },
    agent: null,
    human: null,
    coercionNotes: [],
    promptVersion: "app-master-v1",
    ...patch,
  } as Spec;
}

test("every enforced part of the mandate reaches the view", () => {
  const v = mandateSections(spec());
  assert.deepEqual(v.approvalGates, ["npm run typecheck", "npm run test:unit"], "blank gates are not gates");
  assert.equal(v.reviewCadenceDays, 14);
  assert.deepEqual(v.retireCriteria, ["two windows below the bar"]);
  assert.equal(v.reservationPolicy, "fixed");
  assert.equal(v.isEmpty, false);
});

// The mapping a JSX review cannot see: target is the BAR, baseline is where the
// app stands today. Rendering the baseline as the target would show a mandate
// that is already met.
test("an objective row carries the target, never the baseline", () => {
  const [first, second] = mandateSections(spec()).objectives;
  assert.deepEqual(first, {
    kpiKey: "gate_pass_rate",
    label: "Gate pass rate",
    target: 0.95,
    unit: "ratio",
    direction: "gte",
    windowDays: 30,
  });
  assert.equal(second.direction, "lte", "direction decides whether the bar is a floor or a ceiling");
  assert.equal(second.target, 400);
});

test("an absent value becomes nothing, never a fabricated default", () => {
  const v = mandateSections(
    spec({
      objectives: [{ kpiKey: "k", label: "  ", baseline: null, target: null, unit: "  ", direction: "gte", windowDays: 0 }],
      mandate: { scopeRung: 0, forbiddenClasses: [], approvalGates: [], owner: "" },
      tenure: { probationDays: 30, reviewCadenceDays: 0, retireCriteria: [] },
    })
  );
  assert.equal(v.objectives[0].target, null, "a missing target must not render as 0");
  assert.equal(v.objectives[0].windowDays, null, "a zero-day window is not a window");
  assert.equal(v.objectives[0].unit, "");
  assert.equal(v.objectives[0].label, "k", "an unlabelled objective falls back to its real key, not an invented name");
  assert.equal(v.reviewCadenceDays, null);
  assert.deepEqual(v.approvalGates, []);
  assert.deepEqual(v.retireCriteria, []);
});

test("a spec with nothing enforced reports empty, so the card renders no heading", () => {
  const v = mandateSections(
    spec({
      objectives: [],
      mandate: { scopeRung: 0, forbiddenClasses: [], approvalGates: [], owner: "" },
      tenure: { probationDays: 30, reviewCadenceDays: 0, retireCriteria: [] },
      budget: { monthlyUsd: 0, reservationPolicy: "nonsense", onCap: "drain" },
    })
  );
  assert.equal(v.isEmpty, true);
  assert.equal(v.reservationPolicy, null, "an unrecognised policy is a disclosed unknown, not `estimate`");
});

test("no spec at all is the empty view, not a throw", () => {
  assert.equal(mandateSections(null).isEmpty, true);
  assert.equal(mandateSections(undefined).isEmpty, true);
});
