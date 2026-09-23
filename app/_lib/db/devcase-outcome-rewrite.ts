// Rewriting a lifecycle's stored run outcome from a door OUTSIDE the runner.
//
// Its own module, not db/devcase.ts: that store sits on every task-hub route graph
// (at its perf ceiling), while this is imported by the Re-source route alone.
import type { StageOutcome } from "../devcase-stage-outcome";
import { ensureDb, safeRowParse } from "./core";

/** Rewrite the stored outcome of every lifecycle cut for `caseId` in `workspaceId`
 *  through a PURE `rewrite` (null = leave the row alone). Returns the rows written.
 *
 *  The Re-source door (POST /api/devcase/source) clears `sourcing_failed` with it after
 *  a successful sourcing; otherwise only the runner's NEXT publish step rewrote the
 *  warning, so the row kept claiming a crash that had been fixed.
 *
 *  Read→compute→write, so it locks: one synchronous `.immediate()` transaction (no
 *  await inside), and each UPDATE also re-asserts the exact outcome text it read. The
 *  stage, `detail` and `updated_at` are not this door's to move. */
export function rewriteLifecycleOutcomesForCase(
  caseId: string,
  workspaceId: string,
  rewrite: (outcome: StageOutcome) => StageOutcome | null
): number {
  const db = ensureDb();
  const tx = db.transaction(() => {
    const rows = db
      .prepare(`SELECT id, outcome_json FROM dev_lifecycle WHERE case_id = ? AND workspace_id = ? AND outcome_json IS NOT NULL`)
      .all(caseId, workspaceId) as Array<{ id: string; outcome_json: string }>;
    let changed = 0;
    for (const r of rows) {
      const current = safeRowParse<StageOutcome>(r.outcome_json, "lifecycle.outcome", r.id);
      const next = current ? rewrite(current) : null;
      if (!next) continue;
      const info = db
        .prepare(`UPDATE dev_lifecycle SET outcome_json = ? WHERE id = ? AND outcome_json = ?`)
        .run(JSON.stringify(next), r.id, r.outcome_json);
      changed += Number(info.changes);
    }
    return changed;
  });
  return tx.immediate();
}
