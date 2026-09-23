// The per-posting in-flight projection (challenge-r06 devcase-session-api/B).
//
// Nothing in the store counted active work sessions, so the recruiter closed an intake
// over candidates 40 minutes into a two-hour case without knowing it. This projection is
// what the postings GET carries: counts and the oldest live start, never an id.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPosting, saveDevCase, startDevSession } from "./devcase.ts";
import { ensureDb } from "./core.ts";
import { inFlightAttemptsByPosting, LIVE_WINDOW_MS } from "./devcase-inflight.ts";

after(() => cleanupUnitDb());

const WS = "workspace";
let n = 0;
function posting(workspaceId = WS) {
  const token = `tok-inflight-${++n}`;
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "Case" } }, workspaceId);
  return createPosting({ caseId: dc.id, channel: "link", token, roleTitle: "Backend Engineer", caseTitle: "Case" });
}

/** Pin a session's clock: created and last-active `createdMinsAgo` / `updatedMinsAgo` before `now`. */
function stamp(id: string, now: number, createdMinsAgo: number, updatedMinsAgo: number) {
  ensureDb()
    .prepare(`UPDATE dev_sessions SET created_at = ?, updated_at = ? WHERE id = ?`)
    .run(new Date(now - createdMinsAgo * 60_000).toISOString(), new Date(now - updatedMinsAgo * 60_000).toISOString(), id);
}

test("live = active and touched inside the window; idle = active and older; submitted is neither", () => {
  const now = Date.now();
  const p = posting();
  const a = startDevSession({ token: p.token, candidateRef: "a" });
  const b = startDevSession({ token: p.token, candidateRef: "b" });
  const c = startDevSession({ token: p.token, candidateRef: "c" });
  stamp(a.id, now, 45, 5);
  stamp(b.id, now, 240, 180);
  stamp(c.id, now, 30, 1);
  ensureDb().prepare(`UPDATE dev_sessions SET status = 'submitted' WHERE id = ?`).run(c.id);

  const byPosting = inFlightAttemptsByPosting(WS, now);
  assert.deepEqual(byPosting.get(p.id), {
    live: 1,
    idle: 1,
    oldestLiveStartedAt: new Date(now - 45 * 60_000).toISOString(),
  });
  assert.ok(LIVE_WINDOW_MS === 30 * 60_000, "the live window is 30 minutes");
});

test("the oldest LIVE start wins; an older idle session does not set it", () => {
  const now = Date.now();
  const p = posting();
  const young = startDevSession({ token: p.token });
  const old = startDevSession({ token: p.token });
  const stale = startDevSession({ token: p.token });
  stamp(young.id, now, 10, 1);
  stamp(old.id, now, 70, 2);
  stamp(stale.id, now, 600, 300);
  assert.deepEqual(inFlightAttemptsByPosting(WS, now).get(p.id), {
    live: 2,
    idle: 1,
    oldestLiveStartedAt: new Date(now - 70 * 60_000).toISOString(),
  });
});

test("another workspace's active session is not counted in this one", () => {
  const now = Date.now();
  const mine = posting();
  const theirs = posting("ws-other-team");
  stamp(startDevSession({ token: theirs.token }).id, now, 5, 1);
  const byPosting = inFlightAttemptsByPosting(WS, now);
  assert.equal(byPosting.has(theirs.id), false, "the other team's posting is not in this team's map");
  assert.equal(byPosting.has(mine.id), false, "a posting with no sessions has no entry");
  assert.equal(inFlightAttemptsByPosting("ws-other-team", now).get(theirs.id)?.live, 1);
});

test("a tokenless session belongs to no posting and is never counted", () => {
  const now = Date.now();
  const s = startDevSession({ token: null });
  stamp(s.id, now, 5, 1);
  const total = [...inFlightAttemptsByPosting(WS, now).values()].reduce((t, a) => t + a.live + a.idle, 0);
  const counted = ensureDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM dev_sessions s JOIN dev_postings p ON p.token = s.token WHERE s.status = 'active' AND p.workspace_id = ?`
    )
    .get(WS) as { n: number };
  assert.equal(total, Number(counted.n), "only sessions whose token resolves to a posting are counted");
});
