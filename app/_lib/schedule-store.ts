import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";
import { randomId, randomToken } from "./random-id";
import { isReminderDue, reminderRetryDelayMs, REMINDER_LEAD_MS, REMINDER_MAX_ATTEMPTS } from "./interview-reminder-policy";

// Self-scheduling: a candidate picks an interview slot from proposed times
// (replacing the hardcoded "Tue 14:00"). Isolated-connection store (same
// pattern as offers-store.ts) owning the `schedule_invites` table — one row per
// tokenized scheduling link. Stage/slot writes on confirm go through db.ts.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  ensureDbDir();
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // The reminder heartbeat's claimReminderAttempt() write fires every ~60s on this
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
      -- Set ONLY when a reminder is successfully delivered (terminal success): it
      -- drops the row out of the due-sweep for good. NULL means "still actionable".
      reminder_sent_at TEXT,
      -- Bounded-retry bookkeeping (idea-edab792a): how many dispatch attempts have
      -- run, and when the most recent one was claimed. The sweep uses these to cap
      -- retries (REMINDER_MAX_ATTEMPTS) and to back off between them instead of
      -- re-firing every 60s at a down comms provider.
      reminder_attempts INTEGER NOT NULL DEFAULT 0,
      reminder_last_attempt_at TEXT,
      -- Set when the candidate's confirm landed but advancing the pipeline entry
      -- failed (stage gate not ready): the invite says "booked" while the
      -- recruiter board still shows them waiting. Flags the drift for a human.
      needs_reconcile INTEGER NOT NULL DEFAULT 0,
      reconcile_reason TEXT,
      -- Planned interview length in minutes, captured when the invite is minted
      -- (plannedInterviewMinutes): a student's six-phase screen runs ~22 min, not
      -- the ~5-min quick screen, and the candidate should block the right time.
      duration_min INTEGER,
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
  for (const col of [
    "slot_at TEXT",
    "reminder_sent_at TEXT",
    "reminder_attempts INTEGER NOT NULL DEFAULT 0",
    "reminder_last_attempt_at TEXT",
    "needs_reconcile INTEGER NOT NULL DEFAULT 0",
    "reconcile_reason TEXT",
    "duration_min INTEGER",
  ]) {
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
  reminderSentAt: string | null; // set only on successful delivery (terminal)
  reminderAttempts: number; // dispatch attempts made so far (cap: REMINDER_MAX_ATTEMPTS)
  reminderLastAttemptAt: string | null; // ISO time of the most recent attempt (for backoff)
  needsReconcile: boolean; // confirmed here but the pipeline entry failed to advance
  reconcileReason: string | null; // why the advance failed (for the operator who reconciles)
  durationMin: number | null; // planned interview length (e.g. 22 for the student script)
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
    reminderAttempts: Number(r.reminder_attempts ?? 0),
    reminderLastAttemptAt: (r.reminder_last_attempt_at as string) ?? null,
    needsReconcile: Boolean(r.needs_reconcile),
    reconcileReason: (r.reconcile_reason as string) ?? null,
    durationMin: r.duration_min == null ? null : Number(r.duration_min),
    createdAt: r.created_at as string,
    confirmedAt: (r.confirmed_at as string) ?? null,
  };
}

export function createScheduleInvite(input: {
  entryId: string;
  candidateLabel?: string | null;
  jobTitle?: string | null;
  durationMin?: number | null;
}): ScheduleInvite {
  const d = db();
  const now = new Date().toISOString();
  const id = randomId("sch");
  const token = randomToken("st");
  // RETURNING * hands the freshly-inserted row back in the same statement, so we
  // don't issue a second SELECT to read what we just wrote.
  const row = d
    .prepare(
      `INSERT INTO schedule_invites (id, token, entry_id, candidate_label, job_title, status, duration_min, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING *`
    )
    .get(id, token, input.entryId, input.candidateLabel ?? null, input.jobTitle ?? null, input.durationMin ?? null, now) as Record<
    string,
    unknown
  >;
  return rowTo(row);
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
    // RETURNING * gives the just-updated row back in the same statement (inside the
    // transaction), replacing the previous UPDATE-then-re-SELECT pair.
    const updated = d
      .prepare(`UPDATE schedule_invites SET status = 'confirmed', slot = ?, slot_at = ?, confirmed_at = ? WHERE token = ? RETURNING *`)
      .get(slot, slotAt ?? null, new Date().toISOString(), token) as Record<string, unknown>;
    return { ok: true, invite: rowTo(updated) };
  });
  return tx();
}

/** Flag an invite as needing manual reconciliation: the candidate's slot was
 *  confirmed (they see "booked") but advancing the linked pipeline entry failed,
 *  so the recruiter board still shows them waiting. Persisting the drift — instead
 *  of swallowing the error — lets an operator find and repair the divergence. */
export function markScheduleInviteNeedsReconcile(token: string, reason: string): void {
  db().prepare(`UPDATE schedule_invites SET needs_reconcile = 1, reconcile_reason = ? WHERE token = ?`).run(reason, token);
}

/** ISO datetimes already taken by confirmed invites — so two candidates don't
 *  double-book. Returns slot_at (the real identity), not the display label. */
export function bookedSlots(): string[] {
  const rows = db().prepare(`SELECT slot_at FROM schedule_invites WHERE status = 'confirmed' AND slot_at IS NOT NULL`).all() as {
    slot_at: string;
  }[];
  return rows.map((r) => r.slot_at);
}

/** Confirmed interviews starting within `windowMs` (the reminder look-ahead) that
 *  haven't been reminded yet and are still eligible for a dispatch attempt. A
 *  *short-notice* booking — one confirmed so close to the slot that the confirmation
 *  note already serves as the reminder — is skipped; that decision (and the
 *  now-distinct lead window vs. short-notice floor) lives in
 *  interview-reminder-policy.ts. Rows that have exhausted REMINDER_MAX_ATTEMPTS are
 *  excluded in SQL (the heartbeat gave up on them); rows whose last failed attempt is
 *  still inside its backoff window are excluded here so a down provider isn't re-hit
 *  every 60s. Defaults to REMINDER_LEAD_MS so callers needn't re-derive the window. */
export function dueReminders(windowMs: number = REMINDER_LEAD_MS): ScheduleInvite[] {
  const now = Date.now();
  const rows = db()
    .prepare(
      `SELECT * FROM schedule_invites
        WHERE status = 'confirmed' AND slot_at IS NOT NULL AND reminder_sent_at IS NULL
          AND reminder_attempts < ?`
    )
    .all(REMINDER_MAX_ATTEMPTS) as Record<string, unknown>[];
  return rows.map(rowTo).filter((inv) => {
    const slotAtMs = inv.slotAt ? Date.parse(inv.slotAt) : NaN;
    const bookedAtMs = inv.confirmedAt ? Date.parse(inv.confirmedAt) : NaN;
    if (
      !isReminderDue({
        nowMs: now,
        slotAtMs,
        bookedAtMs: Number.isNaN(bookedAtMs) ? null : bookedAtMs,
        leadMs: windowMs,
      })
    ) {
      return false;
    }
    // Honor the retry backoff: a prior failed attempt must age past its (growing)
    // delay before this invite is offered for re-claiming.
    if (inv.reminderLastAttemptAt) {
      const lastMs = Date.parse(inv.reminderLastAttemptAt);
      if (!Number.isNaN(lastMs) && now < lastMs + reminderRetryDelayMs(inv.reminderAttempts)) {
        return false;
      }
    }
    return true;
  });
}

/** Atomically claim the next dispatch attempt for a reminder so concurrent
 *  ticks/processes can't double-send or double-count. `expectedAttempts` is the
 *  attempt count the caller read — an optimistic CAS: only the claimer holding the
 *  current generation wins (a racing claimer sees the counter already bumped and
 *  loses), so exactly one attempt runs per generation. The claim also enforces the
 *  cap (`reminder_attempts < maxAttempts`) and the backoff gate (`reminder_last_-
 *  attempt_at <= cutoffIso`, where cutoff = now − backoff), then records the attempt
 *  by incrementing the counter and stamping the time. Returns true only for the
 *  winner. NB: a claim records an *attempt*, not a success — call markReminderSent
 *  only after the dispatch actually completes. */
export function claimReminderAttempt(
  id: string,
  expectedAttempts: number,
  cutoffIso: string,
  maxAttempts: number = REMINDER_MAX_ATTEMPTS
): boolean {
  const res = db()
    .prepare(
      `UPDATE schedule_invites
          SET reminder_attempts = reminder_attempts + 1, reminder_last_attempt_at = ?
        WHERE id = ?
          AND reminder_sent_at IS NULL
          AND reminder_attempts = ?
          AND reminder_attempts < ?
          AND (reminder_last_attempt_at IS NULL OR reminder_last_attempt_at <= ?)`
    )
    .run(new Date().toISOString(), id, expectedAttempts, maxAttempts, cutoffIso);
  return res.changes > 0;
}

/** Mark a reminder as successfully delivered (terminal): sets reminder_sent_at, so
 *  the due-sweep never returns it again. Called only after dispatch completes. */
export function markReminderSent(id: string): void {
  db().prepare(`UPDATE schedule_invites SET reminder_sent_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
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
