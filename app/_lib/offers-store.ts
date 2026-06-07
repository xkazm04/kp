import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";
import { randomId, randomToken } from "./random-id";
import type { PipelineEntryStatus } from "./pipeline-status";

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
      responded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offers_entry ON offers (entry_id);
  `);
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
  status: string; // extended | accepted | declined
  createdAt: string;
  respondedAt: string | null;
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
  const now = new Date().toISOString();
  const id = randomId("off");
  const token = randomToken("tk");
  // RETURNING * hands the freshly-inserted row back in the same statement, so we
  // don't issue a second SELECT to read what we just wrote.
  const row = d
    .prepare(
      `INSERT INTO offers (id, token, entry_id, candidate_label, job_id, job_title, currency, salary, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'extended', ?) RETURNING *`
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
      now
    ) as Record<string, unknown>;
  return rowToOffer(row);
}

export function getOfferByToken(token: string): OfferRow | null {
  const r = db().prepare(`SELECT * FROM offers WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
  return r ? rowToOffer(r) : null;
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

/** Record the candidate's (or recruiter-on-behalf) response. Idempotent. */
export function markOfferResponded(token: string, status: "accepted" | "declined"): OfferRow | null {
  const d = db();
  // Idempotent: the `status = 'extended'` guard means only the first response
  // flips the row, and RETURNING * hands back the fresh row in the same statement
  // — no separate re-SELECT on the common (still-open) path.
  const updated = d
    .prepare(`UPDATE offers SET status = ?, responded_at = ? WHERE token = ? AND status = 'extended' RETURNING *`)
    .get(status, new Date().toISOString(), token) as Record<string, unknown> | undefined;
  if (updated) return rowToOffer(updated);
  // Already responded, or no such token — return the current row (or null) as-is.
  return getOfferByToken(token);
}

/** Terminal status write for a declined offer (candidate said no). Typed against
 *  the canonical taxonomy so a stray free-form string can't be persisted. */
export function markEntryStatus(entryId: string, status: PipelineEntryStatus): void {
  db().prepare(`UPDATE pipeline_entries SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), entryId);
}
