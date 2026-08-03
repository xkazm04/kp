// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — pins the lifecycle
// panel's bucketing. Non-vacuity: the pre-fix panel had only attention/upcoming
// (future-only)/awaiting; a confirmed slot at-or-just-past "now" landed in NONE of
// them (see `legacyUpcoming` below, which replicates the old predicate and drops
// the row). The `today` bucket keeps those visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketInvites, canReinvite, closedReason, hasPendingProposals, isInProgress, RECENT_WINDOW_MS } from "./scheduleInviteLifecycleBuckets.ts";
import { INVITE_LINK_TTL_DAYS } from "@/app/_lib/schedule-slots";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";

const NOW = Date.parse("2026-06-01T10:00:00.000Z");

function inv(over: Partial<ScheduleInvite>): ScheduleInvite {
  return {
    id: over.id ?? `id-${Math.random()}`,
    token: over.token ?? "tok",
    entryId: "e",
    candidateLabel: "C",
    jobTitle: "R",
    status: "pending",
    slot: null,
    slotAt: null,
    reminderSentAt: null,
    reminderAttempts: 0,
    reminderLastAttemptAt: null,
    needsReconcile: false,
    reconcileReason: null,
    needsMoreSlots: false,
    moreSlotsFlaggedAt: null,
    durationMin: null,
    rescheduleCount: 0,
    candidateTz: null,
    attendanceStatus: null,
    attendanceAt: null,
    meetingUrl: null,
    proposals: null,
    proposalsAt: null,
    proposalStatus: null,
    calendarEventId: null,
    calendarEventLink: null,
    calendarEventState: null,
    calendarEventAt: null,
    locale: null,
    entryStatus: null,
    entryStage: null,
    workspaceId: "workspace",
    createdAt: "2026-06-01T00:00:00.000Z",
    confirmedAt: null,
    ...over,
  };
}

// The old future-only rule, kept here purely to demonstrate the bug this fixes.
const legacyUpcoming = (list: ScheduleInvite[]) =>
  list.filter((i) => i.status === "confirmed" && i.slotAt && Date.parse(i.slotAt) >= NOW);

test("a confirmed slot that just passed stays visible in `today` (not dropped as pre-fix)", () => {
  const justPast = inv({ id: "past", status: "confirmed", slotAt: "2026-06-01T09:30:00.000Z", durationMin: 30 });
  const { upcoming, today, awaiting, attention } = bucketInvites([justPast], NOW);
  assert.equal(today.length, 1, "just-past confirmed interview is in `today`");
  assert.equal(today[0].id, "past");
  assert.equal(upcoming.length, 0);
  assert.equal(awaiting.length, 0);
  assert.equal(attention.length, 0);
  // Non-vacuity: the pre-fix predicate would have shown it nowhere.
  assert.equal(legacyUpcoming([justPast]).length, 0, "old rule dropped it from upcoming");
});

test("future confirmed → upcoming (sorted), old-past → dropped, non-confirmed → awaiting", () => {
  const future2 = inv({ id: "f2", status: "confirmed", slotAt: "2026-06-01T14:00:00.000Z" });
  const future1 = inv({ id: "f1", status: "confirmed", slotAt: "2026-06-01T12:00:00.000Z" });
  const ancient = inv({ id: "old", status: "confirmed", slotAt: "2026-05-20T09:00:00.000Z" });
  const pending = inv({ id: "p", status: "pending" });
  const { upcoming, today, awaiting } = bucketInvites([future2, future1, ancient, pending], NOW);
  assert.deepEqual(upcoming.map((i) => i.id), ["f1", "f2"], "upcoming sorted ascending by slot");
  assert.equal(today.length, 0);
  assert.ok(!upcoming.concat(today).some((i) => i.id === "old"), "an interview past the grace window is not shown");
  assert.deepEqual(awaiting.map((i) => i.id), ["p"]);
});

test("flagged rows go to attention and never double-count in another bucket", () => {
  const flagged = inv({ id: "flag", status: "confirmed", slotAt: "2026-06-01T12:00:00.000Z", needsReconcile: true });
  const { attention, upcoming, today } = bucketInvites([flagged], NOW);
  assert.deepEqual(attention.map((i) => i.id), ["flag"]);
  assert.equal(upcoming.length, 0, "attention row not also in upcoming");
  assert.equal(today.length, 0);
});

test("a slot exactly at `now` stays visible (no >=-flicker disappearance)", () => {
  const atNow = inv({ id: "now", status: "confirmed", slotAt: "2026-06-01T10:00:00.000Z" });
  const { upcoming, today } = bucketInvites([atNow], NOW);
  assert.equal(upcoming.length + today.length, 1, "the boundary slot is shown, not hidden");
});

test("recent window boundary: past the window → not shown", () => {
  const edge = new Date(NOW - RECENT_WINDOW_MS - 60_000).toISOString();
  const stale = inv({ id: "stale", status: "confirmed", slotAt: edge });
  const { today, upcoming, awaiting } = bucketInvites([stale], NOW);
  assert.equal(today.length + upcoming.length + awaiting.length, 0);
});

test("isInProgress is true only between start and planned end", () => {
  assert.equal(isInProgress("2026-06-01T09:45:00.000Z", 30, NOW), true, "started 15m ago, 30m long → in progress");
  assert.equal(isInProgress("2026-06-01T09:00:00.000Z", 30, NOW), false, "finished 30m ago");
  assert.equal(isInProgress("2026-06-01T11:00:00.000Z", 30, NOW), false, "not started yet");
  assert.equal(isInProgress("2026-06-01T09:45:00.000Z", null, NOW), false, "unknown duration → no claim");
});

// --- Direction 1: terminal fates land in the `closed` bucket, not attention/awaiting
test("declined / no_show / expired invites bucket as `closed` and out of the live buckets", () => {
  const ttlDays = 7;
  const declined = inv({ id: "d", status: "declined" });
  const noShow = inv({ id: "n", status: "no_show", slotAt: "2026-05-30T10:00:00.000Z" });
  // A stale, never-booked pending link (created > TTL ago) is derived-expired.
  const expired = inv({ id: "e", status: "pending", createdAt: new Date(NOW - (ttlDays + 1) * 86_400_000).toISOString() });
  const livePending = inv({ id: "p", status: "pending", createdAt: new Date(NOW - 60_000).toISOString() });
  const { closed, awaiting, attention, upcoming, today } = bucketInvites([declined, noShow, expired, livePending], NOW);
  assert.deepEqual(closed.map((i) => i.id).sort(), ["d", "e", "n"], "all three terminal fates are closed");
  assert.deepEqual(awaiting.map((i) => i.id), ["p"], "only the live pending link still awaits a booking");
  assert.equal(attention.length, 0);
  assert.equal(upcoming.length + today.length, 0);
});

test("closedReason names the fate and a terminal row never appears in attention despite a stale flag", () => {
  assert.equal(closedReason(inv({ status: "declined" }), NOW), "declined");
  assert.equal(closedReason(inv({ status: "no_show" }), NOW), "no_show");
  assert.equal(closedReason(inv({ status: "confirmed", slotAt: "2026-06-01T12:00:00.000Z" }), NOW), null);
  // A no_show that still carries needsReconcile is closed, not surfaced as attention.
  const flaggedNoShow = inv({ id: "fn", status: "no_show", needsReconcile: true, slotAt: "2026-05-30T10:00:00.000Z" });
  const { closed, attention } = bucketInvites([flaggedNoShow], NOW);
  assert.deepEqual(closed.map((i) => i.id), ["fn"]);
  assert.equal(attention.length, 0, "a terminal row is not an actionable attention row");
});

// --- "Propose your own times" escalation surfaces as attention-worthy
test("a pending-proposals invite is attention-worthy, even a confirmed one past the cap", () => {
  const props = [{ value: "2026-06-09T11:00:00.000Z", label: "Tue 9 Jun · 11:00" }];
  // A confirmed invite would normally be upcoming; a pending proposal pulls it to attention.
  const capped = inv({ id: "cap", status: "confirmed", slotAt: "2026-06-01T14:00:00.000Z", proposals: props, proposalStatus: "pending" });
  const stalled = inv({ id: "stall", status: "pending", needsMoreSlots: true, proposals: props, proposalStatus: "pending" });
  // A cleared/declined proposal is NOT attention.
  const declined = inv({ id: "dec", status: "confirmed", slotAt: "2026-06-01T14:00:00.000Z", proposalStatus: "declined" });
  const { attention, upcoming } = bucketInvites([capped, stalled, declined], NOW);
  assert.deepEqual(attention.map((i) => i.id).sort(), ["cap", "stall"], "pending proposals are attention rows");
  assert.deepEqual(upcoming.map((i) => i.id), ["dec"], "a declined-proposal confirmed invite is a normal upcoming row");
  assert.equal(hasPendingProposals(capped), true);
  assert.equal(hasPendingProposals(declined), false);
});

// --- Direction: re-invite from the Closed bucket -------------------------------
test("canReinvite: only a CLOSED invite whose linked entry is still on-track can be re-invited", () => {
  // A declined invite for an entry that's still active → re-invitable.
  const declinedActive = inv({ id: "da", status: "declined", entryStatus: "active", entryStage: "Interview" });
  assert.equal(canReinvite(declinedActive, NOW), true, "declined + active entry → re-invite");

  // A no_show whose entry has since been rejected → NOT re-invitable (terminal entry).
  const noShowRejected = inv({ id: "nr", status: "no_show", slotAt: "2026-05-30T10:00:00.000Z", entryStatus: "rejected", entryStage: "Interview" });
  assert.equal(canReinvite(noShowRejected, NOW), false, "terminal entry → no re-invite");

  // A no_show whose entry reached Hired (status stays active) → NOT re-invitable.
  const hired = inv({ id: "hi", status: "no_show", slotAt: "2026-05-30T10:00:00.000Z", entryStatus: "active", entryStage: "Hired" });
  assert.equal(canReinvite(hired, NOW), false, "hired entry → no re-invite");

  // An EXPIRED pending link (derived from age) with an active entry → re-invitable.
  const expired = inv({ id: "ex", status: "pending", entryStatus: "active", entryStage: "Interview", createdAt: new Date(NOW - (INVITE_LINK_TTL_DAYS + 1) * 86_400_000).toISOString() });
  assert.equal(closedReason(expired, NOW), "expired", "the link has aged out");
  assert.equal(canReinvite(expired, NOW), true, "expired + active entry → re-invite");

  // A LIVE invite (not closed) is never a re-invite candidate.
  const live = inv({ id: "lv", status: "confirmed", slotAt: "2026-06-05T10:00:00.000Z", entryStatus: "active", entryStage: "Interview" });
  assert.equal(canReinvite(live, NOW), false, "a live invite is not re-invited from Closed");

  // A closed invite whose entry wasn't joined (null) stays re-invitable (orphan-safe,
  // mirrors the reminder rule) — but only when it still carries an entryId to key on.
  const orphanJoin = inv({ id: "oj", status: "declined", entryStatus: null, entryStage: null });
  assert.equal(canReinvite(orphanJoin, NOW), true, "unknown entry state → re-invitable (like reminder eligibility)");
  const noEntry = inv({ id: "ne", status: "declined", entryId: null, entryStatus: null });
  assert.equal(canReinvite(noEntry, NOW), false, "no linked entry → nothing to re-invite");
});
