import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { randomId, randomToken } from "./random-id";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { TERMINAL_ENTRY_STATUSES, type PipelineEntryStatus } from "./pipeline-status";
import { stageWithRole } from "./pipeline-stages";
import { getPipelineAxis } from "./pipeline-axis-server";
import { isOfferExpired, OFFER_REMINDER_LEAD_MS, offerExpiresAtMs, resolveOfferTtlDays } from "./offer-policy";
import { recordAutomationEvent } from "./db/pipeline";

// Direction #4 — offer extension + candidate response capture. Isolated-connection
// store (same pattern as job-ingest.ts): opens its OWN better-sqlite3 handle on
// the shared DB file (WAL-safe) so we don't touch the fork-churned db.ts. Owns the
// `offers` table (one row per extended offer, token-gated for the candidate's
// accept/decline) and a couple of narrow writes to pipeline_entries for the
// terminal decline status. Stage transitions on accept go through db.ts.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // respondToOffer interleaves writes across this connection (markOfferResponded/
  // markEntryStatus) and db.ts's (actOnPipelineEntry). Without the wait, a
  // concurrent writer makes those writes throw SQLITE_BUSY instantly — 500ing a
  // valid accept/decline mid-transition. Wait briefly instead of crashing.
  const d = openStore();
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
      expires_at TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE INDEX IF NOT EXISTS idx_offers_entry ON offers (entry_id);
  `);
  // Tenancy scoping (E0 Phase 1): workspace_id on a pre-existing table (isolated store).
  try {
    d.exec(`ALTER TABLE offers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'`);
  } catch {
    /* column already exists — idempotent */
  }
  // Migration for stores created before the expiry column existed.
  try {
    d.exec(`ALTER TABLE offers ADD COLUMN expires_at TEXT`);
  } catch {
    /* column already exists */
  }
  // Migration for the T-48h reminder dedup column (idea-29361408 follow-up): the
  // timestamp a single pre-deadline reminder was sent, NULL until then. The
  // reminder sweep CAS-claims on `reminded_at IS NULL` so it sends at most once.
  try {
    d.exec(`ALTER TABLE offers ADD COLUMN reminded_at TEXT`);
  } catch {
    /* column already exists */
  }
  // The whole-day deadline window actually APPLIED to this offer (the recruiter's
  // ttlDays lever, already validated through offer-policy.resolveOfferTtlDays).
  // Persisted because expires_at alone cannot answer "did the recruiter change the
  // deadline?" on a re-extend — expires_at is re-based on every refresh, so the
  // stored span stops equalling the chosen TTL. NULL on legacy rows minted before
  // this column → read back as the deployment default, which is what they were
  // minted with.
  try {
    d.exec(`ALTER TABLE offers ADD COLUMN ttl_days INTEGER`);
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
  /** The whole-day window applied when the deadline was last (re-)stamped. Legacy
   *  rows read back as the deployment default. Compared across re-extends so a
   *  deliberate deadline change is honored and a double-click still isn't. */
  ttlDays: number;
  // The offer's tenant (stamped from the entry at createOffer). Load-bearing on
  // the terminal transitions: respondToOffer must pass it to the workspace-scoped
  // actOnPipelineEntry/markEntryStatus, or a non-default team's accept/decline
  // silently no-ops against the default workspace (offers-onboarding #1).
  workspaceId: string;
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
    // resolveOfferTtlDays(null) is the deployment default — exactly what a legacy
    // (pre-column) row's deadline was minted from.
    ttlDays: resolveOfferTtlDays((r.ttl_days as number) ?? null),
    workspaceId: (r.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
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
  /** Per-offer deadline in whole days — the recruiter's lever (offers-onboarding
   *  #3). Out-of-range/omitted falls back to the deployment default; validated in
   *  offer-policy.resolveOfferTtlDays, and the resolved figure is persisted on the
   *  row so a re-extend can tell a deadline change from a verbatim re-send. */
  ttlDays?: number | null;
}): OfferRow {
  const d = db();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  // Stamp the deadline at mint time (idea-29361408) so the offer lapses on its own.
  // Honors a per-offer ttlDays (validated) or the deployment default. The APPLIED
  // day-count is stored alongside it so a later re-extend can tell a deliberate
  // deadline change from a verbatim re-send.
  const ttlDays = resolveOfferTtlDays(input.ttlDays);
  const expiresAt = new Date(offerExpiresAtMs(nowMs, ttlDays)).toISOString();
  const id = randomId("off");
  const token = randomToken("tk");
  // Tenant (P1): an offer inherits its pipeline entry's workspace (by-id read; guarded
  // so an isolated store without pipeline_entries falls back to default). Every other
  // offers op is keyed by the unguessable token or the globally-unique entry_id, and the
  // lapse/reminder sweeps are global heartbeat jobs — so the stamp here is what a future
  // recruiter enumeration would filter on.
  let workspaceId = DEFAULT_WORKSPACE_ID;
  try {
    const ws = d.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(input.entryId) as { workspace_id?: string } | undefined;
    workspaceId = ws?.workspace_id ?? DEFAULT_WORKSPACE_ID;
  } catch {
    /* pipeline_entries absent on this connection — keep the default workspace */
  }
  // RETURNING * hands the freshly-inserted row back in the same statement, so we
  // don't issue a second SELECT to read what we just wrote.
  const row = d
    .prepare(
      `INSERT INTO offers (id, token, entry_id, candidate_label, job_id, job_title, currency, salary, payload_json, status, created_at, expires_at, ttl_days, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'extended', ?, ?, ?, ?) RETURNING *`
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
      expiresAt,
      ttlDays,
      workspaceId
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
  if (!updated) return getOfferByToken(token);
  const row = rowToOffer(updated);
  // Record the lapse like every sibling offer transition (sent/accepted/declined),
  // so a dead offer leaves an audit trail, surfaces on the candidate timeline, and
  // doesn't read as "still pending" in accept-rate/funnel analytics.
  if (row.entryId) recordAutomationEvent(row.entryId, "offer_expired", row.jobTitle ?? "", row.workspaceId);
  return row;
}

/** Sweep every still-open offer past its deadline to terminal 'expired' (the
 *  reminder heartbeat calls this). ISO strings compare lexicographically in the
 *  same order as time, so the `<=` is a correct deadline test in SQL. Rows with a
 *  NULL deadline (legacy) are excluded — they never expire. Returns how many lapsed. */
export function lapseExpiredOffers(nowMs: number = Date.now()): number {
  // RETURNING the flipped rows (race-safe vs a separate SELECT) so each lapse can
  // record an `offer_expired` event — otherwise a dead offer is invisible to the
  // recruiter, the timeline, and accept-rate analytics.
  const lapsed = db()
    .prepare(
      `UPDATE offers SET status = 'expired'
       WHERE status = 'extended' AND expires_at IS NOT NULL AND expires_at <= ?
       RETURNING entry_id, job_title, workspace_id`
    )
    .all(new Date(nowMs).toISOString()) as Array<{ entry_id: string | null; job_title: string | null; workspace_id: string | null }>;
  for (const r of lapsed) {
    // A GLOBAL sweep across every tenant (the heartbeat has no session), so each
    // event is stamped with the offer row's OWN team — not the caller's and not
    // the default. Returning workspace_id from the UPDATE is what makes that
    // possible without a second query per row.
    if (r.entry_id) recordAutomationEvent(r.entry_id, "offer_expired", r.job_title ?? "", r.workspace_id ?? undefined);
  }
  return lapsed.length;
}

/** Still-open offers that have entered the T-48h reminder window and haven't been
 *  reminded yet: deadline in the FUTURE (`> now`, so not already lapsable) but within
 *  `leadMs`. NULL-deadline (legacy, never-expires) rows are excluded — nothing to nudge
 *  toward. ISO strings compare lexicographically in time order, so the bounds are
 *  correct in SQL. The heartbeat reminder sweep reads this. */
export function dueOfferReminders(
  nowMs: number = Date.now(),
  leadMs: number = OFFER_REMINDER_LEAD_MS
): OfferRow[] {
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs + leadMs).toISOString();
  const rows = db()
    .prepare(
      `SELECT * FROM offers
       WHERE status = 'extended' AND reminded_at IS NULL
         AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?
       ORDER BY expires_at ASC`
    )
    .all(nowIso, cutoffIso) as Record<string, unknown>[];
  return rows.map(rowToOffer);
}

/** CAS-claim the reminder for an offer: stamp `reminded_at` only if it's still an
 *  un-reminded open offer. Returns true for the ONE caller whose write flipped it —
 *  the sweep claims BEFORE dispatch, so a re-tick (or a second process) can't send the
 *  candidate a duplicate nudge. At-most-once by design: a dispatch failure after the
 *  claim is logged, not retried (the deadline still lapses the offer and the candidate
 *  can act any time before then — a missed nudge is benign; a duplicate is not). */
export function markOfferReminded(token: string, whenIso: string = new Date().toISOString()): boolean {
  const res = db()
    .prepare(`UPDATE offers SET reminded_at = ? WHERE token = ? AND reminded_at IS NULL AND status = 'extended'`)
    .run(whenIso, token);
  return res.changes > 0;
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
export function getOrCreateOpenOffer(
  input: Parameters<typeof createOffer>[0]
): { offer: OfferRow; created: boolean; updated: boolean } {
  const d = db();
  const tx = d.transaction((): { offer: OfferRow; created: boolean; updated: boolean } => {
    const open = getOpenOfferForEntry(input.entryId);
    if (!open) return { offer: createOffer(input), created: true, updated: false };

    // Re-extend after a draft edit (offers-onboarding #1): the stored row is the
    // offer-of-record the BINDING accept page renders (offer-finalize.offerView →
    // OfferClient reads offer.salary/currency), but the re-dispatched letter is
    // minted from the LIVE draft. So if the recruiter corrected the number (typo,
    // re-negotiation, wrong currency) and re-extends, the emailed terms and the
    // accept page would diverge — a candidate could accept a figure that isn't the
    // one they were sent. Refresh the SAME open row (same token/link — the
    // idempotent re-send contract; never a second live link) to the incoming
    // draft's terms so the accept page and the letter are one snapshot. Guarded to a
    // material change, so a pure idempotent re-extend stays a verbatim re-send with
    // its deadline and reminder claim untouched.
    const nextCurrency = typeof input.currency === "string" ? input.currency : null;
    const nextSalary = input.salary ?? null;
    const termsChanged = nextSalary !== open.salary || nextCurrency !== open.currency;
    // The DEADLINE is the recruiter's other lever, and it is chosen fresh on every
    // approval (DecisionsAiReviewCard's ttlDays input). Guarding only on salary/currency
    // silently discarded it: re-approving an unchanged 100k offer with the window
    // widened 7 -> 14 days left the offer lapsing on the ORIGINAL deadline. Compare the
    // APPLIED day-counts (open.ttlDays, persisted at mint) rather than expires_at, which
    // is re-based on every refresh — so a genuine change is honored while a
    // double-clicked approval, which re-sends the identical TTL, still isn't.
    const nextTtlDays = resolveOfferTtlDays(input.ttlDays);
    const deadlineChanged = nextTtlDays !== open.ttlDays;
    // A row whose deadline has already passed but that the heartbeat hasn't swept to
    // 'expired' yet is still "open" to the query above. Re-sending it verbatim would
    // mail the candidate a link that 410s on arrival — and the same recruiter action a
    // minute later (post-sweep) mints a fresh live offer. Refresh it instead, so the
    // outcome doesn't depend on sweep timing.
    const deadlineLapsed = isOfferExpired(open.expiresAt);
    if (!termsChanged && !deadlineChanged && !deadlineLapsed) return { offer: open, created: false, updated: false };

    // A corrected offer is effectively re-extended: restart the deadline window
    // (honoring the draft's ttlDays) and re-arm the single T-48h reminder. The CAS
    // on `status = 'extended'` means an offer that was accepted/declined/expired in
    // the meantime is NEVER silently rewritten into a different amount — the update
    // matches no open row and the current authoritative row is returned instead.
    const expiresAt = new Date(offerExpiresAtMs(Date.now(), nextTtlDays)).toISOString();
    const updatedRow = d
      .prepare(
        `UPDATE offers SET salary = ?, currency = ?, expires_at = ?, ttl_days = ?, payload_json = ?, reminded_at = NULL
          WHERE id = ? AND status = 'extended' RETURNING *`
      )
      .get(nextSalary, nextCurrency, expiresAt, nextTtlDays, JSON.stringify(input.payload ?? null), open.id) as
      | Record<string, unknown>
      | undefined;
    if (!updatedRow) {
      const current = getOpenOfferForEntry(input.entryId);
      return { offer: current ?? open, created: false, updated: false };
    }
    return { offer: rowToOffer(updatedRow), created: false, updated: true };
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
//
// Resolved by ROLE, never by name or by position on the shipped axis. A workspace
// composes its own columns (decision-config `pipelineStages`, written through
// /api/pipeline/stage-migration), and the only invariants the validator enforces are
// "entry first, exactly one terminal, and it is last" — the terminal column's ID is
// whatever the team called it ("Onboarded", "Placed"). `PIPELINE_STAGES[length - 1]`
// answered "Hired" for every tenant, so on a renamed board this guard protected a
// column nobody stands on and let a stale decline demote an actual hire.
const SHIPPED_TERMINAL_STAGE = stageWithRole("terminal") ?? "Hired";

/** Every stage id that plays the TERMINAL role on `workspaceId`'s board — live AND
 *  retired (a candidate hired before the team re-composed its axis is still standing
 *  on the retired column) — plus the shipped id as a floor. A failed axis read falls
 *  back to that floor rather than dropping the guard entirely. */
function terminalStageIds(workspaceId: string): string[] {
  const ids = new Set<string>([SHIPPED_TERMINAL_STAGE]);
  try {
    const axis = getPipelineAxis(workspaceId);
    for (const s of [...axis.stages, ...axis.retired]) if (s.role === "terminal") ids.add(s.id);
  } catch (e) {
    console.warn("[offers-store] could not resolve the board axis; guarding the shipped terminal stage only", e);
  }
  return [...ids];
}

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
export function markEntryStatus(entryId: string, status: PipelineEntryStatus, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const terminalStages = terminalStageIds(workspaceId);
  const res = db()
    .prepare(
      `UPDATE pipeline_entries SET status = ?, updated_at = ?
        WHERE id = ? AND status NOT IN ${TERMINAL_STATUS_SQL_LIST}
          AND stage NOT IN (${terminalStages.map(() => "?").join(", ")}) AND workspace_id = ?`
    )
    .run(status, new Date().toISOString(), entryId, ...terminalStages, workspaceId);
  if (res.changes === 0) {
    console.warn(
      `[offers-store] markEntryStatus('${status}') blocked for entry ${entryId}: ` +
        `entry is already terminal or on a terminal-role stage (or missing) — refusing to overwrite (stale/duplicate offer decline).`
    );
    return false;
  }
  return true;
}
