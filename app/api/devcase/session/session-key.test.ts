// The per-attempt session key (challenge-r06 devcase-session-api/A).
//
// The apply link is per POSTING and shared by every applicant, and a session id is a
// `randomId` (Math.random) that rides the URL path of every call. Until this card, those
// two values were the whole authority over a live attempt: another applicant of the same
// posting who learned a session id could overwrite its file tree, spend its model budget
// or seal it early. The mint now hands the minting device a CSPRNG key (once), the row
// keeps only its sha256, and one door guard (devcase-session-auth.ts `openSessionDoor`)
// demands the key on a keyed row. A row minted before the change (key_hash NULL) keeps
// the apply-token rule, so no candidate mid-attempt at deploy time is locked out.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { saveDevCase, createPosting, startDevSession, getDevSession, getDevSessionEvents } from "../../../_lib/db.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { rateLimit } from "../../../_lib/rate-limit.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST: mintPost } = await import("./route.ts");
const { POST: flushPost } = await import("./[id]/route.ts");
const { POST: chatPost } = await import("./[id]/chat/route.ts");
const { POST: finalizePost } = await import("./[id]/submit/route.ts");
const { SESSION_KEY_HEADER } = await import("../../../_lib/devcase-session-auth.ts");

after(() => cleanupUnitDb());

let seedN = 0;
function seedOpenPosting(): string {
  const token = `tok-key-${++seedN}`;
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } });
  createPosting({ caseId: dc.id, channel: "link", token, roleTitle: "Backend Engineer", caseTitle: "API case" });
  return token;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mint(token: string): Promise<{ sessionId: string; sessionKey: string; watermark: string }> {
  const res = await mintPost(
    new Request("http://localhost/api/devcase/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, candidateRef: "cand" }),
    })
  );
  assert.equal(res.status, 200);
  return (await res.json()) as { sessionId: string; sessionKey: string; watermark: string };
}

function headers(key?: string | null): Record<string, string> {
  return { "content-type": "application/json", ...(key ? { [SESSION_KEY_HEADER]: key } : {}) };
}

function door(path: string, id: string, body: Record<string, unknown>, key?: string | null): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/devcase/session/${id}${path}`, { method: "POST", headers: headers(key), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  ];
}

const rawRow = (id: string) => ensureDb().prepare(`SELECT * FROM dev_sessions WHERE id = ?`).get(id) as Record<string, unknown>;
const oneEdit = () => [{ t: Date.now(), kind: "edit", path: "src/x.ts" }];
const oneFile = () => [{ path: "src/x.ts", contents: "export const hijacked = true;\n" }];

test("1. the mint answers a CSPRNG sessionKey once; the row keeps only its sha256", async () => {
  const token = seedOpenPosting();
  const body = await mint(token);
  assert.equal(typeof body.sessionKey, "string");
  assert.ok(body.sessionKey.length >= 32, `a key of ${body.sessionKey.length} chars is guessable`);
  assert.ok(body.sessionId && body.watermark, "sessionId and watermark still ride beside it");
  const row = rawRow(body.sessionId);
  assert.equal(row.key_hash, sha256(body.sessionKey), "the store keeps sha256(sessionKey)");
  for (const [column, value] of Object.entries(row)) {
    assert.notEqual(value, body.sessionKey, `column ${column} holds the raw key`);
  }
  // Two mints never share a key.
  assert.notEqual((await mint(token)).sessionKey, body.sessionKey);
});

test("2. flush on a keyed session with the apply token but NO key -> 403, nothing written", async () => {
  const token = seedOpenPosting();
  const { sessionId } = await mint(token);
  const before = rawRow(sessionId).files_json;
  const res = await flushPost(...door("", sessionId, { token, events: oneEdit(), files: oneFile() }, null));
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { code?: string }).code, "SESSION_TOKEN_REQUIRED");
  assert.equal(getDevSessionEvents(sessionId).length, 0, "no event appended");
  assert.equal(rawRow(sessionId).files_json, before, "files_json byte-identical");
});

test("3. flush on a keyed session with the correct key -> 200, events land, tree saved", async () => {
  const token = seedOpenPosting();
  const { sessionId, sessionKey } = await mint(token);
  const res = await flushPost(...door("", sessionId, { token, events: oneEdit(), files: oneFile() }, sessionKey));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok?: boolean; seq?: number };
  assert.equal(body.ok, true);
  assert.ok((body.seq ?? 0) > 0);
  assert.equal(getDevSessionEvents(sessionId).length, 1);
  assert.deepEqual(getDevSession(sessionId)!.files, oneFile());
});

test("4. chat on a keyed session with a WRONG key -> 403 before the throttle and before any write", async () => {
  const token = seedOpenPosting();
  const { sessionId } = await mint(token);
  const other = await mint(token); // a real key, but another attempt's
  const res = await chatPost(...door("/chat", sessionId, { token, channel: "assistant", message: "hello" }, other.sessionKey));
  assert.equal(res.status, 403);
  const n = ensureDb().prepare(`SELECT COUNT(*) AS n FROM dev_session_chat WHERE session_id = ?`).get(sessionId) as { n: number };
  assert.equal(Number(n.n), 0, "no dev_session_chat row");
  // The refusal ran before the limiter: all 30 calls of the per-session window remain.
  const key = `devcase-chat:${sessionId}`;
  for (let i = 0; i < 30; i++) assert.equal(rateLimit(key, { limit: 30, windowMs: 10 * 60_000 }), true, `call ${i + 1} of 30`);
  assert.equal(rateLimit(key, { limit: 30, windowMs: 10 * 60_000 }), false);
});

test("5. finalize on a keyed session with the apply token but no key -> 403, still active, no submission", async () => {
  const token = seedOpenPosting();
  const { sessionId } = await mint(token);
  const res = await finalizePost(...door("/submit", sessionId, { token, candidate: "Ada", contact: "ada@example.test" }, null));
  assert.equal(res.status, 403);
  assert.equal(getDevSession(sessionId)!.status, "active");
  const n = ensureDb().prepare(`SELECT COUNT(*) AS n FROM dev_submissions WHERE repo_ref = ?`).get(`session:${sessionId}`) as { n: number };
  assert.equal(Number(n.n), 0, "no dev_submissions row for the session");
});

test("5b. finalize on a keyed session WITH the key seals it", async () => {
  const token = seedOpenPosting();
  const { sessionId, sessionKey } = await mint(token);
  const res = await finalizePost(...door("/submit", sessionId, { token, candidate: "Ada", contact: "ada@example.test" }, sessionKey));
  assert.equal(res.status, 200);
  assert.equal(getDevSession(sessionId)!.status, "submitted");
});

test("6. a legacy session (key_hash NULL) keeps today's apply-token rule", async () => {
  const token = seedOpenPosting();
  // What startDevSession fixtures and every pre-change product row carry.
  const legacy = startDevSession({ token, candidateRef: "cand" });
  assert.equal(rawRow(legacy.id).key_hash ?? null, null);
  const ok = await flushPost(...door("", legacy.id, { token, events: oneEdit() }, null));
  assert.equal(ok.status, 200, "an attempt in flight at deploy time is not cut off");
  const refused = await flushPost(...door("", legacy.id, { events: oneEdit() }, null));
  assert.equal(refused.status, 403, "no token -> 403, exactly as today");
  assert.equal(getDevSessionEvents(legacy.id).length, 1);
});
