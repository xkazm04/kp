import assert from "node:assert/strict";
import { acceptGigPlan, createGigPlanRound, setGigPlanResult, setGigPlanRunning } from "../../db/gigs-plans";
import type { GigPlan, GigPlanRow } from "../types";

// A gig with an operator-ACCEPTED plan, through the real store (db/gigs-plans.ts): one seat
// queued -> running -> ready, then accepted with the operator's note. Shared by the pairing,
// dispatch and sync tests. The caller has already imported unit-db.ts.

export function fixturePlan(steps = 3): GigPlan {
  return {
    summary: "Reproduce the stored XSS, write the report with a minimal PoC, and verify the fix path.",
    steps: Array.from({ length: steps }, (_, i) => ({ title: `Step ${i + 1} work`, doneWhen: `Evidence ${i + 1} is in NOTES.md` })),
    decisions: ["Scope to the profile page only."],
    risks: ["The program may mark it a duplicate."],
    effortHours: { min: 2, max: 5 },
    questions: [],
  };
}

export function fixtureAcceptedPlan(workspaceId: string, gigId: string, opts: { steps?: number; note?: string | null } = {}): GigPlanRow {
  const round = createGigPlanRound(workspaceId, gigId, [{ seat: "opus", model: "claude-opus-5-5", effort: "xhigh" }]);
  assert.ok(round && round.length === 1, "the plan round was queued");
  const id = round![0]!.id;
  assert.ok(setGigPlanRunning(workspaceId, id));
  assert.ok(setGigPlanResult(workspaceId, id, { plan: fixturePlan(opts.steps ?? 3), fallbackReason: null, costUsd: 0.4, durationMs: 1000 }));
  const accepted = acceptGigPlan(workspaceId, id, opts.note === undefined ? "Keep the PoC harmless." : opts.note);
  assert.ok(accepted.ok, "the plan was accepted");
  return accepted.ok ? accepted.plan : (null as never);
}
