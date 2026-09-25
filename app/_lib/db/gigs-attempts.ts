import { canTransitionGigAttempt } from "../gigs/transitions";
import {
  isGigAttemptStatus,
  type GigAttempt,
  type GigAttemptStatus,
  type GigDeliverable,
  type GigReview,
} from "../gigs/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";

// Gig attempts (app/_lib/gigs/types.ts): one specialist run on one gig. A revision is a
// NEW attempt (the old one ends at `revision_requested`), so an attempt never goes back.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (gigs-attempts-tenancy.test.ts). No carve-out, and no tenant default.
//
// Status moves go through transitionGigAttempt: `illegal` before any read when
// GIG_ATTEMPT_TRANSITIONS lacks the edge, then a compare-and-swap under `.immediate()`
// with `from` re-asserted in the UPDATE's WHERE.

type GigAttemptRow = {
  id: string;
  workspace_id: string;
  gig_id: string;
  specialist_id: string;
  execution_id: string | null;
  status: string;
  deliverable_json: string | null;
  fallback_reason: string | null;
  cost_usd: number | null;
  review_json: string | null;
  revision_note: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

function gigAttemptFromRow(row: GigAttemptRow): GigAttempt {
  const deliverable = safeRowParse<GigDeliverable>(row.deliverable_json, "gigAttempt.deliverable", row.id);
  const review = safeRowParse<GigReview>(row.review_json, "gigAttempt.review", row.id);
  return {
    id: row.id,
    gigId: row.gig_id,
    specialistId: row.specialist_id,
    executionId: row.execution_id,
    // Written from typed values only; the fallback keeps a retired status renderable.
    status: isGigAttemptStatus(row.status) ? row.status : "failed",
    deliverable: deliverable && typeof deliverable === "object" ? deliverable : null,
    fallbackReason: row.fallback_reason,
    costUsd: typeof row.cost_usd === "number" && Number.isFinite(row.cost_usd) ? row.cost_usd : null,
    review: review && typeof review === "object" ? review : null,
    revisionNote: row.revision_note,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CreateGigAttemptInput = {
  gigId: string;
  specialistId: string;
  /** The operator's note when this attempt answers a revision request. */
  revisionNote: string | null;
  /** A degrade known at dispatch (e.g. `personas_route_missing`: the run is not bound to the
   *  gig's folder). Absent/null for an ordinary dispatch. */
  fallbackReason?: string | null;
};

/** A new attempt, status `dispatched`. Null when the gig is not in this workspace - the
 *  existence check and the INSERT share one IMMEDIATE transaction, so an attempt can
 *  never be minted against another tenant's gig id. */
export function createGigAttempt(workspaceId: string, input: CreateGigAttemptInput): GigAttempt | null {
  const d = ensureDb();
  const id = randomId("gatt");
  const run = d.transaction((): boolean => {
    const gig = d.prepare(`SELECT id FROM gigs WHERE id = ? AND workspace_id = ?`).get(input.gigId, workspaceId);
    if (!gig) return false;
    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO gig_attempts (id, workspace_id, gig_id, specialist_id, status, revision_note, fallback_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'dispatched', ?, ?, ?, ?)`
    ).run(
      id,
      workspaceId,
      input.gigId,
      input.specialistId,
      input.revisionNote?.trim() ? input.revisionNote.trim().slice(0, 4000) : null,
      input.fallbackReason?.trim() ? input.fallbackReason.trim().slice(0, 120) : null,
      now,
      now
    );
    return true;
  });
  return run.immediate() ? getGigAttempt(workspaceId, id) : null;
}

export function getGigAttempt(workspaceId: string, id: string): GigAttempt | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM gig_attempts WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as GigAttemptRow | undefined;
  return row ? gigAttemptFromRow(row) : null;
}

/** Oldest first: the attempt history of one gig reads as a timeline. */
export function listGigAttemptsForGig(workspaceId: string, gigId: string): GigAttempt[] {
  const rows = ensureDb()
    .prepare(`SELECT * FROM gig_attempts WHERE workspace_id = ? AND gig_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(workspaceId, gigId) as GigAttemptRow[];
  return rows.map(gigAttemptFromRow);
}

/** Every attempt in one of `statuses`, oldest first (a work queue: the dispatcher's
 *  poll, the review desk). An empty filter matches nothing. */
export function listGigAttemptsByStatus(workspaceId: string, statuses: readonly GigAttemptStatus[]): GigAttempt[] {
  const wanted = [...new Set(statuses.filter(isGigAttemptStatus))];
  if (wanted.length === 0) return [];
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM gig_attempts WHERE workspace_id = ? AND status IN (${wanted.map(() => "?").join(", ")})
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(workspaceId, ...wanted) as GigAttemptRow[];
  return rows.map(gigAttemptFromRow);
}

/** Stamp the Personas execution id on a `dispatched` attempt that has none yet - the
 *  one write that is not a status move (the attempt stays `dispatched` until the run is
 *  seen `running`; GIG_ATTEMPT_TRANSITIONS has no self-edge, on purpose). Write-once:
 *  the WHERE re-asserts `status = 'dispatched' AND execution_id IS NULL`, so a second
 *  stamp, or a stamp racing a move, changes nothing and answers null. Added by WP3
 *  (gigs/dispatch.ts). */
export function setGigAttemptExecutionId(workspaceId: string, id: string, executionId: string): GigAttempt | null {
  const res = ensureDb()
    .prepare(
      `UPDATE gig_attempts SET execution_id = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = 'dispatched' AND execution_id IS NULL`
    )
    .run(executionId, new Date().toISOString(), id, workspaceId);
  return res.changes > 0 ? getGigAttempt(workspaceId, id) : null;
}

/** Fields a status move may write in the same statement. `undefined` = untouched,
 *  `null` = cleared. */
export type GigAttemptPatch = {
  executionId?: string | null;
  deliverable?: GigDeliverable | null;
  fallbackReason?: string | null;
  costUsd?: number | null;
  review?: GigReview | null;
  revisionNote?: string | null;
  sentAt?: string | null;
};

export type TransitionGigAttemptResult =
  | { ok: true; attempt: GigAttempt }
  | { ok: false; reason: "not_found" | "stale" | "illegal" };

function attemptPatchColumns(patch: GigAttemptPatch | undefined): { sets: string[]; args: (string | number | null)[] } {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (!patch) return { sets, args };
  if (patch.executionId !== undefined) {
    sets.push("execution_id = ?");
    args.push(patch.executionId);
  }
  if (patch.deliverable !== undefined) {
    sets.push("deliverable_json = ?");
    args.push(patch.deliverable === null ? null : JSON.stringify(patch.deliverable));
  }
  if (patch.fallbackReason !== undefined) {
    sets.push("fallback_reason = ?");
    args.push(patch.fallbackReason);
  }
  if (patch.costUsd !== undefined) {
    sets.push("cost_usd = ?");
    // A non-finite cost is "not reported", never a number the KPI would sum.
    args.push(typeof patch.costUsd === "number" && Number.isFinite(patch.costUsd) ? patch.costUsd : null);
  }
  if (patch.review !== undefined) {
    sets.push("review_json = ?");
    args.push(patch.review === null ? null : JSON.stringify(patch.review));
  }
  if (patch.revisionNote !== undefined) {
    sets.push("revision_note = ?");
    args.push(patch.revisionNote);
  }
  if (patch.sentAt !== undefined) {
    sets.push("sent_at = ?");
    args.push(patch.sentAt);
  }
  return { sets, args };
}

/** Compare-and-swap status move, same result shape as transitionGig: `illegal` (no read)
 *  when any `from` state lacks the edge; `not_found` outside this workspace; `stale`
 *  when the attempt already moved on. The patch lands in the SAME statement as the move,
 *  so a deliverable and its `drafted` status can never be observed apart. */
export function transitionGigAttempt(
  workspaceId: string,
  id: string,
  move: { from: GigAttemptStatus | readonly GigAttemptStatus[]; to: GigAttemptStatus; patch?: GigAttemptPatch }
): TransitionGigAttemptResult {
  const from = [...new Set(typeof move.from === "string" ? [move.from] : move.from)];
  if (from.length === 0 || !from.every((s) => canTransitionGigAttempt(s, move.to))) return { ok: false, reason: "illegal" };
  const d = ensureDb();
  const { sets, args } = attemptPatchColumns(move.patch);
  const fromPh = from.map(() => "?").join(", ");
  // Assembled OUTSIDE the SQL template: a nested template literal would split the
  // statement in the tenancy source guard's backtick scan.
  const setSql = sets.map((s) => ", " + s).join("");
  const run = d.transaction((): { ok: true } | { ok: false; reason: "not_found" | "stale" } => {
    const row = d.prepare(`SELECT status FROM gig_attempts WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
      | Pick<GigAttemptRow, "status">
      | undefined;
    if (!row) return { ok: false, reason: "not_found" };
    if (!(from as string[]).includes(row.status)) return { ok: false, reason: "stale" };
    const res = d
      .prepare(
        `UPDATE gig_attempts SET status = ?, updated_at = ?${setSql}
         WHERE id = ? AND workspace_id = ? AND status IN (${fromPh})`
      )
      .run(move.to, new Date().toISOString(), ...args, id, workspaceId, ...from);
    return res.changes === 0 ? { ok: false, reason: "stale" } : { ok: true };
  });
  const result = run.immediate();
  if (!result.ok) return result;
  const attempt = getGigAttempt(workspaceId, id);
  return attempt ? { ok: true, attempt } : { ok: false, reason: "not_found" };
}
