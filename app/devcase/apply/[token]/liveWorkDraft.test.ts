// Live Work Surface — local draft persistence, verifier pass 2026-07-17.
// Pure logic (no DOM): run with node:test directly, no jsdom needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { draftStorageKey, encodeDraft, decodeDraft, type LiveWorkDraft } from "./liveWorkDraft.ts";

const surface = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "LiveWorkSurface.tsx"), "utf8");

test("draftStorageKey is namespaced and per-token", () => {
  assert.equal(draftStorageKey("tok-a"), "kp:devcase:livework:tok-a");
  assert.notEqual(draftStorageKey("tok-a"), draftStorageKey("tok-b"));
});

test("round-trips a normal draft", () => {
  const draft: LiveWorkDraft = {
    sessionId: "dsess_1",
    sessionKey: "dsk-round-trip-key-0123456789abcdef",
    files: [{ path: "src/index.ts", contents: "export const x = 1;\n" }],
    pending: [{ t: 1000, kind: "edit", path: "src/index.ts" }],
    chat: [
      { channel: "assistant", role: "user", text: "how does this compile?" },
      { channel: "assistant", role: "model", text: "check tsconfig", deterministic: true },
    ],
    name: "Ada Lovelace",
    contact: "ada@example.com",
    savedAt: 1000,
  };
  const decoded = decodeDraft(encodeDraft(draft));
  assert.deepEqual(decoded, draft);
});

test("decodeDraft fills chat and identity on a legacy blob that lacks those keys", () => {
  const raw = JSON.stringify({
    sessionId: "dsess_legacy",
    files: [{ path: "a.ts", contents: "ok" }],
    pending: [{ t: 1, kind: "edit", path: "a.ts" }],
    savedAt: 5,
  });
  const decoded = decodeDraft(raw);
  assert.ok(decoded);
  assert.deepEqual(decoded!.chat, []);
  assert.equal(decoded!.name, "");
  assert.equal(decoded!.contact, "");
  assert.equal(decoded!.sessionId, "dsess_legacy");
});

test("decodeDraft drops unknown chat channels and roles", () => {
  const raw = JSON.stringify({
    sessionId: "dsess_chat",
    files: [],
    pending: [],
    chat: [
      { channel: "assistant", role: "user", text: "keep me" },
      { channel: "secret", role: "user", text: "drop channel" },
      { channel: "stakeholder", role: "system", text: "drop role" },
      { channel: "stakeholder", role: "model", text: "keep too" },
      { channel: "assistant", role: "model", text: 42 },
    ],
    name: "Ada",
    contact: "ada@example.com",
    savedAt: 5,
  });
  const decoded = decodeDraft(raw);
  assert.ok(decoded);
  assert.deepEqual(decoded!.chat, [
    { channel: "assistant", role: "user", text: "keep me" },
    { channel: "stakeholder", role: "model", text: "keep too" },
  ]);
  assert.equal(decoded!.name, "Ada");
  assert.equal(decoded!.contact, "ada@example.com");
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

test("decodeDraft keeps an identity-only draft so Submit stays enabled after reload", () => {
  const decoded = decodeDraft(
    JSON.stringify({ sessionId: null, files: [], pending: [], name: "Ada Lovelace", contact: "ada@example.com", savedAt: 1 })
  );
  assert.ok(decoded);
  assert.equal(decoded!.name, "Ada Lovelace");
  assert.equal(decoded!.contact, "ada@example.com");
  assert.deepEqual(decoded!.chat, []);
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

test("LiveWorkSurface persistDraft writes chat, name and contact and mount restore hydrates them", () => {
  assert.match(surface, /chat: chatMessagesRef\.current/);
  assert.match(surface, /name: nameRef\.current/);
  assert.match(surface, /contact: contactRef\.current/);
  assert.match(surface, /setChatMessages\(draft\.chat\)/);
  assert.match(surface, /setName\(draft\.name\)/);
  assert.match(surface, /setContact\(draft\.contact\)/);
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

// challenge-r06 devcase-session-api/A — the per-attempt session key lives in the draft
// beside the session id it belongs to, so a reload keeps proving the attempt.
test("encodeDraft/decodeDraft round-trips sessionKey", () => {
  const decoded = decodeDraft(
    encodeDraft({
      sessionId: "dsess_k",
      sessionKey: "dsk-AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      files: [],
      pending: [{ t: 1, kind: "edit", path: "a.ts" }],
      chat: [],
      name: "",
      contact: "",
      savedAt: 1,
    })
  );
  assert.equal(decoded?.sessionKey, "dsk-AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  assert.equal(decoded?.sessionId, "dsess_k");
});

test("a draft whose sessionKey is not a string decodes with sessionKey null and keeps its sessionId", () => {
  for (const bad of [42, true, { k: 1 }, ["x"], "", null]) {
    const decoded = decodeDraft(JSON.stringify({ sessionId: "dsess_legacy", sessionKey: bad, pending: [{ t: 1, kind: "edit" }], savedAt: 1 }));
    assert.ok(decoded, `sessionKey ${JSON.stringify(bad)}`);
    assert.equal(decoded!.sessionKey, null);
    // The id survives: the sync client flushes it KEYLESS (a legacy row accepts that)
    // rather than re-minting and abandoning the server-side attempt.
    assert.equal(decoded!.sessionId, "dsess_legacy");
  }
  // A pre-change blob has no sessionKey field at all.
  assert.equal(decodeDraft(JSON.stringify({ sessionId: "dsess_old", files: [{ path: "a", contents: "b" }] }))!.sessionKey, null);
});

test("LiveWorkSurface persists sessionKey with the draft and hydrates it back", () => {
  assert.match(surface, /sessionKey: sync\.sessionKey/);
  assert.match(surface, /sessionKey: draft\.sessionKey/);
});
