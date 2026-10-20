// A closed intake reaches the candidate mid-case (challenge-r06 devcase-session-api/B).
//
// Until this card the flush checked only the SESSION's status and chat only that a case
// existed, so a candidate whose intake the recruiter closed kept working (and kept
// spending a real model call per chat message) until the seal answered 410, after every
// hour since the close. Now the flush says `intakeClosed` on the next save and still keeps
// the work; chat refuses POSTING_CLOSED before the throttle and before any spend.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { saveDevCase, createPosting, getDevSessionEvents, setPostingStatus } from "../../../_lib/db/devcase.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { rateLimit } from "../../../_lib/rate-limit.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST: mintPost } = await import("./route.ts");
const { POST: flushPost } = await import("./[id]/route.ts");
const { POST: chatPost } = await import("./[id]/chat/route.ts");
const { SESSION_KEY_HEADER } = await import("../../../_lib/devcase-session-auth.ts");

after(() => cleanupUnitDb());

let seedN = 0;
function seedOpenPosting(): { token: string; postingId: string } {
  const token = `tok-intake-${++seedN}`;
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } });
  const p = createPosting({ caseId: dc.id, channel: "link", token, roleTitle: "Backend Engineer", caseTitle: "API case" });
  return { token, postingId: p.id };
}

async function mint(token: string): Promise<{ sessionId: string; sessionKey: string }> {
  const res = await mintPost(
    new Request("http://localhost/api/devcase/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, candidateRef: "cand" }),
    })
  );
  assert.equal(res.status, 200);
  return (await res.json()) as { sessionId: string; sessionKey: string };
}

function door(path: string, id: string, key: string, body: Record<string, unknown>): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/devcase/session/${id}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_KEY_HEADER]: key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

const oneEdit = () => [{ t: Date.now(), kind: "edit", path: "src/x.ts" }];

test("flush on an OPEN posting answers intakeClosed: false", async () => {
  const { token } = seedOpenPosting();
  const { sessionId, sessionKey } = await mint(token);
  const res = await flushPost(...door("", sessionId, sessionKey, { token, events: oneEdit() }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { intakeClosed?: unknown }).intakeClosed, false);
});

test("flush after the posting CLOSED answers 200 intakeClosed: true, and the events are still stored", async () => {
  const { token, postingId } = seedOpenPosting();
  const { sessionId, sessionKey } = await mint(token);
  // A first flush while open: the per-token memo on this path has now seen the posting.
  assert.equal((await flushPost(...door("", sessionId, sessionKey, { token, events: oneEdit() }))).status, 200);
  setPostingStatus(postingId, "closed");
  const res = await flushPost(...door("", sessionId, sessionKey, { token, events: oneEdit() }));
  assert.equal(res.status, 200, "the work is kept: a closed intake is not a refused save");
  const body = (await res.json()) as { ok?: boolean; intakeClosed?: unknown };
  assert.equal(body.ok, true);
  assert.equal(body.intakeClosed, true, "a live posting read, not the memo");
  assert.equal(getDevSessionEvents(sessionId).length, 2, "both batches landed");
});

test("chat after the posting CLOSED -> 410 POSTING_CLOSED, no chat row, the per-session limiter untouched", async () => {
  const { token, postingId } = seedOpenPosting();
  const { sessionId, sessionKey } = await mint(token);
  setPostingStatus(postingId, "closed");
  const res = await chatPost(...door("/chat", sessionId, sessionKey, { token, channel: "assistant", message: "hello" }));
  assert.equal(res.status, 410);
  assert.equal(((await res.json()) as { code?: string }).code, "POSTING_CLOSED");
  const n = ensureDb().prepare(`SELECT COUNT(*) AS n FROM dev_session_chat WHERE session_id = ?`).get(sessionId) as { n: number };
  assert.equal(Number(n.n), 0, "no dev_session_chat row, so no model call was made");
  const prompts = getDevSessionEvents(sessionId).filter((e) => e.kind === "prompt");
  assert.equal(prompts.length, 0, "no prompt event");
  const key = `devcase-chat:${sessionId}`;
  for (let i = 0; i < 30; i++) assert.equal(rateLimit(key, { limit: 30, windowMs: 10 * 60_000 }), true, `call ${i + 1} of 30`);
  assert.equal(rateLimit(key, { limit: 30, windowMs: 10 * 60_000 }), false);
});
