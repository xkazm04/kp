// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before db-path
// evaluates). Store/lib-level coverage for the grid `book` server-side advance
// (Direction: close the grid-book drift gap). The POST /api/schedule route itself
// imports next/server, whose worktree artifact fails to resolve under bare
// `node --test`, so we pin the exact primitive SEQUENCE the book handler runs —
// resolve the grid pick, confirm the invite, advance the linked entry via
// approve_event, and seal the decision — proving the booking and the stage advance
// happen together (no confirmed booking left with an un-advanced entry).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, setApproval, actOnPipelineEntry } from "./db/pipeline.ts";
import { createScheduleInvite, confirmScheduleInvite, rescheduleScheduleInvite, getScheduleInviteByToken } from "./schedule-store.ts";
import { sealDecisionSafe, listDecisionRecords } from "./decision-record-store.ts";
import { gridSlotToIso, scheduledSealOutcome } from "./schedule-slots.ts";

after(() => cleanupUnitDb());

let seq = 0;
function calendarEntry() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `grid-c${seq}`,
    candidateLabel: `Grid Candidate ${seq}`,
    jobId: `grid-job-${seq}`,
    jobTitle: "Grid Role",
    stage: "Interview",
  });
  // Queue the entry on the calendar gate, exactly as an accepted screening does.
  setApproval(entry.id, "calendar", "Tue 14:00");
  return entry;
}

test("grid book confirms the invite AND advances the entry off the calendar gate + seals a decision", () => {
  const entry = calendarEntry();
  const resolved = gridSlotToIso("Wed 11:00");
  assert.ok(resolved, "the grid pick resolves to a canonical instant");

  // The exact sequence POST /api/schedule action:"book" runs server-side.
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  const booked = confirmScheduleInvite(invite.token, resolved!.label, resolved!.value);
  assert.ok(booked.ok, "the invite confirms at the resolved instant");
  actOnPipelineEntry(entry.id, "approve_event", resolved!.label);
  sealDecisionSafe({
    kind: "interview_scheduled",
    actor: "human:recruiter",
    policyVersion: "manual",
    candidateRef: entry.id,
    rationale: `Recruiter booked the interview on the week grid (${resolved!.label}).`,
    reasonCode: "interview_scheduled",
    inputs: { slot: resolved!.label, slotAt: resolved!.value },
  });

  const after = getPipelineEntry(entry.id);
  assert.equal(after?.approvalKind, null, "the entry advanced off the calendar gate (no drift)");
  assert.equal(getScheduleInviteByToken(invite.token)?.status, "confirmed", "the booking stands");
  assert.equal(getScheduleInviteByToken(invite.token)?.slotAt, resolved!.value, "at the booked instant");
  const sealed = listDecisionRecords({ candidateRef: entry.id });
  assert.ok(sealed.some((d) => d.kind === "interview_scheduled"), "the grid book seals an interview_scheduled decision");
});

test("re-booking a confirmed grid invite moves it (recruiter authority) and stays advanced — idempotent, no drift", () => {
  const entry = calendarEntry();
  // Distinct instants from the other tests (they share the unit-db calendar).
  const first = gridSlotToIso("Thu 15:00")!;
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  assert.ok(confirmScheduleInvite(invite.token, first.label, first.value).ok, "setup booking confirms");
  actOnPipelineEntry(entry.id, "approve_event", first.label);

  // A second book for the same entry reuses the live invite and MOVES it with
  // recruiter authority (no candidate reschedule cap consumed).
  const reused = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  assert.equal(reused.token, invite.token, "book is idempotent per entry — reuses the live invite");
  assert.equal(reused.status, "confirmed");
  const second = gridSlotToIso("Fri 16:00")!;
  const moved = rescheduleScheduleInvite(reused.token, second.label, second.value, null, { recruiter: true });
  assert.ok(moved.ok, "recruiter re-book moves the confirmed invite");
  assert.equal(moved.ok && moved.invite.rescheduleCount, 0, "a recruiter move doesn't spend the candidate's reschedule budget");
  actOnPipelineEntry(entry.id, "approve_event", second.label);

  const after = getPipelineEntry(entry.id);
  assert.equal(after?.approvalKind, null, "still advanced after the re-book (no stale calendar gate)");
  assert.equal(getScheduleInviteByToken(reused.token)?.slotAt, second.value, "moved to the new instant");
});

test("integrity fix: a grid book whose entry can't advance seals a QUALIFIED outcome, not a clean 'scheduled'", () => {
  const entry = calendarEntry();
  const resolved = gridSlotToIso("Tue 10:00")!;
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  assert.ok(confirmScheduleInvite(invite.token, resolved.label, resolved.value).ok, "setup booking confirms");
  // Close the candidate AFTER booking, so approve_event no-ops (returns null → not advanced).
  actOnPipelineEntry(entry.id, "reject");

  // The EXACT sequence the route now runs: attempt the advance, derive the seal outcome
  // from whether it landed, then seal. Previously the route sealed a clean "scheduled"
  // UNCONDITIONALLY — a tamper-evident record asserting a state the pipeline never reached.
  const advanced = actOnPipelineEntry(entry.id, "approve_event", resolved.label) != null;
  assert.equal(advanced, false, "a terminal entry does not advance");
  const outcome = scheduledSealOutcome(advanced);
  sealDecisionSafe({
    kind: "interview_scheduled",
    actor: "human:recruiter",
    policyVersion: "manual",
    candidateRef: entry.id,
    rationale: `Recruiter booked the interview on the week grid (${resolved.label}).${outcome.note}`,
    reasonCode: outcome.reasonCode,
    inputs: { slot: resolved.label, slotAt: resolved.value, advanced },
  });

  const sched = listDecisionRecords({ candidateRef: entry.id }).find((d) => d.kind === "interview_scheduled");
  assert.ok(sched, "the decision is still recorded — the booking really happened");
  assert.equal(sched!.reasonCode, "interview_scheduled_unconfirmed", "but the outcome is honestly qualified, not a clean 'scheduled'");
});

test("a grid book on a terminal entry does not resurrect it — approve_event is a no-op the route would flag", () => {
  const entry = calendarEntry();
  const resolved = gridSlotToIso("Mon 09:00")!;
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  assert.ok(confirmScheduleInvite(invite.token, resolved.label, resolved.value).ok, "setup booking confirms");
  // Reject the entry AFTER the invite exists (a since-closed candidate).
  actOnPipelineEntry(entry.id, "reject");
  const before = getPipelineEntry(entry.id);
  assert.equal(before?.status, "rejected");

  // approve_event returns null for a terminal entry (no throw) — the booking stands
  // but the stage is untouched, exactly as accept_proposal handles it.
  const res = actOnPipelineEntry(entry.id, "approve_event", resolved.label);
  assert.equal(res, null, "approve_event refuses to resurrect a terminal entry");
  assert.equal(getPipelineEntry(entry.id)?.status, "rejected", "still terminal");
});
