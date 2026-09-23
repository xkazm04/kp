// The hired-agent transition door (challenge-r06 agents-api/A). Every status
// write on hired_agents — the push report, the pull refresh, the dispatch — goes
// through ONE closed from→to table, ONE mapping of Personas' two vocabularies,
// and ONE compare-and-swap write. These cases pin the three halves:
//
//   1. the table is total over AGENT_STATUSES and refuses the backwards moves
//      (a dead hire cannot be revived; a failed dispatch cannot be onboarded);
//   2. the push event and the poll status map through lifecycleTarget(), so a
//      new Personas word is one row, not a third private mapping;
//   3. the store write re-asserts the status it was computed from, and a lost
//      race changes nothing on the row.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { AGENT_STATUSES, createHiredAgent, getHiredAgent, listAgentActivity, transitionHiredAgent, updateHiredAgentStatus } from "../db/agents.ts";
import { AGENT_TRANSITIONS, canTransition, lifecycleTarget } from "./lifecycle.ts";

after(() => cleanupUnitDb());

const SPEC = { name: "Door Agent", mission: "m", systemPromptDraft: "s", connectors: [], maxTurns: null };

test("transition table: backwards moves out of a terminal state are refused, forward ones are legal", () => {
  assert.equal(canTransition("retired", "active"), false);
  assert.equal(canTransition("rejected", "active"), false);
  assert.equal(canTransition("failed", "onboarding"), false);
  assert.equal(canTransition("pending_approval", "onboarding"), true);
  assert.equal(canTransition("onboarding", "active"), true);
  assert.equal(canTransition("dispatched", "failed"), true);
});

test("transition table: every AgentStatus declares its exits (an exhaustive Record)", () => {
  assert.deepEqual(Object.keys(AGENT_TRANSITIONS).sort(), [...AGENT_STATUSES].sort());
  for (const [from, exits] of Object.entries(AGENT_TRANSITIONS)) {
    for (const to of exits) {
      assert.ok((AGENT_STATUSES as readonly string[]).includes(to), `${from} → ${to} names a real status`);
    }
  }
});

test("lifecycleTarget: both Personas vocabularies map through ONE function", () => {
  assert.equal(lifecycleTarget({ kind: "push", event: "activated" }), "active");
  assert.equal(lifecycleTarget({ kind: "poll", status: "activated" }), "active");
  assert.equal(lifecycleTarget({ kind: "poll", status: "ACTIVE" }), "active", "the poll word is case-folded");
  assert.equal(lifecycleTarget({ kind: "poll", status: "expired" }), "failed");
  assert.equal(lifecycleTarget({ kind: "poll", status: "teleported" }), null, "an unknown poll status writes nothing");
  assert.equal(lifecycleTarget({ kind: "push", event: "probation_review", decision: "extended" }), "onboarding");
  assert.equal(lifecycleTarget({ kind: "push", event: "probation_review", decision: "activated" }), "active");
  assert.equal(lifecycleTarget({ kind: "push", event: "probation_review", decision: null }), null);
});

test("store CAS: a transition computed from a stale status changes nothing on the row", () => {
  const ws = "ws-door-cas";
  const agent = createHiredAgent({ jobId: "job-door-1", jobTitle: "Role", spec: SPEC }, ws);
  updateHiredAgentStatus(agent.id, "active", { personaId: "p-live", personaName: "Live" }, ws);
  const before = getHiredAgent(agent.id, ws)!;

  const res = transitionHiredAgent(
    agent.id,
    { from: "pending_approval", to: "onboarding", event: "approved", personaId: "p-other", personaName: "Other" },
    ws
  );
  assert.equal(res.applied, false);
  assert.equal(res.current, "active");

  const after = getHiredAgent(agent.id, ws)!;
  assert.equal(after.status, "active");
  assert.equal(after.personaId, "p-live", "a refused transition does not backfill the persona");
  assert.equal(after.updatedAt, before.updatedAt, "a refused transition does not touch updated_at");

  const refused = listAgentActivity(agent.id, 10, ws).filter((r) => r.kind === "lifecycle");
  assert.equal(refused.length, 1);
  assert.ok(refused[0]!.status?.startsWith("refused:approved"), `ledger says refused, got ${refused[0]!.status}`);
});

test("store CAS: an applied transition writes ONE lifecycle row carrying {from, to} — the entered-at stamp", () => {
  const ws = "ws-door-ledger";
  const agent = createHiredAgent({ jobId: "job-door-2", jobTitle: "Role", spec: SPEC }, ws);

  const res = transitionHiredAgent(agent.id, { from: "dispatched", to: "pending_approval", event: "dispatched", requestId: "req-1" }, ws);
  assert.equal(res.applied, true);
  assert.equal(res.current, "pending_approval");
  assert.equal(res.agent?.requestId, "req-1");

  const rows = listAgentActivity(agent.id, 10, ws).filter((r) => r.kind === "lifecycle");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "dispatched");
  assert.deepEqual((rows[0]!.raw as { transition?: unknown }).transition, { from: "dispatched", to: "pending_approval" });
});

test("store CAS: an illegal move is refused even when the status it names is current", () => {
  const ws = "ws-door-illegal";
  const agent = createHiredAgent({ jobId: "job-door-3", jobTitle: "Role", spec: SPEC }, ws);
  updateHiredAgentStatus(agent.id, "rejected", {}, ws);

  const res = transitionHiredAgent(agent.id, { from: "rejected", to: "active", event: "activated" }, ws);
  assert.equal(res.applied, false);
  assert.equal(res.current, "rejected");
  assert.equal(getHiredAgent(agent.id, ws)?.status, "rejected");
});
