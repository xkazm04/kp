// Pins WHICH attempt /api/interview/complete bills for.
//
// A 'failed' session stays reconnectable on purpose (a dropped call — silent mic,
// provider hiccup — should be retryable), and markInterviewStarted COALESCEs
// started_at, so the row keeps the FIRST connect. Billing wall-clock from that
// timestamp charged a candidate's next-day retry for the whole gap: elapsed ran to
// ~1500 minutes and clamped straight to the 2× ceiling, so a short second call
// debited the maximum reservable minutes on the one meter with real per-unit cost
// (and stamped the matching inflated cost estimate on the llm_usage ledger).
//
// The billed minutes are asserted through the ledger row's cost estimate, which
// voiceUsageRow derives from the SAME clamped minute count the meter is debited
// with (minute-prices.ts) — so this pins the number without needing a configured
// billing provider.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import); entry-less sessions, so no scorecard synthesis and no LLM.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createInterviewSession, markInterviewStarted } from "../../../_lib/db/interviews.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { aggregateLlmUsage } from "../../../_lib/db/llm.ts";
import { voiceMinuteCostUsd } from "../../../_lib/voice/minute-prices.ts";

before(() => {
  delete process.env.OPENAI_REALTIME_MODEL;
});

after(() => {
  cleanupUnitDb();
});

const BOOKED_MIN = 20;
const TRANSCRIPT = [
  { role: "interviewer", text: "Tell me about your last project." },
  { role: "candidate", text: "I built a test harness." },
];

function completeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/interview/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Total voice cost booked on the ledger so far — the delta across one completion
 *  is that completion's billed minutes at the provider's per-minute price. */
function voiceCostUsd(): number {
  return aggregateLlmUsage()
    .filter((r) => r.useCase === "interview_realtime")
    .reduce((sum, r) => sum + r.costUsd, 0);
}

/** A live (in_progress) session whose FIRST connect was `hoursAgo` hours ago and
 *  whose latest connect is now — exactly the row a reconnected retry leaves. */
function reconnectedSession(hoursAgo: number) {
  const session = createInterviewSession({ provider: "openai", mode: "test", jobTitle: "QA Engineer", durationMin: BOOKED_MIN });
  markInterviewStarted(session.id, true);
  if (hoursAgo > 0) {
    // Only started_at is moved back: markInterviewStarted re-stamps updated_at on
    // every connect, so "now" is where the current attempt began.
    ensureDb()
      .prepare(`UPDATE interview_sessions SET started_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), session.id);
  }
  return session;
}

test("a reconnected retry bills the CURRENT attempt, not the whole life of the link", async () => {
  const before = voiceCostUsd();
  const session = reconnectedSession(25); // first connect yesterday, reconnect now
  const res = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(res.status, 200);

  const billed = voiceCostUsd() - before;
  assert.ok(
    Math.abs(billed - voiceMinuteCostUsd("openai", 1)) < 1e-9,
    `a just-started retry must bill the 1-minute floor, not the ceiling — billed ${billed}`
  );
  assert.notEqual(
    Math.round(billed * 1e6),
    Math.round(voiceMinuteCostUsd("openai", BOOKED_MIN * 2) * 1e6),
    "billing from the original started_at clamps to the 2× reservation ceiling"
  );
});

test("a single-attempt session is unaffected — started_at and updated_at are one write", async () => {
  const before = voiceCostUsd();
  const session = reconnectedSession(0);
  const res = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(res.status, 200);
  assert.ok(Math.abs(voiceCostUsd() - before - voiceMinuteCostUsd("openai", 1)) < 1e-9, "still the 1-minute floor");
});

test("a stale in_progress row with no reconnect still bills from started_at", async () => {
  // Defensive half of the reading: updated_at is trusted ONLY while the row is
  // in_progress. Here BOTH timestamps are old (a zombie connect that finally
  // finalizes), so the elapsed time is real and the 2× clamp is what bounds it.
  const before = voiceCostUsd();
  const session = reconnectedSession(0);
  const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
  ensureDb().prepare(`UPDATE interview_sessions SET started_at = ?, updated_at = ? WHERE id = ?`).run(old, old, session.id);
  const res = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(res.status, 200);
  const billed = voiceCostUsd() - before;
  assert.ok(
    Math.abs(billed - voiceMinuteCostUsd("openai", BOOKED_MIN * 2)) < 1e-9,
    `a genuinely long call is still bounded by the 2× ceiling — billed ${billed}`
  );
});
