// The jobs corpus fetch. Its header has claimed since it was written that "the
// in-flight request is cancelled on the next change/unmount" — it was not: a
// `cancelled` boolean was flipped and the socket stayed open, so typing eight
// characters into the search box left eight live requests racing to the browser's
// per-host limit, each one decoding a full page of jobs nobody would read. The
// comment was the only cancellation in the file.
//
// The hook itself needs a React renderer this repo does not carry, so what is
// driven here is the pure pair the effect is built from — the query it sends and
// the payload it reads — plus a source guard on the abort wiring itself, which is
// the part a pure test cannot see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { jobsListQuery, readJobsListPayload, type JobsListFilters } from "./useJobsList.ts";

const NONE: JobsListFilters = { roleFamily: "", seniority: "", workMode: "", entryOnly: false, openOnly: false, q: "" };

test("an unfiltered corpus read sends no parameters at all", () => {
  assert.equal(jobsListQuery(NONE), "");
});

test("each filter contributes exactly its own parameter", () => {
  assert.equal(jobsListQuery({ ...NONE, roleFamily: "backend" }), "roleFamily=backend");
  assert.equal(jobsListQuery({ ...NONE, seniority: "medior" }), "seniority=medior");
  assert.equal(jobsListQuery({ ...NONE, workMode: "remote" }), "workMode=remote");
  // The wire names differ from the state names on purpose — that mapping is the
  // whole reason this is a function and not an inline template.
  assert.equal(jobsListQuery({ ...NONE, entryOnly: true }), "entryEligible=true");
  assert.equal(jobsListQuery({ ...NONE, openOnly: true }), "openOnly=true");
  // A false toggle is ABSENT, never `false`: the route reads presence.
  assert.equal(jobsListQuery({ ...NONE, entryOnly: false, openOnly: false }), "");
});

test("the search term is trimmed, and whitespace alone is not a search", () => {
  assert.equal(jobsListQuery({ ...NONE, q: "  rust  " }), "q=rust");
  assert.equal(jobsListQuery({ ...NONE, q: "   " }), "", "a whitespace-only box must not narrow the corpus");
  assert.equal(jobsListQuery({ ...NONE, q: "c++ & go" }), "q=c%2B%2B+%26+go", "the term is encoded, not interpolated");
});

test("every filter at once produces one stable query", () => {
  assert.equal(
    jobsListQuery({ roleFamily: "backend", seniority: "senior", workMode: "hybrid", entryOnly: true, openOnly: true, q: "go" }),
    "roleFamily=backend&seniority=senior&workMode=hybrid&entryEligible=true&openOnly=true&q=go"
  );
});

test("the payload reader keeps the three honesty fields only when they are all real", () => {
  const full = readJobsListPayload({ jobs: [{ id: "a" }], stats: { total: 1 }, truncated: true, matching: 42, limit: 300 });
  assert.deepEqual(full.page, { truncated: true, matching: 42, limit: 300 });
  assert.equal(full.jobs.length, 1);

  // A route that answers rows without the page facts leaves `page` null rather
  // than inventing a `truncated: false` the server never claimed.
  assert.equal(readJobsListPayload({ jobs: [], stats: null, truncated: false }).page, null);
  assert.equal(readJobsListPayload({ jobs: [], matching: 5 }).page, null);
  assert.equal(readJobsListPayload(null).page, null);
});

test("a missing jobs array reads as an empty corpus, never as undefined", () => {
  assert.deepEqual(readJobsListPayload(null).jobs, []);
  assert.deepEqual(readJobsListPayload({}).jobs, []);
  assert.equal(readJobsListPayload({}).stats, null);
  assert.deepEqual(readJobsListPayload({ jobs: "nope" }).jobs, [], "a non-array `jobs` is not a corpus");
});

// The part no pure test can reach: that the effect really aborts. CRLF-normalised
// because this checkout is CRLF while the worktree may be LF.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "useJobsList.ts"), "utf8").replace(/\r\n/g, "\n");

test("the corpus effect aborts its in-flight request, as its header claims", () => {
  assert.match(src, /new AbortController\(\)/, "the effect owns a controller");
  assert.match(src, /signal: controller\.signal/, "…which is handed to fetch");
  assert.match(src, /return \(\) => \{\n(.|\n)*?controller\.abort\(\)/, "…and aborted by the effect's cleanup");
  // The boolean it replaced must be gone: two cancellation mechanisms in one
  // effect is how the header came to describe one the code did not have.
  assert.ok(!/let cancelled = false/.test(src), "the `cancelled` flag was replaced, not doubled up");
});
