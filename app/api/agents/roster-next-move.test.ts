// GET /api/agents: the two lifecycle facts the roster's next move is derived
// from (challenge-r06 agents-api/B), against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import).
//
//   lastDecision        — the newest APPLIED lifecycle row ({event, at}): the
//                         event name only, never its reason or raw_json; a
//                         refused move is not a decision.
//   pendingApprovalSince — when the hire ENTERED pending_approval: the newest
//                         lifecycle row whose raw.transition.to is
//                         pending_approval (the transition door writes it),
//                         never updated_at.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET as agentsGet } from "./route.ts";
import { createHiredAgent, recordAgentReportReceipt, transitionHiredAgent } from "../../_lib/db/agents.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

const SPEC = { name: "Ledger Agent", mission: "m", systemPromptDraft: "s", connectors: ["gmail"], maxTurns: null };
const WS = DEFAULT_WORKSPACE_ID;

type Row = {
  id: string;
  reportToken?: unknown;
  lastDecision: { event: string; at: string } | null;
  pendingApprovalSince: string | null;
};

async function roster(): Promise<Row[]> {
  const res = await agentsGet();
  assert.equal(res.status, 200);
  return ((await res.json()) as { agents: Row[] }).agents;
}

test("GET /api/agents projects lastDecision and pendingApprovalSince from the lifecycle ledger, and never the token", async () => {
  const quiet = createHiredAgent({ jobId: "job-q", jobTitle: "Quiet", spec: SPEC }, WS);

  const pending = createHiredAgent({ jobId: "job-p", jobTitle: "Pending", spec: SPEC }, WS);
  const entered = transitionHiredAgent(
    pending.id,
    { from: "dispatched", to: "pending_approval", event: "dispatched", requestId: "pr-1", raw: { secret: "raw-only" } },
    WS
  );
  assert.equal(entered.applied, true);
  const before = (await roster()).find((r) => r.id === pending.id);
  assert.ok(before?.pendingApprovalSince, "the dispatch row stamps when the hire entered pending_approval");
  await new Promise((r) => setTimeout(r, 5));
  // Later writes must not restart the approval clock: a poll that re-reads
  // "pending" is an applied SELF-move (pending_approval -> pending_approval,
  // updated_at bumped, a transition row written), but the hire did not ENTER
  // the state again; neither does a liveness receipt.
  const repoll = transitionHiredAgent(pending.id, { from: "pending_approval", to: "pending_approval", event: "poll:pending" }, WS);
  assert.equal(repoll.applied, true);
  recordAgentReportReceipt(pending.id, WS);
  // A refused move is logged but is not a decision and does not reset the clock.
  const refused = transitionHiredAgent(pending.id, { from: "active", to: "retired", event: "retired" }, WS);
  assert.equal(refused.applied, false);

  const onboarding = createHiredAgent({ jobId: "job-o", jobTitle: "Onboarding", spec: SPEC }, WS);
  transitionHiredAgent(onboarding.id, { from: "dispatched", to: "pending_approval", event: "dispatched" }, WS);
  transitionHiredAgent(onboarding.id, { from: "pending_approval", to: "onboarding", event: "approved" }, WS);
  transitionHiredAgent(
    onboarding.id,
    { from: "onboarding", to: "onboarding", event: "probation_review:extended", reason: "needs another sprint" },
    WS
  );

  const rows = await roster();
  for (const row of rows) assert.equal("reportToken" in row, false, "the report token never rides the roster");

  const q = rows.find((r) => r.id === quiet.id);
  assert.equal(q?.lastDecision, null, "no lifecycle row -> no decision");
  assert.equal(q?.pendingApprovalSince, null);

  const p = rows.find((r) => r.id === pending.id);
  assert.equal(p?.lastDecision?.event, "poll:pending", "the refused row is skipped");
  assert.equal(p?.pendingApprovalSince, before?.pendingApprovalSince, "the clock is the entry stamp, not a later write");

  const o = rows.find((r) => r.id === onboarding.id);
  assert.deepEqual(Object.keys(o?.lastDecision ?? {}).sort(), ["at", "event"]);
  assert.equal(o?.lastDecision?.event, "probation_review:extended", "the event name, without its reason text");
  assert.ok(o?.lastDecision?.at && Number.isFinite(Date.parse(o.lastDecision.at)));
  assert.ok(o?.pendingApprovalSince, "an agent that has left pending_approval keeps its historical stamp");
});
