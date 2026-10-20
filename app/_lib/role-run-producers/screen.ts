import { FAIRNESS_BLOCKED_REJECT_ALERT, runAutomationPass, type AutomationDecision, type AutomationPassResult } from "../automation-pass.ts";
import { DEFAULT_STAGE_RUNNERS, type StageContext, type StageOutcome, type StageRunner } from "../role-run-engine.ts";
import type { ScreenPayload, ScreenRoute } from "../role-run-stages.ts";
import type { RoleRunProducer } from "./index.ts";

// S2 - screen, backed by the automation policy pass (idea 899c6bab).
//
// The pass stays what it is - S2's engine, not the orchestrator - and is asked ONE question
// per branch: what would you do with this entry? It is run as a SCOPED DRY RUN
// (runAutomationPass({ dryRun: true, entryIds: [branch] })): read-only, no stage move, no
// score write, no candidate email, no approval row. The result is a PROPOSAL, written to
// the ledger as an `awaiting_approval` artifact exactly like the keyless floor's, so the
// rejection gate (commitRoleRunStageGate) is unchanged and still the only thing that can
// resolve it.
//
// ART. 22. This producer can now propose `reject_proposed` from the policy pass, which the
// keyless floor never does (it routes a low score to `hold`). That is still a proposal a
// human must approve at the rejection gate, and the pass's own fairness backstop has
// already downgraded any reject it refuses to a hold in the same preview. Nothing here
// applies, approves or declines anything.
//
// WHAT THE LEDGER GETS. Scores, a route, and CODES only: the pass's `reason` is prose and
// its reasonParams carry prose (`original`, `verdict`), so neither is copied. A payload that
// still tripped the PII door would throw at the write and the seam would fall back to the
// keyless floor for that branch.

export type ScreenProducerDeps = {
  /** The scoped dry run. Injected by tests; the default is the real pass. */
  pass?: (entryIds: readonly string[]) => Promise<AutomationPassResult>;
  keyless?: StageRunner;
};

/** The board-wide pass's own version marker for this payload: which policy proposed it. */
export const SCREEN_POLICY_VERSION = "automation-pass-dryrun-1";

const TOKEN = /^[A-Za-z0-9_.:-]{1,40}$/;

const ROUTE_OF: Record<AutomationDecision["action"], ScreenRoute> = {
  advance: "advance",
  reject: "reject_proposed",
  hold: "hold",
  none: "hold",
};

/** Only machine facts survive: numbers and short token-shaped strings. Everything else the
 *  pass wrote is sentence-shaped prose and stays out of an immutable ledger. */
function codeParams(params: AutomationDecision["reasonParams"]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string" && TOKEN.test(v)) out[k] = v;
  }
  return out;
}

export function screenProducer(deps: ScreenProducerDeps = {}): RoleRunProducer {
  const pass = deps.pass ?? ((entryIds: readonly string[]) => runAutomationPass({ dryRun: true, entryIds }));
  const keyless = deps.keyless ?? DEFAULT_STAGE_RUNNERS.screen;

  const run = async (ctx: StageContext): Promise<StageOutcome> => {
    const entryId = ctx.branchRef ?? "";
    if (!entryId) return keyless(ctx);
    const { decisions } = await pass([entryId]);
    const d = decisions.find((x) => x.entryId === entryId);
    // The pass lists ACTIVE entries only: a withdrawn or already-closed branch has no
    // decision, and the keyless floor already knows how to say "not active".
    if (!d) return keyless(ctx);
    const fairness = (d.alerts ?? []).filter((a) => a === FAIRNESS_BLOCKED_REJECT_ALERT);
    return {
      status: "awaiting_approval",
      payload: {
        decisions: [
          {
            entryId,
            route: ROUTE_OF[d.action] ?? "hold",
            matchScore: typeof d.matchScore === "number" ? d.matchScore : null,
            reasonCode: d.reasonCode && TOKEN.test(d.reasonCode) ? d.reasonCode : `policy_${d.action}`,
            reasonParams: codeParams(d.reasonParams),
          },
        ],
        policyVersion: SCREEN_POLICY_VERSION,
        fairnessAlerts: fairness,
      } satisfies ScreenPayload,
    };
  };

  // The pass is deterministic and LLM-free (its scoring is the local recruiter_cli rank).
  return { kind: "screen", usesLlm: false, run };
}
