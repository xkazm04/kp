// bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2) — the live-session
// intake path is a SECOND submission path; these tests pin the guardrails it was
// missing: (A) the finalize route rejects a CLOSED posting 410 (matching the public
// inbound webhook) instead of minting a submission on an intake the recruiter closed;
// (B) session-start enforces a per-token/day cap so a leaked shareable apply token
// can't amplify into unbounded session rows; (C) appendDevSessionEvents enforces an
// absolute per-session event ceiling so one session can't accumulate unbounded rows.
//
// unit-db.ts MUST be the first project import: it sets KP_DB_PATH before any module
// touches db-path.ts, so every store below opens a throwaway isolated SQLite file.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  saveDevCase,
  createPosting,
  setPostingStatus,
  startDevSession,
  getDevSession,
  appendDevSessionEvents,
  getDevSessionEvents,
  MAX_SESSION_EVENTS,
} from "../../../_lib/db.ts";
import { POST as sessionPost, MAX_SESSIONS_PER_TOKEN_DAY } from "./route.ts";
import { POST as finalizePost } from "./[id]/submit/route.ts";

after(() => cleanupUnitDb());

let seedN = 0;
function seedOpenPosting(): { token: string; postingId: string } {
  const token = `tok-guard-${++seedN}`;
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } });
  const posting = createPosting({ caseId: dc.id, channel: "link", token, roleTitle: "Backend Engineer", caseTitle: "API case" });
  return { token, postingId: posting.id };
}

function startReq(token: string): Request {
  return new Request("http://localhost/api/devcase/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, candidateRef: "cand" }),
  });
}

function finalizeReq(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/devcase/session/${id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidate: "Ada", contact: "ada@example.test" }),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

test("finalize on a CLOSED posting answers 410 and mints no submission", async () => {
  const { token, postingId } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  // Recruiter closes the intake AFTER the candidate started the session.
  setPostingStatus(postingId, "closed");

  const [req, ctx] = finalizeReq(session.id);
  const res = await finalizePost(req, ctx);
  // Pre-fix the finalize route never checked posting.status, so it returned 200 and
  // created a submission on the closed posting — this asserted status was 200 then.
  assert.equal(res.status, 410, "a closed intake is rejected honestly, like the inbound webhook");
  assert.equal(getDevSession(session.id)!.submissionId, null, "no submission is minted on a closed posting");
});

test("finalize on an OPEN posting still succeeds (guard is not over-broad)", async () => {
  const { token } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  const [req, ctx] = finalizeReq(session.id);
  const res = await finalizePost(req, ctx);
  assert.equal(res.status, 200);
  assert.ok(getDevSession(session.id)!.submissionId, "an open posting still mints the linked submission");
});

test("session-start enforces the per-token/day cap (429 once the quota is hit)", async () => {
  const { token } = seedOpenPosting();
  // First start under the quota succeeds.
  assert.equal((await sessionPost(startReq(token))).status, 200);
  // Seed the token up to the cap directly, then the next START is throttled.
  for (let i = 1; i < MAX_SESSIONS_PER_TOKEN_DAY; i++) startDevSession({ token, candidateRef: "cand" });
  // Pre-fix there was NO cap, so this over-quota start returned 200 unconditionally.
  const res = await sessionPost(startReq(token));
  assert.equal(res.status, 429, "the token's daily session quota is exhausted");
});

test("appendDevSessionEvents caps total events per session at MAX_SESSION_EVENTS", () => {
  const { token } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  const now = Date.now();
  // One over-cap batch: pre-fix all of them inserted (no ceiling) → length MAX+5.
  const events = Array.from({ length: MAX_SESSION_EVENTS + 5 }, (_, i) => ({ t: now + i, kind: "edit", path: "src/x.ts" }));
  const seq = appendDevSessionEvents(session.id, events);
  assert.equal(seq, MAX_SESSION_EVENTS, "the high-water seq never exceeds the ceiling");
  assert.equal(getDevSessionEvents(session.id).length, MAX_SESSION_EVENTS, "excess events beyond the ceiling are dropped");
  // A further flush past the cap is a no-op that leaves the count unchanged.
  assert.equal(appendDevSessionEvents(session.id, [{ t: now, kind: "edit", path: "src/y.ts" }]), MAX_SESSION_EVENTS);
  assert.equal(getDevSessionEvents(session.id).length, MAX_SESSION_EVENTS);
});
