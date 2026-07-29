// Live Work Surface — local draft persistence, verifier pass 2026-07-17.
// Pure logic (no DOM): run with node:test directly, no jsdom needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftStorageKey, encodeDraft, decodeDraft, type LiveWorkDraft } from "./liveWorkDraft.ts";

test("draftStorageKey is namespaced and per-token", () => {
  assert.equal(draftStorageKey("tok-a"), "kp:devcase:livework:tok-a");
  assert.notEqual(draftStorageKey("tok-a"), draftStorageKey("tok-b"));
});

test("round-trips a normal draft", () => {
  const draft: LiveWorkDraft = {
    sessionId: "dsess_1",
    files: [{ path: "src/index.ts", contents: "export const x = 1;\n" }],
    pending: [{ t: 1000, kind: "edit", path: "src/index.ts" }],
    savedAt: 1000,
  };
  const decoded = decodeDraft(encodeDraft(draft));
  assert.deepEqual(decoded, draft);
});

test("decodeDraft returns null for missing/garbage input", () => {
  assert.equal(decodeDraft(null), null);
  assert.equal(decodeDraft(undefined), null);
  assert.equal(decodeDraft(""), null);
  assert.equal(decodeDraft("not json"), null);
  assert.equal(decodeDraft("42"), null);
  assert.equal(decodeDraft("null"), null);
});

test("decodeDraft returns null for an empty-but-present draft (nothing worth resuming)", () => {
  assert.equal(decodeDraft(JSON.stringify({ sessionId: null, files: [], pending: [], savedAt: 1 })), null);
});

test("decodeDraft drops unknown event kinds and non-object files (candidate-writable storage)", () => {
  const raw = JSON.stringify({
    sessionId: "dsess_2",
    files: [{ path: "a.ts", contents: "ok" }, { path: "bad" }, "not-a-file", 42],
    pending: [
      { t: 1, kind: "edit", path: "a.ts" },
      { t: 2, kind: "eval", path: "a.ts" }, // not a real ProcessEventKind
      "not-an-event",
    ],
    savedAt: 5,
  });
  const decoded = decodeDraft(raw);
  assert.ok(decoded);
  assert.deepEqual(decoded!.files, [{ path: "a.ts", contents: "ok" }]);
  assert.deepEqual(decoded!.pending, [{ t: 1, kind: "edit", path: "a.ts" }]);
});

test("decodeDraft caps oversized file contents and file/event counts (mirrors the server route's bounds)", () => {
  const bigContents = "x".repeat(300 * 1024); // over the 256KB cap
  const manyFiles = Array.from({ length: 60 }, (_, i) => ({ path: `f${i}.ts`, contents: "x" }));
  const manyEvents = Array.from({ length: 2500 }, (_, i) => ({ t: i, kind: "edit", path: "a.ts" }));
  const raw = JSON.stringify({
    sessionId: "dsess_3",
    files: [{ path: "big.ts", contents: bigContents }, ...manyFiles],
    pending: manyEvents,
    savedAt: 1,
  });
  const decoded = decodeDraft(raw);
  assert.ok(decoded);
  assert.equal(decoded!.files.length, 50, "capped at MAX_FILES");
  assert.ok(decoded!.files[0].contents.length <= 256 * 1024, "capped at MAX_FILE_BYTES");
  assert.equal(decoded!.pending.length, 2000, "capped at MAX_PENDING_EVENTS");
});
