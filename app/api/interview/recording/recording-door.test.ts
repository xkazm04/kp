// The two audio doors, driven through the REAL handlers against an isolated DB and a
// throwaway recordings folder.
//
// POST /api/interview/recording is a PUBLIC door reached by a candidate's browser in
// the middle of an interview, so what is pinned here is mostly what it REFUSES: an
// unstorable container, a workspace that does not offer recording, a session whose
// candidate never gave the separate audio consent, a call that is over, a body past the
// per-chunk cap, a replayed chunk index. Every one of them answers a CODE, because the
// portal was opened from an invite written in the candidate's own language.
//
// GET /api/interview/recording/[sessionId] is the recruiter's playback door: operator-
// gated, workspace-scoped, Range-serving, and closed by the read-time retention gate
// whether or not the nightly sweep has run.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { GET } from "./[sessionId]/route.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import {
  createInterviewSession,
  interviewRecordingsForSession,
  markInterviewStarted,
  revokeInterviewSession,
} from "../../../_lib/db/interviews.ts";
import { listInterviewEvents } from "../../../_lib/db/interview-events.ts";
import { setDecisionConfig } from "../../../_lib/decision-config-store.ts";
import { isPublicPath } from "../../../_lib/auth/public-routes.ts";
import { recordingFilePath } from "../../../_lib/interview-recording.ts";
import { recordingFileName } from "../../../_lib/interview-recording-paths.ts";

after(() => cleanupUnitDb());

const WS = "workspace";
setDecisionConfig("compliance", { jurisdiction: "eu", interviewRecordingOffered: true }, WS, "team");

function recordedCall(opts: { consent?: boolean } = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { entry } = createPipelineEntry({
    candidateId: `c-door-${suffix}`,
    candidateLabel: "Door Candidate",
    jobId: `job-door-${suffix}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
  });
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: "Door Candidate",
    jobTitle: "Backend Engineer",
    workspaceId: WS,
  });
  assert.ok(markInterviewStarted(session.id, true));
  if (opts.consent !== false) {
    ensureDb().prepare(`UPDATE interview_sessions SET recording_consent_at = ? WHERE id = ?`).run(new Date().toISOString(), session.id);
  }
  return { entry, session };
}

function upload(
  session: { id: string; token: string },
  opts: { chunk?: number; attempt?: number; bytes?: number; type?: string; token?: string; sessionId?: string } = {}
): Promise<Response> {
  const headers = new Headers({
    "content-type": opts.type ?? "audio/webm;codecs=opus",
    "x-kp-token": opts.token ?? session.token,
    "x-kp-session": opts.sessionId ?? session.id,
    "x-kp-attempt": String(opts.attempt ?? 1),
    "x-kp-chunk": String(opts.chunk ?? 0),
  });
  return POST(
    new NextRequest("http://localhost/api/interview/recording", {
      method: "POST",
      headers,
      body: new Uint8Array(opts.bytes ?? 1024).fill(9),
    })
  );
}

type Body = { ok?: boolean; duplicate?: boolean; code?: string; error?: string };

test("the upload door is public by EXACT path; the playback door one segment below it is not", () => {
  assert.equal(isPublicPath("/api/interview/recording"), true, "the candidate's browser has no session cookie");
  assert.equal(
    isPublicPath("/api/interview/recording/iv-123"),
    false,
    "playback serves candidate audio BACK and must stay behind the operator gate"
  );
});

test("a chunk is stored, the first one leaves a recording_started event, and a replay is acknowledged", async () => {
  const { session } = recordedCall();
  const first = await upload(session, { chunk: 0, bytes: 1024 });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });

  const events = listInterviewEvents(session.id, WS, { kinds: ["recording_started"] });
  assert.equal(events.length, 1, "audio started existing for this call, once");
  assert.equal(events[0]!.payload.mime, "audio/webm");
  assert.equal(events[0]!.attempt, 1);

  const second = await upload(session, { chunk: 1, bytes: 512 });
  assert.equal(second.status, 200);
  assert.equal(listInterviewEvents(session.id, WS, { kinds: ["recording_started"] }).length, 1, "…and only once");

  const file = recordingFilePath(WS, recordingFileName(session.id, 1, "audio/webm")!)!;
  assert.equal(fs.statSync(file).size, 1536);

  // A RETRIED upload of a chunk the server already has: 200, and the file does not grow.
  const replay = await upload(session, { chunk: 1, bytes: 512 });
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as Body).duplicate, true);
  assert.equal(fs.statSync(file).size, 1536, "a replay must never double the audio");
  assert.equal(interviewRecordingsForSession(session.id, WS)![0]!.bytes, 1536);
});

test("only the container formats a browser produces are accepted", async () => {
  const { session } = recordedCall();
  for (const type of ["video/webm", "application/json", "audio/wav", "text/plain"]) {
    const res = await upload(session, { type });
    assert.equal(res.status, 415, type);
    assert.equal(((await res.json()) as Body).code, "INTERVIEW_RECORDING_TYPE_UNSUPPORTED");
  }
  for (const type of ["audio/ogg", "audio/mp4"]) {
    const res = await upload(session, { type });
    assert.equal(res.status, 200, type);
  }
});

test("no audio consent on the row, and no offer from the workspace, both refuse", async () => {
  const unconsented = recordedCall({ consent: false });
  const refused = await upload(unconsented.session);
  assert.equal(refused.status, 403);
  assert.equal(((await refused.json()) as Body).code, "INTERVIEW_RECORDING_NOT_OFFERED");
  assert.equal(interviewRecordingsForSession(unconsented.session.id, WS)?.length ?? 0, 0, "nothing was written");

  // The offer is re-read on EVERY chunk: an operator who switches it off mid-call stops
  // audio being kept from that moment, not from the next interview.
  const live = recordedCall();
  assert.equal((await upload(live.session, { chunk: 0 })).status, 200);
  setDecisionConfig("compliance", { jurisdiction: "eu", interviewRecordingOffered: false }, WS, "team");
  const stopped = await upload(live.session, { chunk: 1 });
  assert.equal(stopped.status, 403);
  assert.equal(((await stopped.json()) as Body).code, "INTERVIEW_RECORDING_NOT_OFFERED");
  setDecisionConfig("compliance", { jurisdiction: "eu", interviewRecordingOffered: true }, WS, "team");
});

test("a revoked link takes no more audio", async () => {
  const { session } = recordedCall();
  assert.ok(revokeInterviewSession(session.id));
  const res = await upload(session);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as Body).code, "INTERVIEW_RECORDING_CLOSED");
});

test("the final flush lands after the call finalizes, and stops being accepted later", async () => {
  const { session } = recordedCall();
  const db = ensureDb();
  db.prepare(`UPDATE interview_sessions SET status = 'completed', ended_at = ? WHERE id = ?`).run(new Date().toISOString(), session.id);
  assert.equal((await upload(session, { chunk: 0 })).status, 200, "MediaRecorder's last chunk arrives after /complete");

  db.prepare(`UPDATE interview_sessions SET ended_at = ? WHERE id = ?`).run(new Date(Date.now() - 10 * 60_000).toISOString(), session.id);
  const late = await upload(session, { chunk: 1 });
  assert.equal(late.status, 409);
  assert.equal(((await late.json()) as Body).code, "INTERVIEW_RECORDING_CLOSED");
});

test("a chunk past the per-chunk byte cap is refused on the BYTES READ", async () => {
  const { session } = recordedCall();
  const res = await upload(session, { bytes: 2 * 1024 * 1024 + 1 });
  assert.equal(res.status, 413);
  const body = (await res.json()) as Body & { maxBytes?: number };
  assert.equal(body.code, "PAYLOAD_TOO_LARGE");
  assert.equal(body.maxBytes, 2 * 1024 * 1024);
  assert.equal(interviewRecordingsForSession(session.id, WS)?.length ?? 0, 0, "an over-long chunk claims nothing");
});

test("a malformed envelope, a wrong session id and an unknown token all answer one refusal", async () => {
  const { session } = recordedCall();
  const other = recordedCall();
  for (const [what, res] of [
    ["another session's id under this token", await upload(session, { sessionId: other.session.id })],
    ["an unknown token", await upload(session, { token: "tk-not-a-real-token" })],
    ["a non-numeric attempt", await POST(
      new NextRequest("http://localhost/api/interview/recording", {
        method: "POST",
        headers: new Headers({
          "content-type": "audio/webm",
          "x-kp-token": session.token,
          "x-kp-session": session.id,
          "x-kp-attempt": "../etc",
          "x-kp-chunk": "0",
        }),
        body: new Uint8Array(8),
      })
    )],
  ] as const) {
    assert.ok(res.status === 400 || res.status === 404, `${what}: ${res.status}`);
    assert.equal(((await res.json()) as Body).code, "INTERVIEW_LINK_NOT_FOUND", what);
  }
});

// ---- playback ---------------------------------------------------------------------

function play(sessionId: string, opts: { range?: string; attempt?: number } = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/interview/recording/${sessionId}`);
  if (opts.attempt !== undefined) url.searchParams.set("attempt", String(opts.attempt));
  const headers = new Headers(opts.range ? { range: opts.range } : {});
  return GET(new NextRequest(url, { method: "GET", headers }), { params: Promise.resolve({ sessionId }) });
}

test("playback streams the audio, serves a Range, and 404s for a foreign or absent recording", async () => {
  const { session } = recordedCall();
  await upload(session, { chunk: 0, bytes: 1000 });

  const whole = await play(session.id);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("content-type"), "audio/webm");
  assert.equal(whole.headers.get("content-length"), "1000");
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal(whole.headers.get("cache-control"), "private, no-store");
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);

  // An <audio> element seeking.
  const part = await play(session.id, { range: "bytes=100-199" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 100-199/1000");
  assert.equal((await part.arrayBuffer()).byteLength, 100);

  const bad = await play(session.id, { range: "bytes=5000-" });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), "bytes */1000");

  // An attempt that was never recorded, and a session with no audio at all.
  assert.equal((await play(session.id, { attempt: 7 })).status, 404);
  const silent = recordedCall();
  const none = await play(silent.session.id);
  assert.equal(none.status, 404);
  assert.equal(((await none.json()) as Body).code, "INTERVIEW_RECORDING_NOT_FOUND");
});

test("playback is closed by the RETENTION gate even before the sweep has run", async () => {
  const { entry, session } = recordedCall();
  await upload(session, { chunk: 0, bytes: 64 });
  assert.equal((await play(session.id)).status, 200);

  // Rejected 31 days ago: the decision clock has run out. Nothing has deleted the file
  // yet — a deployment whose clock never started is exactly the case this gate exists
  // for — and the door must already refuse.
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET status = 'rejected', updated_at = ? WHERE id = ?`).run(
    new Date(Date.now() - 31 * 86_400_000).toISOString(),
    entry.id
  );
  assert.equal(fs.existsSync(recordingFilePath(WS, recordingFileName(session.id, 1, "audio/webm")!)!), true, "the file is still there");
  const gated = await play(session.id);
  assert.equal(gated.status, 404, "past its window is past its window, swept or not");
  assert.equal(((await gated.json()) as Body).code, "INTERVIEW_RECORDING_NOT_FOUND");
});

test("playback never serves another workspace's recording", async () => {
  // The caller's tenant in open mode is the default workspace, so a session filed under
  // a different team must be invisible here rather than served by id.
  const suffix = Math.random().toString(36).slice(2, 8);
  const foreign = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Other Team Candidate",
    jobTitle: "Backend Engineer",
    workspaceId: `other-team-${suffix}`,
  });
  ensureDb()
    .prepare(`UPDATE interview_sessions SET recordings_json = ? WHERE id = ?`)
    .run(
      JSON.stringify([
        { attempt: 1, file: `${foreign.id}-a1.webm`, bytes: 10, mime: "audio/webm", startedAt: new Date().toISOString(), endedAt: null, partial: false, deletedAt: null, deleteReason: null },
      ]),
      foreign.id
    );
  const res = await play(foreign.id);
  assert.equal(res.status, 404);
});
