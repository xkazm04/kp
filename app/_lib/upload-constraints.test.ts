// Pins the acceptUpload gate — the single client-side check every CV / JD /
// company File passes through before it enters state (idea-c9abc53f). The point
// of the gate is to reject a bad file at the drop/select moment rather than
// after a slow upload round-trip, so these lock the two rejection reasons
// (wrong extension, over the size limit) and the accepted shape.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPT_AUDIO_MIME,
  acceptUpload,
  FILE_TOO_LARGE_STATUS,
  fileTooLargeMessage,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MB,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  validateAudioUploadServer,
  validateOptionalUploadServer,
  validateUploadServer,
} from "./upload-constraints.ts";

// Build a File of an exact byte size without inspecting it elsewhere; acceptUpload
// only reads `.name` and `.size`, so a real File keeps the test honest.
function fileOf(name: string, bytes: number, type = "application/octet-stream"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

test("rejects a 20 MB PNG (the headline drop-anywhere case) on extension", () => {
  // The extension check fires first, so the image is rejected instantly — the
  // 20 MB never has to upload to learn it is the wrong type.
  const result = acceptUpload(fileOf("portfolio.png", 20 * 1024 * 1024, "image/png"));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "Use a PDF, DOCX, TXT, or MD file.");
});

test("rejects any non-CV extension regardless of size", () => {
  for (const name of ["resume.exe", "notes.pages", "scan.jpg", "data.csv", "noextension"]) {
    const result = acceptUpload(fileOf(name, 1024));
    assert.equal(result.ok, false, `${name} should be rejected`);
  }
});

test("rejects a valid type that exceeds the size limit", () => {
  const result = acceptUpload(fileOf("huge.pdf", MAX_FILE_BYTES + 1, "application/pdf"));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, `File exceeds the ${MAX_FILE_MB} MB limit.`);
});

test("accepts each supported extension at or under the size limit", () => {
  for (const name of ["cv.pdf", "cv.docx", "cv.txt", "cv.md", "CV.PDF"]) {
    const file = fileOf(name, MAX_FILE_BYTES); // exactly at the limit is allowed
    const result = acceptUpload(file);
    assert.equal(result.ok, true, `${name} should be accepted`);
    assert.equal(result.ok === true && result.file, file, "returns the same File for committing");
  }
});

// The server-boundary half of the one max-input-size contract (idea-36cc4b87):
// an over-limit upload is a 413, distinct from the 400 used for a wrong file
// type, and names which input to shrink.
test("the over-limit server status is 413 (Content Too Large), not a generic 4xx", () => {
  assert.equal(FILE_TOO_LARGE_STATUS, 413);
});

test("fileTooLargeMessage names the input and the one shared limit", () => {
  assert.equal(fileTooLargeMessage("profile"), `The profile exceeds the ${MAX_FILE_MB} MB upload limit.`);
  assert.equal(fileTooLargeMessage("CV variant 2"), `The CV variant 2 exceeds the ${MAX_FILE_MB} MB upload limit.`);
});

// validateUploadServer is the one server-side gate shared by /api/analyze and
// /api/extract-text (idea-5b61d729). These lock the two rejections — a wrong
// MIME type (400) and an over-limit size (413) — plus the accepted (null) case,
// so the two routes can't drift on accepted types or the size cap.
test("validateUploadServer rejects a wrong MIME type as a 400 naming the input", () => {
  const rejection = validateUploadServer(fileOf("portfolio.png", 1024, "image/png"), "profile");
  assert.deepEqual(rejection, { status: 400, error: "Use PDF, DOCX, TXT, or MD for the profile." });
});

test("validateUploadServer rejects an over-limit file as a 413 with the shared message", () => {
  const rejection = validateUploadServer(fileOf("huge.pdf", MAX_FILE_BYTES + 1, "application/pdf"), "job description");
  assert.deepEqual(rejection, { status: FILE_TOO_LARGE_STATUS, error: fileTooLargeMessage("job description") });
});

test("validateUploadServer accepts each supported MIME type at or under the limit", () => {
  const mimes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "", // browsers report empty type for .md / extensionless files
  ];
  // A real upload carries a supported extension, so use one here: it satisfies
  // the empty-MIME extension fallback below while leaving the non-empty types
  // (which ignore the filename) accepted exactly as before.
  for (const type of mimes) {
    const result = validateUploadServer(fileOf("doc.md", MAX_FILE_BYTES, type), "profile");
    assert.equal(result, null, `${type || "(empty type)"} at the limit should be accepted`);
  }
});

// The empty-MIME gap (idea-d902fc8e): some browsers report a blank Content-Type
// for .md / extensionless files, so "" is in ACCEPT_MIME. But a blank type alone
// must NOT wave a file past the only server-side type gate — when the MIME
// channel is empty the server falls back to the same extension contract the
// client gate (acceptUpload) enforces, so the two channels can't drift.
test("validateUploadServer accepts an empty-MIME upload only when the extension matches", () => {
  for (const name of ["notes.md", "resume.pdf", "cv.docx", "jd.txt", "CV.MD"]) {
    const result = validateUploadServer(fileOf(name, 1024, ""), "profile");
    assert.equal(result, null, `empty MIME + ${name} should be accepted on the extension fallback`);
  }
});

test("validateUploadServer rejects an empty-MIME upload whose filename has no valid extension", () => {
  // The exact drift this closed: a direct POST with a blank Content-Type and any
  // filename used to pass, since the server never checked the extension.
  for (const name of ["payload", "malware.exe", "portfolio.png", "noextension", "archive.zip"]) {
    const rejection = validateUploadServer(fileOf(name, 1024, ""), "profile");
    assert.deepEqual(
      rejection,
      { status: 400, error: "Use PDF, DOCX, TXT, or MD for the profile." },
      `empty MIME + ${name} must be rejected as a wrong type`,
    );
  }
});

test("validateUploadServer checks MIME before size (wrong-type-and-too-big is a 400)", () => {
  const rejection = validateUploadServer(fileOf("portfolio.png", MAX_FILE_BYTES + 1, "image/png"), "profile");
  assert.equal(rejection?.status, 400);
});

test("validateOptionalUploadServer treats a missing or empty field as accepted", () => {
  assert.equal(validateOptionalUploadServer(null, "company overview"), null);
  assert.equal(validateOptionalUploadServer("some text value", "company overview"), null);
  assert.equal(validateOptionalUploadServer(fileOf("empty.pdf", 0, "application/pdf"), "company overview"), null);
});

test("validateOptionalUploadServer validates a present file like validateUploadServer", () => {
  const rejection = validateOptionalUploadServer(fileOf("scan.jpg", 1024, "image/jpeg"), "company overview");
  assert.deepEqual(rejection, { status: 400, error: "Use PDF, DOCX, TXT, or MD for the company overview." });
});

// ── The audio contract (voice-stt package, /api/stt) ─────────────────────────

test("validateAudioUploadServer: over-limit is the SHARED 413, wrong kind is a 400 — and both answer a CODE", () => {
  assert.equal(validateAudioUploadServer(fileOf("clip.wav", 1024, "audio/wav")), null);
  assert.deepEqual(validateAudioUploadServer(fileOf("clip.wav", MAX_AUDIO_BYTES + 1, "audio/wav")), {
    status: FILE_TOO_LARGE_STATUS,
    code: "AUDIO_TOO_LARGE",
  });
  assert.deepEqual(validateAudioUploadServer(fileOf("cv.pdf", 1024, "application/pdf")), {
    status: 400,
    code: "AUDIO_UNSUPPORTED_TYPE",
  });
  // The English sentence is gone on purpose: the client resolves errors.<CODE>
  // in the reader's language, so a refusal is never shipped in one language.
  assert.equal(MAX_AUDIO_MB, 25);
});

test("validateAudioUploadServer refuses an untyped blob rather than guessing", () => {
  // No empty-MIME fallback, unlike the document gate: guessing wrong here means
  // spawning an engine or spending a per-audio-hour rate on a file that is not audio.
  assert.deepEqual(validateAudioUploadServer(fileOf("clip.wav", 1024, "")), {
    status: 400,
    code: "AUDIO_UNSUPPORTED_TYPE",
  });
});

test("the boundary's audio MIME list matches the package's validation door", async () => {
  // types.ts only — the package index reaches node:fs, and this module is
  // imported by client components. The door is the authority; ACCEPT_AUDIO_MIME
  // is the boundary copy, and a copy nothing compares is a copy that drifts:
  // accepting a container here that the door rejects turns a 400 at the edge
  // into a 400 after the upload has already been paid for.
  const { STT_MIME_TYPES } = await import("../../packages/voice-stt/src/types.ts");
  assert.deepEqual([...ACCEPT_AUDIO_MIME].sort(), [...STT_MIME_TYPES].sort());
});
