// A gate commit that continues the run: the commit writes the ledger, then ONE live pass
// moves whatever the decision unblocked, so nobody has to re-trigger (review 2026-10-23, H7).
// The commit is unchanged and still mints nothing on the board; the pass is the ordinary
// live pass, so it stops at the next gate exactly as any trigger would.
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import type { RoleRunStageArtifact } from "@/app/_lib/db/role-runs";
import { commitRoleRunStageGate, type AdvanceResult, type CommitGateInput } from "@/app/_lib/role-run-engine";
import { advanceRoleRunLive, type LiveAdvanceOptions } from "@/app/_lib/role-run-live";

export type CommitContinuePass =
  | { outcome: "advanced"; awaiting: AdvanceResult["awaiting"]; produced: number; runStatus: AdvanceResult["status"] }
  | { outcome: "busy" }
  | { outcome: "not_found" }
  | { outcome: "skipped" }
  | { outcome: "failed"; error: string };

export type CommitContinueResult = { status: RoleRunStageArtifact["status"]; pass: CommitContinuePass };

export type CommitContinueOptions = {
  /** Runner set and limits of the one pass; defaults to the live trigger's. */
  advance?: LiveAdvanceOptions;
  /** false commits and takes no pass (a caller that must act between the two). */
  continueRun?: boolean;
};

/**
 * Commit one gate decision, then — only if the commit succeeded — take one live pass.
 * A refused commit throws exactly as commitRoleRunStageGate does and takes no pass. A pass
 * that fails after a commit leaves the commit standing and is reported, not thrown.
 */
export async function commitRoleRunStageGateAndContinue(
  input: CommitGateInput,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  opts: CommitContinueOptions = {}
): Promise<CommitContinueResult> {
  const artifact = commitRoleRunStageGate(input, workspaceId);
  if (opts.continueRun === false) return { status: artifact.status, pass: { outcome: "skipped" } };
  try {
    const live = await advanceRoleRunLive(input.runId, workspaceId, opts.advance);
    if (live.outcome === "advanced") return { status: artifact.status, pass: { outcome: "advanced", awaiting: live.result.awaiting, produced: live.result.produced.length, runStatus: live.result.status } };
    return { status: artifact.status, pass: { outcome: live.outcome } };
  } catch (error) {
    return { status: artifact.status, pass: { outcome: "failed", error: error instanceof Error ? error.message : String(error) } };
  }
}
