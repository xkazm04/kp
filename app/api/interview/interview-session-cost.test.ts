// Direction 3 — what an interview COST reaches the recruiter, and an unknown cost
// never reads as a free one.
//
// Voice minutes are the one meter in this product with a real per-unit cost, and the
// two providers differ by roughly 60% per minute. /api/interview/complete has written
// that cost to the usage ledger since tiger F1 - `llm_usage.request_id` IS the session
// id, use case `interview_realtime` - and it had exactly zero readers outside the
// aggregate Models panel. The recruiter deciding whether to run another screen could
// not see what the last one cost.
//
// The half that needed care is the THREE-state answer. `null` is unknown (no ledger
// row yet, or an unpriced provider, which minute-prices.ts writes as cost_usd NULL by
// design) and `0` is a real, asserted zero (a self-hosted provider served the call, so
// no per-minute credits were spent). Collapsing unknown to 0 would tell a recruiter
// the priciest meter in the product is free - the exact failure the repo law names.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { createInterviewSession, listRecentInterviewSessions } from "../../_lib/db/interviews.ts";
import { insertLlmUsage } from "../../_lib/db/llm.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

const WS = "team-interview-cost";

function summaryFor(id: string) {
  const row = listRecentInterviewSessions(WS, 500).find((s) => s.id === id);
  assert.ok(row, `expected session ${id} in the workspace ledger`);
  return row;
}

test("a session with no ledger row costs UNKNOWN, not zero", () => {
  const s = createInterviewSession({ provider: "openai", mode: "candidate", durationMin: 20, workspaceId: WS });
  assert.equal(summaryFor(s.id).costUsd, null, "no completion yet means no answer, and no answer is not $0");
});

test("a completed session carries the ledger's cost", () => {
  const s = createInterviewSession({ provider: "openai", mode: "candidate", durationMin: 20, workspaceId: WS });
  insertLlmUsage({
    useCase: "interview_realtime",
    provider: "openai",
    model: "gpt-realtime",
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    costUsd: 2.7,
    source: "llm",
    outcome: "ok",
    requestId: s.id,
  });
  assert.equal(summaryFor(s.id).costUsd, 2.7);
});

test("a REAL zero survives - a self-hosted call cost nothing, and says so", () => {
  const s = createInterviewSession({ provider: "elevenlabs", mode: "candidate", durationMin: 20, workspaceId: WS });
  insertLlmUsage({
    useCase: "interview_realtime",
    provider: "elevenlabs",
    model: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    // voiceMinuteCostUsd returns exactly this for a self-hosted provider.
    costUsd: 0,
    source: "llm",
    outcome: "ok",
    requestId: s.id,
  });
  assert.equal(summaryFor(s.id).costUsd, 0, "0 is an assertion about a free call, not a missing number");
});

test("an UNPRICED provider's row still reads as unknown", () => {
  const s = createInterviewSession({ provider: "openai", mode: "candidate", durationMin: 20, workspaceId: WS });
  insertLlmUsage({
    useCase: "interview_realtime",
    provider: "openai",
    model: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    // The base.py convention minute-prices.ts mirrors: metered by quantity, unpriced
    // in money. A NULL cost is not a zero cost.
    costUsd: null,
    source: "llm",
    outcome: "ok",
    requestId: s.id,
  });
  assert.equal(summaryFor(s.id).costUsd, null);
});

test("a reconnect that bills twice reports the TOTAL, not one attempt", () => {
  const s = createInterviewSession({ provider: "openai", mode: "candidate", durationMin: 20, workspaceId: WS });
  for (const cost of [1.2, 0.8]) {
    insertLlmUsage({
      useCase: "interview_realtime",
      provider: "openai",
      model: "gpt-realtime",
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      costUsd: cost,
      source: "llm",
      outcome: "ok",
      requestId: s.id,
    });
  }
  assert.equal(summaryFor(s.id).costUsd, 2, "what the call cost in total is the honest answer");
});

test("another use case's row on the same id is not this interview's cost", () => {
  const s = createInterviewSession({ provider: "openai", mode: "candidate", durationMin: 20, workspaceId: WS });
  insertLlmUsage({
    useCase: "analysis",
    provider: "anthropic",
    model: "claude",
    inputTokens: 10,
    outputTokens: 10,
    cachedTokens: null,
    costUsd: 99,
    source: "llm",
    outcome: "ok",
    requestId: s.id,
  });
  assert.equal(summaryFor(s.id).costUsd, null, "the join is keyed by use case as well as by request id");
});

test("the cost join stays inside the tenant the list is scoped to", () => {
  const mine = createInterviewSession({ provider: "openai", mode: "candidate", durationMin: 20, workspaceId: WS });
  const theirs = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    durationMin: 20,
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  const ids = listRecentInterviewSessions(WS, 500).map((s) => s.id);
  assert.ok(ids.includes(mine.id));
  assert.ok(!ids.includes(theirs.id), "adding the cost join must not widen what the list returns");
});
