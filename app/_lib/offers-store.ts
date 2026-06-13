import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";
import { randomId, randomToken } from "./random-id";
import { TERMINAL_ENTRY_STATUSES, type PipelineEntryStatus } from "./pipeline-status";
import { PIPELINE_STAGES } from "./pipeline-stages";
import { isOfferExpired, OFFER_TTL_MS } from "./offer-policy";

// Direction #4 — offer extension + candidate response capture. Isolated-connection
// store (same pattern as job-ingest.ts): opens its OWN better-sqlite3 handle on
// the shared DB file (WAL-safe) so we don't touch the fork-churned db.ts. Owns the
// `offers` table (one row per extended offer, token-gated for the candidate's
// accept/decline) and a couple of narrow writes to pipeline_entries for the
// terminal decline status. Stage transitions on accept go through db.ts.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  ensureDbDir();
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // respondToOffer interleaves writes across this connection (markOfferResponded/
  // markEntryStatus) and db.ts's (actOnPipelineEntry) on the same kp.sqlite file.
  // Without this, a concurrent writer makes those writes throw SQLITE_BUSY instantly
  // — 500ing a valid accept/decline mid-transition. Wait briefly instead of crashing.
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE,
      entry_id TEXT,
      candidate_label TEXT,
      job_id TEXT,
      job_title TEXT,
      currency TEXT,
      salary INTEGER,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'extended',
      created_at TEXT NOT NULL,
      responded_at TEXT,
      -- Deadline after which an un-answered offer lapses to status 'expired'
      -- (idea-29361408). NULL on legacy rows minted before this column → those
      -- never expire (fail-open, see offer-policy.isOfferExpired).
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offers_entry ON offers (entry_id);
  `);
  // Migration for stores created before the expiry column existed.
  try {
    d.exec(`ALTER TABLE offers ADD COLUMN expires_at TEXT`);
  } catch {
    /* column already exists */
  }
  // At most ONE open offer per entry, enforced by the database itself
  // (idea-00987b3c): the route's read-then-create dedupe is a TOCTOU two
  // near-simultaneous approvals both pass. Partial unique index = the backstop
  // no race can slip through. try/catch: a legacy DB that already holds
  // duplicate open offers would fail the CREATE — keep running (the
  // transactional getOrCreateOpenOffer still dedupes go-forward) and log so an
  // operator can clean up and let the index take on the next boot.
  try {
    d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_offers_open_entry ON offers (entry_id) WHERE status = 'extended'`);
  } catch (e) {
    console.warn("[offers-store] could not create uq_offers_open_entry (duplicate open offers exist?)", e);
  }
  _db = d;
  return d;
}

export type OfferRow = {
  id: string;
  token: string;
  entryId: string | null;
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
  currency: string | null;
  salary: number | null;
  payload: unknown;
  status: string; // extended | accepted | declined | expired
  createdAt: string;
  respondedAt: string | null;
  expiresAt: string | null; // deadline; null = never expires (legacy row)
};

function rowToOffer(r: Record<string, unknown>): OfferRow {
  let payload: unknown = null;
  try {
    payload = r.payload_json ? JSON.parse(r.payload_json as string) : null;
  } catch {
    payload = null;
  }
  return {
    id: r.id as string,
    token: r.token as string,
    entryId: (r.entry_id as string) ?? null,
    candidateLabel: (r.candidate_label as string) ?? null,
    jobId: (r.job_id as string) ?? null,
    jobTitle: (r.job_title as string) ?? null,
    currency: (r.currency as string) ?? null,
    salary: (r.salary as number) ?? null,
    payload,
    status: r.status as string,
    createdAt: r.created_at as string,
    respondedAt: (r.responded_at as string) ?? null,
    expiresAt: (r.expires_at as string) ?? null,
  };
}

/** Extend an offer: persist it and mint the candidate's token. */
export function createOffer(input: {
  entryId: string;
  candidateLabel: string;
  jobId: string | null;
  jobTitle: string | null;
  currency: string | null;
  salary: number | null;
  payload: unknown;
}): OfferRow {
  const d = db();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  // Stamp the deadline at mint time (idea-29361408) so the offer lapses on its own.
  const expiresAt = new Date(nowMs + OFFER_TTL_MS).toISOString();
  const id = randomId("off");
  const token = randomToken("tk");
  // RETURNING * hands the freshly-inserted row back in the same statement, so we
  // don't issue a second SELECT to read what we just wrote.
  const row = d
    .prepare(
      `INSERT INTO offers (id, token, entry_id, candidate_label, job_id, job_title, currency, salary, payload_json, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'extended', ?, ?) RETURNING *`
    )
    .get(
      id,
      token,
      input.entryId,
      input.candidateLabel,
      input.jobId,
      input.jobTitle,
      input.currency,
      input.salary,
      JSON.stringify(input.payload ?? null),
      now,
      expiresAt
    ) as Record<string, unknown>;
  return rowToOffer(row);
}

export function getOfferByToken(token: string): OfferRow | null {
  const r = db().prepare(`SELECT * FROM offers WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
  return r ? rowToOffer(r) : null;
}

/** Lazily lapse a single offer if it's past its deadline (idea-29361408), then
 *  return the current row. Lets the candidate read/respond paths see a freshly
 *  'expired' status the moment the deadline passes, even if the heartbeat sweep
 *  hasn't run yet. The CAS (`status = 'extended'`) means only the still-open row
 *  flips — an already accepted/declined offer is never touched. */
export function expireOfferIfDue(token: string, nowMs: number = Date.now()): OfferRow | null {
  const offer = getOfferByToken(token);
  if (!offer) return null;
  if (offer.status !== "extended" || !isOfferExpired(offer.expiresAt, nowMs)) return offer;
  const updated = db()
    .prepare(`UPDATE offers SET status = 'expired' WHERE token = ? AND status = 'extended' RETURNING *`)
    .get(token) as Record<string, unknown> | undefined;
  return updated ? rowToOffer(updated) : getOfferByToken(token);
}

/** Sweep every still-open offer past its deadline to terminal 'expired' (the
 *  reminder heartbeat calls this). ISO strings compare lexicographically in the
 *  same order as time, so the `<=` is a correct deadline test in SQL. Rows with a
 *  NULL deadline (legacy) are excluded — they never expire. Returns how many lapsed. */
export function lapseExpiredOffers(nowMs: number = Date.now()): number {
  const res = db()
    .prepare(`UPDATE offers SET status = 'expired' WHERE status = 'extended' AND expires_at IS NOT NULL AND expires_at <= ?`)
    .run(new Date(nowMs).toISOString());
  return res.changes;
}

/** Every offer ever extended to an entry, oldest first — the candidate
 *  timeline's offer chapter (extended → accepted/declined per row). */
export function listOffersForEntry(entryId: string): OfferRow[] {
  const rows = db()
    .prepare(`SELECT * FROM offers WHERE entry_id = ? ORDER BY created_at ASC`)
    .all(entryId) as Record<string, unknown>[];
  return rows.map(rowToOffer);
}

/** The most recent still-open offer for an entry (used to dedupe re-extends). */
export function getOpenOfferForEntry(entryId: string): OfferRow | null {
  const r = db()
    .prepare(`SELECT * FROM offers WHERE entry_id = ? AND status = 'extended' ORDER BY created_at DESC LIMIT 1`)
    .get(entryId) as Record<string, unknown> | undefined;
  return r ? rowToOffer(r) : null;
}

/** Atomic "reuse the open offer or mint one" (idea-00987b3c). The route used
 *  `getOpenOfferForEntry(id) ?? createOffer(...)` — a read-then-create TOCTOU:
 *  two near-simultaneous approvals (a double-clicked Accept, or two recruiters)
 *  both saw no open offer and both minted one, sending the candidate TWO live
 *  offer links with different tokens. The IMMEDIATE transaction serializes the
 *  check-then-insert across connections, and the partial unique index above
 *  backstops any writer that bypasses this helper. `created` tells the caller
 *  whether this call minted the row (vs. reusing an existing open offer). */
export function getOrCreateOpenOffer(input: Parameters<typeof createOffer>[0]): { offer: OfferRow; created: boolean } {
  const d = db();
  const tx = d.transaction((): { offer: OfferRow; created: boolean } => {
    const open = getOpenOfferForEntry(input.entryId);
    if (open) return { offer: open, created: false };
    return { offer: createOffer(input), created: true };
  });
  return tx.immediate();
}

/** Record the candidate's (or recruiter-on-behalf) response. Idempotent at the
 *  row level — and the CALLER must be too: `claimed` is true only for the one
 *  call whose CAS actually flipped the row (idea-e80f60f1). respondToOffer used
 *  to ignore this and run the terminal side effects (onboarding dispatch, the
 *  Hired transition, automation events) unconditionally, so two concurrent
 *  accepts both fired them. Side effects belong to the claimer alone. */
export function markOfferResponded(
  token: string,
  status: "accepted" | "declined"
): { offer: OfferRow | null; claimed: boolean } {
  const d = db();
  // The `status = 'extended'` guard means only the first response flips the row,
  // and RETURNING * hands back the fresh row in the same statement — no separate
  // re-SELECT on the common (still-open) path.
  const updated = d
    .prepare(`UPDATE offers SET status = ?, responded_at = ? WHERE token = ? AND status = 'extended' RETURNING *`)
    .get(status, new Date().toISOString(), token) as Record<string, unknown> | undefined;
  if (updated) return { offer: rowToOffer(updated), claimed: true };
  // Already responded, or no such token — return the current row (or null) as-is.
  return { offer: getOfferByToken(token), claimed: false };
}

// SQL list of the two terminal statuses, derived from the taxonomy const so this
// guard can't drift from it (mirrors db.ts's TERMINAL_STATUS_SQL_LIST). Trusted
// compile-time literals, never user input — injection-safe to inline.
const TERMINAL_STATUS_SQL_LIST = `(${TERMINAL_ENTRY_STATUSES.map((s) => `'${s}'`).join(", ")})`;
// The terminal STAGE: a Hired candidate keeps status='active' (see pipeline-status
// header), so the status list alone wouldn't protect them — gate on stage too.
const HIRED_STAGE = PIPELINE_STAGES[PIPELINE_STAGES.length - 1];

/** Terminal status write for a declined offer (candidate said no). Typed against
 *  the canonical taxonomy so a stray free-form string can't be persisted.
 *
 *  CONDITIONAL by design (idea-83614939). An entry can accumulate MANY offer links
 *  (re-extends, duplicates) and offer tokens never expire, so a decline click on a
 *  STALE link could otherwise fire an unconditional `UPDATE … SET status` that
 *  silently demotes a candidate who has since been Hired (status stays 'active',
 *  stage 'Hired') — or re-closes an already closed-out one — losing the hire with no
 *  audit trail. The WHERE guard only transitions a still-live, not-yet-Hired entry;
 *  it mirrors the approve_event guard in actOnPipelineEntry that protects the
 *  symmetric stale-schedule-token path, and the isEntryReminderEligible predicate.
 *  Returns true only when the row actually transitioned; logs when the guard blocks
 *  the write so the dropped decline is never silent. */
export function markEntryStatus(entryId: string, status: PipelineEntryStatus): boolean {
  const res = db()
    .prepare(
      `UPDATE pipeline_entries SET status = ?, updated_at = ?
        WHERE id = ? AND status NOT IN ${TERMINAL_STATUS_SQL_LIST} AND stage != ?`
    )
    .run(status, new Date().toISOString(), entryId, HIRED_STAGE);
  if (res.changes === 0) {
    console.warn(
      `[offers-store] markEntryStatus('${status}') blocked for entry ${entryId}: ` +
        `entry is already terminal or Hired (or missing) — refusing to overwrite (stale/duplicate offer decline).`
    );
    return false;
  }
  return true;
}
