// The Clock Wheel's model: drawers (capped, so legibility never grows with the roster), phases, spend honesty, the
// wheel's angles, the urgency order, the ledger, the verdict a card carries and the reason a metric has no data.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentAggregates, AgentStatus } from "@/app/_lib/db/agents.ts";
import type { AgentRosterEntry, NextAction } from "./agentsWorkforceLogic.ts";
import {
  EXIT_STEPS, FAN, LIFE_STEPS, MAX_ROLE_DRAWERS, PHASES, bridgeView, cardNo, groupDrawers, ledgerOf, needing, noDataReason,
  parseEvent, phaseOf, sorter, spendOf, totalsOf, verdictOf, wheelOf, byUrgency, type Moves,
} from "./workforceModel.ts";

const NOW = new Date("2026-10-01T09:00:00Z");

function agg(p: Partial<AgentAggregates> = {}): AgentAggregates {
  return { runs: 0, successes: 0, failures: 0, successRate: null, costUsd: 0, monthCostUsd: 0, tokensIn: 0, tokensOut: 0, connectors: {}, lastActivityAt: null, ...p };
}

function hire(id: string, p: Partial<AgentRosterEntry> = {}): AgentRosterEntry {
  return {
    id, workspaceId: "w", jobId: "job-1", jobTitle: "Support", intakeId: null, appMaster: null, personaId: null, personaName: id, requestId: null,
    status: "active" as AgentStatus, spec: { mission: "m", connectors: [] }, fit: null, metrics: [], budgetUsd: 100, createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: null, lastReportAt: null, aggregates: agg(), backbone: null, kpiDeltas: null, lastDecision: null, pendingApprovalSince: null,
    ...p,
  } as unknown as AgentRosterEntry;
}

const none: NextAction = { kind: "none" };
const moves = (entries: [string, NextAction][]): Moves => new Map(entries);

test("drawers: a role per job, gig hires and App masters apart, the rest folded so the wheel never grows", () => {
  const agents: AgentRosterEntry[] = [];
  for (let j = 0; j < 20; j++) for (let k = 0; k < 3; k++) agents.push(hire(`h-${j}-${k}`, { jobId: `job-${j}`, jobTitle: `Role ${j}` }));
  agents.push(hire("gig-1", { jobId: "" }), hire("am-1", { jobId: "", intakeId: "i", appMaster: { population: "agent", scopeRung: 1, probationDays: 30, autopilotMode: null, memory: null } }));
  const d = groupDrawers(agents, moves([]));
  assert.equal(d.length, MAX_ROLE_DRAWERS + 3, "6 role drawers + more roles + gigs + App masters, at any roster size");
  assert.deepEqual(d.slice(-3).map((x) => x.key), ["other", "gigs", "appmaster"]);
  assert.equal(d.find((x) => x.key === "other")?.count, (20 - MAX_ROLE_DRAWERS) * 3);
  assert.equal(d.reduce((t, x) => t + x.count, 0), agents.length, "every hire is in exactly one drawer");
  const small = groupDrawers(agents.slice(0, 3), moves([]));
  assert.equal(small.length, 1);
  assert.equal(small[0].title, "Role 0");
});

test("drawers: the ones that need the operator come first, then the larger", () => {
  const a = [hire("a1", { jobId: "j-a", jobTitle: "A" }), hire("a2", { jobId: "j-a", jobTitle: "A" }), hire("b1", { jobId: "j-b", jobTitle: "B" })];
  const d = groupDrawers(a, moves([["b1", { kind: "redispatch", target: { jobId: "j-b" } }]]));
  assert.deepEqual(d.map((x) => x.title), ["B", "A"]);
  assert.equal(d[0].need, 1);
});

test("phase: the bridge outranks everything, stuck is a failed or lapsed hire, retired is out", () => {
  assert.equal(phaseOf(hire("a"), { kind: "repair_bridge" }), "cutoff");
  assert.equal(phaseOf(hire("a", { status: "pending_approval" }), { kind: "approval_lapsed" }), "stuck");
  assert.equal(phaseOf(hire("a", { status: "failed" }), none), "stuck");
  assert.equal(phaseOf(hire("a", { status: "pending_approval" }), { kind: "approve_in_personas", hoursLeft: 4 }), "waiting");
  assert.equal(phaseOf(hire("a", { status: "onboarding" }), none), "probation");
  assert.equal(phaseOf(hire("a", { status: "retired" }), none), "out");
  assert.equal(PHASES.length, 6);
});

test("spend: uncosted is not zero, a rate is against the hire's own budget, no budget is no fraction", () => {
  assert.equal(spendOf(hire("a")).unmeasured, true, "nothing ever costed");
  const s = spendOf(hire("a", { aggregates: agg({ costUsd: 50, monthCostUsd: 85 }), budgetUsd: 100 }));
  assert.equal(s.unmeasured, false);
  assert.equal(s.tone, "near");
  assert.equal(spendOf(hire("a", { aggregates: agg({ costUsd: 50, monthCostUsd: 120 }) })).tone, "over");
  const nb = spendOf(hire("a", { budgetUsd: null, aggregates: agg({ costUsd: 5, monthCostUsd: 5 }) }));
  assert.equal(nb.frac, null);
  assert.equal(nb.tone, "unknown");
});

test("urgency: the declared priority, then the soonest approval clock, then name", () => {
  const a = hire("a"), b = hire("b"), c = hire("c"), d = hire("d");
  const m = moves([["a", { kind: "approve_in_personas", hoursLeft: 9 }], ["b", { kind: "approve_in_personas", hoursLeft: 2 }], ["c", { kind: "approval_lapsed" }], ["d", { kind: "check_reporter", reason: "silent" }]]);
  assert.deepEqual([a, b, c, d].sort(byUrgency(m)).map((x) => x.id), ["c", "b", "a", "d"]);
  assert.deepEqual(needing([a, b, c, d, hire("e")], m).map((x) => x.id), ["c", "b", "a", "d"], "a hire with no move is not 'needing'");
  assert.deepEqual(needing([a, b, c, d], m, "check_reporter").map((x) => x.id), ["d"]);
});

test("wheel: drawers keep their places whatever the roster size, a one-hire drawer keeps a floor, cards fit inside their drawer", () => {
  const mk = (n: number) => {
    const agents = Array.from({ length: n }, (_, i) => hire(`h${i}`, { jobId: `job-${i % 3}`, jobTitle: `R${i % 3}` }));
    return wheelOf(groupDrawers(agents, moves([])), moves([]));
  };
  const w14 = mk(14);
  const w400 = mk(400);
  assert.equal(w14.drawers.length, w400.drawers.length);
  for (const d of w400.drawers) {
    assert.ok(d.a0 >= FAN.a0 && d.a1 <= FAN.a1 + 0.001, "inside the fan");
    assert.ok(d.a1 - d.a0 >= 10, "every drawer stays hittable");
  }
  for (const c of w400.cards) assert.ok(c.theta >= c.drawer.a0 && c.theta <= c.drawer.a1, "a card stands inside its drawer");
  assert.ok(w400.cards[0].pitch < w14.cards[0].pitch, "only how closely the cards stand changes");
  assert.deepEqual(wheelOf([], moves([])), { drawers: [], cards: [] });
});

test("ledger: newest first; what was never recorded is stated", () => {
  const never = ledgerOf(hire("a", { createdAt: "2026-09-01T00:00:00.000Z" }));
  assert.deepEqual(never.absent, ["never_heard"]);
  assert.equal(never.events.length, 1);
  const heard = ledgerOf(hire("a", { lastReportAt: "2026-09-10T00:00:00.000Z" }));
  assert.deepEqual(heard.absent, ["none_accepted"]);
  const full = ledgerOf(hire("a", { lastReportAt: "2026-09-10T00:00:00.000Z", lastDecision: { event: "activated", at: "2026-09-05T00:00:00.000Z" }, aggregates: agg({ lastActivityAt: "2026-09-09T00:00:00.000Z" }) }));
  assert.deepEqual(full.events.map((e) => e.kind), ["report", "activity", "decision", "mint"]);
  assert.deepEqual(full.absent, []);
});

test("events: poll stems and known stems are words, anything else is shown as named", () => {
  assert.deepEqual(parseEvent("poll:active"), { kind: "poll", status: "active" });
  assert.deepEqual(parseEvent("probation_review:activated"), { kind: "known", event: "probation_review" });
  assert.deepEqual(parseEvent("approved"), { kind: "known", event: "approved" });
  assert.deepEqual(parseEvent("something_new"), { kind: "other", event: "something_new" });
  assert.equal(parseEvent(undefined), null);
});

test("verdict: no data is neither met nor missed; an App master is its backbone, incomplete is a dash", () => {
  const none = verdictOf(hire("a", { metrics: [{ key: "success_rate", label: "S", target: 80, unit: "%", direction: "gte" }] }), NOW);
  assert.equal(none.kind, "metrics");
  assert.equal(none.mark, "unknown");
  const am = hire("m", { jobId: "", appMaster: { population: "agent", scopeRung: 1, probationDays: 30, autopilotMode: null, memory: null }, backbone: { verdict: "incomplete" } as AgentRosterEntry["backbone"] });
  const v = verdictOf(am, NOW);
  assert.equal(v.kind, "backbone");
  assert.equal(v.mark, "unknown", "incomplete is a dash, never a soft pass");
  assert.equal(verdictOf(hire("m2", { jobId: "", appMaster: am.appMaster, backbone: null }), NOW).mark, "unknown");
});

test("noData: the honest reason, never a zero", () => {
  assert.equal(noDataReason(hire("a"), "success_rate"), "never_heard");
  assert.equal(noDataReason(hire("a", { lastReportAt: "2026-09-10T00:00:00.000Z" }), "success_rate"), "none_accepted");
  assert.equal(noDataReason(hire("a", { aggregates: agg({ lastActivityAt: "x" }) }), "cost_per_task"), "uncosted");
  assert.equal(noDataReason(hire("a", { aggregates: agg({ lastActivityAt: "x" }) }), "success_rate"), "no_runs");
  assert.equal(noDataReason(hire("a", { aggregates: agg({ lastActivityAt: "x", runs: 3, successRate: 1 }) }), "something_else"), "no_reading");
});

test("bridge: unknown while loading is not a dead bridge; never paired is not down", () => {
  assert.equal(bridgeView(null).state, "unknown");
  assert.equal(bridgeView({ paired: true, hasKey: true, lastOkAt: "x" }).condition, "live");
  assert.equal(bridgeView({ paired: false, hasKey: true, lastOkAt: "x" }).state, "down");
  assert.equal(bridgeView({ paired: false, hasKey: false, lastOkAt: null }).state, "never");
});

test("sort, totals, steps and numbering", () => {
  const a = hire("a", { personaName: "Zed", aggregates: agg({ monthCostUsd: 5 }) }), b = hire("b", { personaName: "Amy", aggregates: agg({ monthCostUsd: 9 }) });
  const m = moves([["a", { kind: "redispatch", target: { jobId: "j" } }]]);
  assert.deepEqual([b, a].sort(sorter("needs", m)).map((x) => x.id), ["a", "b"]);
  assert.deepEqual([a, b].sort(sorter("spend", m)).map((x) => x.id), ["b", "a"]);
  assert.deepEqual([a, b].sort(sorter("name", m)).map((x) => x.id), ["b", "a"]);
  const t = totalsOf([a, b, hire("r", { status: "retired", budgetUsd: 50 })]);
  assert.equal(t.budget, 200, "only live hires' budgets are summed");
  assert.equal(t.live, 2);
  assert.deepEqual([...LIFE_STEPS, ...EXIT_STEPS].length, 7, "the seven statuses are all on a rack");
  assert.equal(cardNo(hire("agent-mun6j9nt-d8abfc")), "D8ABFC");
});
