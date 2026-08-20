// Pins the /api/interview/complete response contract: this is a PUBLIC token
// route (public-routes.ts allow-lists it), so the candidate's own hang-up POST
// must get back a PROJECTION, never the interview_sessions row.
//
// The leak this locks out: `session` was the whole InterviewSession, whose
// `instructions` is the recruiter's PRIVATE interviewer brief (prep-chronology
// goals, the role-intake intent digest, and on a submission debrief literal
// “Internal red flag — never say this aloud: …” lines built in interview-run.ts)
// and whose `runOfShow` carries the same gap annotations. /connect is already
// held to exactly this line by connect-response-contract.test.ts; /complete was
// the back door, one Network tab away from the candidate.
//
// The fixture brief/run-of-show markers are deliberately the SAME ones the
// /connect contract test uses, so the two responses are pinned against one
// vocabulary of interviewer-internal annotations.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import); entry-less sessions, so no scorecard synthesis and no LLM.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createInterviewSession, markInterviewStarted } from "../../../_lib/db/interviews.ts";

after(() => {
  cleanupUnitDb();
});

const RED_FLAG = "Internal red flag — never say this aloud: claims 8 skills, largely self-taught";
const GAP_NOTE = "Test automation fundamentals (missing must-have)";
const PRIVATE_BRIEF = `You are an interviewer. ${GAP_NOTE}. Probe provenance: coursework only. ${RED_FLAG}. Ask about it obliquely.`;
const PRIVATE_RUN_OF_SHOW = [GAP_NOTE, "Motivation (aspiration mismatch)"];

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

/** A started candidate session carrying the private brief, with no entry (so the
 *  scorecard path — and its LLM hop — stays out of this test). */
function startedCandidateSession() {
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Unit Candidate",
    jobTitle: "QA Engineer",
    instructions: PRIVATE_BRIEF,
    runOfShow: PRIVATE_RUN_OF_SHOW,
    durationMin: 20,
  });
  markInterviewStarted(session.id, true); // records consent_at, the /complete persist invariant
  return session;
}

function assertNoInterviewerInternals(body: unknown, where: string) {
  const raw = JSON.stringify(body);
  for (const marker of ["never say this aloud", "red flag", "missing must-have", "aspiration mismatch", "coursework only"]) {
    assert.ok(!raw.includes(marker), `${where}: “${marker}” must never reach the candidate's browser`);
  }
}

test("the completion response is a projection — no interviewer brief, no run-of-show, no tenant", async () => {
  const session = startedCandidateSession();
  const res = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; session: Record<string, unknown> };
  assert.equal(body.ok, true);

  assertNoInterviewerInternals(body, "fresh completion");
  assert.ok(!("instructions" in body.session), "the private brief field is gone from the projection");
  assert.ok(!("runOfShow" in body.session), "the annotated run-of-show is gone from the projection");
  assert.ok(!("workspaceId" in body.session), "the tenant id is not candidate-facing");
  assert.ok(!("entryId" in body.session) && !("jobId" in body.session), "internal pipeline ids stay off the public wire");

  // …and the projection still carries what the wire actually needs: the browser
  // reads res.ok, the voice eval harness reads session.transcript's length.
  assert.equal(body.session.status, "completed");
  assert.equal((body.session.transcript as unknown[]).length, TRANSCRIPT.length);
});

test("the already-completed retry answers with the same projection", async () => {
  const session = startedCandidateSession();
  await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  const retry = await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT }));
  assert.equal(retry.status, 200);
  const body = (await retry.json()) as { alreadyCompleted?: boolean; session: Record<string, unknown> };
  assert.equal(body.alreadyCompleted, true);
  assertNoInterviewerInternals(body, "already-completed retry");
  assert.ok(!("instructions" in body.session) && !("runOfShow" in body.session));
});

test("the empty-transcript-after-a-real-one guard answers with the same projection", async () => {
  const session = startedCandidateSession();
  // First a FAILED finalize with a real transcript (no candidate turns → 'failed',
  // so the row stays writable), then the stray empty finalize that guard catches.
  await POST(completeRequest({ token: session.token, transcript: TRANSCRIPT, status: "failed" }));
  const stray = await POST(completeRequest({ token: session.token, transcript: [] }));
  assert.equal(stray.status, 200);
  const body = (await stray.json()) as { alreadyCompleted?: boolean; session: Record<string, unknown> };
  assert.equal(body.alreadyCompleted, true, "the empty finalize must not overwrite the stored transcript");
  assertNoInterviewerInternals(body, "empty-finalize guard");
  assert.ok(!("instructions" in body.session) && !("runOfShow" in body.session));
});
