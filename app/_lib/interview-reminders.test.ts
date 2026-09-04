// The interview-reminder sweep had NO test. It is the one loop in the product that
// sends a candidate-facing message on a timer, with nobody watching, ~60s apart
// forever — and its whole design is a set of negatives that only a test can hold:
//
//   - exactly ONE delivery per confirmed interview (a duplicate "see you at your
//     interview" is a trust-eroding message, and a re-arm after a delivered-then-threw
//     dispatch is precisely how the old loop produced one);
//   - a failed attempt is left to AGE past its backoff, never released for an
//     immediate re-send (the old loop's re-claim/re-fail/re-release storm against a
//     down comms provider);
//   - the retry cap is terminal — at REMINDER_MAX_ATTEMPTS the invite leaves the
//     sweep for good rather than hammering the provider until the slot passes; and
//   - a candidate who has left the interview track (rejected/declined/Hired) is never
//     reminded, however live their booking still looks.
//
// The dispatcher is injected (`ReminderDispatch`, defaulting to the real one), so
// these run over a real SQLite file with no comms provider and no clock mocking:
// the backoff is exercised by ageing `reminder_last_attempt_at` in the DB, which is
// the same thing the passage of 60 seconds does.
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by the transitive `./db/*` slice imports.
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { actOnPipelineEntry, createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { confirmScheduleInvite, createScheduleInvite, getScheduleInviteByToken } from "./schedule-store.ts";
import { REMINDER_MAX_ATTEMPTS, reminderRetryDelayMs } from "./interview-reminder-policy.ts";
import { sendDueInterviewReminders, type ReminderDispatch } from "./interview-reminders.ts";

after(() => cleanupUnitDb());

const HOUR = 60 * 60 * 1000;
let seq = 0;

/** A confirmed booking six hours out: inside the 24h look-ahead window and well
 *  above the 2h short-notice floor, so the sweep owes it exactly one reminder. */
function bookedInvite(): { token: string; entryId: string } {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `cand-rem-${seq}`,
    candidateLabel: `Reminded Rita ${seq}`,
    jobId: `jd-rem-${seq}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
  });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  const slotAt = new Date(Date.now() + 6 * HOUR).toISOString();
  const res = confirmScheduleInvite(invite.token, `Slot ${seq}`, slotAt);
  assert.equal(res.ok, true, "the fixture booking confirms");
  return { token: invite.token, entryId: entry.id };
}

/** Pretend `ms` has passed since the last dispatch attempt. The sweep's backoff gate
 *  compares wall-clock now against `reminder_last_attempt_at + delay`, so winding the
 *  stamp backwards is equivalent to waiting — and keeps the test instant. */
function ageLastAttempt(token: string, ms: number): void {
  const db = new Database(UNIT_DB_PATH);
  try {
    const row = db.prepare(`SELECT reminder_last_attempt_at AS a FROM schedule_invites WHERE token = ?`).get(token) as
      | { a: string | null }
      | undefined;
    assert.ok(row?.a, "an attempt has actually been recorded to age");
    const aged = new Date(Date.parse(row.a as string) - ms).toISOString();
    db.prepare(`UPDATE schedule_invites SET reminder_last_attempt_at = ? WHERE token = ?`).run(aged, token);
  } finally {
    db.close();
  }
}

/** A dispatcher that fails its first `failures` calls, then succeeds, recording each
 *  invite it was asked to deliver to. */
function recorder(failures = 0) {
  const calls: string[] = [];
  const dispatch: ReminderDispatch = async (entry, slot) => {
    calls.push(`${entry.id ?? "—"}|${slot}`);
    if (calls.length <= failures) throw new Error("comms provider unreachable");
  };
  return { calls, dispatch };
}

test("one confirmed booking in the window gets exactly ONE reminder", async () => {
  const { token } = bookedInvite();
  const { calls, dispatch } = recorder();

  assert.equal(await sendDueInterviewReminders(undefined, dispatch), 1, "one delivery");
  assert.equal(calls.length, 1);
  const after1 = getScheduleInviteByToken(token);
  assert.ok(after1?.reminderSentAt, "terminal success is recorded");
  assert.equal(after1?.reminderAttempts, 1);

  // The load-bearing half: the next ~60s tick must not send it again. A reminded
  // candidate reminded twice is the failure this whole loop is shaped around.
  assert.equal(await sendDueInterviewReminders(undefined, dispatch), 0, "the second tick sends nothing");
  assert.equal(calls.length, 1, "and never touches the provider again");
});

test("a failed dispatch is NOT released — it ages past its backoff, then retries once and succeeds", async () => {
  const { token } = bookedInvite();
  const { calls, dispatch } = recorder(1); // the first attempt throws

  assert.equal(await sendDueInterviewReminders(undefined, dispatch), 0, "a throw is not a delivery");
  const failed = getScheduleInviteByToken(token);
  assert.equal(failed?.reminderAttempts, 1, "the attempt is recorded, not rolled back");
  assert.equal(failed?.reminderSentAt, null, "and nothing claims it was sent");
  assert.ok(failed?.reminderLastAttemptAt, "the attempt time is stamped for the backoff gate");

  // The IMMEDIATE next tick must do nothing: releasing here is what turned a down
  // provider into a re-claim/re-fail storm across every due invite.
  assert.equal(await sendDueInterviewReminders(undefined, dispatch), 0);
  assert.equal(calls.length, 1, "no second call before the backoff elapses");

  // …and once the backoff has elapsed, exactly one retry runs and it delivers.
  ageLastAttempt(token, reminderRetryDelayMs(1) + 1000);
  assert.equal(await sendDueInterviewReminders(undefined, dispatch), 1, "the retry delivers");
  assert.equal(calls.length, 2);
  const done = getScheduleInviteByToken(token);
  assert.ok(done?.reminderSentAt);
  assert.equal(done?.reminderAttempts, 2);
});

test("the retry cap is terminal — the sweep gives up instead of hammering the provider", async () => {
  const { token } = bookedInvite();
  const { calls, dispatch } = recorder(Number.MAX_SAFE_INTEGER); // never delivers

  for (let i = 1; i <= REMINDER_MAX_ATTEMPTS; i += 1) {
    assert.equal(await sendDueInterviewReminders(undefined, dispatch), 0, `attempt ${i} does not deliver`);
    assert.equal(getScheduleInviteByToken(token)?.reminderAttempts, i, `attempt ${i} is counted`);
    if (i < REMINDER_MAX_ATTEMPTS) ageLastAttempt(token, reminderRetryDelayMs(i) + 1000);
  }
  assert.equal(calls.length, REMINDER_MAX_ATTEMPTS, "the cap bounds the provider calls");

  // Past the cap the invite is out of the sweep FOR GOOD — ageing the backoff by a
  // day does not bring it back, which is the difference between "give up" and
  // "back off a lot".
  ageLastAttempt(token, 24 * HOUR);
  assert.equal(await sendDueInterviewReminders(undefined, dispatch), 0);
  assert.equal(calls.length, REMINDER_MAX_ATTEMPTS, "no attempt beyond the cap");
  assert.equal(getScheduleInviteByToken(token)?.reminderAttempts, REMINDER_MAX_ATTEMPTS);
  assert.equal(getScheduleInviteByToken(token)?.reminderSentAt, null, "and it is never falsely marked sent");
});

test("a candidate who has left the interview track is not reminded, however live the booking looks", async () => {
  const { token, entryId } = bookedInvite();
  // The candidate was rejected after booking. The slot is still confirmed and still
  // inside the look-ahead window, so nothing on the INVITE disqualifies it — only the
  // linked entry does (isEntryReminderEligible, reconciled in dueReminders).
  assert.ok(actOnPipelineEntry(entryId, "reject", "not a fit"), "the fixture rejection applies");
  assert.equal(getPipelineEntry(entryId)?.status, "rejected");

  const { calls, dispatch } = recorder();
  assert.equal(await sendDueInterviewReminders(undefined, dispatch), 0, "no reminder for a rejected candidate");
  assert.equal(calls.length, 0, "the provider is never called");
  const untouched = getScheduleInviteByToken(token);
  assert.equal(untouched?.reminderAttempts, 0, "and no attempt is even claimed");
  assert.equal(untouched?.status, "confirmed", "the booking itself is left alone");
});
