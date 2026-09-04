import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// SCH2 — rescheduleScheduleInvite is the collision authority for a candidate
// self-reschedule (a PUBLIC, email-sending flow). These tests pin its contract
// against a throwaway SQLite file, loading the REAL schedule-store so the
// transaction/guard can't drift from a copied-out gate: it moves a confirmed
// booking, rejects a slot another candidate holds (taken), refuses a pending
// invite (not_confirmed), is bounded (limit), no-ops an unchanged slot, frees the
// old slot, and resets the reminder cycle so the reminder fires for the NEW time.

// schedule-store transitively imports extensionless TS siblings (./db-path,
// ./random-id, ./interview-reminder-policy, ./pipeline-status) — how Next/tsc
// resolve, but not bare `node --test`. Same minimal resolve hook the other
// real-module tests use (see offers-store.test.ts).
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
});

// Point the store at a throwaway DB BEFORE importing it: db-path reads KP_DB_PATH at
// module load (DB_PATH is frozen then), so this MUST stay the first project import;
// the store opens its connection lazily.
//
// It used to be a hand-rolled `os.tmpdir()/kp-schedule-store-test-${process.pid}.sqlite`.
// `--test-isolation=process` gives each FILE a fresh process, but the OS RECYCLES pids:
// a later run drawing a pid this file used before re-opens that run's leftover database
// and inherits its committed invites/booked slots (see 7c63692, the billing-suite flake).
// unit-db.ts is the repo-wide fix: a mkdtemp'd run directory (unique by construction,
// never pid-derived), a liveness-gated sweep of abandoned dirs, and cleanupUnitDb().
const { cleanupUnitDb, UNIT_DB_PATH: TMP } = await import("./testing/unit-db.ts");

const {
  createScheduleInvite,
  confirmScheduleInvite,
  rescheduleScheduleInvite,
  getScheduleInviteByToken,
  confirmAttendance,
  cancelAttendance,
  declineScheduleInvite,
  markScheduleInviteNoShow,
  markScheduleInviteNeedsReconcile,
  resolveScheduleInviteReconcile,
  setScheduleInviteProposals,
  declineScheduleInviteProposals,
  bookedSlots,
  isTerminalScheduleInviteStatus,
  MAX_RESCHEDULES,
  countFutureConfirmedInvites,
  recordCalendarEvent,
  flagScheduleInviteNeedsMoreSlots,
  claimReminderAttempt,
  markReminderSent,
} = await import("./schedule-store.ts");
const { INVITE_LINK_TTL_DAYS, gridSlotToIso, isoToGridSlot, isScheduleInviteExpired } = await import("./schedule-slots.ts");

// Mint a confirmed invite at a specific slot, returning its token. Each test uses
// globally-unique slot_at times so confirmed rows from other tests can't collide.
function makeConfirmed(slotAt: string, slot = slotAt): string {
  const inv = createScheduleInvite({ entryId: `e-${slotAt}`, candidateLabel: "Test Candidate", jobTitle: "Role" });
  const r = confirmScheduleInvite(inv.token, slot, slotAt);
  assert.ok(r.ok, "setup confirm should succeed");
  return inv.token;
}

// Closes the memoized main connection and removes this run's temp dir. The store's own
// isolated handle has no close API, so on Windows the delete can fail — the fixture's
// liveness-gated sweep reclaims the dir on a later run instead.
after(cleanupUnitDb);

// --- Direction 1: terminal state machine (decline / no_show / expired) ----------

test("declineScheduleInvite closes a pending invite terminally", () => {
  const inv = createScheduleInvite({ entryId: "e-decline-pending", candidateLabel: "P", jobTitle: "Role" });
  const out = declineScheduleInvite(inv.token);
  assert.equal(out?.status, "declined");
  assert.equal(isTerminalScheduleInviteStatus(out!.status), true);
  // Already terminal → not re-declinable.
  assert.equal(declineScheduleInvite(inv.token), null);
});

test("declineScheduleInvite frees a confirmed slot and drops it from bookedSlots", () => {
  const slotAt = "2030-06-01T10:00:00.000Z";
  const token = makeConfirmed(slotAt, "Decline me");
  assert.ok(bookedSlots().includes(slotAt), "slot booked before decline");
  const out = declineScheduleInvite(token);
  assert.equal(out?.status, "declined");
  assert.equal(out?.slotAt, null, "slot freed on decline");
  assert.ok(!bookedSlots().includes(slotAt), "declined slot no longer blocks the pool");
});

test("markScheduleInviteNoShow only closes a confirmed invite and keeps the missed slot", () => {
  const slotAt = "2030-07-01T10:00:00.000Z";
  const token = makeConfirmed(slotAt, "No show");
  const out = markScheduleInviteNoShow(token);
  assert.equal(out?.status, "no_show");
  assert.equal(out?.slotAt, slotAt, "no_show retains the record of the missed time");
  // A pending invite can't no-show.
  const pending = createScheduleInvite({ entryId: "e-ns-pending", candidateLabel: "P", jobTitle: "Role" });
  assert.equal(markScheduleInviteNoShow(pending.token), null);
});

test("an EXPIRED pending invite is not reused by re-invite — a fresh token is minted", () => {
  const entryId = "e-expired-reuse";
  const first = createScheduleInvite({ entryId, candidateLabel: "P", jobTitle: "Role" });
  // Age the row past the TTL via a raw connection on the same DB file.
  const raw = new Database(TMP);
  const oldCreated = new Date(Date.now() - (INVITE_LINK_TTL_DAYS + 1) * 86_400_000).toISOString();
  raw.prepare(`UPDATE schedule_invites SET created_at = ? WHERE token = ?`).run(oldCreated, first.token);
  raw.close();
  const second = createScheduleInvite({ entryId, candidateLabel: "P", jobTitle: "Role" });
  assert.notEqual(second.token, first.token, "expired pending invite must not be handed back");
});

test("moves a confirmed booking to a new slot and frees the old one", () => {
  const token = makeConfirmed("2030-01-01T10:00:00.000Z", "Slot A");
  const r = rescheduleScheduleInvite(token, "Slot B", "2030-01-01T11:00:00.000Z");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.invite.slot, "Slot B");
    assert.equal(r.invite.slotAt, "2030-01-01T11:00:00.000Z");
    assert.equal(r.invite.status, "confirmed");
    assert.equal(r.invite.rescheduleCount, 1);
  }
  const booked = bookedSlots();
  assert.ok(!booked.includes("2030-01-01T10:00:00.000Z"), "old slot freed");
  assert.ok(booked.includes("2030-01-01T11:00:00.000Z"), "new slot booked");
});

test("rejects a slot another candidate already holds (taken)", () => {
  makeConfirmed("2030-02-01T10:00:00.000Z", "Taken by someone else");
  const token = makeConfirmed("2030-02-01T09:00:00.000Z", "Mine");
  const r = rescheduleScheduleInvite(token, "Taken by someone else", "2030-02-01T10:00:00.000Z");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "taken");
  // The original booking is untouched after a rejected move.
  assert.equal(getScheduleInviteByToken(token)?.slotAt, "2030-02-01T09:00:00.000Z");
});

test("refuses to reschedule a still-pending invite (not_confirmed)", () => {
  const inv = createScheduleInvite({ entryId: "e-pending", candidateLabel: "Pending", jobTitle: "Role" });
  const r = rescheduleScheduleInvite(inv.token, "X", "2030-03-01T10:00:00.000Z");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_confirmed");
});

test("is bounded by MAX_RESCHEDULES", () => {
  const token = makeConfirmed("2030-04-01T08:00:00.000Z", "S0");
  for (let i = 1; i <= MAX_RESCHEDULES; i += 1) {
    const hh = String(8 + i).padStart(2, "0");
    const r = rescheduleScheduleInvite(token, `S${i}`, `2030-04-01T${hh}:00:00.000Z`);
    assert.equal(r.ok, true, `reschedule ${i} within cap should succeed`);
  }
  const over = rescheduleScheduleInvite(token, "S-over", "2030-04-01T20:00:00.000Z");
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.reason, "limit");
});

test("re-picking the same slot is a no-op that doesn't burn a reschedule", () => {
  const token = makeConfirmed("2030-05-01T10:00:00.000Z", "Same");
  const r = rescheduleScheduleInvite(token, "Same", "2030-05-01T10:00:00.000Z");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.invite.rescheduleCount, 0);
});

test("returns not_found for an unknown token", () => {
  const r = rescheduleScheduleInvite("st_does_not_exist", "X", "2030-06-01T10:00:00.000Z");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_found");
});

test("resets the reminder cycle so the reminder fires for the new time", () => {
  const token = makeConfirmed("2030-07-01T10:00:00.000Z", "Old");
  // Simulate a reminder already delivered for the old slot (direct write on the
  // same WAL file — the store has no setter for these by design).
  const d = new Database(TMP);
  d.prepare(`UPDATE schedule_invites SET reminder_sent_at = 't', reminder_attempts = 2 WHERE token = ?`).run(token);
  d.close();
  const r = rescheduleScheduleInvite(token, "New", "2030-07-01T12:00:00.000Z");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.invite.reminderSentAt, null, "reminder_sent_at cleared so the new slot re-arms");
    assert.equal(r.invite.reminderAttempts, 0, "attempt counter reset for the new slot");
  }
});

// --- RSVP attendance (idea-87af39c5) -----------------------------------------

test("confirmAttendance stamps attendance on a confirmed invite only", () => {
  const token = makeConfirmed("2031-01-05T10:00:00.000Z");
  const updated = confirmAttendance(token);
  assert.ok(updated, "confirm should return the row");
  assert.equal(updated?.attendanceStatus, "confirmed");
  assert.ok(updated?.attendanceAt, "attendance_at stamped");
  assert.equal(updated?.status, "confirmed", "the booking stays confirmed");
});

test("confirmAttendance is a no-op on a pending invite", () => {
  const inv = createScheduleInvite({ entryId: "e-pending-rsvp", candidateLabel: "P", jobTitle: "R" });
  assert.equal(confirmAttendance(inv.token), null, "pending invite has no confirmed booking to RSVP");
});

test("cancelAttendance frees the slot, re-opens the invite, and records the cancel", () => {
  const slotAt = "2031-02-09T14:00:00.000Z";
  const token = makeConfirmed(slotAt);
  assert.ok(bookedSlots().includes(slotAt), "slot is booked before cancel");
  const updated = cancelAttendance(token);
  assert.ok(updated, "cancel should return the row");
  assert.equal(updated?.status, "pending", "invite returns to pending so the candidate can re-book");
  assert.equal(updated?.slotAt, null, "slot_at cleared");
  assert.equal(updated?.attendanceStatus, "cancelled");
  assert.equal(updated?.reminderAttempts, 0, "reminder cycle reset");
  assert.ok(!bookedSlots().includes(slotAt), "the freed slot is no longer booked");
});

test("cancelling a booking on an AGED link leaves a live capability, not an instantly-expired one", () => {
  // The lived sequence: link minted, candidate books three weeks out (the 21-day
  // horizon), then days later cancels. cancelAttendance re-opens the invite to
  // 'pending' so the SAME link can re-book — but expiry used to be anchored on
  // created_at alone, so an invite older than the TTL went 'expired' the moment it
  // re-opened: the token route 410s every re-book and the re-invite reconcile below
  // stacks a second token instead of reusing this one (contradicting its own comment).
  const entryId = "e-cancel-aged";
  const inv = createScheduleInvite({ entryId, candidateLabel: "C", jobTitle: "Role" });
  assert.ok(confirmScheduleInvite(inv.token, "Old", "2031-09-01T10:00:00.000Z").ok, "setup booking confirms");
  const raw = new Database(TMP);
  raw
    .prepare(`UPDATE schedule_invites SET created_at = ? WHERE token = ?`)
    .run(new Date(Date.now() - (INVITE_LINK_TTL_DAYS + 5) * 86_400_000).toISOString(), inv.token);
  raw.close();

  const reopened = cancelAttendance(inv.token);
  assert.equal(reopened?.status, "pending", "the cancel re-opens the invite for re-booking");
  assert.equal(
    isScheduleInviteExpired(getScheduleInviteByToken(inv.token)!),
    false,
    "the re-opened link is a LIVE capability — the candidate can actually pick a new time"
  );
  const again = createScheduleInvite({ entryId, candidateLabel: "C", jobTitle: "Role" });
  assert.equal(again.token, inv.token, "a re-invite reuses the re-opened link instead of stacking a new token");
});

test("re-confirming after a cancel clears the stale cancelled RSVP", () => {
  const token = makeConfirmed("2031-03-03T10:00:00.000Z");
  cancelAttendance(token);
  const r = confirmScheduleInvite(token, "Re", "2031-03-10T10:00:00.000Z");
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.invite.attendanceStatus, null, "a fresh booking starts with no RSVP");
});

// --- one active invite per entry (bug-ui-scan-2026-07-09 #2) ------------------
// Non-vacuity: against the pre-fix createScheduleInvite (unconditional INSERT)
// each call minted a NEW token/id for the same entry_id, so both assertions
// (same token, single row) fail — the whole point of the bug.

test("re-inviting a pending entry reuses the live invite instead of minting a duplicate", () => {
  const entryId = "e-dup-pending";
  const a = createScheduleInvite({ entryId, candidateLabel: "Dup", jobTitle: "Role" });
  const b = createScheduleInvite({ entryId, candidateLabel: "Dup", jobTitle: "Role" });
  assert.equal(b.token, a.token, "second invite for the same pending entry returns the first token");
  assert.equal(b.id, a.id);
  const d = new Database(TMP);
  const rows = d.prepare(`SELECT COUNT(*) AS n FROM schedule_invites WHERE entry_id = ?`).get(entryId) as { n: number };
  d.close();
  assert.equal(rows.n, 1, "exactly one row exists for the entry");
});

test("re-inviting an already-confirmed entry returns the confirmed invite (no second bookable token)", () => {
  const entryId = "e-dup-confirmed";
  const a = createScheduleInvite({ entryId, candidateLabel: "Booked" });
  const r = confirmScheduleInvite(a.token, "Slot", "2031-05-01T10:00:00.000Z");
  assert.ok(r.ok);
  const b = createScheduleInvite({ entryId, candidateLabel: "Booked" });
  assert.equal(b.token, a.token, "re-invite returns the same (confirmed) invite, not a new pending one");
  assert.equal(b.status, "confirmed");
  const d = new Database(TMP);
  const rows = d.prepare(`SELECT COUNT(*) AS n FROM schedule_invites WHERE entry_id = ?`).get(entryId) as { n: number };
  d.close();
  assert.equal(rows.n, 1, "no duplicate token minted for a confirmed entry");
});

test("a distinct entry still mints its own invite", () => {
  const x = createScheduleInvite({ entryId: "e-dup-x" });
  const y = createScheduleInvite({ entryId: "e-dup-y" });
  assert.notEqual(x.token, y.token, "different entries get different invites");
});

// --- Direction 2: recruiter-side invite control ---------------------------------

test("recruiter reschedule bypasses MAX_RESCHEDULES and doesn't spend the candidate budget", () => {
  const token = makeConfirmed("2031-01-06T08:00:00.000Z", "R0");
  // Exhaust the candidate's reschedule budget with slots distinct from the initial one
  // (an unchanged slot is a no-op that doesn't consume the budget).
  for (let n = 1; n <= MAX_RESCHEDULES; n += 1) {
    const r = rescheduleScheduleInvite(token, `C${n}`, `2031-01-06T${String(10 + n).padStart(2, "0")}:00:00.000Z`);
    assert.equal(r.ok, true, `candidate move ${n} should succeed`);
  }
  // A further CANDIDATE move is capped...
  const capped = rescheduleScheduleInvite(token, "Cx", "2031-01-06T20:00:00.000Z");
  assert.equal(capped.ok, false);
  if (!capped.ok) assert.equal(capped.reason, "limit");
  const countBefore = getScheduleInviteByToken(token)!.rescheduleCount;
  // ...but a RECRUITER move goes through and does not consume the budget.
  const rec = rescheduleScheduleInvite(token, "Rec", "2031-01-07T10:00:00.000Z", null, { recruiter: true });
  assert.equal(rec.ok, true, "recruiter move bypasses the cap");
  if (rec.ok) {
    assert.equal(rec.invite.slotAt, "2031-01-07T10:00:00.000Z");
    assert.equal(rec.invite.rescheduleCount, countBefore, "recruiter move must not consume the candidate's budget");
    assert.equal(rec.invite.reminderSentAt, null, "reminder cycle resets on the recruiter move");
  }
});

test("recruiter reschedule still honors the per-team collision check", () => {
  makeConfirmed("2031-02-03T10:00:00.000Z", "Occupied");
  const token = makeConfirmed("2031-02-03T09:00:00.000Z", "Mover");
  const clash = rescheduleScheduleInvite(token, "x", "2031-02-03T10:00:00.000Z", null, { recruiter: true });
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.equal(clash.reason, "taken");
});

test("resolveScheduleInviteReconcile clears the drift flag once (idempotent)", () => {
  const inv = createScheduleInvite({ entryId: "e-reconcile", candidateLabel: "P", jobTitle: "Role" });
  markScheduleInviteNeedsReconcile(inv.token, "stage gate not ready");
  assert.equal(getScheduleInviteByToken(inv.token)!.needsReconcile, true);
  assert.equal(resolveScheduleInviteReconcile(inv.token), true, "first resolve flips the flag");
  const after = getScheduleInviteByToken(inv.token)!;
  assert.equal(after.needsReconcile, false);
  assert.equal(after.reconcileReason, null);
  assert.equal(resolveScheduleInviteReconcile(inv.token), false, "second resolve is a no-op");
});

// --- Direction 3: the grid confirm composes the ONE scheduling engine -----------
// Mirrors the /api/schedule `book` action: resolve the grid pick to a canonical
// instant, then produce/update a collision-checked confirmed invite. Pins the seam
// at the store level (the route can't run under bare node --test in a worktree).
test("grid book: resolve pick → confirm a canonical, collision-checked invite; re-book moves it", () => {
  const entryId = "e-grid-book";
  const resolved = gridSlotToIso("Tue 14:00");
  assert.ok(resolved, "a valid grid cell resolves to an instant");
  // First confirm (pending → confirmed) at the resolved instant.
  const inv = createScheduleInvite({ entryId, candidateLabel: "Grid Cand", jobTitle: "Role" });
  const booked = confirmScheduleInvite(inv.token, resolved!.label, resolved!.value);
  assert.equal(booked.ok, true);
  assert.equal(getScheduleInviteByToken(inv.token)!.slotAt, resolved!.value);
  // The booking round-trips back onto the grid cell it came from.
  assert.equal(isoToGridSlot(resolved!.value), "Tue 14:00");
  // A different entry can't book the SAME instant (grid collision check).
  const other = createScheduleInvite({ entryId: "e-grid-clash", candidateLabel: "Other", jobTitle: "Role" });
  const clash = confirmScheduleInvite(other.token, resolved!.label, resolved!.value);
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.equal(clash.reason, "taken");
  // Re-booking the same entry onto another cell is a recruiter move (idempotent invite
  // reuse + recruiter reschedule) — no candidate reschedule budget consumed.
  const moved = gridSlotToIso("Wed 10:00");
  const reInv = createScheduleInvite({ entryId, candidateLabel: "Grid Cand", jobTitle: "Role" });
  assert.equal(reInv.token, inv.token, "book reuses the live invite for the entry");
  const rebooked = rescheduleScheduleInvite(reInv.token, moved!.label, moved!.value, null, { recruiter: true });
  assert.equal(rebooked.ok, true);
  if (rebooked.ok) {
    assert.equal(rebooked.invite.slotAt, moved!.value);
    assert.equal(rebooked.invite.rescheduleCount, 0, "recruiter grid move doesn't spend the candidate budget");
  }
});

// --- Candidate "propose your own times" escalation -------------------------------
test("setScheduleInviteProposals stores server-authored times on a pending invite and marks it pending", () => {
  const inv = createScheduleInvite({ entryId: "e-prop-1", candidateLabel: "Prop Cand", jobTitle: "Role" });
  const proposals = [
    { value: "2026-06-09T11:00:00.000Z", label: "Tue 9 Jun · 11:00" },
    { value: "2026-06-10T15:00:00.000Z", label: "Wed 10 Jun · 15:00" },
  ];
  const saved = setScheduleInviteProposals(inv.token, proposals);
  assert.ok(saved, "proposals saved on a pending invite");
  assert.equal(saved!.proposalStatus, "pending");
  assert.deepEqual(saved!.proposals, proposals);
  // Round-trips through the store (JSON persisted + parsed back).
  const reread = getScheduleInviteByToken(inv.token)!;
  assert.deepEqual(reread.proposals, proposals);
  assert.equal(reread.proposalStatus, "pending");
});

test("a terminal invite refuses proposals; a confirmed invite accepts them", () => {
  const declinedInv = createScheduleInvite({ entryId: "e-prop-2", candidateLabel: "X", jobTitle: "R" });
  declineScheduleInvite(declinedInv.token); // → terminal 'declined'
  assert.equal(setScheduleInviteProposals(declinedInv.token, [{ value: "2026-06-09T11:00:00.000Z", label: "L" }]), null, "terminal invite refuses proposals");
  const confirmedTok = makeConfirmed("2026-06-11T11:00:00.000Z");
  const saved = setScheduleInviteProposals(confirmedTok, [{ value: "2026-06-12T11:00:00.000Z", label: "Fri 12 Jun · 11:00" }]);
  assert.ok(saved, "a confirmed invite (e.g. at the reschedule cap) can carry proposals");
  assert.equal(saved!.proposalStatus, "pending");
});

test("declineScheduleInviteProposals clears the times and records the honest 'declined' state", () => {
  const inv = createScheduleInvite({ entryId: "e-prop-3", candidateLabel: "Y", jobTitle: "R" });
  setScheduleInviteProposals(inv.token, [{ value: "2026-06-09T11:00:00.000Z", label: "Tue 9 Jun · 11:00" }]);
  const declined = declineScheduleInviteProposals(inv.token);
  assert.ok(declined);
  assert.equal(declined!.proposalStatus, "declined");
  assert.equal(declined!.proposals, null, "proposed times are cleared on decline");
  // Idempotent: a second decline (no longer pending) is a no-op.
  assert.equal(declineScheduleInviteProposals(inv.token), null);
});

test("booking (confirm) clears a pending proposal — the booking is the record", () => {
  const inv = createScheduleInvite({ entryId: "e-prop-4", candidateLabel: "Z", jobTitle: "R" });
  setScheduleInviteProposals(inv.token, [{ value: "2026-06-09T11:00:00.000Z", label: "Tue 9 Jun · 11:00" }]);
  const r = confirmScheduleInvite(inv.token, "Tue 9 Jun · 11:00", "2026-06-13T11:00:00.000Z");
  assert.ok(r.ok);
  const reread = getScheduleInviteByToken(inv.token)!;
  assert.equal(reread.proposalStatus, null, "confirm clears proposal_status");
  assert.equal(reread.proposals, null, "confirm clears proposals");
});

// --- Direction: the invite store LOCKS its writes (wave 40, lib-scheduling) ------
//
// Every transaction here was DEFERRED and the confirm/reschedule UPDATEs re-asserted
// nothing their SELECT had read. Two consequences, both of which these pin:
//   (1) across connections a deferred read-to-write upgrade is answered with
//       SQLITE_BUSY_SNAPSHOT, which busy_timeout does NOT wait out - a thrown 500
//       where the honest answer is "that time is no longer yours"; and
//   (2) with no precondition on the UPDATE, a row that moved between the SELECT and
//       the write was overwritten anyway - a declined or no-showed link could be
//       resurrected into a confirmed booking by a tab that was open when it closed.
// The refusal is `taken` (not a third reason): every ConfirmResult consumer already
// renders it and the remedy is the same - this link no longer holds that time.

test("a confirm that races the row's own closure is refused as taken, never a store throw", () => {
  const inv = createScheduleInvite({ entryId: "e-cas-1", candidateLabel: "Race", jobTitle: "Role" });
  // The row moves to a terminal state after the candidate's picker was rendered -
  // exactly the state a concurrent decline (or another process's write) leaves behind.
  assert.ok(declineScheduleInvite(inv.token), "setup: the invite is closed out");
  const r = confirmScheduleInvite(inv.token, "Tue 9 Jun 10:00", "2026-06-09T10:00:00.000Z");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "taken", "a moved row answers taken, not ok");
  const reread = getScheduleInviteByToken(inv.token)!;
  assert.equal(reread.status, "declined", "the terminal status survives - no resurrection");
  assert.equal(reread.slotAt, null, "and no slot was written onto a closed invite");
});

test("a reschedule that races another move is refused, and the recorded time is untouched", () => {
  const token = makeConfirmed("2026-06-16T10:00:00.000Z");
  // First move lands and spends generation 0.
  const first = rescheduleScheduleInvite(token, "Wed 17 Jun 10:00", "2026-06-17T10:00:00.000Z");
  assert.ok(first.ok);
  // A no-show closes the booking under a tab that still holds the old view.
  assert.ok(markScheduleInviteNoShow(token), "setup: the booking is closed");
  const stale = rescheduleScheduleInvite(token, "Thu 18 Jun 10:00", "2026-06-18T10:00:00.000Z");
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false && stale.reason, "not_confirmed", "a closed booking is not movable");
  assert.equal(getScheduleInviteByToken(token)!.slotAt, "2026-06-17T10:00:00.000Z", "the recorded time is untouched");
});

// --- reads and one-shot writes that had no coverage at all ----------------------

test("countFutureConfirmedInvites counts only future confirmed bookings", () => {
  const now = Date.parse("2026-06-20T09:00:00.000Z");
  const before = countFutureConfirmedInvites(undefined, now);
  makeConfirmed("2026-06-19T10:00:00.000Z"); // in the past relative to `now`
  assert.equal(countFutureConfirmedInvites(undefined, now), before, "a past booking is not upcoming");
  createScheduleInvite({ entryId: "e-count-p", candidateLabel: "P", jobTitle: "R" }); // pending, never counted
  assert.equal(countFutureConfirmedInvites(undefined, now), before, "an unbooked invite is not upcoming");
  const closed = makeConfirmed("2026-06-22T10:00:00.000Z");
  assert.equal(countFutureConfirmedInvites(undefined, now), before + 1, "a future booking is counted");
  markScheduleInviteNoShow(closed);
  assert.equal(countFutureConfirmedInvites(undefined, now), before, "a no-show drops out of the badge");
});

test("recordCalendarEvent KEEPS the handle on a live state and CLEARS it on 'removed'", () => {
  const token = makeConfirmed("2026-06-23T10:00:00.000Z");
  recordCalendarEvent(token, { state: "created", eventId: "gcal-1", eventLink: "https://cal.example/1" });
  let inv = getScheduleInviteByToken(token)!;
  assert.equal(inv.calendarEventState, "created");
  assert.equal(inv.calendarEventId, "gcal-1");
  // A later write that carries no id must not null the handle out (COALESCE).
  recordCalendarEvent(token, { state: "updated" });
  inv = getScheduleInviteByToken(token)!;
  assert.equal(inv.calendarEventState, "updated");
  assert.equal(inv.calendarEventId, "gcal-1", "a live state keeps the handle it already had");
  // 'orphaned' deliberately keeps it - the event is still on someone's calendar.
  recordCalendarEvent(token, { state: "orphaned" });
  assert.equal(getScheduleInviteByToken(token)!.calendarEventId, "gcal-1");
  // 'removed' is the ONE state that clears both, so the id always answers
  // "is there an event out there?".
  recordCalendarEvent(token, { state: "removed" });
  inv = getScheduleInviteByToken(token)!;
  assert.equal(inv.calendarEventState, "removed");
  assert.equal(inv.calendarEventId, null);
  assert.equal(inv.calendarEventLink, null);
  // An unknown token is bookkeeping, never a throw - the booking is the truth.
  assert.doesNotThrow(() => recordCalendarEvent("no-such-token", { state: "removed" }));
});

test("flagScheduleInviteNeedsMoreSlots reports the 0-to-1 transition ONCE", () => {
  const inv = createScheduleInvite({ entryId: "e-flag-1", candidateLabel: "F", jobTitle: "R" });
  assert.equal(flagScheduleInviteNeedsMoreSlots(inv.token), true, "the first fully-booked open flags");
  assert.equal(flagScheduleInviteNeedsMoreSlots(inv.token), false, "a refresh must not re-alert");
  assert.equal(getScheduleInviteByToken(inv.token)!.needsMoreSlots, true);
  // Booking clears the flag - "currently stalled", not "ever stalled".
  assert.ok(confirmScheduleInvite(inv.token, "Fri 26 Jun 10:00", "2026-06-26T10:00:00.000Z").ok);
  assert.equal(getScheduleInviteByToken(inv.token)!.needsMoreSlots, false);
  assert.equal(flagScheduleInviteNeedsMoreSlots("no-such-token"), false, "an unknown token never claims a flag");
});

test("claimReminderAttempt is a generation CAS: one winner per generation, capped, backoff-gated", () => {
  const token = makeConfirmed("2026-06-27T10:00:00.000Z");
  const id = getScheduleInviteByToken(token)!.id;
  const aged = new Date(Date.now() + 60_000).toISOString(); // cutoff in the future = backoff satisfied
  assert.equal(claimReminderAttempt(id, 0, aged, 3), true, "the holder of generation 0 wins");
  assert.equal(claimReminderAttempt(id, 0, aged, 3), false, "a racing claimer on the SAME generation loses");
  assert.equal(getScheduleInviteByToken(token)!.reminderAttempts, 1, "exactly one attempt was recorded");
  // The backoff gate: a cutoff BEFORE the stamped attempt refuses the next generation.
  const tooSoon = new Date(Date.now() - 60_000).toISOString();
  assert.equal(claimReminderAttempt(id, 1, tooSoon, 3), false, "an attempt inside its backoff is not re-claimable");
  assert.equal(claimReminderAttempt(id, 1, aged, 3), true, "...and is claimable once it has aged past it");
  // The cap is enforced by the claim itself, not only by the sweep's filter.
  assert.equal(claimReminderAttempt(id, 2, aged, 2), false, "no claim past maxAttempts");
  // Terminal success drops it out for good - even a correct generation can't re-claim.
  markReminderSent(id);
  assert.equal(claimReminderAttempt(id, 2, aged, 5), false, "a delivered reminder is never re-attempted");
});
