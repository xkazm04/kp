// Locks the interview-reminder policy (idea-902261e7). The reminder sweep once
// reused a single 24h number as both the look-ahead window AND the skip threshold,
// so any booking confirmed < 24h before its slot silently received no reminder.
// These tests pin the now-distinct constants and the decided behaviour: short-
// notice confirms (within the floor) are covered by the confirmation note; every
// other in-window booking still gets a reminder.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REMINDER_LEAD_MS,
  REMINDER_MIN_NOTICE_MS,
  isShortNoticeBooking,
  isReminderDue,
} from "./interview-reminder-policy.ts";

const HOUR = 60 * 60 * 1000;
const NOW = 1_000_000_000_000; // fixed clock; Date.now() is never called by the policy

test("the two durations are distinct and ordered — the coincidental-24h collision can't reappear", () => {
  assert.equal(REMINDER_LEAD_MS, 24 * HOUR, "lead window is 24h");
  assert.ok(
    REMINDER_MIN_NOTICE_MS < REMINDER_LEAD_MS,
    `short-notice floor ${REMINDER_MIN_NOTICE_MS} must be strictly below the lead window ${REMINDER_LEAD_MS}`
  );
  assert.ok(REMINDER_MIN_NOTICE_MS > 0, "the floor is a positive duration");
});

test("isShortNoticeBooking is true only at/below the floor", () => {
  assert.equal(isShortNoticeBooking(NOW + REMINDER_MIN_NOTICE_MS - 1, NOW), true, "just under the floor → short notice");
  assert.equal(isShortNoticeBooking(NOW + REMINDER_MIN_NOTICE_MS, NOW), true, "exactly at the floor → short notice");
  assert.equal(isShortNoticeBooking(NOW + REMINDER_MIN_NOTICE_MS + 1, NOW), false, "just over the floor → not short notice");
});

test("a booking made well ahead is due a reminder once the slot enters the lead window", () => {
  // Confirmed 5 days ago, slot is 12h away → inside the 24h window, far above the floor.
  assert.equal(
    isReminderDue({ nowMs: NOW, slotAtMs: NOW + 12 * HOUR, bookedAtMs: NOW - 5 * 24 * HOUR }),
    true
  );
});

test("THE FIX: a sub-24h booking above the floor still gets a reminder (was silently skipped)", () => {
  // Booked 8h before the slot — previously slot-minus-booked (8h) ≤ window (24h) skipped it.
  assert.equal(
    isReminderDue({ nowMs: NOW, slotAtMs: NOW + 8 * HOUR, bookedAtMs: NOW }),
    true,
    "an 8h-notice booking is in-window, above the floor → reminder due"
  );
});

test("a short-notice booking gets no timed reminder (the confirmation note covers it)", () => {
  // Booked 1h before a 1h-away slot → within the floor.
  assert.equal(
    isReminderDue({ nowMs: NOW, slotAtMs: NOW + 1 * HOUR, bookedAtMs: NOW }),
    false
  );
});

test("slots outside the lead window are not yet due, and past slots never are", () => {
  assert.equal(isReminderDue({ nowMs: NOW, slotAtMs: NOW + 25 * HOUR, bookedAtMs: NOW - 48 * HOUR }), false, "beyond 24h → not yet");
  assert.equal(isReminderDue({ nowMs: NOW, slotAtMs: NOW - HOUR, bookedAtMs: NOW - 48 * HOUR }), false, "already passed → never");
  assert.equal(isReminderDue({ nowMs: NOW, slotAtMs: NOW, bookedAtMs: NOW - 48 * HOUR }), false, "exactly now → not due (strict >)");
});

test("an unknown confirm time does not suppress a reminder (missing data must not swallow it)", () => {
  assert.equal(
    isReminderDue({ nowMs: NOW, slotAtMs: NOW + 3 * HOUR, bookedAtMs: null }),
    true
  );
  assert.equal(
    isReminderDue({ nowMs: NOW, slotAtMs: NaN, bookedAtMs: NOW }),
    false,
    "an unparseable slot is filtered out, not reminded"
  );
});

test("the lead window is honored at its exact boundary", () => {
  assert.equal(
    isReminderDue({ nowMs: NOW, slotAtMs: NOW + REMINDER_LEAD_MS, bookedAtMs: NOW - 48 * HOUR }),
    true,
    "slot exactly at now+lead is inclusive"
  );
  assert.equal(
    isReminderDue({ nowMs: NOW, slotAtMs: NOW + REMINDER_LEAD_MS + 1, bookedAtMs: NOW - 48 * HOUR }),
    false,
    "one ms past the window is excluded"
  );
});
