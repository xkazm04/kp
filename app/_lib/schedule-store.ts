import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { randomId, randomToken } from "./random-id";
import { isReminderDue, reminderRetryDelayMs, REMINDER_LEAD_MS, REMINDER_MAX_ATTEMPTS } from "./interview-reminder-policy";
import { isEntryReminderEligible } from "./pipeline-status";
import { isScheduleInviteExpired } from "./schedule-slots";

// Self-scheduling: a candidate picks an interview slot from proposed times
// (replacing the hardcoded "Tue 14:00"). Isolated-connection store (same
// pattern as offers-store.ts) owning the `schedule_invites` table — one row per
// tokenized scheduling link. Stage/slot writes on confirm go through db.ts.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // the reminder heartbeat's claimReminderAttempt() write fires every ~60s here
  // while candidate confirms and recruiter db.ts writes hit the same file, so a
  // concurrent writer waits briefly rather than instantly throwing SQLITE_BUSY.
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS schedule_invites (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE,
      entry_id TEXT,
      -- Tenant (P1): the team that owns this scheduling link (the linked entry's
      -- workspace). Recruiter agenda reads + slot-collision checks filter on it; the
      -- candidate token flow and the global reminder sweep do not (token = capability).
      workspace_id TEXT,
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
      -- Set when a candidate opened the picker but every slot in the proposal
      -- horizon was already booked (idea-5df8e10f): zero offerable times. Flags
      -- the stalled booking for the recruiter so the busiest-calendar edge can't
      -- die silently; cleared when the candidate eventually confirms a slot.
      needs_more_slots INTEGER NOT NULL DEFAULT 0,
      more_slots_flagged_at TEXT,
      -- Planned interview length in minutes, captured when the invite is minted
      -- (plannedInterviewMinutes): a student's six-phase screen runs ~22 min, not
      -- the ~5-min quick screen, and the candidate should block the right time.
      duration_min INTEGER,
      -- How many times the candidate has self-rescheduled a confirmed booking.
      -- Capped (MAX_RESCHEDULES) so the "change time" affordance can't be used to
      -- churn the recruiter's calendar indefinitely.
      reschedule_count INTEGER NOT NULL DEFAULT 0,
      -- The candidate's IANA timezone (e.g. "Europe/Prague"), captured at confirm
      -- (idea-b51106df). The slot_at instant is canonical; this records WHERE the
      -- candidate is so the recruiter agenda can show a cross-border booking's real
      -- local time. NULL until the candidate confirms from a browser that resolves it.
      candidate_tz TEXT,
      -- RSVP on a confirmed booking (idea-87af39c5): 'confirmed' when the candidate
      -- taps "I'll be there" (recruiter gets an early attendance signal), 'cancelled'
      -- when they tap "I can't make it" (the slot is freed and the invite returns to
      -- pending so they can re-book). NULL = no RSVP yet. attendance_at stamps when.
      attendance_status TEXT,
      attendance_at TEXT,
      -- Optional interview join link (Meet/Teams/Zoom…) the recruiter attaches; it
      -- becomes the calendar event's location + a "Join" link on both the recruiter
      -- agenda and the candidate's booked card. NULL until set.
      meeting_url TEXT,
      -- Candidate "propose your own times" escalation: when a candidate is stranded
      -- (horizon fully booked, or past the self-reschedule cap) they suggest 1-3
      -- concrete times. proposals holds the SERVER-authored value/label JSON (the
      -- label is minted by proposedSlotFor, never candidate text); proposal_status is
      -- NULL, 'pending' (awaiting the recruiter), or 'declined' (recruiter couldn't
      -- accommodate - the candidate page reads this honest state). Cleared when a booking
      -- supersedes it (confirm/reschedule). Additive columns; existing rows read NULL.
      proposals TEXT,
      proposals_at TEXT,
      proposal_status TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sched_entry ON schedule_invites (entry_id);
  `);
  // Migrations for stores created before the reminder columns existed.
  for (const col of [
    "slot_at TEXT",
    "reminder_sent_at TEXT",
    "reminder_attempts INTEGER NOT NULL DEFAULT 0",
    "reminder_last_attempt_at TEXT",
    "needs_reconcile INTEGER NOT NULL DEFAULT 0",
    "reconcile_reason TEXT",
    "needs_more_slots INTEGER NOT NULL DEFAULT 0",
    "more_slots_flagged_at TEXT",
    "duration_min INTEGER",
    "reschedule_count INTEGER NOT NULL DEFAULT 0",
    "candidate_tz TEXT",
    "attendance_status TEXT",
    "attendance_at TEXT",
    "meeting_url TEXT",
    "workspace_id TEXT",
    "proposals TEXT",
    "proposals_at TEXT",
    "proposal_status TEXT",
  ]) {
    try {
      d.exec(`ALTER TABLE schedule_invites ADD COLUMN ${col}`);
    } catch {
      /* column already exists */
    }
  }
  // Tenant backfill (P1): existing invites → the default workspace. A subquery join to
  // pipeline_entries would be more "correct" in spirit, but this store owns its OWN
  // connection (the pipeline_entries table may not exist on it — e.g. an isolated test
  // store, or a boot before ensureDb ran), and SQLite validates a referenced table at
  // PREPARE time even for zero matched rows. In single-tenant every entry IS 'workspace',
  // so this is identical; new invites derive their real team in createScheduleInvite.
  d.exec(`UPDATE schedule_invites SET workspace_id = 'workspace' WHERE workspace_id IS NULL`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sched_workspace ON schedule_invites (workspace_id)`);
  // Partial index matching the heartbeat's due-reminder query exactly, so the
  // every-60s sweep is an index range over only un-reminded confirmed invites
  // rather than a full table scan. CREATED AFTER the migration loop on purpose:
  // it references slot_at, a *migrated* column on stores that predate it. In the
  // original order (this index lived inside the CREATE-TABLE exec, before the
  // migrations) any DB whose schedule_invites was created before slot_at existed
  // threw `no such column: slot_at` on every db() init — CREATE TABLE IF NOT
  // EXISTS is a no-op on the old table, so the column wasn't there yet when the
  // index referenced it. That aborted the whole store setup and broke the
  // reminder sweep on a 60s loop. (fix 2026-06-18)
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_sched_due ON schedule_invites (slot_at)
      WHERE status = 'confirmed' AND reminder_sent_at IS NULL;
  `);
  _db = d;
  return d;
}

// The invite state machine (Direction 1). Every interview now has an honest terminal
// fate instead of a stale link living forever:
//   pending    — link minted, not yet booked. Expires (derived) past the TTL — see
//                isScheduleInviteExpired (schedule-slots.ts); an expired pending
//                invite is a dead capability the token route refuses.
//   confirmed  — a slot is booked. The only reminder-eligible state.
//   declined   — the candidate withdrew from the interview (terminal). Frees the slot.
//   no_show    — the candidate didn't attend a confirmed interview; the recruiter
//                marked it (terminal). Keeps slot_at as the record of the missed time.
// declined/no_show are stored statuses; expired is derived from a pending row's age so
// existing rows need no migration and the pending/confirmed behavior is unchanged.
export const SCHEDULE_INVITE_STATUSES = ["pending", "confirmed", "declined", "no_show"] as const;
export const TERMINAL_SCHEDULE_INVITE_STATUSES = ["declined", "no_show"] as const;

/** Whether a stored status is a closed-out terminal state (declined / no_show). Note
 *  `expired` is NOT here — it's derived from a pending row's age, not a stored value. */
export function isTerminalScheduleInviteStatus(status: string): boolean {
  return status === "declined" || status === "no_show";
}

export type ScheduleInvite = {
  id: string;
  token: string;
  entryId: string | null;
  candidateLabel: string | null;
  jobTitle: string | null;
  status: string; // pending | confirmed | declined | no_show
  slot: string | null; // human label, e.g. "Mon 1 Jun · 10:00"
  slotAt: string | null; // ISO datetime of the chosen slot
  reminderSentAt: string | null; // set only on successful delivery (terminal)
  reminderAttempts: number; // dispatch attempts made so far (cap: REMINDER_MAX_ATTEMPTS)
  reminderLastAttemptAt: string | null; // ISO time of the most recent attempt (for backoff)
  needsReconcile: boolean; // confirmed here but the pipeline entry failed to advance
  reconcileReason: string | null; // why the advance failed (for the operator who reconciles)
  needsMoreSlots: boolean; // candidate hit a fully-booked horizon (zero offerable slots); flagged for the recruiter
  moreSlotsFlaggedAt: string | null; // ISO time the zero-slots stall was first flagged
  durationMin: number | null; // planned interview length (e.g. 22 for the student script)
  rescheduleCount: number; // self-reschedules made on this confirmed booking (cap: MAX_RESCHEDULES)
  candidateTz: string | null; // idea-b51106df — candidate's IANA timezone captured at confirm; null until they book
  attendanceStatus: string | null; // idea-87af39c5 — RSVP on the booking: 'confirmed' | 'cancelled' | null
  attendanceAt: string | null; // ISO time the RSVP was recorded
  meetingUrl: string | null; // optional interview join link (Meet/Teams/Zoom…); null until the recruiter sets it
  proposals: { value: string; label: string }[] | null; // candidate-proposed alternative times (server-authored labels); null when none pending
  proposalsAt: string | null; // ISO time the candidate submitted their proposed times
  proposalStatus: string | null; // null | 'pending' (awaiting recruiter) | 'declined' (recruiter couldn't accommodate)
  locale: string | null; // SIM3 — the linked entry's applicant locale, when joined (dueReminders); null otherwise
  // The linked pipeline entry's status/stage, surfaced by the recruiter agenda read
  // (listScheduleInvites' LEFT JOIN) so a surface can gate on the entry's fate — e.g.
  // the Closed-bucket re-invite is withheld for a terminal (rejected/hired) entry. Null
  // on every other read (no join) and for an orphan invite with no matching entry.
  entryStatus: string | null;
  entryStage: string | null;
  workspaceId: string; // P1 — the owning team (the linked entry's workspace)
  createdAt: string;
  confirmedAt: string | null;
};

/** Parse the stored proposals JSON back into typed slots, tolerating a null/empty or
 *  malformed column (an old row, or a hand-edited value) by degrading to null. */
function parseProposals(raw: string | null | undefined): { value: string; label: string }[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter((x): x is { value: string; label: string } => !!x && typeof x.value === "string" && typeof x.label === "string")
      .map((x) => ({ value: x.value, label: x.label }));
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

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
    needsMoreSlots: Boolean(r.needs_more_slots),
    moreSlotsFlaggedAt: (r.more_slots_flagged_at as string) ?? null,
    durationMin: r.duration_min == null ? null : Number(r.duration_min),
    rescheduleCount: Number(r.reschedule_count ?? 0),
    candidateTz: (r.candidate_tz as string) ?? null,
    attendanceStatus: (r.attendance_status as string) ?? null,
    attendanceAt: (r.attendance_at as string) ?? null,
    meetingUrl: (r.meeting_url as string) ?? null,
    proposals: parseProposals(r.proposals as string | null | undefined),
    proposalsAt: (r.proposals_at as string) ?? null,
    proposalStatus: (r.proposal_status as string) ?? null,
    // Only the dueReminders join selects entry_locale; every other read leaves it null.
    locale: (r.entry_locale as string) ?? null,
    // Only the recruiter-agenda join (listScheduleInvites) and dueReminders select
    // these; other reads leave them null (no join / orphan invite).
    entryStatus: (r.entry_status as string) ?? null,
    entryStage: (r.entry_stage as string) ?? null,
    workspaceId: (r.workspace_id as string) ?? "workspace",
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
  // bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #2) — one active
  // invite per entry. Without this, re-inviting an entry (a bulk cohort that
  // overlaps an already-invited candidate, or a second single/bulk call) minted a
  // SECOND live token for the same entry_id — two independently confirmable links,
  // so one candidate could book two slots in the scarce global pool, the confirm
  // path ran actOnPipelineEntry twice, the reminder sweep double-sent, and the
  // lifecycle agenda showed two rows for one person. coerceBulkEntryIds only dedupes
  // WITHIN one request, so it didn't cover overlap across requests. Reconcile
  // against any existing non-terminal (pending|confirmed) invite for this entry and
  // return it instead of inserting a duplicate — making "invite this entry/cohort"
  // idempotent regardless of overlap. A cancelled attendance returns the invite to
  // 'pending' (still matched here), so a re-invite reuses that link rather than
  // stacking a new one.
  // Tenant (P1): derive the owning team from the linked entry (a by-id lookup on the
  // shared file) so callers don't thread it. Degrades to the default workspace for an
  // orphan entry OR an isolated connection with no pipeline_entries table (test harness).
  // Derived BEFORE the reconcile below so the idempotency lookup is itself
  // workspace-scoped: an entry_id belongs to exactly one team, but every recruiter-facing
  // schedule_invites query must filter workspace_id (schedule-tenancy.test.ts) and a new
  // invite must never reconcile against a DIFFERENT tenant's row.
  let workspaceId = "workspace";
  try {
    const wsRow = d.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(input.entryId) as
      | { workspace_id?: string }
      | undefined;
    if (wsRow?.workspace_id) workspaceId = wsRow.workspace_id;
  } catch {
    /* no pipeline_entries on this connection — default workspace */
  }
  const existing = d
    .prepare(
      `SELECT * FROM schedule_invites WHERE entry_id = ? AND workspace_id = ? AND status IN ('pending','confirmed')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(input.entryId, workspaceId) as Record<string, unknown> | undefined;
  // Reuse a live invite (idempotent re-invite), but NOT an EXPIRED pending one:
  // a link aged past the TTL is a dead capability the token route refuses, so
  // re-inviting must mint a fresh token rather than hand back the stale one
  // (Direction 1). A confirmed invite (or a still-fresh pending one) is reused.
  if (existing && !isScheduleInviteExpired(rowTo(existing))) return rowTo(existing);
  const now = new Date().toISOString();
  const id = randomId("sch");
  const token = randomToken("st");
  // RETURNING * hands the freshly-inserted row back in the same statement, so we
  // don't issue a second SELECT to read what we just wrote.
  const row = d
    .prepare(
      `INSERT INTO schedule_invites (id, token, entry_id, workspace_id, candidate_label, job_title, status, duration_min, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING *`
    )
    .get(id, token, input.entryId, workspaceId, input.candidateLabel ?? null, input.jobTitle ?? null, input.durationMin ?? null, now) as Record<
    string,
    unknown
  >;
  return rowTo(row);
}

export function getScheduleInviteByToken(token: string): ScheduleInvite | null {
  const r = db().prepare(`SELECT * FROM schedule_invites WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
  return r ? rowTo(r) : null;
}

/** Recruiter projection of every invite (W6-3/SCH1). The store had ONLY token
 *  lookup / bookedSlots / dueReminders — once a link was minted its whole life
 *  was invisible: no agenda of confirmed bookings, no view of un-booked
 *  invites, and the two operator flags written for exactly this surface
 *  (needs_more_slots, needs_reconcile) had zero readers. Confirmed bookings
 *  first by slot time, then pending newest-first. */
export function listScheduleInvites(limit = 200, workspaceId: string = DEFAULT_WORKSPACE_ID): ScheduleInvite[] {
  // LEFT JOIN the linked entry so the agenda can gate on the entry's fate — the
  // Closed-bucket re-invite (Direction: re-invite from the Closed bucket) is withheld
  // when the entry is terminal (rejected/hired). Same-file, separate connection: the
  // join resolves against db.ts's pipeline_entries (as dueReminders does). Recruiter-
  // facing, so still workspace-scoped on the invite side.
  const rows = db()
    .prepare(
      `SELECT s.*, p.status AS entry_status, p.stage AS entry_stage
         FROM schedule_invites s
         LEFT JOIN pipeline_entries p ON p.id = s.entry_id
        WHERE s.workspace_id = ?
        ORDER BY (s.slot_at IS NULL) ASC, s.slot_at ASC, s.created_at DESC
        LIMIT ?`
    )
    .all(workspaceId, Math.min(Math.max(limit, 1), 500)) as Record<string, unknown>[];
  return rows.map(rowTo);
}

/** The invites for ONE entry (drawer-open-diet). The candidate drawer used to pull up
 *  to 500 workspace invites via listScheduleInvites and JS-filter to the single entry —
 *  a full workspace scan on every drawer open (and every in-place stage-move refresh).
 *  schedule_invites has an entry_id column (indexed: idx_sched_entry), so scope the read
 *  in SQL instead. Byte-identical to `listScheduleInvites(...).filter(i => i.entryId ===
 *  entryId)`: same LEFT JOIN (entry_status/entry_stage), same workspace scope, same
 *  ORDER BY — only the WHERE narrows to this entry (pinned by schedule-store.test.ts). */
export function listScheduleInvitesForEntry(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): ScheduleInvite[] {
  const rows = db()
    .prepare(
      `SELECT s.*, p.status AS entry_status, p.stage AS entry_stage
         FROM schedule_invites s
         LEFT JOIN pipeline_entries p ON p.id = s.entry_id
        WHERE s.workspace_id = ? AND s.entry_id = ?
        ORDER BY (s.slot_at IS NULL) ASC, s.slot_at ASC, s.created_at DESC`
    )
    .all(workspaceId, entryId) as Record<string, unknown>[];
  return rows.map(rowTo);
}

export type ConfirmResult =
  | { ok: true; invite: ScheduleInvite }
  | { ok: false; reason: "not_found" | "taken"; invite: ScheduleInvite | null };

/** Confirm a slot, atomically rejecting a time another candidate already took.
 *  better-sqlite3 runs synchronously, so the read-then-write below executes as a
 *  single uninterrupted transaction — two concurrent confirms can't both claim
 *  the same slot_at, which is what `bookedSlots()`/`proposeSlots()` only guard at
 *  read time. Collision identity is the ISO `slot_at`, not the display label. */
export function confirmScheduleInvite(token: string, slot: string, slotAt?: string | null, candidateTz?: string | null): ConfirmResult {
  const d = db();
  const tx = d.transaction((): ConfirmResult => {
    const current = d.prepare(`SELECT * FROM schedule_invites WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
    if (!current) return { ok: false, reason: "not_found", invite: null };
    const inv = rowTo(current);
    if (inv.status === "confirmed") return { ok: true, invite: inv }; // idempotent re-confirm of the same invite
    // Collision domain is per-team (a team's booking can't clash with another team's
    // calendar): scope the check to this invite's workspace.
    const clash = slotAt
      ? d.prepare(`SELECT 1 FROM schedule_invites WHERE status = 'confirmed' AND slot_at = ? AND token != ? AND workspace_id = ? LIMIT 1`).get(slotAt, token, inv.workspaceId)
      : d.prepare(`SELECT 1 FROM schedule_invites WHERE status = 'confirmed' AND slot = ? AND token != ? AND workspace_id = ? LIMIT 1`).get(slot, token, inv.workspaceId);
    if (clash) return { ok: false, reason: "taken", invite: inv };
    // RETURNING * gives the just-updated row back in the same statement (inside the
    // transaction), replacing the previous UPDATE-then-re-SELECT pair.
    // Confirming clears any prior zero-slots flag: a candidate who once hit a
    // fully-booked horizon (needs_more_slots) is no longer stalled once they
    // book, so the flag stays honest as "currently stalled", not "ever stalled".
    // COALESCE keeps any previously-captured zone when this confirm doesn't carry
    // one (e.g. a browser that couldn't resolve it), rather than nulling it out.
    const updated = d
      .prepare(
        `UPDATE schedule_invites
            SET status = 'confirmed', slot = ?, slot_at = ?, confirmed_at = ?, candidate_tz = COALESCE(?, candidate_tz),
                attendance_status = NULL, attendance_at = NULL,
                needs_more_slots = 0, more_slots_flagged_at = NULL,
                proposals = NULL, proposals_at = NULL, proposal_status = NULL
          WHERE token = ? RETURNING *`
      )
      .get(slot, slotAt ?? null, new Date().toISOString(), candidateTz ?? null, token) as Record<string, unknown>;
    return { ok: true, invite: rowTo(updated) };
  });
  return tx();
}

/** Attach (or clear, with null) the interview join link on an invite. The caller
 *  validates + normalizes the URL (http/https only); this just persists it. Returns
 *  the updated row, or null when the token doesn't exist. */
export function setScheduleInviteMeetingUrl(token: string, url: string | null): ScheduleInvite | null {
  const clean = url && url.trim() ? url.trim().slice(0, 2048) : null;
  const updated = db()
    .prepare(`UPDATE schedule_invites SET meeting_url = ? WHERE token = ? RETURNING *`)
    .get(clean, token) as Record<string, unknown> | undefined;
  return updated ? rowTo(updated) : null;
}

/** Cap on candidate self-reschedules of a confirmed booking. Small on purpose:
 *  the "change time" affordance exists to remove recruiter triage, not to let a
 *  candidate churn the calendar — past this the email's "just reply" path takes
 *  over (a human reschedules). */
export const MAX_RESCHEDULES = 3;

export type RescheduleResult =
  | { ok: true; invite: ScheduleInvite }
  | { ok: false; reason: "not_found" | "not_confirmed" | "taken" | "limit"; invite: ScheduleInvite | null };

/** Move a CONFIRMED booking to a new slot. Same synchronous-transaction collision
 *  authority as confirmScheduleInvite (two concurrent reschedules — or a reschedule
 *  racing another candidate's first confirm — can't both claim the same slot_at;
 *  identity is the ISO slot_at, not the label). The old slot is freed implicitly by
 *  overwriting slot_at (it drops out of bookedSlots()). Re-anchors confirmed_at to
 *  now and RESETS the reminder cycle (reminder_sent_at / attempts cleared) so the
 *  reminder fires for the NEW time, not the abandoned one. Bounded by MAX_RESCHEDULES.
 *  Only a confirmed invite is reschedulable — a pending one books via confirm. */
export function rescheduleScheduleInvite(
  token: string,
  slot: string,
  slotAt: string,
  candidateTz?: string | null,
  // Direction 2 — a RECRUITER-initiated move (recruiter-side invite control). The
  // MAX_RESCHEDULES cap exists to stop a CANDIDATE churning the calendar; a recruiter
  // repairing a booking is trusted, so `recruiter:true` bypasses the cap AND does not
  // consume the candidate's reschedule budget. The collision authority and the
  // reminder-cycle reset are identical — the recruiter path layers on this same
  // transaction rather than forking a parallel one.
  opts?: { recruiter?: boolean }
): RescheduleResult {
  const recruiter = opts?.recruiter === true;
  const d = db();
  const tx = d.transaction((): RescheduleResult => {
    const current = d.prepare(`SELECT * FROM schedule_invites WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
    if (!current) return { ok: false, reason: "not_found", invite: null };
    const inv = rowTo(current);
    if (inv.status !== "confirmed") return { ok: false, reason: "not_confirmed", invite: inv };
    if (!recruiter && inv.rescheduleCount >= MAX_RESCHEDULES) return { ok: false, reason: "limit", invite: inv };
    // Re-picking the same time is a no-op (the reschedule count is precious) —
    // don't burn a reschedule or churn the reminder cycle for an unchanged slot.
    if (inv.slotAt === slotAt) return { ok: true, invite: inv };
    // Collision identity is slot_at; exclude this invite's own row so freeing the
    // old slot here can't be seen as a clash against itself.
    const clash = d
      .prepare(`SELECT 1 FROM schedule_invites WHERE status = 'confirmed' AND slot_at = ? AND token != ? AND workspace_id = ? LIMIT 1`)
      .get(slotAt, token, inv.workspaceId);
    if (clash) return { ok: false, reason: "taken", invite: inv };
    // A recruiter move doesn't spend the candidate's reschedule budget.
    const countClause = recruiter ? "" : "reschedule_count = reschedule_count + 1,";
    const updated = d
      .prepare(
        `UPDATE schedule_invites
            SET slot = ?, slot_at = ?, confirmed_at = ?, ${countClause}
                candidate_tz = COALESCE(?, candidate_tz),
                attendance_status = NULL, attendance_at = NULL,
                reminder_sent_at = NULL, reminder_attempts = 0, reminder_last_attempt_at = NULL,
                needs_more_slots = 0, more_slots_flagged_at = NULL,
                proposals = NULL, proposals_at = NULL, proposal_status = NULL
          WHERE token = ? RETURNING *`
      )
      .get(slot, slotAt, new Date().toISOString(), candidateTz ?? null, token) as Record<string, unknown>;
    return { ok: true, invite: rowTo(updated) };
  });
  return tx();
}

/** RSVP "I'll be there" on a confirmed booking (idea-87af39c5) — records an early
 *  attendance signal the recruiter agenda surfaces, so a no-show isn't first learned
 *  when it happens. Only a still-confirmed invite is affected (the WHERE guard), so a
 *  stale tab on a pending/rebooked invite is a no-op. Returns the updated row or null. */
export function confirmAttendance(token: string): ScheduleInvite | null {
  const updated = db()
    .prepare(
      `UPDATE schedule_invites SET attendance_status = 'confirmed', attendance_at = ?
        WHERE token = ? AND status = 'confirmed' RETURNING *`
    )
    .get(new Date().toISOString(), token) as Record<string, unknown> | undefined;
  return updated ? rowTo(updated) : null;
}

/** RSVP "I can't make it" on a confirmed booking (idea-87af39c5): free the slot
 *  (clear slot_at so it drops out of bookedSlots) and return the invite to 'pending'
 *  so the candidate can pick a new time, while recording the cancellation for the
 *  recruiter (attendance_status = 'cancelled'). Resets the reminder cycle — no
 *  reminder for an abandoned slot. Only a confirmed invite cancels; returns the
 *  updated (now-pending) row or null. The linked pipeline entry is intentionally
 *  left at its stage: a cancelled time means "find another", not "reject". */
export function cancelAttendance(token: string): ScheduleInvite | null {
  const updated = db()
    .prepare(
      `UPDATE schedule_invites
          SET status = 'pending', slot = NULL, slot_at = NULL, confirmed_at = NULL,
              attendance_status = 'cancelled', attendance_at = ?,
              reminder_sent_at = NULL, reminder_attempts = 0, reminder_last_attempt_at = NULL
        WHERE token = ? AND status = 'confirmed' RETURNING *`
    )
    .get(new Date().toISOString(), token) as Record<string, unknown> | undefined;
  return updated ? rowTo(updated) : null;
}

/** Terminal DECLINE (Direction 1): the candidate withdrew from the interview
 *  entirely — distinct from cancelAttendance, which frees the slot but returns the
 *  invite to 'pending' for re-booking. A decline is a closed fate: the slot is freed
 *  (slot_at cleared → drops out of bookedSlots), the reminder cycle is reset (no
 *  reminder for an interview that won't happen), and the status goes terminal so the
 *  link can never book again. Reachable from a pending OR a confirmed invite (a
 *  candidate can withdraw before or after booking). Transactional like the other
 *  transitions. Returns the updated row, or null when the token doesn't exist or is
 *  already terminal. The linked pipeline entry is intentionally left at its stage —
 *  a withdrawal is surfaced, not silently regressed (the recruiter decides). */
export function declineScheduleInvite(token: string): ScheduleInvite | null {
  const d = db();
  const tx = d.transaction((): ScheduleInvite | null => {
    const updated = d
      .prepare(
        `UPDATE schedule_invites
            SET status = 'declined', slot = NULL, slot_at = NULL, confirmed_at = NULL,
                reminder_sent_at = NULL, reminder_attempts = 0, reminder_last_attempt_at = NULL
          WHERE token = ? AND status IN ('pending','confirmed') RETURNING *`
      )
      .get(token) as Record<string, unknown> | undefined;
    return updated ? rowTo(updated) : null;
  });
  return tx();
}

/** Terminal NO-SHOW (Direction 1): the recruiter marks a CONFIRMED interview whose
 *  slot has passed as not-attended. Before this a real no-show just fell out of the
 *  "today" bucket after the grace window and vanished with no record. Keeps slot_at
 *  (the record of the missed time) but resets the reminder cycle and closes the
 *  status so the link can't re-book. Only a confirmed invite can no-show; returns the
 *  updated row or null. Transactional. The linked pipeline entry is left at its stage
 *  — surfacing the fate, not regressing it. */
export function markScheduleInviteNoShow(token: string): ScheduleInvite | null {
  const d = db();
  const tx = d.transaction((): ScheduleInvite | null => {
    const updated = d
      .prepare(
        `UPDATE schedule_invites
            SET status = 'no_show', reminder_sent_at = NULL, reminder_attempts = 0, reminder_last_attempt_at = NULL
          WHERE token = ? AND status = 'confirmed' RETURNING *`
      )
      .get(token) as Record<string, unknown> | undefined;
    return updated ? rowTo(updated) : null;
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

/** Clear the needs-reconcile flag once a recruiter has repaired the drift (Direction
 *  2 — recruiter-side invite control). Idempotent: returns true only when a flag was
 *  actually set (1→0), so the caller can tell a real resolve from a no-op double-tap. */
export function resolveScheduleInviteReconcile(token: string): boolean {
  const res = db()
    .prepare(`UPDATE schedule_invites SET needs_reconcile = 0, reconcile_reason = NULL WHERE token = ? AND needs_reconcile = 1`)
    .run(token);
  return res.changes > 0;
}

/** Flag an invite whose entire proposal horizon was already booked when the
 *  candidate opened the picker (zero offerable slots — idea-5df8e10f). Returns
 *  true only on the 0→1 transition, so the caller logs/alerts exactly once
 *  instead of on every page refresh. Cleared when the candidate confirms a slot
 *  (see confirmScheduleInvite). */
export function flagScheduleInviteNeedsMoreSlots(token: string): boolean {
  const res = db()
    .prepare(
      `UPDATE schedule_invites SET needs_more_slots = 1, more_slots_flagged_at = ?
        WHERE token = ? AND needs_more_slots = 0`
    )
    .run(new Date().toISOString(), token);
  return res.changes > 0;
}

/** Candidate "propose your own times" escalation: persist 1–MAX_PROPOSALS server-
 *  authored proposed slots on a STUCK (pending or confirmed) invite and mark it
 *  'pending' so the recruiter lifecycle panel surfaces it as attention-worthy. The
 *  caller validates/mints the slots (validateProposedSlots) — this only persists the
 *  server-authored [{value,label}] shape. Refuses a terminal invite via the status
 *  guard (the token route's 410 gate already blocks expired/declined/no_show upstream).
 *  Returns the updated row, or null when the token doesn't exist or is terminal. */
export function setScheduleInviteProposals(token: string, proposals: { value: string; label: string }[]): ScheduleInvite | null {
  const json = JSON.stringify(proposals.map((p) => ({ value: p.value, label: p.label })));
  const updated = db()
    .prepare(
      `UPDATE schedule_invites
          SET proposals = ?, proposals_at = ?, proposal_status = 'pending'
        WHERE token = ? AND status IN ('pending','confirmed') RETURNING *`
    )
    .get(json, new Date().toISOString(), token) as Record<string, unknown> | undefined;
  return updated ? rowTo(updated) : null;
}

/** Recruiter declined all of a candidate's proposed times: clear them and record the
 *  honest 'declined' state the candidate page reads ("couldn't accommodate — the
 *  recruiter will reach out"). Only a currently-'pending' proposal declines (so a
 *  double-tap or a stale request is a no-op). Returns the updated row, or null. */
export function declineScheduleInviteProposals(token: string): ScheduleInvite | null {
  const updated = db()
    .prepare(
      `UPDATE schedule_invites
          SET proposals = NULL, proposals_at = NULL, proposal_status = 'declined'
        WHERE token = ? AND proposal_status = 'pending' RETURNING *`
    )
    .get(token) as Record<string, unknown> | undefined;
  return updated ? rowTo(updated) : null;
}

/** ISO datetimes already taken by confirmed invites — so two candidates don't
 *  double-book. Returns slot_at (the real identity), not the display label. */
export function bookedSlots(workspaceId: string = DEFAULT_WORKSPACE_ID): string[] {
  const rows = db()
    .prepare(`SELECT slot_at FROM schedule_invites WHERE status = 'confirmed' AND slot_at IS NOT NULL AND workspace_id = ?`)
    .all(workspaceId) as {
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
  // LEFT JOIN the linked pipeline entry and surface its status/stage so we never
  // remind a candidate who has left the interview track. A confirmed invite alone
  // isn't enough: after the candidate is rejected/declined (terminal status) or
  // Hired (status stays 'active', stage 'Hired'), the slot is still in-window so the
  // sweep would email "see you at your interview" for a call that won't happen. The
  // eligibility rule itself lives in isEntryReminderEligible (pipeline-status.ts) —
  // the single source the rest of the app shares — and is applied here in JS rather
  // than re-encoded as a SQL predicate so the two can't drift; a null entry (orphan
  // invite, no matching row) stays eligible, as before the join. The partial index
  // still drives the invite-side filter; p is reached by primary key. Same kp.sqlite
  // file, separate connection — the join resolves against db.ts's tables.
  const rows = db()
    .prepare(
      `SELECT s.*, p.id AS entry_row_id, p.status AS entry_status, p.stage AS entry_stage, p.locale AS entry_locale
         FROM schedule_invites s
         LEFT JOIN pipeline_entries p ON p.id = s.entry_id
        WHERE s.status = 'confirmed' AND s.slot_at IS NOT NULL AND s.reminder_sent_at IS NULL
          AND s.reminder_attempts < ?`
    )
    .all(REMINDER_MAX_ATTEMPTS) as Record<string, unknown>[];
  return rows
    .filter((r) =>
      isEntryReminderEligible(
        r.entry_row_id == null ? null : { status: String(r.entry_status), stage: String(r.entry_stage) }
      )
    )
    .map(rowTo)
    .filter((inv) => {
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

// Slot proposal + structural validation live in schedule-slots.ts (pure, no
// DB, unit-testable) so the confirm-side validation (idea-e05aedfb) and the
// proposal can never drift apart. This store keeps only the persistence side
// (bookedSlots/confirmScheduleInvite are the collision authority).
