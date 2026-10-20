// Behaviour of the gig source store on an isolated throwaway DB - unit-db.ts must be the
// first project import (it sets KP_DB_PATH before any store opens a connection).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { GIG_INVALID_STREAK_LIMIT } from "../gigs/types.ts";
import {
  acknowledgeGigSource,
  createGigSource,
  getGigSource,
  listGigSources,
  pauseGigSource,
  recordGigSourceRun,
  recordGigSourceVerdict,
  resumeGigSource,
} from "./gigs-sources.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-sources";
const OTHER = "ws-gig-sources-other";

test("tier A is created enabled; tier B is created disabled and paused for terms_review", () => {
  const a = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: " GitHub.com ", config: { labels: ["bounty"] } });
  assert.equal(a.tier, "A");
  assert.equal(a.enabled, true);
  assert.equal(a.pausedReason, null);
  assert.equal(a.host, "github.com");
  assert.deepEqual(a.config, { labels: ["bounty"] });
  assert.equal(a.invalidStreak, 0);

  const b = createGigSource(WS, { adapter: "kaggle", arena: "competition", host: "kaggle.com", config: {} });
  assert.equal(b.tier, "B");
  assert.equal(b.enabled, false);
  assert.equal(b.pausedReason, "terms_review");
  assert.equal(b.acknowledgedAt, null);
});

test("an adapter cannot be filed under an arena it does not list", () => {
  assert.throws(() => createGigSource(WS, { adapter: "kaggle", arena: "security", host: "kaggle.com", config: {} }));
});

test("acknowledging enables and clears terms_review ONLY; a changed hash is recorded", () => {
  const b = createGigSource(WS, { adapter: "hackerone", arena: "security", host: "hackerone.com", config: {} });
  const acked = acknowledgeGigSource(WS, b.id, "hash-1");
  assert.ok(acked);
  assert.equal(acked.enabled, true);
  assert.equal(acked.pausedReason, null);
  assert.equal(acked.acknowledgedTermsHash, "hash-1");
  assert.ok(acked.acknowledgedAt);

  // A blocked source stays blocked through a re-acknowledgement.
  pauseGigSource(WS, b.id, "blocked");
  const again = acknowledgeGigSource(WS, b.id, "hash-2");
  assert.equal(again?.pausedReason, "blocked");
  assert.equal(again?.acknowledgedTermsHash, "hash-2");
});

test("resume is refused for a tier-B source never acknowledged, allowed once acknowledged", () => {
  const b = createGigSource(WS, { adapter: "freelancer_api", arena: "freelance", host: "freelancer.com", config: {} });
  assert.deepEqual(resumeGigSource(WS, b.id), { ok: false, reason: "terms_unacknowledged" });
  assert.equal(getGigSource(WS, b.id)?.pausedReason, "terms_review", "the refusal wrote nothing");
  acknowledgeGigSource(WS, b.id, "h");
  pauseGigSource(WS, b.id, "owner");
  const resumed = resumeGigSource(WS, b.id);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.ok && resumed.source.pausedReason, null);
  assert.deepEqual(resumeGigSource(WS, "gsrc-missing"), { ok: false, reason: "not_found" });
});

test("verdicts drive the invalid streak: rejected/duplicate count, accepted resets, no_response is neutral, the limit pauses", () => {
  const s = createGigSource(WS, { adapter: "algora", arena: "oss_bounty", host: "algora.io", config: {} });
  assert.deepEqual(recordGigSourceVerdict(WS, s.id, "rejected"), { invalidStreak: 1, paused: false });
  assert.deepEqual(recordGigSourceVerdict(WS, s.id, "duplicate"), { invalidStreak: 2, paused: false });
  assert.deepEqual(recordGigSourceVerdict(WS, s.id, "no_response"), { invalidStreak: 2, paused: false });
  assert.deepEqual(recordGigSourceVerdict(WS, s.id, "accepted"), { invalidStreak: 0, paused: false });

  let last = { invalidStreak: 0, paused: false };
  for (let i = 0; i < GIG_INVALID_STREAK_LIMIT; i += 1) last = recordGigSourceVerdict(WS, s.id, "rejected")!;
  assert.deepEqual(last, { invalidStreak: GIG_INVALID_STREAK_LIMIT, paused: true });
  assert.equal(getGigSource(WS, s.id)?.pausedReason, "invalid_streak");
  // A further rejection does not re-announce the pause.
  assert.deepEqual(recordGigSourceVerdict(WS, s.id, "rejected"), { invalidStreak: GIG_INVALID_STREAK_LIMIT + 1, paused: false });

  // Only the operator lifts it, and lifting resets the streak.
  const resumed = resumeGigSource(WS, s.id);
  assert.equal(resumed.ok && resumed.source.pausedReason, null);
  assert.equal(resumed.ok && resumed.source.invalidStreak, 0);
});

test("a run outcome is recorded without touching the pause", () => {
  const s = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: "github.com", config: {} });
  pauseGigSource(WS, s.id, "collapsed");
  assert.equal(recordGigSourceRun(WS, s.id, "skipped"), true);
  const after = getGigSource(WS, s.id);
  assert.equal(after?.lastOutcome, "skipped");
  assert.ok(after?.lastRunAt);
  assert.equal(after?.pausedReason, "collapsed");
});

test("another workspace sees and moves nothing", () => {
  const s = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: "github.com", config: {} });
  assert.equal(getGigSource(OTHER, s.id), null);
  assert.equal(listGigSources(OTHER).length, 0);
  assert.equal(pauseGigSource(OTHER, s.id, "owner"), null);
  assert.equal(acknowledgeGigSource(OTHER, s.id, "h"), null);
  assert.equal(recordGigSourceRun(OTHER, s.id, "failed"), false);
  assert.equal(recordGigSourceVerdict(OTHER, s.id, "rejected"), null);
  assert.deepEqual(resumeGigSource(OTHER, s.id), { ok: false, reason: "not_found" });
  const mine = getGigSource(WS, s.id);
  assert.equal(mine?.pausedReason, null);
  assert.equal(mine?.invalidStreak, 0);
  assert.ok(listGigSources(WS).some((x) => x.id === s.id));
});
