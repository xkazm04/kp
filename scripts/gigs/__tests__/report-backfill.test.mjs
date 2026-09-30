// report-backfill.mjs's pure half: argv, which gigs it asks for, the 429 wait.
// node --test scripts/gigs/__tests__/report-backfill.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { daysLeft, DEFAULT_STATUSES, parseArgs, pickGigs, retryAfterS } from "../report-backfill.mjs";

test("parseArgs: defaults, flags and refusals", () => {
  assert.deepEqual(parseArgs([]), { statuses: DEFAULT_STATUSES, kp: null, paceS: 35, max: 50, all: false, dryRun: false, help: false, minDaysLeft: null, datedOnly: false, arenas: null });
  const d = parseArgs(["--min-days-left", "2", "--dated-only"]);
  assert.deepEqual([d.minDaysLeft, d.datedOnly], [2, true]);
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

test("pickGigs: --min-days-left keeps gigs with more than n days left, and undated ones unless --dated-only", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const gigs = [
    { id: "soon", status: "drafted", brief: {}, report: null, deadlineAt: "2026-10-02T11:00:00Z" },
    { id: "later", status: "drafted", brief: {}, report: null, deadlineAt: "2026-10-05T00:00:00Z" },
    { id: "gone", status: "drafted", brief: {}, report: null, deadlineAt: "2026-09-29T00:00:00Z" },
    { id: "open", status: "drafted", brief: {}, report: null, deadlineAt: null },
  ];
  assert.deepEqual(pickGigs(gigs, { now }).map((g) => g.id), ["soon", "later", "gone", "open"]);
  assert.deepEqual(pickGigs(gigs, { now, minDaysLeft: 2 }).map((g) => g.id), ["later", "open"]);
  assert.deepEqual(pickGigs(gigs, { now, minDaysLeft: 2, datedOnly: true }).map((g) => g.id), ["later"]);
  assert.deepEqual(pickGigs([{ ...gigs[1], arena: "freelance" }, { ...gigs[3], id: "b", arena: "oss_bounty" }], { now, arenas: ["oss_bounty"] }).map((g) => g.id), ["b"]);
  assert.equal(daysLeft(null, now), null);
  assert.equal(daysLeft("2026-10-01T12:00:00Z", now), 1);
});
