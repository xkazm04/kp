import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Self-scheduling: a candidate picks an interview slot from proposed times
// (replacing the hardcoded "Tue 14:00"). Isolated-connection store (same
// pattern as offers-store.ts) owning the `schedule_invites` table — one row per
// tokenized scheduling link. Stage/slot writes on confirm go through db.ts.

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");
let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // The reminder heartbeat's claimReminder() write fires every ~60s on this
  // connection while candidate confirms and recruiter db.ts writes hit the same
  // kp.sqlite file; busy_timeout makes a concurrent writer wait briefly rather
  // than instantly throwing SQLITE_BUSY (mirrors db.ts).
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS schedule_invites (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE,
      entry_id TEXT,
      candidate_label TEXT,
      job_title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      slot TEXT,
      slot_at TEXT,
      reminder_sent_at TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sched_entry ON schedule_invites (entry_id);
    -- Partial index matching the heartbeat's due-reminder query exactly, so the
    -- every-60s sweep is an index range over only un-reminded confirmed invites
    -- rather than a full table scan.
    CREATE INDEX IF NOT EXISTS idx_sched_due ON schedule_invites (slot_at)
      WHERE status = 'confirmed' AND reminder_sent_at IS NULL;
  `);
  // Migrations for stores created before the reminder columns existed.
  for (const col of ["slot_at TEXT", "reminder_sent_at TEXT"]) {
    try {
      d.exec(`ALTER TABLE schedule_invites ADD COLUMN ${col}`);
    } catch {
      /* column already exists */
    }
  }
  _db = d;
  return d;
}

export type ScheduleInvite = {
  id: string;
  token: string;
  entryId: string | null;
  candidateLabel: string | null;
  jobTitle: string | null;
  status: string; // pending | confirmed
  slot: string | null; // human label, e.g. "Mon 1 Jun · 10:00"
  slotAt: string | null; // ISO datetime of the chosen slot
  reminderSentAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

function rowTo(r: Record<string, unknown>): ScheduleInvite {
  return {
    id: r.id as string,
    token: r.token as string,
    entryId: (r.entry_id as string) ?? null,
    candidateLabel: (r.candidate_label as string) ?? null,
    jobTitle: (r.job_title as string) ?? null,
    status: r.status as string,
    slot: (r.slot as string) ?? null,
    slotAt: (r.slot_at as string) ?? null,
    reminderSentAt: (r.reminder_sent_at as string) ?? null,
    createdAt: r.created_at as string,
    confirmedAt: (r.confirmed_at as string) ?? null,
  };
}

export function createScheduleInvite(input: {
  entryId: string;
  candidateLabel?: string | null;
  jobTitle?: string | null;
}): ScheduleInvite {
  const d = db();
  const now = new Date().toISOString();
  const id = `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const token = `st-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
  d.prepare(
    `INSERT INTO schedule_invites (id, token, entry_id, candidate_label, job_title, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(id, token, input.entryId, input.candidateLabel ?? null, input.jobTitle ?? null, now);
  return rowTo(d.prepare(`SELECT * FROM schedule_invites WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function getScheduleInviteByToken(token: string): ScheduleInvite | null {
  const r = db().prepare(`SELECT * FROM schedule_invites WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
  return r ? rowTo(r) : null;
}

export type ConfirmResult =
  | { ok: true; invite: ScheduleInvite }
  | { ok: false; reason: "not_found" | "taken"; invite: ScheduleInvite | null };

/** Confirm a slot, atomically rejecting a time another candidate already took.
 *  better-sqlite3 runs synchronously, so the read-then-write below executes as a
 *  single uninterrupted transaction — two concurrent confirms can't both claim
 *  the same slot_at, which is what `bookedSlots()`/`proposeSlots()` only guard at
 *  read time. Collision identity is the ISO `slot_at`, not the display label. */
export function confirmScheduleInvite(token: string, slot: string, slotAt?: string | null): ConfirmResult {
  const d = db();
  const tx = d.transaction((): ConfirmResult => {
    const current = d.prepare(`SELECT * FROM schedule_invites WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
    if (!current) return { ok: false, reason: "not_found", invite: null };
    const inv = rowTo(current);
    if (inv.status === "confirmed") return { ok: true, invite: inv }; // idempotent re-confirm of the same invite
    const clash = slotAt
      ? d.prepare(`SELECT 1 FROM schedule_invites WHERE status = 'confirmed' AND slot_at = ? AND token != ? LIMIT 1`).get(slotAt, token)
      : d.prepare(`SELECT 1 FROM schedule_invites WHERE status = 'confirmed' AND slot = ? AND token != ? LIMIT 1`).get(slot, token);
    if (clash) return { ok: false, reason: "taken", invite: inv };
    d.prepare(`UPDATE schedule_invites SET status = 'confirmed', slot = ?, slot_at = ?, confirmed_at = ? WHERE token = ?`).run(
      slot,
      slotAt ?? null,
      new Date().toISOString(),
      token
    );
    return { ok: true, invite: rowTo(d.prepare(`SELECT * FROM schedule_invites WHERE token = ?`).get(token) as Record<string, unknown>) };
  });
  return tx();
}

/** ISO datetimes already taken by confirmed invites — so two candidates don't
 *  double-book. Returns slot_at (the real identity), not the display label. */
export function bookedSlots(): string[] {
  const rows = db().prepare(`SELECT slot_at FROM schedule_invites WHERE status = 'confirmed' AND slot_at IS NOT NULL`).all() as {
    slot_at: string;
  }[];
  return rows.map((r) => r.slot_at);
}

/** Confirmed interviews starting within `windowMs` that haven't been reminded.
 *  Skips interviews booked *inside* the window: for those the confirmation
 *  message just went out, so a separate "~24h reminder" would arrive seconds
 *  after they booked rather than the day before. */
export function dueReminders(windowMs: number): ScheduleInvite[] {
  const now = Date.now();
  const rows = db()
    .prepare(`SELECT * FROM schedule_invites WHERE status = 'confirmed' AND slot_at IS NOT NULL AND reminder_sent_at IS NULL`)
    .all() as Record<string, unknown>[];
  return rows
    .map(rowTo)
    .filter((inv) => {
      const t = inv.slotAt ? Date.parse(inv.slotAt) : NaN;
      if (Number.isNaN(t) || !(t > now && t <= now + windowMs)) return false;
      const booked = inv.confirmedAt ? Date.parse(inv.confirmedAt) : NaN;
      return Number.isNaN(booked) || t - booked > windowMs;
    });
}

/** Atomically claim a reminder so concurrent ticks/processes can't double-send:
 *  the conditional flip of reminder_sent_at (NULL → now) lets exactly one caller
 *  win. Returns true only for that winner. */
export function claimReminder(id: string): boolean {
  const res = db()
    .prepare(`UPDATE schedule_invites SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL`)
    .run(new Date().toISOString(), id);
  return res.changes > 0;
}

/** Release a claimed reminder (e.g. delivery failed) so a later tick retries. */
export function releaseReminder(id: string): void {
  db().prepare(`UPDATE schedule_invites SET reminder_sent_at = NULL WHERE id = ?`).run(id);
}

const TIMES = ["10:00", "14:00"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Propose the next few business-day interview slots, skipping ones already
 *  taken (by ISO `value`, the same identity `bookedSlots()` returns). `value` is
 *  the slot's ISO datetime (used for timed reminders + collision checks); `label`
 *  is the human-readable time shown to the candidate. */
export function proposeSlots(taken: string[] = [], count = 6): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const takenSet = new Set(taken);
  const base = new Date();
  for (let day = 1; day <= 21 && out.length < count; day += 1) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + day);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    for (const t of TIMES) {
      const [h, m] = t.split(":").map(Number);
      const slot = new Date(dt);
      slot.setHours(h, m, 0, 0);
      const value = slot.toISOString();
      const label = `${DOW[dow]} ${slot.getDate()} ${MON[slot.getMonth()]} · ${t}`;
      if (takenSet.has(value)) continue;
      out.push({ value, label });
      if (out.length >= count) break;
    }
  }
  return out;
}
