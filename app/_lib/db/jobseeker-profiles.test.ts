// Behaviour of the seeker's profile store on an isolated throwaway DB — unit-db.ts must
// be the first project import (it sets KP_DB_PATH before any store opens a connection).
// What is pinned here is the FEED ANCHOR, whose whole contract is "it never moves
// backwards": everything else about the anchor (the badge, the divider, the count) is
// derived from it, so a rewind would silently swallow postings the seeker never saw.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { EMPTY_PREFERENCES } from "../jobseeker/types.ts";
import { advanceFeedAnchor, getFeedAnchor, mergePreferences, upsertJobseekerProfile } from "./jobseeker-profiles.ts";

after(() => cleanupUnitDb());

const WS = "ws-anchor";
const T0 = "2026-09-16T08:00:00.000Z";
const T1 = "2026-09-16T09:00:00.000Z";

function profileFor(userId: string | null, workspaceId: string) {
  return upsertJobseekerProfile({ userId, profile: {} as never, preferences: EMPTY_PREFERENCES }, workspaceId);
}

test("the feed anchor starts empty, advances forward, and refuses every move backwards", () => {
  const profile = profileFor(null, WS);
  assert.equal(getFeedAnchor(profile.id, WS), null, "a seeker who has never had a settled feed load has no anchor");

  assert.deepEqual(advanceFeedAnchor(profile.id, { at: T0, id: "jpo-5" }, WS), { at: T0, id: "jpo-5" });
  // Later timestamp: moves. Same timestamp, larger id: moves (the tuple is the order).
  assert.deepEqual(advanceFeedAnchor(profile.id, { at: T1, id: "jpo-1" }, WS), { at: T1, id: "jpo-1" });
  assert.deepEqual(advanceFeedAnchor(profile.id, { at: T1, id: "jpo-2" }, WS), { at: T1, id: "jpo-2" });
  // Earlier timestamp, same timestamp with a smaller id, and the anchor itself: no-ops,
  // each answering the anchor as it STANDS rather than the one it was asked for.
  for (const stale of [
    { at: T0, id: "jpo-9" },
    { at: T1, id: "jpo-1" },
    { at: T1, id: "jpo-2" },
  ]) {
    assert.deepEqual(advanceFeedAnchor(profile.id, stale, WS), { at: T1, id: "jpo-2" }, JSON.stringify(stale));
  }
});

test("the anchor does not touch updated_at — reading the feed must not re-score the dataset", () => {
  const profile = profileFor("u-1", WS);
  advanceFeedAnchor(profile.id, { at: T1, id: "jpo-7" }, WS);
  const after = upsertJobseekerProfile(
    { userId: "u-1", profile: profile.profile, preferences: profile.preferences },
    WS
  );
  assert.ok(after.updatedAt >= profile.updatedAt);
  // The incremental matcher compares every stored score against updated_at
  // (listPostingsForMatching); an anchor advance is a READ, not a change of the inputs.
  const reread = profileFor("u-2", WS);
  advanceFeedAnchor(reread.id, { at: T1, id: "jpo-8" }, WS);
  const still = upsertJobseekerProfile({ userId: "u-2", profile: reread.profile, preferences: reread.preferences }, WS);
  assert.equal(getFeedAnchor(still.id, WS)?.id, "jpo-8", "and a profile write leaves the anchor alone");
});

test("the anchor is workspace-scoped: another workspace's id resolves nothing", () => {
  const mine = profileFor(null, "ws-anchor-a");
  advanceFeedAnchor(mine.id, { at: T1, id: "jpo-3" }, "ws-anchor-a");
  assert.equal(getFeedAnchor(mine.id, "ws-anchor-b"), null);
  assert.equal(advanceFeedAnchor(mine.id, { at: T1, id: "jpo-4" }, "ws-anchor-b"), null, "a foreign id writes nothing");
  assert.deepEqual(getFeedAnchor(mine.id, "ws-anchor-a"), { at: T1, id: "jpo-3" });
});

test("mergePreferences: an empty list from a dialog does not erase a stated one; a non-empty list replaces it", () => {
  const ws = "ws-merge";
  const profile = upsertJobseekerProfile({ userId: null, profile: {} as never, preferences: { ...EMPTY_PREFERENCES, locations: ["Brno"] } }, ws);
  // The cv_polish dialog closes with the preferences IT extracted; a turn that never
  // mentioned places hands back [] — which is "nothing said", not "no places".
  const merged = mergePreferences(profile.id, { locations: [] }, ws);
  assert.deepEqual(merged?.preferences.locations, ["Brno"]);
  assert.deepEqual(mergePreferences(profile.id, { locations: ["Praha"] }, ws)?.preferences.locations, ["Praha"]);
});
