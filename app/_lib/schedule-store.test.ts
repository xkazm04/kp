import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
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

// Point the store at a throwaway DB BEFORE importing it: db-path reads KP_DB_PATH
// at module load, and the store opens its connection lazily. node --test isolates
// each file in its own process, so this can't leak to the pure tests.
const TMP = path.join(os.tmpdir(), `kp-schedule-store-test-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const {
  createScheduleInvite,
  confirmScheduleInvite,
  rescheduleScheduleInvite,
  getScheduleInviteByToken,
  confirmAttendance,
  cancelAttendance,
  declineScheduleInvite,
  markScheduleInviteNoShow,
  bookedSlots,
  isTerminalScheduleInviteStatus,
  MAX_RESCHEDULES,
} = await import("./schedule-store.ts");
const { INVITE_LINK_TTL_DAYS } = await import("./schedule-slots.ts");

// Mint a confirmed invite at a specific slot, returning its token. Each test uses
// globally-unique slot_at times so confirmed rows from other tests can't collide.
function makeConfirmed(slotAt: string, slot = slotAt): string {
  const inv = createScheduleInvite({ entryId: `e-${slotAt}`, candidateLabel: "Test Candidate", jobTitle: "Role" });
  const r = confirmScheduleInvite(inv.token, slot, slotAt);
  assert.ok(r.ok, "setup confirm should succeed");
  return inv.token;
}

after(() => {
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* locked / absent — disposable temp, process exits next */
    }
  }
});

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
