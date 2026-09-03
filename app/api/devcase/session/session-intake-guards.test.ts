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
  listOutboxFiltered,
  listSubmissions,
  MAX_SESSION_EVENTS,
} from "../../../_lib/db.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../_lib/db/workspaces.ts";
import { rateLimit } from "../../../_lib/rate-limit.ts";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the routes load (hooks only affect LATER
// resolutions — hence the dynamic imports below). A junction-linked worktree otherwise
// resolves next/server through two module identities, leaving the handlers' own
// NextResponse.json undefined and every assertion here unreachable.
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST: sessionPost } = await import("./route.ts");
const { MAX_SESSIONS_PER_TOKEN_DAY } = await import("./session-limits.ts");
const { POST: finalizePost } = await import("./[id]/submit/route.ts");
const { POST: flushPost } = await import("./[id]/route.ts");
const { submissionReference } = await import("../../../_lib/devcase-reference.ts");

// The finalize door's daily budget, written as a literal in the route (a route module
// may not `export const`). rate-limit-contract.test.ts pins the route's text; raising
// one without the other breaks the seeding loop below.
const FINALIZE_LIMIT = 60;

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

// The apply token rides the finalize call: a session id alone is not authority to seal
// someone else's session (see devcase-session-auth.ts).
function finalizeReq(id: string, token: string | null): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/devcase/session/${id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(token ? { token } : {}), candidate: "Ada", contact: "ada@example.test" }),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

test("finalize on a CLOSED posting answers 410 and mints no submission", async () => {
  const { token, postingId } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  // Recruiter closes the intake AFTER the candidate started the session.
  setPostingStatus(postingId, "closed");

  const [req, ctx] = finalizeReq(session.id, token);
  const res = await finalizePost(req, ctx);
  // Pre-fix the finalize route never checked posting.status, so it returned 200 and
  // created a submission on the closed posting — this asserted status was 200 then.
  assert.equal(res.status, 410, "a closed intake is rejected honestly, like the inbound webhook");
  assert.equal(getDevSession(session.id)!.submissionId, null, "no submission is minted on a closed posting");
});

test("finalize on an OPEN posting still succeeds (guard is not over-broad)", async () => {
  const { token } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  const [req, ctx] = finalizeReq(session.id, token);
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

// A session id is NOT a bearer capability. Pre-fix, the three mutating sub-routes
// authorized on session existence + status alone, so anyone holding an id could append
// events, OVERWRITE the submitted tree (destroying another candidate's work) and finalize
// the session early. Each now re-checks the apply token that minted it.
test("finalize without the owning apply token is refused 403 and mints no submission", async () => {
  const { token } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  const [req, ctx] = finalizeReq(session.id, null);
  const res = await finalizePost(req, ctx);
  assert.equal(res.status, 403, "a session id alone cannot seal the session");
  assert.equal(getDevSession(session.id)!.submissionId, null, "no submission is minted");
  // Not 404/409: those tell LiveWorkSurface to drop the id and re-mint, which would
  // spin the per-token/day session quota.
  assert.notEqual(res.status, 409);
});

test("flush with the WRONG apply token is refused 403 and writes nothing", async () => {
  const { token } = seedOpenPosting();
  const other = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  const flushReq = (t: string) =>
    flushPost(
      new Request(`http://localhost/api/devcase/session/${session.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: t, events: [{ t: Date.now(), kind: "edit", path: "src/x.ts" }] }),
      }),
      { params: Promise.resolve({ id: session.id }) }
    );
  assert.equal((await flushReq(other.token)).status, 403, "another posting's link is not authority here");
  assert.equal(getDevSessionEvents(session.id).length, 0, "the unauthorized append wrote nothing");
  // The owning token still works — the guard is not over-broad.
  assert.equal((await flushReq(token)).status, 200);
  assert.equal(getDevSessionEvents(session.id).length, 1);
});

// ---------------------------------------------------------------------------
// /perfect wave 23 (devcase-candidate-and-devcase). The finalize door called the
// STORE directly (`submitDevSession`) while both sibling intake doors — the public
// inbound webhook and the internal /api/devcase/submit — go through the shared
// `intakeSubmission` + `resumeCollectingLifecycle`. So the ONE submit path a
// workspace case has produced no candidate acknowledgement and resumed no
// lifecycle: the screen said "you'll hear back" and nothing was sent and nothing
// was evaluated.
test("finalizing a live session produces the candidate acknowledgement, like its siblings", async () => {
  const { token, postingId } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  const [req, ctx] = finalizeReq(session.id, token);
  const res = await finalizePost(req, ctx);
  assert.equal(res.status, 200);

  const submissionId = getDevSession(session.id)!.submissionId!;
  assert.ok(submissionId, "the session is still sealed and linked");
  // Pre-fix this was [] — the finalize door never touched the intake, so the outbox
  // held nothing for the submission and the candidate was never written to.
  const acks = listOutboxFiltered({ ref: submissionId, kind: "acknowledgement", limit: 5 }, DEFAULT_WORKSPACE_ID);
  assert.equal(acks.length, 1, "exactly one acknowledgement is recorded for the submission");
  // And exactly ONE submission row: the shared intake dedups onto the row the seal
  // just wrote (same posting/candidate/repo key) rather than minting a twin.
  assert.equal(listSubmissions(postingId, DEFAULT_WORKSPACE_ID).length, 1, "no duplicate submission row");
});

test("a repeated finalize is idempotent — one row, one acknowledgement", async () => {
  const { token, postingId } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  assert.equal((await finalizePost(...finalizeReq(session.id, token))).status, 200);
  assert.equal((await finalizePost(...finalizeReq(session.id, token))).status, 200);
  const submissionId = getDevSession(session.id)!.submissionId!;
  assert.equal(listSubmissions(postingId, DEFAULT_WORKSPACE_ID).length, 1);
  assert.equal(
    listOutboxFiltered({ ref: submissionId, kind: "acknowledgement", limit: 5 }, DEFAULT_WORKSPACE_ID).length,
    1,
    "the durable outbox marker stops a double-click acknowledging twice"
  );
});

test("the finalize door carries a per-apply-token limiter, and refuses through the chokepoint", async () => {
  const { token, postingId } = seedOpenPosting();
  // Spend the route's own budget on the shared in-process limiter (same module, same
  // config) — the rate-limit-contract idiom, so the key and the window are pinned
  // without 60 real intakes.
  for (let i = 0; i < FINALIZE_LIMIT; i++) {
    assert.equal(
      rateLimit(`devcase-finalize:${token}`, { limit: FINALIZE_LIMIT, windowMs: 24 * 60 * 60_000 }),
      true,
      `hit ${i + 1} must pass`
    );
  }
  const session = startDevSession({ token, candidateRef: "cand" });
  const res = await finalizePost(...finalizeReq(session.id, token));
  // Pre-fix there was NO limiter on this door at all, so this returned 200 and ran a
  // full intake (ack mail + lifecycle resume) on an exhausted link.
  assert.equal(res.status, 429, "the apply link's daily finalize budget is exhausted");
  assert.equal((await res.json()).code, "TOO_MANY_REQUESTS", "the refusal carries a code the surface can localize");
  assert.equal(getDevSession(session.id)!.submissionId, null, "a refused finalize seals nothing");
  assert.equal(listSubmissions(postingId, DEFAULT_WORKSPACE_ID).length, 0, "and writes no row");
});

test("the candidate is handed an OPAQUE reference, never the store id", async () => {
  const { token } = seedOpenPosting();
  const session = startDevSession({ token, candidateRef: "cand" });
  const res = await finalizePost(...finalizeReq(session.id, token));
  const body = (await res.json()) as { reference?: string; submissionId?: string };
  // Pre-fix the response carried only `submissionId` and the thank-you screen printed
  // it — an internal store key on a public wire, and the sole argument of the
  // (then ungated) skill-profile mint.
  assert.match(body.reference ?? "", /^ref-[0-9a-f]{10}$/, "a short one-way hash, not the id");
  assert.equal(body.submissionId, undefined, "the store id never rides the public wire");
  const linked = getDevSession(session.id)!.submissionId!;
  assert.equal(body.reference, submissionReference(linked), "deterministic, so it is quotable");
});
