// What /api/interview/complete tells a caller whose transcript it will NOT save.
//
// Every "this session is already finished" case answered `{ok:true,
// alreadyCompleted:true}`. That is right for the honest duplicate — the End
// fetch racing its own unload beacon, a network retry, a replayed
// sessionStorage stash — and a retrying client must settle rather than error.
// It was a green lie for the SECOND live call on the same link: its own
// conversation, its own minutes, its own turns, none of them in the stored
// transcript, and its candidate read "saved".
//
// Also pins the last three bare-English refusals on this PUBLIC candidate door.
// /connect was held to the coded line in wave 21a because the candidate arrives
// from a link rendered in their own language; /complete is the same candidate,
// one hang-up later, and still answered "token is required" / "session not
// found" / a hardcoded consent sentence.
//
// Entry-less sessions throughout, so no scorecard synthesis and no LLM hop.
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createInterviewSession, markInterviewStarted } from "../../../_lib/db/interviews.ts";

after(() => {
  cleanupUnitDb();
});

const WINNER = [
  { role: "interviewer", text: "Tell me about your last project." },
  { role: "candidate", text: "I built a test harness." },
  { role: "interviewer", text: "What was hard about it?" },
  { role: "candidate", text: "Flaky selectors." },
];

const SECOND_TAB = [
  { role: "interviewer", text: "Tell me about your last project." },
  { role: "candidate", text: "I rewrote our billing importer." },
  { role: "interviewer", text: "Why did it need rewriting?" },
];

function completeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/interview/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function startedSession(consent = true) {
  const s = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Unit Candidate",
    jobTitle: "QA Engineer",
    instructions: "You are an interviewer.",
    durationMin: 8,
  });
  markInterviewStarted(s.id, consent);
  return s;
}

/** Land the winning transcript, leaving the session `completed`. */
async function completeWith(token: string, transcript: unknown[]) {
  const res = await POST(completeRequest({ token, transcript, status: "completed" }));
  assert.equal(res.status, 200, "the first completion must land");
  return res;
}

test("the loser is told its turns were discarded, never that they were saved", async () => {
  const s = startedSession();
  await completeWith(s.token, WINNER);

  const res = await POST(completeRequest({ token: s.token, transcript: SECOND_TAB, status: "completed" }));
  assert.equal(res.status, 409);
  const body = (await res.json()) as { ok?: boolean; code?: string; discardedTurns?: number };
  assert.equal(body.ok, false, "a discarded transcript must not be reported as a success");
  assert.equal(body.code, "INTERVIEW_ALREADY_COMPLETED");
  // The whole call, not the diverging tail: none of it is in the scored record.
  assert.equal(body.discardedTurns, SECOND_TAB.length);
});

test("the honest duplicate still settles green — a retrying client must not be made to error", async () => {
  const s = startedSession();
  await completeWith(s.token, WINNER);

  const dup = await POST(completeRequest({ token: s.token, transcript: WINNER, status: "completed" }));
  assert.equal(dup.status, 200);
  assert.equal(((await dup.json()) as { alreadyCompleted?: boolean }).alreadyCompleted, true);
});

test("the unload beacon's earlier snapshot is a duplicate, not a loser", async () => {
  const s = startedSession();
  await completeWith(s.token, WINNER);

  // The beacon fires a turn or two behind the End fetch it raced.
  const beacon = await POST(completeRequest({ token: s.token, transcript: WINNER.slice(0, 2), status: "failed" }));
  assert.equal(beacon.status, 200);
  assert.equal(((await beacon.json()) as { alreadyCompleted?: boolean }).alreadyCompleted, true);
});

test("an empty finalize after a real one still never overwrites, and loses nothing", async () => {
  const s = startedSession();
  await completeWith(s.token, WINNER);

  const empty = await POST(completeRequest({ token: s.token, transcript: [], status: "failed" }));
  assert.equal(empty.status, 200);
  const body = (await empty.json()) as { session?: { transcript?: unknown[] } };
  assert.equal(body.session?.transcript?.length, WINNER.length, "the stored transcript stands");
});

// ── The three bare-English refusals ─────────────────────────────────────────

test("a missing token answers a CODE, not 'token is required'", async () => {
  const res = await POST(completeRequest({ transcript: WINNER }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "INTERVIEW_LINK_NOT_FOUND");
});

test("an unresolvable token — and a mismatched sessionId — answer the same code", async () => {
  const bad = await POST(completeRequest({ token: "iv_not_a_real_token", transcript: WINNER }));
  assert.equal(bad.status, 404);
  assert.equal(((await bad.json()) as { code?: string }).code, "INTERVIEW_LINK_NOT_FOUND");

  const s = startedSession();
  const mismatch = await POST(completeRequest({ token: s.token, sessionId: "iv_someone_else", transcript: WINNER }));
  assert.equal(mismatch.status, 404);
  assert.equal(((await mismatch.json()) as { code?: string }).code, "INTERVIEW_LINK_NOT_FOUND");
});

test("an unconsented candidate transcript is refused with a code, not a hardcoded sentence", async () => {
  const s = startedSession(false); // started without recording consent
  const res = await POST(completeRequest({ token: s.token, transcript: WINNER, status: "completed" }));
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { code?: string }).code, "INTERVIEW_CONSENT_REQUIRED");
});

test("no refusal on this public door forwards a raw English message the client would paint", async () => {
  // The client resolves `errors.<CODE>` in the reader's language; a refusal with
  // no code leaves it with nothing but the server's English.
  for (const body of [{}, { token: "nope" }]) {
    const res = await POST(completeRequest(body));
    const json = (await res.json()) as { code?: string };
    assert.ok(json.code, `every refusal carries a code (${JSON.stringify(body)})`);
  }
});
