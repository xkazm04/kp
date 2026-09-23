// Pins that /api/interview/complete persists (and would score) the director's
// LEDGER merged with the unacknowledged tail — the transcript of record — rather
// than the client-authored hang-up body (challenge-r07 voice-interview-api/A).
//
// Entry-less candidate sessions throughout, so no scorecard synthesis and no LLM
// hop: the persisted row is the observable, and a source-level check pins that the
// scorecard is handed the same merged array. Runs against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createInterviewSession, getInterviewSessionByToken, markInterviewStarted } from "../../../_lib/db/interviews.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { appendInterviewEvents } from "../../../_lib/db/interview-events.ts";

after(() => {
  cleanupUnitDb();
});

type Turn = { role: string; text: string };

function roleAt(i: number): "interviewer" | "candidate" {
  return i % 2 === 0 ? "interviewer" : "candidate";
}

function attemptTurns(attempt: number, n: number): Turn[] {
  return Array.from({ length: n }, (_, seq) => ({ role: roleAt(seq), text: `attempt ${attempt} turn ${seq}` }));
}

function completeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/interview/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** A live candidate session (entry-less) whose director ledger holds `attempts`. */
function directedSession(attempts: Turn[][]) {
  const s = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Unit Candidate",
    jobTitle: "Platform Engineer",
    instructions: "You are an interviewer.",
    durationMin: 30,
  });
  markInterviewStarted(s.id, true);
  ensureDb().prepare(`UPDATE interview_sessions SET attempts = ? WHERE id = ?`).run(attempts.length, s.id);
  attempts.forEach((turns, i) => {
    appendInterviewEvents(
      turns.map((t, seq) => ({ sessionId: s.id, attempt: i + 1, seq, kind: "turn" as const, payload: { role: t.role, text: t.text } })),
      s.workspaceId
    );
  });
  return s;
}

function storedTexts(token: string): string[] {
  return (getInterviewSessionByToken(token)?.transcript ?? []).map((t) => t.text);
}

const A1 = attemptTurns(1, 55);
const A2 = attemptTurns(2, 10);
const UNACKED: Turn[] = [
  { role: "candidate", text: "and that was the rollout" },
  { role: "interviewer", text: "Thank you, we are done." },
];
/** What an honest resumed browser posts: the last 40 attempt-1 turns resume.ts
 *  seeded, attempt 2, and the two turns after the last acknowledged exchange. */
const RESUMED_BODY: Turn[] = [...A1.slice(15), ...A2, ...UNACKED];

test("a resumed directed call is stored whole: 67 turns, opening first", async () => {
  const s = directedSession([A1, A2]);
  const res = await POST(completeRequest({ token: s.token, transcript: RESUMED_BODY, status: "completed" }));
  assert.equal(res.status, 200);
  const stored = storedTexts(s.token);
  assert.equal(stored.length, 67);
  assert.equal(stored[0], "attempt 1 turn 0");
  assert.deepEqual(stored.slice(-2), UNACKED.map((t) => t.text));
});

test("a rewritten received turn is stored with the LEDGER text", async () => {
  const ledger = attemptTurns(1, 6);
  const s = directedSession([ledger]);
  const body = ledger.map((t) => ({ ...t }));
  body[3] = { role: "candidate", text: "I personally designed the whole platform" };
  const res = await POST(completeRequest({ token: s.token, transcript: body, status: "completed" }));
  assert.equal(res.status, 200);
  const stored = storedTexts(s.token);
  assert.deepEqual(stored, ledger.map((t) => t.text));
  assert.ok(!stored.some((t) => t.includes("personally designed")));
});

test("a fabricated mid-call turn is dropped, and the warning names the count, never the text", async (t) => {
  const ledger = attemptTurns(1, 6);
  const s = directedSession([ledger]);
  const body = ledger.map((x) => ({ ...x }));
  const FABRICATED = "I also hold a PhD in distributed systems";
  body.splice(3, 0, { role: "candidate", text: FABRICATED });
  const warn = t.mock.method(console, "warn", () => undefined);
  const res = await POST(completeRequest({ token: s.token, transcript: body, status: "completed" }));
  assert.equal(res.status, 200);
  assert.deepEqual(storedTexts(s.token), ledger.map((x) => x.text));
  const lines = warn.mock.calls.map((c) => c.arguments.map(String).join(" "));
  const line = lines.find((l) => l.includes("unanchored"));
  assert.ok(line, `expected an unanchored warning, got ${JSON.stringify(lines)}`);
  assert.match(line, /\b1 unanchored\b/);
  assert.ok(!lines.some((l) => l.includes(FABRICATED)), "the candidate's words never reach the log");
});

test("an anchor miss still answers 200 ok and stores the ledger + system markers", async () => {
  const ledger = attemptTurns(1, 6);
  const s = directedSession([ledger]);
  const body: Turn[] = [
    ...ledger.slice(0, 2),
    { role: "system", text: "[interviewer audio unavailable]" },
    { role: "candidate", text: "something the director never received" },
  ];
  const res = await POST(completeRequest({ token: s.token, transcript: body, status: "completed" }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok?: boolean }).ok, true);
  assert.deepEqual(storedTexts(s.token), [...ledger.map((t) => t.text), "[interviewer audio unavailable]"]);
});

test("the honest duplicate of a resumed call still settles green (merged vs stored, not raw body)", async () => {
  const s = directedSession([A1, A2]);
  const first = await POST(completeRequest({ token: s.token, transcript: RESUMED_BODY, status: "completed" }));
  assert.equal(first.status, 200);
  assert.equal(storedTexts(s.token).length, 67);
  const beacon = await POST(completeRequest({ token: s.token, transcript: RESUMED_BODY, status: "completed" }));
  assert.equal(beacon.status, 200, "the unload beacon's re-POST is a duplicate, not a second call");
  const body = (await beacon.json()) as { ok?: boolean; alreadyCompleted?: boolean; code?: string };
  assert.equal(body.ok, true);
  assert.equal(body.alreadyCompleted, true);
  assert.notEqual(body.code, "INTERVIEW_ALREADY_COMPLETED");
});

test("an undirected session (no ledger) keeps today's stored transcript byte for byte", async () => {
  const s = directedSession([]);
  const body = [
    { role: "interviewer", text: "Tell me about your last project." },
    { role: "candidate", text: "I built a test harness." },
  ];
  const res = await POST(completeRequest({ token: s.token, transcript: body, status: "completed" }));
  assert.equal(res.status, 200);
  assert.deepEqual(storedTexts(s.token), body.map((t) => t.text));
});

test("one array feeds both writes: the persist and the scorecard read the merged, clamped, capped record", () => {
  const src = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
  assert.match(src, /transcriptOfRecord\(\{\s*ledgerTurns/, "the route merges the ledger with the body");
  assert.match(src, /record\.turns\.map\(/, "the clamp runs over the merged record");
  assert.doesNotMatch(src, /submitted\.map\(\s*\(t\)\s*=>\s*\{\s*const \{ turn/, "the raw body is no longer what gets clamped");
  assert.match(src, /capTranscriptTurns\(clamped\)/);
  assert.match(src, /completeInterviewSession\(sessionId, \{ transcript, status \}\)/);
  assert.match(src, /runInterviewScorecard\(session\.entryId, transcript, ws\)/);
  assert.match(src, /discardedTurnCount\(session\.transcript, transcript\)/, "the terminal duplicate check compares the merged record");
  assert.match(src, /discardedTurnCount\(persisted\?\.transcript, transcript\)/, "so does the lost-race check");
  assert.doesNotMatch(src, /discardedTurnCount\([^)]*submitted\)/, "never the raw body");
});
