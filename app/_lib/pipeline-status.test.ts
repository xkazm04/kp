// Locks the `pipeline_entries.status` lifecycle contract (idea-275e251e). The
// point of the taxonomy is that `rejected` (company passed) and `declined`
// (candidate turned us down) are DISTINCT terminal states — these tests fix the
// exact membership so the two can't quietly be collapsed back into one, and pin
// the terminal-state helper that readers use instead of string-comparing literals.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PIPELINE_ENTRY_STATUSES,
  TERMINAL_ENTRY_STATUSES,
  isPipelineEntryStatus,
  isTerminalEntryStatus,
  isEntryReminderEligible,
} from "./pipeline-status.ts";

test("the canonical status list is exactly the five documented states", () => {
  assert.deepEqual([...PIPELINE_ENTRY_STATUSES].sort(), ["active", "declined", "rejected", "rematched", "role_closed"]);
});

test("declined is a first-class status, distinct from rejected", () => {
  // The whole contract: a candidate-side decline is NOT a company-side reject.
  assert.equal(PIPELINE_ENTRY_STATUSES.includes("declined"), true);
  assert.equal(PIPELINE_ENTRY_STATUSES.includes("rejected"), true);
  assert.notEqual("declined", "rejected");
});

test("all terminal states are terminal — and active is not", () => {
  assert.deepEqual([...TERMINAL_ENTRY_STATUSES].sort(), ["declined", "rejected", "rematched", "role_closed"]);
  assert.equal(isTerminalEntryStatus("rejected"), true);
  assert.equal(isTerminalEntryStatus("declined"), true);
  // rematched is the redirect close (idea-9ad8a777): terminal for this role so the
  // candidate drops out of the active board + automation, distinct from reject/decline.
  assert.equal(isTerminalEntryStatus("rematched"), true);
  // role_closed is the role-filled/closed cascade (JOB2): terminal, distinct from a
  // company merit-reject so reject-rate stays honest.
  assert.equal(isTerminalEntryStatus("role_closed"), true);
  assert.equal(isTerminalEntryStatus("active"), false);
});

test("isTerminalEntryStatus is null-safe and rejects unknown values", () => {
  assert.equal(isTerminalEntryStatus(null), false);
  assert.equal(isTerminalEntryStatus(undefined), false);
  assert.equal(isTerminalEntryStatus("hired"), false);
  assert.equal(isTerminalEntryStatus(""), false);
});

test("isPipelineEntryStatus guards membership (null/typo are not statuses)", () => {
  assert.equal(isPipelineEntryStatus("active"), true);
  assert.equal(isPipelineEntryStatus("rejected"), true);
  assert.equal(isPipelineEntryStatus("declined"), true);
  assert.equal(isPipelineEntryStatus("rematched"), true);
  assert.equal(isPipelineEntryStatus("role_closed"), true);
  assert.equal(isPipelineEntryStatus("withdrawn"), false);
  assert.equal(isPipelineEntryStatus(null), false);
  assert.equal(isPipelineEntryStatus(undefined), false);
});

test("every terminal status is also a member of the full status set", () => {
  for (const s of TERMINAL_ENTRY_STATUSES) {
    assert.equal(isPipelineEntryStatus(s), true, `${s} must be a documented status`);
  }
});

// --- Interview-reminder eligibility (idea-d7a8d30e) -----------------------------
// The reminder sweep reconciles the schedule invite against the pipeline entry so a
// candidate who left the interview track never gets a "see you at your interview"
// for a call that won't happen. dueReminders applies THIS predicate, so locking it
// here pins the actual sweep behavior — not a copy that can drift.

test("an active, pre-Hired entry is still reminder-eligible (the legitimate interview keeps firing)", () => {
  assert.equal(isEntryReminderEligible({ status: "active", stage: "Interview" }), true);
  assert.equal(isEntryReminderEligible({ status: "active", stage: "Offer" }), true, "still active later in the funnel");
});

test("THE FIX: a rejected or declined entry is NOT reminder-eligible (left the track after booking)", () => {
  // Recruiter passed (ScheduleTab `act reject`) or the candidate declined — the
  // invite may still be 'confirmed' and in-window, but the call is off.
  assert.equal(isEntryReminderEligible({ status: "rejected", stage: "Interview" }), false, "company rejected → no reminder");
  assert.equal(isEntryReminderEligible({ status: "declined", stage: "Interview" }), false, "candidate declined → no reminder");
});

test("a Hired entry is NOT reminder-eligible even though its status stays 'active'", () => {
  // The whole reason status alone is insufficient: Hired keeps status='active'.
  assert.equal(isEntryReminderEligible({ status: "active", stage: "Hired" }), false);
});

test("an orphaned invite (no linked entry) stays eligible — preserves the pre-join behavior", () => {
  assert.equal(isEntryReminderEligible(null), true);
  assert.equal(isEntryReminderEligible(undefined), true);
});

test("every terminal status is excluded at the canonical interview stage", () => {
  // Belt-and-suspenders: whatever the terminal set is, none of it gets reminded.
  for (const s of TERMINAL_ENTRY_STATUSES) {
    assert.equal(isEntryReminderEligible({ status: s, stage: "Interview" }), false, `${s} must not be reminded`);
  }
});
