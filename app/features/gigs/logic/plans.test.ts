// Pure logic for the Plans tab (plans.ts) and the Pairing tab's milestone (pairing.ts): rounds
// in seat order, the round on screen, polling, failure reasons, the dispatch-relevant
// accepted plan, the legacy split, and the milestone's goals.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GigPlan, GigPlanRow } from "@/app/_lib/gigs/types.ts";
import { att, spec } from "./fixtures.ts";
import { gigPersonaOf, isLegacyRouted, milestoneRows, milestoneTotals, personaModelLabel } from "./pairing.ts";
import { planDuration, planFailure, planRounds, planView, plansBusy } from "./plans.ts";

const PLAN: GigPlan = { summary: "s", steps: [{ title: "A", doneWhen: "a" }, { title: "B", doneWhen: "b" }, { title: "C", doneWhen: "c" }], decisions: [], risks: [], effortHours: null, questions: [] };

function row(id: string, seat: GigPlanRow["seat"], status: GigPlanRow["status"], createdAt: string, p: Partial<GigPlanRow> = {}): GigPlanRow {
  return { id, gigId: "g", seat, model: "m", effort: null, status, plan: status === "ready" ? PLAN : null, fallbackReason: null, costUsd: null, durationMs: null, note: null, acceptedAt: null, progress: null, createdAt, updatedAt: createdAt, ...p };
}
const R1 = "2026-09-28T10:00:00.000Z";
const R2 = "2026-09-29T10:00:00.000Z";

test("planRounds: rows fold into rounds newest first, each in the lineup's seat order", () => {
  const rounds = planRounds([row("s2", "sonnet", "ready", R2), row("f2", "fable", "running", R2), row("o1", "opus", "failed", R1), row("o2", "opus", "queued", R2)]);
  assert.deepEqual(rounds.map((r) => r.createdAt), [R2, R1]);
  assert.deepEqual(rounds[0].rows.map((r) => r.seat), ["opus", "fable", "sonnet"]);
});

test("planView: the newest round, or the accepted plan's; ready counts the shown round; busy while any seat writes", () => {
  const open = planView([row("f2", "fable", "ready", R2), row("o2", "opus", "running", R2), row("s2", "sonnet", "failed", R2), row("f1", "fable", "ready", R1)]);
  assert.equal(open.shown?.createdAt, R2);
  assert.equal(open.earlier.length, 1);
  assert.equal(open.ready, 1);
  assert.equal(open.busy, true);
  assert.equal(open.accepted, null);
  const accepted = planView([row("f2", "fable", "failed", R2), row("f1", "fable", "ready", R1, { acceptedAt: R1 })]);
  assert.equal(accepted.shown?.createdAt, R1, "the accepted plan's round stays on screen");
  assert.equal(accepted.accepted?.id, "f1");
  assert.equal(plansBusy([row("x", "opus", "ready", R2)]), false, "polling stops when nothing writes");
  assert.equal(planView(null).shown, null);
  assert.equal(planView([]).ready, 0);
});

test("planFailure: the four named reasons, llm_error's type as detail, anything else shown as its code", () => {
  assert.deepEqual(planFailure("no_provider"), { key: "no_provider", detail: null });
  assert.deepEqual(planFailure("budget"), { key: "budget", detail: null });
  assert.deepEqual(planFailure("llm_error:timeout"), { key: "llm_error", detail: "timeout" });
  assert.deepEqual(planFailure("spawn_failed"), { key: null, detail: "spawn_failed" });
  assert.deepEqual(planFailure(null), { key: null, detail: null });
  assert.deepEqual(planDuration(16_400), { m: 0, s: 16 });
  assert.deepEqual(planDuration(72_000), { m: 1, s: 12 });
  assert.equal(planDuration(null), null);
});

test("pairing: the gig's own persona, the legacy split, the model label, the milestone's goals", () => {
  const own = { ...spec("p1", "x", "active"), gigId: "g" };
  assert.equal(gigPersonaOf({ id: "g", specialistId: "p1" }, [spec("n", "web", "active"), own])?.id, "p1");
  assert.equal(gigPersonaOf({ id: "g", specialistId: "n" }, [spec("n", "web", "active")]), null, "a niche specialist is never the gig's persona");
  assert.equal(isLegacyRouted(null, att("a", "g", "drafted")), true, "worked by a niche specialist before pairing");
  assert.equal(isLegacyRouted(null, null), false, "a fresh gig is paired at dispatch");
  assert.equal(isLegacyRouted(own, att("a", "g", "drafted")), false);
  assert.equal(personaModelLabel(), "Opus 5.5 · high");
  const accepted = row("f1", "fable", "ready", R1, {
    acceptedAt: R1,
    progress: { milestoneId: "m", updatedAt: R2, goals: [{ stepIndex: 0, goalId: "g0", status: "done", progress: 80, note: null }, { stepIndex: 1, goalId: "g1", status: "blocked", progress: 140, note: "waiting on access" }] },
  });
  const rows = milestoneRows(accepted);
  assert.deepEqual(rows.map((r) => [r.status, r.progress]), [["done", 100], ["blocked", 100], ["open", 0]], "done reads 100, progress is clamped, an unreported step is open at 0");
  assert.equal(rows[1].note, "waiting on access");
  assert.deepEqual(milestoneTotals(rows), { done: 1, total: 3, pct: 67 });
  assert.deepEqual(milestoneRows(null), []);
});
