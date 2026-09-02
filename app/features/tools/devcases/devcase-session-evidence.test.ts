// The pure half of the session-evidence reader. No DOM, no DB, no fetch — the same
// shape devcase-judge-independence.test.ts uses, because this repo has no
// component-test harness and every judgement worth pinning lives outside the JSX.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionEvidenceModel, sessionIdFromRepoRef } from "./devcase-session-evidence.ts";

test("a session with a tree but no chat is NOT empty", () => {
  const m = sessionEvidenceModel({
    session: { status: "submitted", submittedAt: "2026-09-01T10:00:00Z" },
    transcript: [],
    files: [{ path: "src/a.ts", contents: "export const a = 1;" }],
  });
  assert.equal(m.isEmpty, false, "the chat is optional — a tree alone is real evidence");
  assert.equal(m.files.length, 1);
  assert.equal(m.status, "submitted");
  assert.equal(m.submittedAt, "2026-09-01T10:00:00Z");
});

test("a session with neither turns nor files is empty", () => {
  assert.equal(sessionEvidenceModel({ session: {}, transcript: [], files: [] }).isEmpty, true);
});

test("file size is measured in BYTES, so an accented tree is not under-counted", () => {
  const m = sessionEvidenceModel({ files: [{ path: "notes.md", contents: "Kandidát" }] });
  // 8 characters, 9 UTF-8 bytes (the accented one is two).
  assert.equal(m.files[0]?.bytes, 9, "String.length reports 8 and under-states every locale but en");
  assert.equal(m.totalBytes, 9);
});

test("turns come back in seq order regardless of wire order", () => {
  const m = sessionEvidenceModel({
    transcript: [
      { seq: 2, channel: "default", role: "model", text: "second", createdAt: "b" },
      { seq: 1, channel: "default", role: "user", text: "first", createdAt: "a" },
    ],
  });
  assert.deepEqual(
    m.turns.map((t) => t.text),
    ["first", "second"]
  );
});

test("a malformed row is dropped and a malformed payload is an honest empty, never a throw", () => {
  const m = sessionEvidenceModel({
    transcript: [null, 7, { seq: 1 }, { seq: 2, text: "kept" }],
    files: [{ contents: "no path" }],
  });
  assert.deepEqual(
    m.turns.map((t) => t.text),
    ["kept"],
    "only a row with text is a turn"
  );
  assert.equal(m.files.length, 0, "a file with no path cannot be shown");
  assert.equal(sessionEvidenceModel(null).isEmpty, true);
  assert.equal(sessionEvidenceModel({}).isEmpty, true);
});

test("an unknown role reads as the candidate, so evidence is never silently withheld", () => {
  const m = sessionEvidenceModel({ transcript: [{ seq: 1, role: "assistant", text: "?" }] });
  assert.equal(m.turns[0]?.role, "user");
});

test("the session id is read out of the repoRef encoding devcase-run.ts writes", () => {
  assert.equal(sessionIdFromRepoRef("session:dsess-123"), "dsess-123");
  assert.equal(sessionIdFromRepoRef("github.com/a/b"), null, "a repo submission has no session");
  assert.equal(sessionIdFromRepoRef("session:"), null, "an empty id is not a session");
  assert.equal(sessionIdFromRepoRef(null), null);
  assert.equal(sessionIdFromRepoRef(undefined), null);
});
