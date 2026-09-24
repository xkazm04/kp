// Opt-in interview recording, driven against a REAL isolated database and a REAL
// throwaway recordings folder (unit-db puts KP_DB_PATH in a temp dir, and the recordings
// root is derived from it — nothing here can touch data/kp.sqlite or data/recordings).
//
// Pins, in the order a recording lives:
//   1. the workspace setting: OFF by default, ON only when an operator turns it on, and
//      OFF again for a config the store cannot read;
//   2. a jurisdiction save does not silently withdraw the offer;
//   3. the chunk ledger: first/append/replay/per-session ceiling;
//   4. the file lands under the workspace's own folder and nowhere else;
//   5. retention SELECTION: decided + 30 days goes, the 180-day backstop goes, a
//      not-yet-due recording is untouched;
//   6. the candidate's own deletion, and the GDPR erasure path, both remove the FILE and
//      keep the deletion record;
//   7. the status projection's boolean.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { createPipelineEntry, anonymizeEntry } from "./db/pipeline.ts";
import {
  claimInterviewRecordingChunk,
  createInterviewSession,
  interviewRecordingsForSession,
  listInterviewRecordingsForEntry,
  markInterviewStarted,
} from "./db/interviews.ts";
import { listInterviewEvents } from "./db/interview-events.ts";
import { setDecisionConfig, getDecisionConfig } from "./decision-config-store.ts";
import type { ComplianceRule } from "./decision-config-schema.ts";
import {
  deleteEntryRecordings,
  entryHasRecording,
  isInterviewRecordingOffered,
  recordingFilePath,
  recordingsRoot,
  runInterviewRecordingRetention,
} from "./interview-recording.ts";
import { MAX_RECORDING_SESSION_BYTES, recordingFileName } from "./interview-recording-paths.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;
const WS = "workspace";

/** A live, audio-consented candidate call on a pipeline entry. */
function recordedCall(opts: { workspaceId?: string; label?: string } = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { entry } = createPipelineEntry({
    candidateId: `c-rec-${suffix}`,
    candidateLabel: opts.label ?? "Rec Candidate",
    jobId: `job-rec-${suffix}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
    contact: "rec@example.com",
  });
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: opts.label ?? "Rec Candidate",
    jobTitle: "Backend Engineer",
    workspaceId: opts.workspaceId ?? WS,
  });
  assert.ok(markInterviewStarted(session.id, true));
  ensureDb().prepare(`UPDATE interview_sessions SET recording_consent_at = ? WHERE id = ?`).run(new Date().toISOString(), session.id);
  return { entry, session };
}

/** Claim + write one chunk the way the upload door does. */
function storeChunk(sessionId: string, workspaceId: string, attempt: number, chunk: number, bytes: number) {
  const file = recordingFileName(sessionId, attempt, "audio/webm")!;
  const claim = claimInterviewRecordingChunk({
    sessionId,
    workspaceId,
    attempt,
    chunk,
    bytes,
    mime: "audio/webm",
    file,
    maxSessionBytes: MAX_RECORDING_SESSION_BYTES,
  });
  if (claim.outcome === "claimed") {
    const full = recordingFilePath(workspaceId, file)!;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, Buffer.alloc(bytes, 7));
  }
  return { claim, file };
}

// ---- 1 + 2: the setting -----------------------------------------------------------

test("recording is OFF until an operator turns it on, and a jurisdiction save does not withdraw it", () => {
  const ws = "ws-setting";
  assert.equal(isInterviewRecordingOffered(ws), false, "no deployment starts holding candidate audio");

  setDecisionConfig("compliance", { jurisdiction: "eu", interviewRecordingOffered: true }, ws, "team");
  assert.equal(isInterviewRecordingOffered(ws), true);

  // THE REGRESSION THIS EXISTS FOR: the compliance row is written wholesale, and its
  // original writer (the jurisdiction picker) sends `{ jurisdiction }` alone. Without
  // the store's preservation that click would silently stop recording mid-interview.
  setDecisionConfig("compliance", { jurisdiction: "us" }, ws, "team");
  assert.equal(isInterviewRecordingOffered(ws), true, "changing the jurisdiction must not withdraw the audio offer");
  assert.equal(getDecisionConfig<ComplianceRule>("compliance", ws).jurisdiction, "us");

  // …and an EXPLICIT false still turns it off, so the toggle is not one-way.
  setDecisionConfig("compliance", { jurisdiction: "us", interviewRecordingOffered: false }, ws, "team");
  assert.equal(isInterviewRecordingOffered(ws), false);

  // A row that will not parse falls back to the code default, which is OFF.
  ensureDb(); // the decision store opens the same file
  assert.equal(isInterviewRecordingOffered("ws-never-configured"), false);
});

test("a plain compliance rule is stored without the recording key at all", () => {
  const ws = "ws-shape";
  setDecisionConfig("compliance", { jurisdiction: "eu" }, ws, "team");
  const stored = getDecisionConfig<ComplianceRule>("compliance", ws);
  assert.equal("interviewRecordingOffered" in stored, false, "absence IS off — no phantom key on an untouched workspace");
});

// ---- 3 + 4: the chunk ledger ------------------------------------------------------

test("chunks append in order, a replay is acknowledged, and the file lands in the workspace's own folder", () => {
  const { session } = recordedCall();
  const first = storeChunk(session.id, WS, 1, 0, 1000);
  assert.equal(first.claim.outcome, "claimed");
  assert.equal(first.claim.first, true, "the first chunk of an attempt creates the record");

  const second = storeChunk(session.id, WS, 1, 1, 500);
  assert.equal(second.claim.outcome, "claimed");
  assert.equal(second.claim.first, false);
  assert.equal(second.claim.meta?.bytes, 1500, "bytes accumulate across chunks");

  // A RETRIED upload of a chunk the server already has: acknowledged, never appended —
  // otherwise a flaky network doubles the audio.
  const replay = storeChunk(session.id, WS, 1, 1, 500);
  assert.equal(replay.claim.outcome, "duplicate");
  const replayOlder = storeChunk(session.id, WS, 1, 0, 1000);
  assert.equal(replayOlder.claim.outcome, "duplicate", "any index at or below the cursor is a replay");
  assert.equal(interviewRecordingsForSession(session.id, WS)?.[0]?.bytes, 1500, "a replay changes nothing");

  // The file is under <recordings root>/<workspace>/, named from server ids only.
  const full = recordingFilePath(WS, first.file)!;
  assert.equal(path.dirname(full), path.join(recordingsRoot(), WS));
  assert.equal(fs.statSync(full).size, 1500);

  // A foreign workspace resolves to NOTHING — not to another team's folder.
  assert.equal(interviewRecordingsForSession(session.id, "other-team"), null);
  assert.equal(recordingFilePath("../escape", first.file), null);
  assert.equal(recordingFilePath(WS, "../../kp.sqlite"), null);

  // The first chunk left a recording_started event on the append-only record.
  const events = listInterviewEvents(session.id, WS, { kinds: ["recording_started"] });
  assert.equal(events.length, 0, "the STORE writes no event; the door does (see the route test)");
});

test("a session's audio budget is a ceiling, and hitting it marks the recording partial", () => {
  const { session } = recordedCall();
  const file = recordingFileName(session.id, 1, "audio/webm")!;
  const claim = claimInterviewRecordingChunk({
    sessionId: session.id,
    workspaceId: WS,
    attempt: 1,
    chunk: 0,
    bytes: 1000,
    mime: "audio/webm",
    file,
    maxSessionBytes: 1500,
  });
  assert.equal(claim.outcome, "claimed");
  const over = claimInterviewRecordingChunk({
    sessionId: session.id,
    workspaceId: WS,
    attempt: 1,
    chunk: 1,
    bytes: 1000,
    mime: "audio/webm",
    file,
    maxSessionBytes: 1500,
  });
  assert.equal(over.outcome, "full");
  const meta = interviewRecordingsForSession(session.id, WS)![0]!;
  assert.equal(meta.partial, true, "what was captured is KEPT and flagged, never dropped");
  assert.equal(meta.bytes, 1000, "the refused chunk is not accounted for");
});

test("a claim for a session in another workspace writes nothing", () => {
  const { session } = recordedCall();
  const claim = claimInterviewRecordingChunk({
    sessionId: session.id,
    workspaceId: "other-team",
    attempt: 1,
    chunk: 0,
    bytes: 10,
    mime: "audio/webm",
    file: recordingFileName(session.id, 1, "audio/webm")!,
    maxSessionBytes: MAX_RECORDING_SESSION_BYTES,
  });
  assert.equal(claim.outcome, "missing");
  assert.equal(interviewRecordingsForSession(session.id, WS)?.length ?? 0, 0);
});

// ---- 5: retention selection --------------------------------------------------------

/** Age a session's call and its entry's decision so the sweep sees the case we mean. */
function age(opts: { sessionId: string; entryId: string; callDaysAgo: number; decision?: { status: string; daysAgo: number } }) {
  const db = ensureDb();
  const callAt = new Date(Date.now() - opts.callDaysAgo * DAY).toISOString();
  db.prepare(`UPDATE interview_sessions SET started_at = ?, created_at = ? WHERE id = ?`).run(callAt, callAt, opts.sessionId);
  if (opts.decision) {
    const decidedAt = new Date(Date.now() - opts.decision.daysAgo * DAY).toISOString();
    db.prepare(`UPDATE pipeline_entries SET status = ?, updated_at = ? WHERE id = ?`).run(opts.decision.status, decidedAt, opts.entryId);
  }
}

test("the retention sweep deletes decided+30d and the 180d backstop, and leaves the rest alone", () => {
  // (a) rejected 31 days ago: the decision clock has run out.
  const decided = recordedCall({ label: "Decided Candidate" });
  const decidedFile = storeChunk(decided.session.id, WS, 1, 0, 100).file;
  age({ sessionId: decided.session.id, entryId: decided.entry.id, callDaysAgo: 60, decision: { status: "rejected", daysAgo: 31 } });

  // (b) never decided, call 200 days ago: the BACKSTOP has run out.
  const stale = recordedCall({ label: "Undecided Candidate" });
  const staleFile = storeChunk(stale.session.id, WS, 1, 0, 100).file;
  age({ sessionId: stale.session.id, entryId: stale.entry.id, callDaysAgo: 200 });

  // (c) rejected 10 days ago on a recent call: NOT due.
  const fresh = recordedCall({ label: "Fresh Candidate" });
  const freshFile = storeChunk(fresh.session.id, WS, 1, 0, 100).file;
  age({ sessionId: fresh.session.id, entryId: fresh.entry.id, callDaysAgo: 20, decision: { status: "rejected", daysAgo: 10 } });

  // (d) still active, call 30 days ago: no decision, far inside the backstop.
  const live = recordedCall({ label: "Live Candidate" });
  const liveFile = storeChunk(live.session.id, WS, 1, 0, 100).file;
  age({ sessionId: live.session.id, entryId: live.entry.id, callDaysAgo: 30 });

  const summary = runInterviewRecordingRetention();
  assert.equal(summary.deleted, 2, "exactly the two that are due");
  assert.equal(summary.failed, 0);

  assert.equal(fs.existsSync(recordingFilePath(WS, decidedFile)!), false, "decided + 30 days: the file is gone");
  assert.equal(fs.existsSync(recordingFilePath(WS, staleFile)!), false, "180-day backstop: the file is gone");
  assert.equal(fs.existsSync(recordingFilePath(WS, freshFile)!), true, "a recent decision is not due yet");
  assert.equal(fs.existsSync(recordingFilePath(WS, liveFile)!), true, "an undecided recent call is not due yet");

  // THE DELETION IS THE RECORD: the meta row stays, stamped with when and why.
  const gone = interviewRecordingsForSession(decided.session.id, WS)![0]!;
  assert.ok(gone.deletedAt, "the row records the deletion");
  assert.equal(gone.deleteReason, "retention");
  assert.equal(gone.bytes, 100, "what we held is still stated");
  const kept = interviewRecordingsForSession(fresh.session.id, WS)![0]!;
  assert.equal(kept.deletedAt, null);

  // …and a recording_deleted event beside it.
  const events = listInterviewEvents(decided.session.id, WS, { kinds: ["recording_deleted"] });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.payload.reason, "retention");

  // IDEMPOTENT: a second tick deletes nothing further.
  const second = runInterviewRecordingRetention();
  assert.equal(second.deleted, 0, "an already-deleted attempt is skipped");
});

// ---- 6: the candidate's own deletion, and erasure -----------------------------------

test("the candidate's own request deletes the file and keeps the record", () => {
  const { entry, session } = recordedCall({ label: "Withdrawing Candidate" });
  const file = storeChunk(session.id, WS, 1, 0, 256).file;
  assert.equal(entryHasRecording(entry.id, WS), true);

  const deleted = deleteEntryRecordings(entry.id, WS, "candidate_request");
  assert.equal(deleted, 1);
  assert.equal(fs.existsSync(recordingFilePath(WS, file)!), false);
  const meta = interviewRecordingsForSession(session.id, WS)![0]!;
  assert.equal(meta.deleteReason, "candidate_request");
  assert.ok(meta.deletedAt);
  // The projection's boolean now reports nothing to delete, so the control disappears.
  assert.equal(entryHasRecording(entry.id, WS), false);

  // A second click is a no-op, not an error: the door is idempotent by design.
  assert.equal(deleteEntryRecordings(entry.id, WS, "candidate_request"), 0);
});

test("GDPR erasure deletes the audio AFTER its transaction commits", () => {
  const { entry, session } = recordedCall({ label: "Erased Candidate" });
  const file = storeChunk(session.id, WS, 1, 0, 512).file;
  assert.equal(fs.existsSync(recordingFilePath(WS, file)!), true);

  assert.ok(anonymizeEntry(entry.id, "erasure", WS));

  assert.equal(fs.existsSync(recordingFilePath(WS, file)!), false, "the audio is the rawest PII the product holds");
  const meta = interviewRecordingsForSession(session.id, WS)![0]!;
  assert.equal(meta.deleteReason, "erasure", "erasure is its OWN reason, not candidate_request");
  assert.ok(meta.deletedAt);
  // The entry-scoped read no longer offers anything to delete.
  assert.equal(listInterviewRecordingsForEntry(entry.id, WS).length, 0);
});
