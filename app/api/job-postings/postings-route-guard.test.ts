// Source guard for the posting-import route's trust boundary and refusal ORDER: the
// operator gate runs first, the cheap refusals precede the limiter, offline egress is
// refused UP FRONT (a decision, never a blocked-fetch accident), and every failure
// answers with a registered CODE rather than a thrown message. Mirrors the house
// source-guard style (rate-limit-contract.test.ts, intake/attachments-guard.test.ts)
// since node:test cannot resolve the "@/" alias.
//
// The BEHAVIOUR behind these markers is driven for real in
// app/_lib/db/job-postings.test.ts (seed once, then a no-op) and
// app/_lib/job-posting-fetch.test.ts (the HTML fixture, the refusals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** CRLF-normalised: a checkout with core.autocrlf=true would otherwise fail an ordering
 *  assertion for a line ending rather than for an order (rate-limit-contract.test.ts). */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

const src = read("./route.ts");
const idSrc = read("./[id]/route.ts");
const limitsSrc = read("./posting-import-limits.ts");
const publicRoutes = read("../../_lib/auth/public-routes.ts");

test("both handlers gate on the operator before any work", () => {
  for (const [name, text] of [["route.ts", src], ["[id]/route.ts", idSrc]] as const) {
    const gate = text.indexOf("await requireOperator()");
    assert.ok(gate >= 0, `${name} has no operator gate`);
    assert.ok(gate < text.indexOf("currentWorkspace()"), `${name} resolves the workspace before gating`);
  }
  assert.ok(src.indexOf("await requireOperator()") < src.indexOf("request.json"));
});

test("the posting routes are NOT on the public allow-list", () => {
  assert.ok(!/job-postings/.test(publicRoutes), "an operator-internal corpus route must never be public");
});

test("a paste under the floor is refused with POSTING_TEXT_REQUIRED, before the limiter", () => {
  const refusal = src.indexOf('jsonRefusal("POSTING_TEXT_REQUIRED", 400)');
  const limiter = src.indexOf("rateLimit(`job-postings-import:");
  assert.ok(refusal >= 0 && limiter >= 0);
  assert.ok(refusal < limiter, "a request that was never going to import must cost no budget");
  assert.match(src, /pastedText\.length < POSTING_MIN_CHARS/);
  assert.match(limitsSrc, /POSTING_MIN_CHARS = 200/);
});

test("a URL import under KP_OFFLINE is refused UP FRONT with POSTING_OFFLINE", () => {
  const offline = src.indexOf('jsonRefusal("POSTING_OFFLINE", 503)');
  assert.ok(offline >= 0, "the offline refusal is missing");
  assert.ok(offline < src.indexOf("rateLimit(`job-postings-import:"), "offline is a decision, so it is answered first");
  assert.ok(offline < src.indexOf("fetchPostingText("), "the guard must precede any fetch");
  assert.match(src, /if \(isOffline\(\)\) return jsonRefusal\("POSTING_OFFLINE", 503\)/);
});

test("the expensive work sits AFTER the limiter, with the pinned budget", () => {
  const limiter = src.indexOf("rateLimit(`job-postings-import:");
  assert.ok(limiter < src.indexOf("fetchPostingText(target.href)"));
  assert.ok(limiter < src.indexOf("seedJobPostingsCorpus(ws)"));
  assert.match(src, /\{ limit: 20, windowMs: 10 \* 60_000 \}/);
  assert.match(src, /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/);
});

test("a failed fetch or an unreadable page answers POSTING_FETCH_FAILED — never the thrown message", () => {
  assert.match(src, /jsonRefusal\("POSTING_FETCH_FAILED", 502\)/);
  // The pre-flight scheme/parse refusal is the same code at 400: nothing was fetched.
  assert.match(src, /jsonRefusal\("POSTING_FETCH_FAILED", 400\)/);
  // Accidents go through safeJsonError (raw error to the log, code to the client).
  assert.match(src, /safeJsonError\(error, "api:job-postings", "JOB_INGEST_FAILED"\)/);
  assert.match(src, /safeJsonError\(error, "api:job-postings", "JOB_LIST_FAILED"\)/);
  assert.ok(!/error: .*\.message/.test(src), "no handler may forward a thrown message");
});

test("an unknown posting id answers POSTING_NOT_FOUND from a workspace-scoped read", () => {
  assert.match(idSrc, /getJobPosting\(id, ws\)/);
  assert.match(idSrc, /jsonRefusal\("POSTING_NOT_FOUND", 404\)/);
  assert.match(idSrc, /safeJsonError\(error, "api:job-postings\/\[id\]", "JOB_LOAD_FAILED"\)/);
});

test("every store call carries the workspace — the route never reads a posting unscoped", () => {
  for (const call of [/listJobPostings\(ws,/, /getJobPosting\(id, ws\)/, /seedJobPostingsCorpus\(ws\)/]) {
    assert.match(src + idSrc, call);
  }
  assert.match(src, /insertJobPosting\(\s*\{[\s\S]*?\},\s*ws\s*\)/);
});

test("a stored body is capped, so one careers page cannot swallow the corpus", () => {
  assert.match(limitsSrc, /POSTING_MAX_CHARS = 60_000/);
  assert.match(src, /bodyText: text\.slice\(0, POSTING_MAX_CHARS\)/);
});
