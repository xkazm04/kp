import { listDevCasesForJob } from "../db/devcase.ts";
import { DEFAULT_STAGE_RUNNERS, type StageContext, type StageOutcome, type StageRunner } from "../role-run-engine.ts";
import type { CaseAssignmentPayload } from "../role-run-stages.ts";
import type { RoleRunProducer } from "./index.ts";

// S3 - case assignment, attaching the job's existing dev case (the thread's case stage).
//
// LOCAL AND IDS-ONLY. No model is called and neither devcase orchestrator nor devcase-run
// is started: this READS the dev cases the recruiter already approved for the run's job
// (listDevCasesForJob, this workspace) and records the newest one's id. The floor still
// builds the payload - timebox, seedRef, caseDesignHash stay exactly as
// runCaseAssignment writes them - and this producer only fills the `devcaseId` the floor
// leaves null. With no approved case the floor's honest null is returned untouched.

export type CaseProducerDeps = {
  /** The id of the newest approved dev case for the job, or null. Injected by tests. */
  findCaseId?: (jobId: string, workspaceId: string) => string | null;
  keyless?: StageRunner;
};

const defaultFindCaseId = (jobId: string, workspaceId: string): string | null =>
  // listDevCasesForJob is newest-first.
  listDevCasesForJob(jobId, workspaceId).find((c) => c.status === "approved")?.id ?? null;

export function caseProducer(deps: CaseProducerDeps = {}): RoleRunProducer {
  const findCaseId = deps.findCaseId ?? defaultFindCaseId;
  const keyless = deps.keyless ?? DEFAULT_STAGE_RUNNERS.case_assignment;

  const run = async (ctx: StageContext): Promise<StageOutcome> => {
    const floor = await keyless(ctx);
    const devcaseId = findCaseId(ctx.run.jobId, ctx.workspaceId);
    if (!devcaseId) return floor;
    const payload = floor.payload as CaseAssignmentPayload;
    return {
      ...floor,
      payload: { ...payload, assignments: payload.assignments.map((a) => ({ ...a, devcaseId })) } satisfies CaseAssignmentPayload,
    };
  };

  return { kind: "case_assignment", usesLlm: false, run };
}
