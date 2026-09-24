// The PURE rules of opt-in interview recording: what may be stored, where it may be
// written, when it must be gone, and how a seek is resolved.
//
// These are the decisions the upload door, the retention sweep, the playback door and
// the candidate's own delete control all resolve through — so they are driven here once
// rather than inferred from four call sites. No DB, no fs, no Next runtime.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --test app/_lib/interview-recording-paths.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRecordingRetentionDue,
  isServerId,
  MAX_RECORDING_CHUNK_BYTES,
  MAX_RECORDING_SESSION_BYTES,
  normalizeRecordingMime,
  parseByteRange,
  parseRecordingAttempt,
  parseRecordingChunk,
  RECORDING_BACKSTOP_DAYS,
  RECORDING_RETENTION_AFTER_DECISION_DAYS,
  recordingAcceptsChunk,
  recordingDeleteDueAtMs,
  recordingFileName,
} from "./interview-recording-paths.ts";

const DAY = 86_400_000;

test("the content-type allow-list is exactly the containers a browser recorder produces", () => {
  assert.equal(normalizeRecordingMime("audio/webm"), "audio/webm");
  // Chrome sends parameters; RFC 9110 says the type is case-insensitive.
  assert.equal(normalizeRecordingMime("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(normalizeRecordingMime("AUDIO/WEBM; codecs=opus"), "audio/webm");
  assert.equal(normalizeRecordingMime("audio/mp4"), "audio/mp4", "Safari's only answer");
  assert.equal(normalizeRecordingMime("audio/ogg;codecs=opus"), "audio/ogg");
  // Everything else has no extension to be stored under, so it is refused at the door
  // rather than sanitized into something the file name can carry.
  for (const bad of ["video/webm", "application/json", "audio/wav", "text/plain", "", null, undefined]) {
    assert.equal(normalizeRecordingMime(bad), null, `${String(bad)} must not be storable`);
  }
});

test("a file name is built from SERVER ids only, so path traversal is unrepresentable", () => {
  assert.equal(recordingFileName("iv_abc123", 1, "audio/webm"), "iv_abc123-a1.webm");
  assert.equal(recordingFileName("iv-abc", 12, "audio/mp4"), "iv-abc-a12.mp4");
  // A session id that is not one we minted yields NO name at all — the caller refuses
  // rather than filing the audio somewhere it guessed.
  for (const hostile of ["../../etc/passwd", "iv/../x", "iv.sqlite", "iv abc", "", "a".repeat(200), "C:\\win", "iv\u0000x"]) {
    assert.equal(recordingFileName(hostile, 1, "audio/webm"), null, `${JSON.stringify(hostile)} must not become a path`);
    assert.equal(isServerId(hostile), false);
  }
  // …and so does an attempt outside the real range.
  for (const attempt of [0, -1, 1.5, 1000, Number.NaN]) {
    assert.equal(recordingFileName("iv_abc", attempt, "audio/webm"), null);
  }
});

test("the wire's attempt and chunk numbers are parsed, never coerced", () => {
  assert.equal(parseRecordingAttempt("1"), 1);
  assert.equal(parseRecordingAttempt("12"), 12);
  for (const bad of ["0", "-1", "1.5", "1e3", " 1", "abc", "1000", "", null]) assert.equal(parseRecordingAttempt(bad), null);
  assert.equal(parseRecordingChunk("0"), 0, "the first chunk is index 0");
  assert.equal(parseRecordingChunk("417"), 417);
  for (const bad of ["-1", "1.5", "abc", "1000000", "", null]) assert.equal(parseRecordingChunk(bad), null);
});

test("the byte budgets are the ones the doors claim", () => {
  assert.equal(MAX_RECORDING_CHUNK_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_RECORDING_SESSION_BYTES, 80 * 1024 * 1024);
});

test("audio is accepted while live, for two minutes past the end, and never otherwise", () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  assert.equal(recordingAcceptsChunk({ status: "in_progress", endedAt: null, nowMs: now }), true);
  // The FINAL FLUSH: MediaRecorder emits its last chunk after teardown, so it lands
  // after /complete has already finalized the row.
  assert.equal(recordingAcceptsChunk({ status: "completed", endedAt: iso(30_000), nowMs: now }), true);
  assert.equal(recordingAcceptsChunk({ status: "failed", endedAt: iso(60_000), nowMs: now }), true);
  assert.equal(recordingAcceptsChunk({ status: "completed", endedAt: iso(5 * 60_000), nowMs: now }), false, "long past the flush window");
  // A link the recruiter PULLED, and one never connected: audio for a call that is not
  // happening must never be stored.
  assert.equal(recordingAcceptsChunk({ status: "revoked", endedAt: null, nowMs: now }), false);
  assert.equal(recordingAcceptsChunk({ status: "created", endedAt: null, nowMs: now }), false);
  // A terminal row with no end stamp cannot be dated, so it is not accepted.
  assert.equal(recordingAcceptsChunk({ status: "completed", endedAt: null, nowMs: now }), false);
});

test("retention: 30 days after the decision, 180 after the call, whichever comes first", () => {
  const now = Date.UTC(2026, 5, 1);
  const ago = (days: number) => new Date(now - days * DAY).toISOString();

  // A decided candidate: due on day 30, not on day 29.
  assert.equal(isRecordingRetentionDue({ decidedAt: ago(29), callAt: ago(40), nowMs: now }), false);
  assert.equal(isRecordingRetentionDue({ decidedAt: ago(RECORDING_RETENTION_AFTER_DECISION_DAYS), callAt: ago(40), nowMs: now }), true);

  // NEVER decided: only the backstop applies, measured from the CALL.
  assert.equal(isRecordingRetentionDue({ decidedAt: null, callAt: ago(179), nowMs: now }), false);
  assert.equal(isRecordingRetentionDue({ decidedAt: null, callAt: ago(RECORDING_BACKSTOP_DAYS), nowMs: now }), true);

  // The backstop is a CEILING, not an alternative: a decision made yesterday on a call
  // from 200 days ago does not buy the audio another 30 days.
  assert.equal(isRecordingRetentionDue({ decidedAt: ago(1), callAt: ago(200), nowMs: now }), true);
  assert.equal(
    recordingDeleteDueAtMs({ decidedAt: ago(1), callAt: ago(200) }),
    Date.parse(ago(200)) + RECORDING_BACKSTOP_DAYS * DAY,
    "the earlier of the two windows wins"
  );

  // A fresh call, freshly decided: nothing is due.
  assert.equal(isRecordingRetentionDue({ decidedAt: ago(2), callAt: ago(3), nowMs: now }), false);

  // UNDATABLE audio is due. Uncertainty resolves toward the candidate: audio we cannot
  // date is audio we cannot justify keeping.
  assert.equal(isRecordingRetentionDue({ decidedAt: null, callAt: null, nowMs: now }), true);
  assert.equal(isRecordingRetentionDue({ decidedAt: "not-a-date", callAt: "also-not", nowMs: now }), true);
});

test("Range is resolved so an <audio> element can seek, and a bad range is refused", () => {
  assert.equal(parseByteRange(null, 1000), null, "no header: serve the whole file");
  assert.equal(parseByteRange("bytes=malformed", 1000), null, "a malformed header is treated as ABSENT (RFC 9110 14.2)");
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=500-", 1000), { start: 500, end: 999 }, "open-ended runs to the last byte");
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 }, "a suffix range is the LAST n bytes");
  assert.deepEqual(parseByteRange("bytes=0-99999", 1000), { start: 0, end: 999 }, "an over-long end is clamped, not refused");
  assert.equal(parseByteRange("bytes=1000-", 1000), "unsatisfiable", "a start at or past the size is a 416");
  assert.equal(parseByteRange("bytes=800-700", 1000), "unsatisfiable");
  assert.equal(parseByteRange("bytes=0-99", 0), null, "an empty file has no range to serve");
});
