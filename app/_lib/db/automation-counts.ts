import { SIM_TITLE_LIKE } from "@/app/_lib/sim-marker";
import { AUTOMATED_ACTION_KINDS, automationCounts, windowCutoffIso, type AutomationCounts } from "../automation-counts";
import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

/** Measured automated-action counts for one workspace over the trailing `days`: one GROUP BY kind over
 *  pipeline_events (workspace-predicated, guided-demo rows excluded, same as the analytics read). */
export function automationCountsSince(nowMs: number, days: number, workspaceId: string = DEFAULT_WORKSPACE_ID): AutomationCounts {
  const marks = AUTOMATED_ACTION_KINDS.map(() => "?").join(",");
  const rows = ensureDb()
    .prepare(
      `SELECT kind, COUNT(*) AS c FROM pipeline_events
        WHERE workspace_id = ? AND created_at >= ? AND kind IN (${marks})
          AND (job_title IS NULL OR job_title NOT LIKE ?)
        GROUP BY kind`
    )
    .all(workspaceId, windowCutoffIso(nowMs, days), ...AUTOMATED_ACTION_KINDS, SIM_TITLE_LIKE) as { kind: string; c: number }[];
  return automationCounts(Object.fromEntries(rows.map((r) => [r.kind, r.c])));
}
