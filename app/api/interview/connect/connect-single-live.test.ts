// ONE LIVE CALL PER LINK.
//
// The token IS the interview session, so two browser tabs on the same emailed
// link both reached /connect: each minted its own provider credentials (two paid
// sessions for one screen), each ran a real conversation, and at hang-up the
// SECOND one to finish was answered `{ok:true, alreadyCompleted:true}` — its
// transcript discarded behind a saved confirmation. The same shape covers a link
// forwarded to a colleague, and a reload racing the call it is reloading.
//
// KEYLESS: the live guard sits above the adapter, so no provider key is set here
// and no network hop happens. The fall-through assertions therefore land on the
// keyless 503 (INTERVIEW_PROVIDER_UNCONFIGURED), which is itself the proof that
// the guard did NOT fire.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import {
  LIVE_INTERVIEW_RECENCY_MIN,
  createInterviewSession,
  markInterviewStarted,
} from "../../../_lib/db/interviews.ts";
import { ensureDb } from "../../../_lib/db/core.ts";

before(() => {
  // Keyless on purpose (see header): neither adapter is configured.
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_AGENT_ID;
});

after(() => {
  cleanupUnitDb();
});

function connectRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/interview/connect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** A candidate session already flipped live by a first /connect. */
function liveSession() {
  const s = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Unit Candidate",
    jobTitle: "QA Engineer",
    instructions: "You are an interviewer.",
    durationMin: 8,
  });
  markInterviewStarted(s.id, true); // in_progress, updated_at = now
  return s;
}

/** Age the row's last-connect stamp so the live window has passed. */
function ageLastConnect(id: string, minutes: number) {
  ensureDb()
    .prepare(`UPDATE interview_sessions SET updated_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - minutes * 60_000).toISOString(), id);
}

test("a second tab on a live link is refused with a code, not a second credential mint", async () => {
  const s = liveSession();
  const res = await POST(connectRequest({ token: s.token, consent: true, provider: "openai" }));
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code?: string; error?: string; retryAfterMin?: number };
  assert.equal(body.code, "INTERVIEW_ALREADY_LIVE");
  // The reader's own sentence needs the number, so it rides as DATA beside the
  // code rather than being smuggled into English prose.
  assert.equal(body.retryAfterMin, LIVE_INTERVIEW_RECENCY_MIN);
});

test("the refusal is the SAME live window /create's reissue guard uses", async () => {
  // One definition of "on the call right now" — otherwise a link could be
  // simultaneously too live to reissue and free to re-dial.
  const s = liveSession();
  ageLastConnect(s.id, LIVE_INTERVIEW_RECENCY_MIN - 1);
  const stillLive = await POST(connectRequest({ token: s.token, consent: true, provider: "openai" }));
  assert.equal(stillLive.status, 409);
  assert.equal(((await stillLive.json()) as { code?: string }).code, "INTERVIEW_ALREADY_LIVE");
});

test("an abandoned session past the grace is re-dialable — a zombie must not lock a candidate out", async () => {
  const s = liveSession();
  ageLastConnect(s.id, LIVE_INTERVIEW_RECENCY_MIN + 5);
  const res = await POST(connectRequest({ token: s.token, consent: true, provider: "openai" }));
  // Keyless, so the request now reaches the adapter gate — which is the point:
  // the live guard let it through.
  assert.notEqual(res.status, 409);
  assert.equal(((await res.json()) as { code?: string }).code, "INTERVIEW_PROVIDER_UNCONFIGURED");
});

test("a fresh, never-started link is untouched by the guard", async () => {
  const s = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    instructions: "You are an interviewer.",
    durationMin: 8,
  });
  const res = await POST(connectRequest({ token: s.token, consent: true, provider: "openai" }));
  assert.equal(((await res.json()) as { code?: string }).code, "INTERVIEW_PROVIDER_UNCONFIGURED");
});

test("a dropped call stays reconnectable — 'failed' is not 'live'", async () => {
  // Every teardown path (hang-up, ICE drop, tab close via the unmount beacon)
  // POSTs /complete, which finalizes a non-substantive call as `failed`. That is
  // the reconnect path, and this guard must never stand in it.
  const s = liveSession();
  ensureDb().prepare(`UPDATE interview_sessions SET status='failed' WHERE id = ?`).run(s.id);
  const res = await POST(connectRequest({ token: s.token, consent: true, provider: "openai" }));
  assert.equal(((await res.json()) as { code?: string }).code, "INTERVIEW_PROVIDER_UNCONFIGURED");
});
