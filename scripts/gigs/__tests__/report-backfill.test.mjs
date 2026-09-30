// report-backfill.mjs's pure half: argv, which gigs it asks for, the 429 wait.
// node --test scripts/gigs/__tests__/report-backfill.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STATUSES, parseArgs, pickGigs, retryAfterS } from "../report-backfill.mjs";

test("parseArgs: defaults, flags and refusals", () => {
  assert.deepEqual(parseArgs([]), { statuses: DEFAULT_STATUSES, kp: null, paceS: 35, max: 50, all: false, dryRun: false, help: false });
  const a = parseArgs(["--status", "drafted, sent", "--pace-s", "0", "--max", "3", "--all", "--dry-run", "--kp", "http://x:1"]);
  assert.deepEqual([a.statuses, a.paceS, a.max, a.all, a.dryRun, a.kp], [["drafted", "sent"], 0, 3, true, true, "http://x:1"]);
  assert.throws(() => parseArgs(["--nope"]), /unknown flag/);
  assert.throws(() => parseArgs(["--max", "-1"]), /non-negative/);
  assert.throws(() => parseArgs(["--status", "DROP TABLE"]), /gig statuses/);
});

test("pickGigs: researched gigs only, a ready report skipped unless --all, capped", () => {
  const gigs = [
    { id: "a", title: "A", status: "drafted", brief: {}, report: null },
    { id: "b", title: "B", status: "drafted", brief: null, report: null },
    { id: "c", title: "C", status: "in_review", brief: {}, report: { status: "ready", stage: "drafted" } },
    { id: "d", title: "D", status: "in_review", brief: {}, report: { status: "failed", stage: "planned" } },
  ];
  assert.deepEqual(pickGigs(gigs).map((g) => g.id), ["a", "d"]);
  assert.deepEqual(pickGigs(gigs, { all: true }).map((g) => g.id), ["a", "c", "d"]);
  assert.deepEqual(pickGigs(gigs, { all: true, max: 1 }).map((g) => g.id), ["a"]);
  assert.deepEqual(pickGigs("nope"), []);
});

test("retryAfterS: the header's seconds, capped, else a minute", () => {
  assert.equal(retryAfterS("12"), 12);
  assert.equal(retryAfterS("9999"), 600);
  assert.equal(retryAfterS(null), 60);
});
