// The candidate's own control over their interview audio, driven through the REAL
// handlers: the boolean the public status projection gains, and the deletion door
// behind it.
//
// What is pinned:
//   • the GET projection carries `hasInterviewRecording` and NOTHING else about the
//     audio — no file name, no size, no date, no attempt count;
//   • DELETE removes the FILE and leaves the deletion record, with `candidate_request`
//     as its reason (never `erasure`: the application stands);
//   • it is IDEMPOTENT — a second click, or a candidate who never had a recording,
//     settles green rather than 404ing, because "nothing to delete" must neither read
//     as a failure nor confirm which candidates were recorded;
//   • an unknown status token answers the same coded refusal its siblings do.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET as STATUS_GET } from "./[token]/route.ts";
import { DELETE as RECORDING_DELETE } from "./[token]/recording/route.ts";
import { ensureDb } from "../../_lib/db/core.ts";
import { createPipelineEntry } from "../../_lib/db/pipeline.ts";
import { claimInterviewRecordingChunk, createInterviewSession, interviewRecordingsForSession, markInterviewStarted } from "../../_lib/db/interviews.ts";
import { getOrCreateStatusLink } from "../../_lib/application-status-store.ts";
import { recordingFilePath } from "../../_lib/interview-recording.ts";
import { MAX_RECORDING_SESSION_BYTES, recordingFileName } from "../../_lib/interview-recording-paths.ts";

after(() => cleanupUnitDb());

const WS = "workspace";
let ip = 0;

function recordedCandidate(opts: { withAudio?: boolean } = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { entry } = createPipelineEntry({
    candidateId: `c-sr-${suffix}`,
    candidateLabel: "Status Candidate",
    jobId: `job-sr-${suffix}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
  });
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: "Status Candidate",
    jobTitle: "Backend Engineer",
    workspaceId: WS,
  });
  assert.ok(markInterviewStarted(session.id, true));
  let file: string | null = null;
  if (opts.withAudio !== false) {
    file = recordingFileName(session.id, 1, "audio/webm")!;
    const claim = claimInterviewRecordingChunk({
      sessionId: session.id,
      workspaceId: WS,
      attempt: 1,
      chunk: 0,
      bytes: 128,
      mime: "audio/webm",
      file,
      maxSessionBytes: MAX_RECORDING_SESSION_BYTES,
    });
    assert.equal(claim.outcome, "claimed");
    const full = recordingFilePath(WS, file)!;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(128, 3));
  }
  return { entry, session, token: getOrCreateStatusLink(entry.id), file };
}

function status(token: string) {
  return STATUS_GET(new NextRequest(`http://localhost/api/status/${token}`, { headers: { "x-forwarded-for": `10.4.0.${++ip}` } }), {
    params: Promise.resolve({ token }),
  });
}

function del(token: string) {
  return RECORDING_DELETE(
    new NextRequest(`http://localhost/api/status/${token}/recording`, { method: "DELETE", headers: { "x-forwarded-for": `10.5.0.${++ip}` } }),
    { params: Promise.resolve({ token }) }
  );
}

test("the status projection gains a BOOLEAN and nothing else about the audio", async () => {
  const c = recordedCandidate();
  const res = await status(c.token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.hasInterviewRecording, true);
  // The whole projection, stated: adding a field here is a deliberate act, and a file
  // name or a date would be a fact about the interview on a public, token-only wire.
  assert.deepEqual(
    Object.keys(body).sort(),
    ["company", "hasInterviewRecording", "jobTitle", "letter", "relayConfigured", "status", "updatedAt"],
    "the candidate projection must not grow silently"
  );
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /\.webm/, "no file name on the public wire");
  assert.doesNotMatch(serialized, new RegExp(c.session.id), "no session id either");
});

test("a candidate with no recording is offered no control", async () => {
  const c = recordedCandidate({ withAudio: false });
  const body = (await (await status(c.token)).json()) as { hasInterviewRecording?: boolean };
  assert.equal(body.hasInterviewRecording, false);
  // …and the door still settles green rather than 404ing, so a stale page cannot make
  // a candidate believe their request failed.
  const res = await del(c.token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, deleted: 0 });
});

test("the candidate's delete removes the file, keeps the record, and is idempotent", async () => {
  const c = recordedCandidate();
  assert.equal(fs.existsSync(recordingFilePath(WS, c.file!)!), true);

  const res = await del(c.token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, deleted: 1 });
  assert.equal(fs.existsSync(recordingFilePath(WS, c.file!)!), false, "the audio itself is gone");

  const meta = interviewRecordingsForSession(c.session.id, WS)![0]!;
  assert.equal(meta.deleteReason, "candidate_request", "the reason is the candidate's own request, not an erasure");
  assert.ok(meta.deletedAt, "the deletion IS the record");
  assert.equal(meta.bytes, 128, "what we held is still stated");

  // The recording_deleted event rides beside it.
  const { listInterviewEvents } = await import("../../_lib/db/interview-events.ts");
  const events = listInterviewEvents(c.session.id, WS, { kinds: ["recording_deleted"] });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.payload.reason, "candidate_request");

  // The control disappears from the page…
  const after1 = (await (await status(c.token)).json()) as { hasInterviewRecording?: boolean };
  assert.equal(after1.hasInterviewRecording, false);
  // …and a second click settles green.
  assert.deepEqual(await (await del(c.token)).json(), { ok: true, deleted: 0 });
  assert.equal(listInterviewEvents(c.session.id, WS, { kinds: ["recording_deleted"] }).length, 1, "no second deletion record");
});

test("an unknown status token answers the same coded refusal its siblings do", async () => {
  const res = await del("as-not-a-real-token");
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "STATUS_LINK_INVALID");
  assert.ok(ensureDb(), "the store was reachable — the 404 is a decision, not an outage");
});
