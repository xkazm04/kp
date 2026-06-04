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
import { acceptUpload, MAX_FILE_BYTES, MAX_FILE_MB } from "./upload-constraints.ts";

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
