// DELETE /api/interview/sessions/[id]/recording — the recruiter's deletion door (WP4),
// driven through the REAL handlers: audio is uploaded through the candidate's own
// public door, deleted through this one, and the disk is checked afterwards.
//
// What it pins: the file is actually unlinked, the ledger row SURVIVES stamped with
// `recruiter` (the deletion is the record), a `recording_deleted` event is appended,
// playback stops working immediately, a second call is idempotent, one attempt can be
// deleted without touching the other, and a foreign or unknown session answers the same
// coded 404 the playback door gives.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { DELETE } from "./[id]/recording/route.ts";
import { POST as UPLOAD } from "../recording/route.ts";
import { GET as PLAY } from "../recording/[sessionId]/route.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { createInterviewSession, interviewRecordingsForSession, markInterviewStarted } from "../../../_lib/db/interviews.ts";
import { listInterviewEvents } from "../../../_lib/db/interview-events.ts";
import { createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import { setDecisionConfig } from "../../../_lib/decision-config-store.ts";
import { recordingFilePath } from "../../../_lib/interview-recording.ts";
import { recordingFileName } from "../../../_lib/interview-recording-paths.ts";

after(() => cleanupUnitDb());

// The caller's tenant in open mode IS the default workspace, so the fixtures live there.
const WS = "workspace";
setDecisionConfig("compliance", { jurisdiction: "eu", interviewRecordingOffered: true }, WS, "team");

type Body = { ok?: boolean; deleted?: number; code?: string };

function recordedCall() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { entry } = createPipelineEntry({
    candidateId: `c-del-${suffix}`,
    candidateLabel: "Delete Candidate",
    jobId: `job-del-${suffix}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
  });
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: "Delete Candidate",
    jobTitle: "Backend Engineer",
    workspaceId: WS,
  });
  assert.ok(markInterviewStarted(session.id, true));
  ensureDb().prepare(`UPDATE interview_sessions SET recording_consent_at = ? WHERE id = ?`).run(new Date().toISOString(), session.id);
  return { entry, session };
}

function upload(session: { id: string; token: string }, attempt = 1, chunk = 0, bytes = 512): Promise<Response> {
  return UPLOAD(
    new NextRequest("http://localhost/api/interview/recording", {
      method: "POST",
      headers: new Headers({
        "content-type": "audio/webm;codecs=opus",
        "x-kp-token": session.token,
        "x-kp-session": session.id,
        "x-kp-attempt": String(attempt),
        "x-kp-chunk": String(chunk),
      }),
      body: new Uint8Array(bytes),
    })
  );
}

function del(sessionId: string, attempt?: number): Promise<Response> {
  const url = new URL(`http://localhost/api/interview/sessions/${sessionId}/recording`);
  if (attempt !== undefined) url.searchParams.set("attempt", String(attempt));
  return DELETE(new NextRequest(url, { method: "DELETE" }), { params: Promise.resolve({ id: sessionId }) });
}

const filePath = (sessionId: string, attempt: number) => recordingFilePath(WS, recordingFileName(sessionId, attempt, "audio/webm")!)!;

test("the recruiter's deletion unlinks the file, keeps the record, and closes playback", async () => {
  const { session } = recordedCall();
  assert.equal((await upload(session)).status, 200);
  assert.equal(fs.existsSync(filePath(session.id, 1)), true, "the audio is on disk to begin with");
  assert.equal((await PLAY(new NextRequest(`http://localhost/x/${session.id}`), { params: Promise.resolve({ sessionId: session.id }) })).status, 200);

  const res = await del(session.id, 1);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, deleted: 1 });

  assert.equal(fs.existsSync(filePath(session.id, 1)), false, "the file is gone");
  const rows = interviewRecordingsForSession(session.id, WS) ?? [];
  assert.equal(rows.length, 1, "the ledger row survives — the deletion IS the record");
  assert.ok(rows[0].deletedAt);
  assert.equal(rows[0].deleteReason, "recruiter", "the vocabulary value that had no door now has one");

  const events = listInterviewEvents(session.id, WS, { kinds: ["recording_deleted"] });
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.reason, "recruiter");

  const gone = await PLAY(new NextRequest(`http://localhost/x/${session.id}`), { params: Promise.resolve({ sessionId: session.id }) });
  assert.equal(gone.status, 404);
  assert.equal(((await gone.json()) as Body).code, "INTERVIEW_RECORDING_NOT_FOUND");
});

test("one attempt can be deleted without touching the other, and a repeat is idempotent", async () => {
  const { session } = recordedCall();
  assert.equal((await upload(session, 1)).status, 200);
  assert.equal((await upload(session, 2)).status, 200);

  assert.deepEqual(await (await del(session.id, 1)).json(), { ok: true, deleted: 1 });
  assert.equal(fs.existsSync(filePath(session.id, 1)), false);
  assert.equal(fs.existsSync(filePath(session.id, 2)), true, "attempt 2 is untouched");

  // The same call again: attempt 1 holds no live audio any more, so it is a 404 for the
  // same reason an unknown id is — there is nothing of that name to delete.
  const repeat = await del(session.id, 1);
  assert.equal(repeat.status, 404);
  assert.equal(((await repeat.json()) as Body).code, "INTERVIEW_RECORDING_NOT_FOUND");

  // With no attempt at all: everything still live.
  assert.deepEqual(await (await del(session.id)).json(), { ok: true, deleted: 1 });
  assert.equal(fs.existsSync(filePath(session.id, 2)), false);
  const rows = interviewRecordingsForSession(session.id, WS) ?? [];
  assert.equal(rows.length, 2, "both deletions are on the record");
  assert.equal(rows.every((r) => r.deleteReason === "recruiter"), true);
});

test("a foreign session, an unknown id and a session with no audio all answer the same coded 404", async () => {
  const silent = recordedCall();
  const foreign = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Other Team Candidate",
    workspaceId: `other-team-${Math.random().toString(36).slice(2, 8)}`,
  });
  ensureDb()
    .prepare(`UPDATE interview_sessions SET recordings_json = ? WHERE id = ?`)
    .run(
      JSON.stringify([
        { attempt: 1, file: `${foreign.id}-a1.webm`, bytes: 10, mime: "audio/webm", startedAt: new Date().toISOString(), endedAt: null, partial: false, deletedAt: null, deleteReason: null },
      ]),
      foreign.id
    );

  for (const [what, res] of [
    ["another team's session", await del(foreign.id)],
    ["an id that names nothing", await del("iv-does-not-exist")],
    ["a session that was never recorded", await del(silent.session.id)],
  ] as const) {
    assert.equal(res.status, 404, what);
    assert.equal(((await res.json()) as Body).code, "INTERVIEW_RECORDING_NOT_FOUND", what);
  }
  // The foreign row is still there: the refusal deleted nothing.
  assert.equal((interviewRecordingsForSession(foreign.id, foreign.workspaceId) ?? [])[0]?.deletedAt ?? null, null);
});
