// The "book your interview" nudge for self-scheduling links nobody has used. Pins the
// negatives that make an unattended timer safe: a fresh link is left alone, an
// expired link is never nudged, one delivery per link, a booked link is dropped, a
// failed attempt waits out its backoff, and a nudge never marks the later confirmed
// interview reminder as sent (own nudge_* columns).
//
// testing/unit-db.ts MUST be the first project import (sets KP_DB_PATH).
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createPipelineEntry } from "./db/pipeline.ts";
import { confirmScheduleInvite, createScheduleInvite, getScheduleInviteByToken } from "./schedule-store.ts";
import { INVITE_LINK_TTL_MS } from "./schedule-slots.ts";
import {
  isScheduleNudgeDue,
  reminderRetryDelayMs,
  SCHEDULE_NUDGE_AFTER_MS,
} from "./interview-reminder-policy.ts";
import { sendDueScheduleNudges, type NudgeDispatch } from "./interview-reminders.ts";

after(() => cleanupUnitDb());

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

function pendingInvite(ageMs: number): { token: string; entryId: string } {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `cand-nudge-${seq}`,
    candidateLabel: `Nudged Nia ${seq}`,
    jobId: `jd-nudge-${seq}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
  });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  withDb((db) => db.prepare(`UPDATE schedule_invites SET created_at = ? WHERE token = ?`).run(new Date(Date.now() - ageMs).toISOString(), invite.token));
  return { token: invite.token, entryId: entry.id };
}

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(UNIT_DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function recorder(failures = 0) {
  const calls: string[] = [];
  const links: string[] = [];
  const dispatch: NudgeDispatch = async (entry, link) => {
    calls.push(entry.id ?? "-");
    links.push(link);
    if (calls.length <= failures) throw new Error("comms provider unreachable");
  };
  return { calls, links, dispatch };
}

test("policy: nudge window opens after the delay and closes at the link TTL", () => {
  const base = { nowMs: 10 * DAY, ttlMs: INVITE_LINK_TTL_MS };
  assert.equal(isScheduleNudgeDue({ ...base, anchorMs: base.nowMs - SCHEDULE_NUDGE_AFTER_MS + 1 }), false, "too fresh");
  assert.equal(isScheduleNudgeDue({ ...base, anchorMs: base.nowMs - SCHEDULE_NUDGE_AFTER_MS }), true, "old enough");
  assert.equal(isScheduleNudgeDue({ ...base, anchorMs: base.nowMs - INVITE_LINK_TTL_MS }), false, "expired link is dead");
  assert.equal(isScheduleNudgeDue({ ...base, anchorMs: Number.NaN }), false);
  assert.ok(SCHEDULE_NUDGE_AFTER_MS < INVITE_LINK_TTL_MS, "there is a window to nudge in");
});

test("a pending link past the delay is nudged exactly once, with its capability link", async () => {
  const { token, entryId } = pendingInvite(3 * DAY);
  const { calls, links, dispatch } = recorder();
  await sendDueScheduleNudges(dispatch);
  assert.deepEqual(calls.filter((c) => c === entryId), [entryId]);
  assert.ok(links.some((l) => l.endsWith(`/schedule/${token}`)), "the nudge carries the invite's own link");
  await sendDueScheduleNudges(dispatch);
  assert.equal(calls.filter((c) => c === entryId).length, 1, "the next tick never re-sends");
});

test("a fresh link and an expired link are left alone", async () => {
  const fresh = pendingInvite(1 * DAY);
  const expired = pendingInvite(INVITE_LINK_TTL_MS + DAY);
  const { calls, dispatch } = recorder();
  await sendDueScheduleNudges(dispatch);
  assert.ok(!calls.includes(fresh.entryId));
  assert.ok(!calls.includes(expired.entryId));
});

test("a booked (confirmed) invite is not nudged, and a sent nudge does not pre-empt its interview reminder", async () => {
  const booked = pendingInvite(3 * DAY);
  const res = confirmScheduleInvite(booked.token, "Slot", new Date(Date.now() + 40 * 60 * 60 * 1000).toISOString());
  assert.equal(res.ok, true);
  const { calls, dispatch } = recorder();
  await sendDueScheduleNudges(dispatch);
  assert.ok(!calls.includes(booked.entryId), "confirmed links are the reminder sweep's business");

  const nudged = pendingInvite(3 * DAY);
  await sendDueScheduleNudges(dispatch);
  assert.equal(getScheduleInviteByToken(nudged.token)?.reminderSentAt, null, "the interview reminder stays owed");
});

test("a failed nudge waits out its backoff, then retries once", async () => {
  const { token, entryId } = pendingInvite(3 * DAY);
  const { calls, dispatch } = recorder(1);
  await sendDueScheduleNudges(dispatch);
  assert.equal(calls.filter((c) => c === entryId).length, 1, "first attempt ran and threw");
  await sendDueScheduleNudges(dispatch);
  assert.equal(calls.filter((c) => c === entryId).length, 1, "no immediate retry");
  withDb((db) =>
    db
      .prepare(`UPDATE schedule_invites SET nudge_last_attempt_at = ? WHERE token = ?`)
      .run(new Date(Date.now() - reminderRetryDelayMs(1) - 1000).toISOString(), token)
  );
  await sendDueScheduleNudges(dispatch);
  assert.equal(calls.filter((c) => c === entryId).length, 2, "one retry after the backoff");
  await sendDueScheduleNudges(dispatch);
  assert.equal(calls.filter((c) => c === entryId).length, 2, "and delivered means done");
});
