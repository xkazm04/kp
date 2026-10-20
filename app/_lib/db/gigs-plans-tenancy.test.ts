// Tenant scope for the gig_plans table: a source guard (every statement binds
// workspace_id, as the other gig stores' guards do) and the behaviour on an isolated DB -
// one workspace never reads, accepts or writes another's plan, and a gig accepts once.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createManualGig } from "./gigs.ts";
import { acceptGigPlan, createGigPlanRound, getAcceptedGigPlan, getGigPlan, listGigPlans, setGigPlanProgress, setGigPlanResult, setGigPlanRunning } from "./gigs-plans.ts";

after(() => cleanupUnitDb());

const TABLE = "gig_plans";
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "gigs-plans.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const touches = new RegExp(`\\b(from|into|update|join|delete\\s+from)\\s+${TABLE}\\b`, "i");
const inserts = new RegExp(`\\binsert\\s+(or\\s+\\w+\\s+)?into\\s+${TABLE}\\b`, "i");

test(`every statement on ${TABLE} binds workspace_id (no carve-out)`, () => {
  const touching = sqlBlocks.filter((s) => touches.test(s));
  assert.ok(touching.length >= 8, `expected >=8 ${TABLE} statements, found ${touching.length}`);
  for (const sql of touching) {
    const required = inserts.test(sql) ? /\bworkspace_id\b/i : /\bworkspace_id\s*=\s*\?/i;
    assert.ok(required.test(sql), `a ${TABLE} statement is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
  assert.doesNotMatch(src, /workspaceId\s*:\s*string\s*=/, "no store export defaults its tenant");
});

const input = (url: string) => ({ arena: "freelance" as const, url, title: "Build it", org: null, reward: null, deadlineAt: null, bodyText: "Build it.", tags: [], suspectReasons: [] });
const SEATS = [
  { seat: "fable" as const, model: "claude-fable-5", effort: null },
  { seat: "opus" as const, model: "claude-opus-5-5", effort: "xhigh" },
];
const PLAN = { summary: "Do it.", steps: [{ title: "Step one", doneWhen: "It runs" }], decisions: [], risks: [], effortHours: null, questions: [] };

test("one workspace never sees, accepts or writes another's plans; a gig accepts exactly once", () => {
  const { gig } = createManualGig("ws-a", input("https://example.test/plans/a"));
  assert.equal(createGigPlanRound("ws-b", gig.id, SEATS), null, "ws-b cannot open a round on ws-a's gig");
  const round = createGigPlanRound("ws-a", gig.id, SEATS)!;
  assert.equal(round.length, 2);
  const [a, b] = round;

  assert.equal(getGigPlan("ws-b", a.id), null);
  assert.deepEqual(listGigPlans("ws-b", gig.id), []);
  assert.equal(setGigPlanRunning("ws-b", a.id), null);
  assert.equal(setGigPlanResult("ws-b", a.id, { plan: PLAN, fallbackReason: null, costUsd: 1, durationMs: 5 }), null);
  assert.equal(getGigPlan("ws-a", a.id)!.status, "queued", "ws-b's writes moved nothing");

  assert.equal(setGigPlanRunning("ws-a", a.id)!.status, "running");
  assert.equal(setGigPlanResult("ws-a", a.id, { plan: PLAN, fallbackReason: null, costUsd: 1.25, durationMs: 42 })!.status, "ready");
  assert.equal(setGigPlanResult("ws-a", b.id, { plan: null, fallbackReason: "no_provider", costUsd: null, durationMs: null })!.status, "failed");

  assert.deepEqual(acceptGigPlan("ws-b", a.id, null), { ok: false, reason: "not_found" });
  assert.deepEqual(acceptGigPlan("ws-a", b.id, null), { ok: false, reason: "not_ready" }, "a failed seat cannot be accepted");
  const accepted = acceptGigPlan("ws-a", a.id, "  use Postgres  ");
  assert.ok(accepted.ok);
  assert.equal(accepted.ok && accepted.plan.note, "use Postgres");
  assert.equal(getAcceptedGigPlan("ws-a", gig.id)?.id, a.id);
  assert.equal(getAcceptedGigPlan("ws-b", gig.id), null);
  assert.equal(createGigPlanRound("ws-a", gig.id, SEATS), null, "no new round once a plan is accepted");

  const progress = { milestoneId: "m1", goals: [{ stepIndex: 0, goalId: "g1", status: "in-progress" as const, progress: 40, note: null }], updatedAt: new Date().toISOString() };
  assert.equal(setGigPlanProgress("ws-b", a.id, progress), null);
  assert.equal(setGigPlanProgress("ws-a", a.id, progress)?.progress?.goals[0].progress, 40);
});
