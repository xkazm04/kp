// Direction 2 (queue-staleness) — the ONE staleness predicate shared by the AI
// review cards and the server wave path. Pinned so a future refactor can't quietly
// flip the boundary (strictly-before) or start firing on missing data.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isScoreStale } from "@/app/features/shared/decisionsTypes";

test("stale only when the score strictly predates the JD's last edit", () => {
  assert.equal(isScoreStale("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"), true, "scored before the edit → stale");
  assert.equal(isScoreStale("2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z"), false, "scored after the edit → fresh");
});

test("an equal timestamp is NOT stale (strictly-before, not on-or-before)", () => {
  const t = "2026-02-01T00:00:00Z";
  assert.equal(isScoreStale(t, t), false);
});

test("missing data is never stale — informs, never fabricates", () => {
  assert.equal(isScoreStale(null, "2026-02-01T00:00:00Z"), false, "unscored/snapshot entry (no scoredAt)");
  assert.equal(isScoreStale("2026-01-01T00:00:00Z", null), false, "never-edited JD (no jdEditedAt)");
  assert.equal(isScoreStale(null, null), false);
  assert.equal(isScoreStale(undefined, undefined), false);
});
