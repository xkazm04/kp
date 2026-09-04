// THROTTLE pin for the PUBLIC application webhook, driven through the REAL route handler.
//
// The defect: `/api/devcase/inbound` is on the public allow-list (public-routes.ts) and had
// no throttle at all, while every accepted call (a) writes a submission row, (b) sends the
// candidate acknowledgement over the comms relay to a CALLER-SUPPLIED address, and (c)
// resumes a collecting lifecycle — a real Python/LLM evaluation pass. The apply token is a
// deliberately shareable public link, so an unauthenticated holder varying `candidate` /
// `repoRef` (the dedup key) could drive all three without bound: an open mailer on the
// deployment's relay plus unmetered model spend. The sibling public paths already self-limit
// — session-start at 50 sessions/token/day, `[id]/chat` at 30/10min + 3000/24h per token.
//
// Both windows are keyed by the apply TOKEN, never the caller's IP: an abuser rotates IPs
// while genuine applicants behind one office/campus NAT share one (the devcase-chat
// rationale). The limiter is driven here by seeding the shared in-process limiter with the
// route's exact key + config, then asserting the route refuses — so the test pins the key,
// the budget AND the refusal envelope without 30 real intakes.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { rateLimit, RATE_LIMITED_ERROR } from "../../../_lib/rate-limit.ts";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { saveDevCase, createPosting, listSubmissions } = await import("../../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

// The route's budgets (BURST_LIMIT / DAILY_LIMIT in route.ts), pinned here: raising one
// without touching this file breaks the seeding loops below.
const BURST_LIMIT = 30;
const BURST_WINDOW_MS = 10 * 60_000;
const DAILY_LIMIT = 300;
const DAILY_WINDOW_MS = 24 * 60 * 60_000;

let seedN = 0;
function seedOpenPosting(): { token: string; postingId: string } {
  const token = `tok-inbound-${++seedN}`;
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } }, DEFAULT_WORKSPACE_ID);
  const posting = createPosting({ caseId: dc.id, channel: "link", token, roleTitle: "Backend Engineer", caseTitle: "API case" });
  return { token, postingId: posting.id };
}

/** The webhook reads its token from `request.nextUrl` (the public apply form sends it in
 *  the query string), which a plain Request does not carry — attach it explicitly rather
 *  than depending on next/server's NextRequest identity under the test loader. */
function inboundReq(token: string, candidate: string) {
  const url = `http://localhost/api/devcase/inbound?token=${encodeURIComponent(token)}`;
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidate, repoRef: `https://example.test/${candidate}`, contact: `${candidate}@example.test` }),
  });
  Object.defineProperty(req, "nextUrl", { value: new URL(url) });
  return req as never;
}

test("a genuine application still passes (the throttle is not over-broad)", async () => {
  const { token, postingId } = seedOpenPosting();
  const res = await POST(inboundReq(token, "ada"));
  assert.equal(res.status, 200);
  assert.equal(listSubmissions(postingId, DEFAULT_WORKSPACE_ID).length, 1, "the submission is recorded");
});

test("the per-token BURST window refuses the over-quota application — no row, no ack, no lifecycle resume", async () => {
  const { token, postingId } = seedOpenPosting();
  // Exhaust the route's own burst key (same shared limiter module, same config).
  for (let i = 0; i < BURST_LIMIT; i++) {
    assert.equal(rateLimit(`devcase-inbound:${token}`, { limit: BURST_LIMIT, windowMs: BURST_WINDOW_MS }), true, `hit ${i + 1} must pass`);
  }

  const res = await POST(inboundReq(token, "grace"));
  // Pre-fix there was NO limiter here, so this returned 200 and minted the submission.
  assert.equal(res.status, 429, "the token's burst budget is exhausted");
  // The shared 429 envelope, now produced by the refusal CHOKEPOINT: the same message
  // (REFUSAL_ERRORS.TOO_MANY_REQUESTS *is* RATE_LIMITED_ERROR) plus the machine code the
  // public apply form needs to say "throttled" in the reader's language.
  assert.deepEqual(await res.json(), { error: RATE_LIMITED_ERROR, code: "TOO_MANY_REQUESTS" });
  assert.equal(listSubmissions(postingId, DEFAULT_WORKSPACE_ID).length, 0, "a refused call writes nothing");
});

test("the per-token DAILY aggregate refuses too, so a slow drip can't spend all day", async () => {
  const { token, postingId } = seedOpenPosting();
  for (let i = 0; i < DAILY_LIMIT; i++) {
    assert.equal(rateLimit(`devcase-inbound-day:${token}`, { limit: DAILY_LIMIT, windowMs: DAILY_WINDOW_MS }), true, `hit ${i + 1} must pass`);
  }

  const res = await POST(inboundReq(token, "linus"));
  assert.equal(res.status, 429, "the token's daily budget is exhausted");
  assert.equal(listSubmissions(postingId, DEFAULT_WORKSPACE_ID).length, 0, "a refused call writes nothing");
});

test("a CLOSED intake keeps answering 410 without consuming the budget", async () => {
  // Lifecycle refusals must run BEFORE the throttle: a candidate arriving at a closed
  // posting deserves the honest 410, and that refusal must not eat a real applicant's slot.
  const { token, postingId } = seedOpenPosting();
  const { setPostingStatus } = await import("../../../_lib/db/devcase.ts");
  setPostingStatus(postingId, "closed");

  const res = await POST(inboundReq(token, "hopper"));
  assert.equal(res.status, 410);
  // The budget is untouched: BURST_LIMIT further hits still pass on this token's key.
  for (let i = 0; i < BURST_LIMIT; i++) {
    assert.equal(rateLimit(`devcase-inbound:${token}`, { limit: BURST_LIMIT, windowMs: BURST_WINDOW_MS }), true, `hit ${i + 1} must pass`);
  }
});
