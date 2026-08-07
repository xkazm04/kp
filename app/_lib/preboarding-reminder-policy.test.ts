import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPreboardingReminderDue,
  preboardingReminderCutoffIso,
  PREBOARDING_REMINDER_DELAY_MS,
} from "./preboarding-reminder-policy.ts";

const start = Date.parse("2026-06-20T00:00:00Z");
const justAfterDelay = start + PREBOARDING_REMINDER_DELAY_MS + 1;
const beforeDelay = start + PREBOARDING_REMINDER_DELAY_MS - 1;

test("due once the run has aged past the delay with no intake and no prior reminder", () => {
  assert.equal(
    isPreboardingReminderDue("2026-06-20T00:00:00Z", { intakeSubmitted: false, remindedAt: null, nowMs: justAfterDelay }),
    true
  );
});

test("not due before the delay elapses", () => {
  assert.equal(
    isPreboardingReminderDue("2026-06-20T00:00:00Z", { intakeSubmitted: false, remindedAt: null, nowMs: beforeDelay }),
    false
  );
});

test("a submitted intake never reminds", () => {
  assert.equal(
    isPreboardingReminderDue("2026-06-20T00:00:00Z", { intakeSubmitted: true, remindedAt: null, nowMs: justAfterDelay }),
    false
  );
});

test("an already-reminded run never reminds again (at-most-once)", () => {
  assert.equal(
    isPreboardingReminderDue("2026-06-20T00:00:00Z", {
      intakeSubmitted: false,
      remindedAt: "2026-06-23T00:00:00Z",
      nowMs: justAfterDelay,
    }),
    false
  );
});

test("a missing/invalid start fails closed (no nudge)", () => {
  assert.equal(isPreboardingReminderDue(null, { intakeSubmitted: false, nowMs: justAfterDelay }), false);
  assert.equal(isPreboardingReminderDue("not-a-date", { intakeSubmitted: false, nowMs: justAfterDelay }), false);
});

test("the cutoff is exactly now minus the delay", () => {
  const now = Date.parse("2026-06-25T00:00:00Z");
  assert.equal(preboardingReminderCutoffIso(now, 3 * 86_400_000), "2026-06-22T00:00:00.000Z");
});
