import {
  GIG_ADAPTER_ARENA,
  GIG_ADAPTER_TIER,
  GIG_INVALID_STREAK_LIMIT,
  GIG_SOURCE_RUN_OUTCOMES,
  GIG_SOURCE_TIERS,
  isGigAdapterName,
  isGigArena,
  isGigPauseReason,
  type GigAdapterName,
  type GigArena,
  type GigOutcomeVerdict,
  type GigPauseReason,
  type GigSource,
  type GigSourceRunOutcome,
  type GigSourceTier,
} from "../gigs/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";

// Gig acquisition sources (app/_lib/gigs/types.ts): the operator-confirmed list of
// official APIs a scan may read listings from.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (gigs-sources-tenancy.test.ts). No carve-out, and no tenant default: workspaceId is
// the first, required parameter of every export.
//
// Two state machines, kept honest at the write:
//  - enabled + acknowledged: a tier-B adapter is CREATED disabled with paused_reason
//    'terms_review'; acknowledgeGigSource writes the acknowledgement, enables it and
//    clears that one pause reason in ONE statement. A tier-A adapter is created enabled.
//  - paused_reason: written by pauseGigSource / recordGigSourceVerdict (invalid_streak),
//    cleared ONLY by the operator (resumeGigSource, or acknowledgeGigSource for
//    terms_review). A scan that finds a source paused skips it; it never un-pauses.

type GigSourceRow = {
  id: string;
  workspace_id: string;
  adapter: string;
  arena: string;
  tier: string;
  host: string;
  config_json: string;
  enabled: number;
  acknowledged_at: string | null;
  acknowledged_terms_hash: string | null;
  paused_reason: string | null;
  paused_at: string | null;
  invalid_streak: number;
  last_run_at: string | null;
  last_outcome: string | null;
  created_at: string;
  updated_at: string;
};

function coerceRunOutcome(value: string | null): GigSourceRunOutcome | null {
  return value !== null && (GIG_SOURCE_RUN_OUTCOMES as readonly string[]).includes(value) ? (value as GigSourceRunOutcome) : null;
}

function gigSourceFromRow(row: GigSourceRow): GigSource {
  const config = safeRowParse<Record<string, unknown>>(row.config_json, "gigSource.config", row.id);
  const adapter: GigAdapterName = isGigAdapterName(row.adapter) ? row.adapter : "manual";
  return {
    id: row.id,
    adapter,
    // arena is written from a typed value; a retired arena still renders as the
    // adapter's own arena so the operator can delete the row.
    arena: isGigArena(row.arena) ? row.arena : "freelance",
    // CHECK-constrained at the DDL.
    tier: (GIG_SOURCE_TIERS as readonly string[]).includes(row.tier) ? (row.tier as GigSourceTier) : "C",
    host: row.host,
    config: config && typeof config === "object" && !Array.isArray(config) ? config : {},
    enabled: row.enabled === 1,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedTermsHash: row.acknowledged_terms_hash,
    pausedReason: isGigPauseReason(row.paused_reason) ? row.paused_reason : null,
    pausedAt: row.paused_at,
    invalidStreak: Number.isFinite(row.invalid_streak) ? row.invalid_streak : 0,
    lastRunAt: row.last_run_at,
    lastOutcome: coerceRunOutcome(row.last_outcome),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listGigSources(workspaceId: string): GigSource[] {
  const rows = ensureDb()
    .prepare(`SELECT * FROM gig_sources WHERE workspace_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(workspaceId) as GigSourceRow[];
  return rows.map(gigSourceFromRow);
}

export function getGigSource(workspaceId: string, id: string): GigSource | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM gig_sources WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as GigSourceRow | undefined;
  return row ? gigSourceFromRow(row) : null;
}

export type CreateGigSourceInput = {
  adapter: GigAdapterName;
  arena: GigArena;
  host: string;
  config: Record<string, unknown>;
};

/** Tier comes from GIG_ADAPTER_TIER, never from the caller. Tier A is created enabled;
 *  tier B is created disabled and paused for `terms_review` until the operator
 *  acknowledges the terms; tier C is refused (never fetched, so never a source). THROWS
 *  on a tier-C adapter or an arena the adapter does not list - a route validates both
 *  before it gets here. */
export function createGigSource(workspaceId: string, input: CreateGigSourceInput): GigSource {
  const tier = GIG_ADAPTER_TIER[input.adapter];
  if (tier === "C") throw new Error(`gig adapter ${input.adapter} is tier C and is never fetched`);
  // A source never mixes arenas: an adapter that owns an arena cannot be filed under another.
  const owned = GIG_ADAPTER_ARENA[input.adapter];
  if (owned !== null && owned !== input.arena) {
    throw new Error(`gig adapter ${input.adapter} lists ${owned} work, not ${input.arena}`);
  }
  const d = ensureDb();
  const id = randomId("gsrc");
  const now = new Date().toISOString();
  const needsTerms = tier === "B";
  d.prepare(
    `INSERT INTO gig_sources
       (id, workspace_id, adapter, arena, tier, host, config_json, enabled, paused_reason, paused_at,
        invalid_streak, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    workspaceId,
    input.adapter,
    input.arena,
    tier,
    input.host.trim().toLowerCase().slice(0, 253),
    JSON.stringify(input.config ?? {}),
    needsTerms ? 0 : 1,
    needsTerms ? "terms_review" : null,
    needsTerms ? now : null,
    now,
    now
  );
  return gigSourceFromRow(d.prepare(`SELECT * FROM gig_sources WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as GigSourceRow);
}

/** The operator acknowledged the terms (hashed, so a changed clause re-asks). Writes the
 *  acknowledgement, enables the source and clears a `terms_review` pause - and ONLY that
 *  pause: a source paused as `blocked` or `invalid_streak` stays paused. */
export function acknowledgeGigSource(workspaceId: string, id: string, termsHash: string): GigSource | null {
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `UPDATE gig_sources
       SET acknowledged_at = ?, acknowledged_terms_hash = ?, enabled = 1,
           paused_reason = CASE WHEN paused_reason = 'terms_review' THEN NULL ELSE paused_reason END,
           paused_at = CASE WHEN paused_reason = 'terms_review' THEN NULL ELSE paused_at END,
           updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(now, termsHash, now, id, workspaceId);
  return res.changes > 0 ? getGigSource(workspaceId, id) : null;
}

export function pauseGigSource(workspaceId: string, id: string, reason: GigPauseReason): GigSource | null {
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(`UPDATE gig_sources SET paused_reason = ?, paused_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(reason, now, now, id, workspaceId);
  return res.changes > 0 ? getGigSource(workspaceId, id) : null;
}

export type ResumeGigSourceResult =
  | { ok: true; source: GigSource }
  | { ok: false; reason: "not_found" | "terms_unacknowledged" };

/** The OPERATOR lifts a pause - the only path that clears paused_reason (besides the
 *  acknowledgement clearing `terms_review`). Refuses a tier-B source whose terms were
 *  never acknowledged: resuming it would fetch under terms nobody accepted. Resuming
 *  also resets invalid_streak, so a source lifted out of `invalid_streak` does not
 *  re-pause on its very next rejection. The refusal is re-asserted in the UPDATE's
 *  WHERE, so a concurrent un-acknowledge cannot slip between the read and the write. */
export function resumeGigSource(workspaceId: string, id: string): ResumeGigSourceResult {
  const current = getGigSource(workspaceId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.tier !== "A" && current.acknowledgedAt === null) return { ok: false, reason: "terms_unacknowledged" };
  const res = ensureDb()
    .prepare(
      `UPDATE gig_sources SET paused_reason = NULL, paused_at = NULL, invalid_streak = 0, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND (tier = 'A' OR acknowledged_at IS NOT NULL)`
    )
    .run(new Date().toISOString(), id, workspaceId);
  if (res.changes === 0) return { ok: false, reason: "terms_unacknowledged" };
  const source = getGigSource(workspaceId, id);
  return source ? { ok: true, source } : { ok: false, reason: "not_found" };
}

/** One scan's outcome for this source. Deliberately does NOT touch paused_reason: the
 *  scan runner calls pauseGigSource separately for `blocked`/`collapsed`, and a later
 *  `skipped` must not read as a recovery. */
export function recordGigSourceRun(workspaceId: string, id: string, outcome: GigSourceRunOutcome): boolean {
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(`UPDATE gig_sources SET last_run_at = ?, last_outcome = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(now, outcome, now, id, workspaceId);
  return res.changes > 0;
}

/** Fold one external verdict into the source's invalid streak: rejected/duplicate
 *  increments it, accepted resets it, no_response leaves it unchanged. Reaching
 *  GIG_INVALID_STREAK_LIMIT pauses the source with `invalid_streak` (an existing pause
 *  reason is never overwritten). `paused` is true only when THIS verdict tripped the
 *  pause - a caller announcing "source paused" must not re-announce an older pause. Read-compute-write under `.immediate()` so two
 *  verdicts recorded at once cannot both read the same streak. Null when the source is
 *  not in this workspace. */
export function recordGigSourceVerdict(
  workspaceId: string,
  id: string,
  verdict: GigOutcomeVerdict
): { invalidStreak: number; paused: boolean } | null {
  const d = ensureDb();
  const run = d.transaction((): { invalidStreak: number; paused: boolean } | null => {
    const row = d
      .prepare(`SELECT invalid_streak, paused_reason FROM gig_sources WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as Pick<GigSourceRow, "invalid_streak" | "paused_reason"> | undefined;
    if (!row) return null;
    const current = row.invalid_streak ?? 0;
    const next =
      verdict === "rejected" || verdict === "duplicate" ? current + 1 : verdict === "accepted" ? 0 : current;
    const trip = next >= GIG_INVALID_STREAK_LIMIT && row.paused_reason === null;
    const now = new Date().toISOString();
    if (trip) {
      d.prepare(
        `UPDATE gig_sources SET invalid_streak = ?, paused_reason = 'invalid_streak', paused_at = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      ).run(next, now, now, id, workspaceId);
    } else if (next !== current) {
      d.prepare(`UPDATE gig_sources SET invalid_streak = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`).run(
        next,
        now,
        id,
        workspaceId
      );
    }
    return { invalidStreak: next, paused: trip };
  });
  return run.immediate();
}
