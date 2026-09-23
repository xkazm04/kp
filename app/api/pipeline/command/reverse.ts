import type { PipelineEntry } from "@/app/_lib/db/core";
import { ensureDb, recordEvent } from "@/app/_lib/db/core";
import { getPipelineEntry, pipelineReasonDetail } from "@/app/_lib/db/pipeline";
import { planWaveReversal, type WaveReversalPlan, type WaveReversalSnapshot } from "@/app/_lib/pipeline-command";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { invalidateGroupEvalSelection } from "@/app/_lib/group-eval";

// Undo a command-bar reject wave (challenge-r05 pipeline-actions-commands/B), lifted
// out of the route so its arithmetic is testable without a NextRequest or a session.
//
// A typed `reject below 40%` closes out and emails a whole cohort in one confirm. The
// governing standard (bulk-adverse-action-governance) holds that such an action is
// defensible only if a cheap standing mechanism can reverse it, and that a reversal is
// a NEW decision sealed to the person reversing it — never an overwrite of the first.
// So, per id:
//   - restoreCommandRejection re-reads the row under a write lock, asks
//     planWaveReversal whether THIS wave is still the newest decision on it, and
//     compare-and-swaps it back to `active` on the stage the wave left it on;
//   - a restored entry is sealed `reinstated` / `command_wave_reversed` under the
//     undoer's name, with the threshold and whether the letter had already gone;
//   - anything else (moved since, a hand reject, another team's row, already undone)
//     is SKIPPED and counted — never overwritten.
//
// `notified` is the truthful half: the outbox has no withdrawn state, so a sent
// rejection letter cannot be recalled. The bar says how many were told, so the
// recruiter follows up with them by hand rather than assuming the undo unsent it.
//
// Declared side effect (critic revision): the `reinstated` event the restore writes is
// the same one screen-wave.ts reads for its reinstatement shield, so a wave-restored
// candidate is spared by the next automated screen-wave. That is intended: a recruiter
// who undid the rejection made a human call on this person, and the machine must not
// re-reject them on the same evidence. A human can still reject them by hand.

export type CommandRejectionRestore =
  | { restored: true; entry: PipelineEntry; notified: boolean; stage: string }
  | { restored: false; reason: "not_found" | "not_rejected" | "not_this_wave" | "moved" };

type RestoreRow = { status: string; stage: string; candidate_label: string; job_title: string | null; archetype: string | null };

/** Undo ONE member of a command-bar reject wave: back to `active` on the stage the
 *  wave left them on — a reject never moves the stage, so the column they stood in
 *  survives it. That is exactly what reinstatePipelineEntry (db/pipeline.ts) does NOT
 *  do: it lands a reversed auto-rejection on the screened column for a fresh look,
 *  while a recruiter undoing a mistyped threshold wants the Interview candidate back
 *  in Interview.
 *
 *  Lives here rather than in db/pipeline.ts so the store every route imports does not
 *  grow for a door only this route uses (perf-budget.json caps each route's graph).
 *  `plan` is planWaveReversal bound to the wave's threshold.
 *
 *  IMMEDIATE read -> plan -> write, with a compare-and-swap on both halves of what the
 *  wave left: the UPDATE re-asserts status='rejected' AND the stage the wave's
 *  `rejected` event recorded. A row that moved since is refused ("moved") and never
 *  overwritten; a second undo finds the entry active and is a no-op, so it cannot
 *  churn or double-seal. The `reinstated` event names the undoer. No await inside:
 *  sealing is the caller's (decision_records is another connection). */
export function restoreCommandRejection(
  id: string,
  workspaceId: string,
  opts: { plan: (snapshot: WaveReversalSnapshot) => WaveReversalPlan; actorRef?: string | null }
): CommandRejectionRestore {
  const db = ensureDb();
  const tx = db.transaction((): CommandRejectionRestore => {
    const row = db
      .prepare(`SELECT status, stage, candidate_label, job_title, archetype FROM pipeline_entries WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as RestoreRow | undefined;
    if (!row) return { restored: false, reason: "not_found" };
    const events = db
      .prepare(
        `SELECT kind, detail, to_stage AS toStage FROM pipeline_events
          WHERE entry_id = ? AND workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`
      )
      .all(id, workspaceId) as { kind: string; detail: string | null; toStage: string | null }[];
    const plan = opts.plan({ status: row.status, eventsNewestFirst: events });
    if (!plan.restorable) return { restored: false, reason: plan.reason };
    // The planner proved the wave's reject is the newest decision, so the first
    // `rejected` row newest-first is it, and its stage is the compare-and-swap.
    const waveStage = events.find((e) => e.kind === "rejected")?.toStage ?? null;
    if (!waveStage || row.stage !== waveStage) return { restored: false, reason: "moved" };
    const now = new Date().toISOString();
    const res = db
      .prepare(
        `UPDATE pipeline_entries SET status='active', updated_at=?
          WHERE id=? AND workspace_id=? AND status='rejected' AND stage=?`
      )
      .run(now, id, workspaceId, waveStage);
    if (res.changes === 0) return { restored: false, reason: "moved" };
    recordEvent(db, {
      entryId: id,
      candidateLabel: row.candidate_label,
      jobTitle: row.job_title,
      archetype: row.archetype,
      kind: "reinstated",
      fromStage: waveStage,
      toStage: waveStage,
      detail: pipelineReasonDetail("commandWaveReversed"),
      actor: opts.actorRef ?? null,
      workspaceId,
    });
    const entry = getPipelineEntry(id, workspaceId);
    if (!entry) return { restored: false, reason: "not_found" };
    return { restored: true, entry, notified: plan.notified, stage: waveStage };
  });
  return tx.immediate();
}

export type WaveReversalCounts = {
  /** Wave members put back to active on the stage they stood on. */
  restored: number;
  /** Of those, how many had already been sent the rejection letter. */
  notified: number;
  /** Ids left alone: moved since, not this wave's, another team's, or already undone. */
  skipped: number;
};

export type WaveReversalDeps = {
  restore: typeof restoreCommandRejection;
  seal: typeof sealDecisionSafe;
  invalidateGroupEval: typeof invalidateGroupEvalSelection;
};

const REAL_DEPS: WaveReversalDeps = {
  restore: restoreCommandRejection,
  seal: sealDecisionSafe,
  invalidateGroupEval: invalidateGroupEvalSelection,
};

/** The most ids one undo will read. The command bar's preview binds a confirm to the
 *  full matched set, so this is the wave-size ceiling, not a page size. */
export const WAVE_REVERSAL_CAP = 200;

export function reverseCommandWave(
  args: { ids: readonly string[]; threshold: number; workspaceId: string; actor: string },
  deps: WaveReversalDeps = REAL_DEPS
): WaveReversalCounts {
  const { threshold, workspaceId: ws, actor } = args;
  const counts: WaveReversalCounts = { restored: 0, notified: 0, skipped: 0 };
  const plan = (snapshot: Parameters<typeof planWaveReversal>[0]) => planWaveReversal(snapshot, threshold);

  for (const id of new Set(args.ids)) {
    try {
      const r = deps.restore(id, ws, { plan, actorRef: actor });
      if (!r.restored) {
        counts.skipped += 1;
        continue;
      }
      counts.restored += 1;
      if (r.notified) counts.notified += 1;
      // The reversal is its own decision, sealed beside the rejection it overturns.
      // Best-effort (sealDecisionSafe never throws): the restore is committed.
      deps.seal(
        {
          kind: "reinstated",
          actor,
          policyVersion: "command-bar",
          candidateRef: id,
          rationale: `Command-bar rejection wave (below ${threshold}%) reversed by the recruiter.`,
          reasonCode: "command_wave_reversed",
          inputs: { previousStatus: "rejected", restoredStage: r.stage, threshold, notified: r.notified },
        },
        ws
      );
      // The role's cohort grew back: a cached group evaluation no longer describes it.
      try {
        deps.invalidateGroupEval(r.entry.jobId ?? r.entry.jobTitle ?? "unassigned", ws);
      } catch (error) {
        console.warn("[pipeline:command:reverse] group-eval cache expiry failed:", error instanceof Error ? error.message : error);
      }
    } catch (error) {
      // One entry's throw never aborts the undo; it is counted as left alone.
      counts.skipped += 1;
      console.error(`[pipeline:command:reverse] restore failed for ${id}`, error);
    }
  }
  return counts;
}
