import type { GigArena, GigReward } from "../gigs/types";
import { isGigArena } from "../gigs/types";
import { ensureDb, safeRowParse } from "./core";

// The purge store (gigs/purge.ts, POST /api/gigs/purge): the rows the reward rules judge, and
// the one delete that removes a gig with its children.
//
// Tenancy: every statement binds `workspace_id = ?` (gigs-purge-tenancy.test.ts); workspaceId
// is the first, required parameter of every export.
//
// What a delete removes, per gig, in ONE synchronous `.immediate()` transaction per batch:
// its plans, its attempts, the gig persona rows the caller did not ask to keep, and the gig.
// What it never removes:
//   - a gig with a recorded OUTCOME: the outcomes table is append-only
//     (gigs-outcomes.test.ts pins that no source mutates it), and a judged piece of work is
//     KPI truth - such a gig is skipped and reported (`keptWithOutcome`);
//   - a gig that no longer matches the rule by the time the batch runs (a scan refreshed its
//     reward in between): the caller's predicate is re-asserted on the row read inside the
//     transaction, and the gig is reported `changed`;
//   - files on disk (workdirs, reports, proposals) - the caller counts them for the operator.

type PurgeRow = {
  id: string;
  arena: string;
  title: string;
  status: string;
  reward_json: string | null;
  workdir: string | null;
  report_json: string | null;
  proposal_json: string | null;
};

export type GigPurgeCandidate = {
  id: string;
  arena: GigArena;
  title: string;
  status: string;
  reward: GigReward | null;
  hasWorkdir: boolean;
  hasReport: boolean;
  hasProposal: boolean;
};

function rewardOf(row: Pick<PurgeRow, "id" | "reward_json">): GigReward | null {
  const reward = safeRowParse<GigReward>(row.reward_json, "gig.reward", row.id);
  return reward && typeof reward === "object" ? reward : null;
}

/** Every gig of the workspace in the light shape the reward rules read. A row with an
 *  unknown arena is skipped (never judged, never deleted). */
export function listGigPurgeCandidates(workspaceId: string): GigPurgeCandidate[] {
  const rows = ensureDb()
    .prepare(
      `SELECT id, arena, title, status, reward_json, workdir, report_json, proposal_json
       FROM gigs WHERE workspace_id = ? ORDER BY created_at ASC, rowid ASC`
    )
    .all(workspaceId) as PurgeRow[];
  const out: GigPurgeCandidate[] = [];
  for (const r of rows) {
    if (!isGigArena(r.arena)) continue;
    out.push({
      id: r.id,
      arena: r.arena,
      title: r.title,
      status: r.status,
      reward: rewardOf(r),
      hasWorkdir: !!r.workdir,
      hasReport: !!r.report_json,
      hasProposal: !!r.proposal_json,
    });
  }
  return out;
}

export type GigPurgeChildren = {
  plans: number;
  attempts: number;
  /** The metered spend the attempts carry (NULL costs count as 0). */
  attemptCostUsd: number;
  /** Gig persona rows (gig_specialists with this gig_id). */
  personas: { specialistId: string; hiredAgentId: string; gigId: string }[];
  /** Gigs with a recorded outcome - never deleted. */
  withOutcome: Set<string>;
};

/** What hangs off these gigs, read before anything is deleted. */
export function readGigPurgeChildren(workspaceId: string, gigIds: readonly string[]): GigPurgeChildren {
  const d = ensureDb();
  const out: GigPurgeChildren = { plans: 0, attempts: 0, attemptCostUsd: 0, personas: [], withOutcome: new Set() };
  const plans = d.prepare(`SELECT COUNT(*) AS n FROM gig_plans WHERE workspace_id = ? AND gig_id = ?`);
  const attempts = d.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM gig_attempts WHERE workspace_id = ? AND gig_id = ?`);
  const personas = d.prepare(`SELECT id, hired_agent_id FROM gig_specialists WHERE workspace_id = ? AND gig_id = ?`);
  const outcome = d.prepare(`SELECT 1 FROM gig_outcomes WHERE workspace_id = ? AND gig_id = ? LIMIT 1`);
  for (const id of gigIds) {
    out.plans += (plans.get(workspaceId, id) as { n: number }).n;
    const a = attempts.get(workspaceId, id) as { n: number; cost: number };
    out.attempts += a.n;
    out.attemptCostUsd += a.cost;
    for (const p of personas.all(workspaceId, id) as { id: string; hired_agent_id: string }[]) {
      out.personas.push({ specialistId: p.id, hiredAgentId: p.hired_agent_id, gigId: id });
    }
    if (outcome.get(workspaceId, id) !== undefined) out.withOutcome.add(id);
  }
  out.attemptCostUsd = Math.round(out.attemptCostUsd * 100) / 100;
  return out;
}

export type DeleteGigsResult = {
  deleted: string[];
  keptWithOutcome: string[];
  changed: string[];
};

export const GIG_PURGE_BATCH = 100;

/** Delete these gigs with their plans, attempts and gig persona rows (except `keepSpecialistIds`,
 *  whose persona the caller retires first), GIG_PURGE_BATCH per IMMEDIATE transaction. Inside
 *  the transaction each row is re-read and `stillMatches` re-asserted on it; a gone row, a
 *  changed one or one with an outcome is skipped. Synchronous: nothing is awaited in a batch. */
export function deleteGigsWithChildren(
  workspaceId: string,
  gigIds: readonly string[],
  opts: { stillMatches: (gig: { arena: GigArena; reward: GigReward | null }) => boolean; keepSpecialistIds: ReadonlySet<string> }
): DeleteGigsResult {
  const d = ensureDb();
  const result: DeleteGigsResult = { deleted: [], keptWithOutcome: [], changed: [] };
  const read = d.prepare(`SELECT id, arena, reward_json FROM gigs WHERE id = ? AND workspace_id = ?`);
  const hasOutcome = d.prepare(`SELECT 1 FROM gig_outcomes WHERE workspace_id = ? AND gig_id = ? LIMIT 1`);
  const personas = d.prepare(`SELECT id FROM gig_specialists WHERE workspace_id = ? AND gig_id = ?`);
  const delPlans = d.prepare(`DELETE FROM gig_plans WHERE workspace_id = ? AND gig_id = ?`);
  const delAttempts = d.prepare(`DELETE FROM gig_attempts WHERE workspace_id = ? AND gig_id = ?`);
  const delPersona = d.prepare(`DELETE FROM gig_specialists WHERE workspace_id = ? AND id = ?`);
  const delGig = d.prepare(`DELETE FROM gigs WHERE workspace_id = ? AND id = ?`);
  for (let i = 0; i < gigIds.length; i += GIG_PURGE_BATCH) {
    const batch = gigIds.slice(i, i + GIG_PURGE_BATCH);
    const run = d.transaction((): DeleteGigsResult => {
      const out: DeleteGigsResult = { deleted: [], keptWithOutcome: [], changed: [] };
      for (const id of batch) {
        const row = read.get(id, workspaceId) as { id: string; arena: string; reward_json: string | null } | undefined;
        if (!row) continue;
        if (!isGigArena(row.arena) || !opts.stillMatches({ arena: row.arena, reward: rewardOf(row) })) {
          out.changed.push(id);
          continue;
        }
        if (hasOutcome.get(workspaceId, id) !== undefined) {
          out.keptWithOutcome.push(id);
          continue;
        }
        delPlans.run(workspaceId, id);
        delAttempts.run(workspaceId, id);
        for (const p of personas.all(workspaceId, id) as { id: string }[]) {
          if (!opts.keepSpecialistIds.has(p.id)) delPersona.run(workspaceId, p.id);
        }
        if (delGig.run(workspaceId, id).changes > 0) out.deleted.push(id);
      }
      return out;
    });
    const out = run.immediate();
    result.deleted.push(...out.deleted);
    result.keptWithOutcome.push(...out.keptWithOutcome);
    result.changed.push(...out.changed);
  }
  return result;
}

/** Remove one gig persona row once its persona is retired (the purge's second step). */
export function deleteGigPersonaRow(workspaceId: string, specialistId: string): boolean {
  return ensureDb().prepare(`DELETE FROM gig_specialists WHERE workspace_id = ? AND id = ?`).run(workspaceId, specialistId).changes > 0;
}
