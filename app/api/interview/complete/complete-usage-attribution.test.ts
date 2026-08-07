// Behavioral test for the voice-minute cost attribution (backlog item 16 /
// tiger F1): completing an interview session must write an ATTRIBUTED
// llm_usage ledger row — use_case "interview_realtime", the serving
// provider/model from the session row, a per-minute cost estimate, and the
// session id as request_id — alongside the quantity-only interview_minutes
// meter debit. The Models UsagePanel reads aggregateLlmUsage, so the same
// assertion here proves the voice spend shows up with zero extra UI work.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the
// first project import); no provider HTTP is involved (complete is pure
// persistence + billing).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createInterviewSession, markInterviewStarted } from "../../../_lib/db/interviews.ts";
import { aggregateLlmUsage } from "../../../_lib/db/llm.ts";
import { voiceMinuteCostUsd } from "../../../_lib/voice/minute-prices.ts";

before(() => {
  // Deterministic model attribution: no machine-local overrides may leak in.
  delete process.env.OPENAI_REALTIME_MODEL;
  delete process.env.ELEVENLABS_AGENT_ID;
});

after(() => {
  cleanupUnitDb();
});

function completeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/interview/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** A started test-mode session (no entryId → no scorecard side effects). */
function startedSession(provider: "openai" | "elevenlabs") {
  const session = createInterviewSession({ provider, mode: "test", jobTitle: "QA Engineer", durationMin: 8 });
  markInterviewStarted(session.id, true);
  return session;
}

const TRANSCRIPT = [
  { role: "interviewer", text: "Tell me about your last project." },
  { role: "candidate", text: "I built a test harness." },
];

function voiceRows() {
  return aggregateLlmUsage().filter((r) => r.useCase === "interview_realtime");
}

test("completing an OpenAI session writes the attributed ledger row the usage panel aggregates", async () => {
  const session = startedSession("openai");
  const res = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true);

  const rows = voiceRows().filter((r) => r.provider === "openai");
  assert.equal(rows.length, 1, "one aggregate row for the completed voice session");
  // startedAt is ~now, so the elapsed-minute clamp bills the 1-minute floor.
  assert.equal(rows[0].calls, 1);
  assert.equal(rows[0].model, "gpt-realtime", "attributed to the env-resolved realtime model");
  assert.equal(rows[0].costUsd, voiceMinuteCostUsd("openai", 1), "cost estimate derives from the billed minutes");
});

test("a duplicate completion POST does not double-write the ledger row", async () => {
  const [rowBefore] = voiceRows().filter((r) => r.provider === "openai");
  const session = startedSession("openai");
  await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  const retry = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(((await retry.json()) as { alreadyCompleted?: boolean }).alreadyCompleted, true);

  const [rowAfter] = voiceRows().filter((r) => r.provider === "openai");
  assert.equal(rowAfter.calls, (rowBefore?.calls ?? 0) + 1, "the retried completion bills exactly once");
});

test("an ElevenLabs session attributes to its provider — the two per-minute costs differ", async () => {
  const session = startedSession("elevenlabs");
  const res = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(res.status, 200);

  const rows = voiceRows().filter((r) => r.provider === "elevenlabs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, null, "no agent id configured → model stays null");
  assert.equal(rows[0].costUsd, voiceMinuteCostUsd("elevenlabs", 1));
  assert.notEqual(rows[0].costUsd, voiceMinuteCostUsd("openai", 1));
});

test("a failed (dropped) call is not billed and writes no ledger row", async () => {
  const countBefore = voiceRows().reduce((n, r) => n + r.calls, 0);
  const session = startedSession("openai");
  const res = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT, status: "failed" }));
  assert.equal(res.status, 200);
  assert.equal(voiceRows().reduce((n, r) => n + r.calls, 0), countBefore, "failed calls never reach the ledger");
});
