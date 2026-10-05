// The post-commit half of taking a job live, extracted as a testable runner.
// Manages candidate sourcing into the pipeline, rediscovery alert raising,
// and updates the durable receipt across attempts and failure modes.
import { runSourceForRole } from "./devcase-run.ts";
import { raiseRediscoveryAlertsForJob } from "./rediscover.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { getJob } from "./db/jobs.ts";
import { splitRequirements } from "../features/library/jobs/JobsTypes.ts";
import { finishReceipt } from "./golive-receipt-store.ts";

export type RunGoLiveDeps = {
  source?: typeof runSourceForRole;
  raise?: typeof raiseRediscoveryAlertsForJob;
  createEntry?: typeof createPipelineEntry;
};

export type RunGoLiveParams = {
  jobId: string;
  workspaceId: string;
  signal?: AbortSignal;
  mode: "first" | "resume";
  attempt?: number;
};

export type RunGoLiveResult = {
  alreadyPublished: boolean;
  resumed?: boolean;
  sourced: number;
  skipped: number;
  silverMedalists: number;
  silverMedalistsFailed?: boolean;
  sourcingWarning: string | null;
  sourcingAbandoned?: boolean;
  reopened?: number;
};

/**
 * Executes the post-commit actions for going live: sourcing candidates,
 * persisting pipeline entries, and raising rediscovery alerts.
 * Only newly created entries increment the `sourced` count.
 * Failures or aborts update the job's receipt accordingly.
 */
export async function runGoLive(
  params: RunGoLiveParams,
  deps: RunGoLiveDeps = {}
): Promise<RunGoLiveResult> {
  const { jobId, workspaceId, signal, mode, attempt = 1 } = params;
  const sourceFn = deps.source ?? runSourceForRole;
  const raiseFn = deps.raise ?? raiseRediscoveryAlertsForJob;
  const createEntryFn = deps.createEntry ?? createPipelineEntry;

  const job = getJob(jobId, workspaceId);
  if (!job) {
    throw new Error(`Job ${jobId} not found in workspace ${workspaceId}`);
  }

  let sourced = 0;
  let skipped = 0;
  let sourcingWarning: string | null = null;

  const reqs = ((job as { requirements?: { skill: string; kind?: string }[] }).requirements ?? []);
  const { mustHaves, niceToHaves } = splitRequirements(reqs);
  const role = {
    title: job.title,
    seniority: job.seniority,
    roleFamily: job.roleFamily,
    languages: job.languages ?? [],
    mustHaves,
    niceToHaves,
    responsibilities: job.description ? [job.description] : [],
  };

  try {
    if (signal?.aborted) {
      throw new Error("aborted");
    }
    const outcome = await sourceFn(role, { signal, workspaceId });
    skipped = outcome.skipped;
    for (const m of outcome.candidates) {
      if (!m.candidateId) continue;
      const res = createEntryFn({
        candidateId: m.candidateId,
        candidateLabel: m.label,
        archetype: m.archetype,
        roleFamily: job.roleFamily ?? null,
        jobId,
        jobTitle: job.title,
        matchScore: m.score,
        stage: "Accepted",
        workspaceId,
      });
      // Honest count: only created pipeline entries count toward sourced
      if (res.created) {
        sourced += 1;
      }
    }
  } catch (sourcingError) {
    if (signal?.aborted) {
      finishReceipt(jobId, workspaceId, attempt, {
        state: "abandoned",
        sourced,
        skipped,
        failureCode: "ABORTED",
      });
      return {
        alreadyPublished: mode === "resume",
        resumed: mode === "resume",
        sourced,
        skipped,
        silverMedalists: 0,
        sourcingWarning: null,
        sourcingAbandoned: true,
      };
    }
    sourcingWarning =
      sourcingError instanceof Error ? sourcingError.message : "Sourcing failed for an unknown reason.";
    finishReceipt(jobId, workspaceId, attempt, {
      state: "sourcing_failed",
      sourced,
      skipped,
      failureCode: sourcingWarning,
    });
    return {
      alreadyPublished: mode === "resume",
      resumed: mode === "resume",
      sourced,
      skipped,
      silverMedalists: 0,
      sourcingWarning,
      sourcingAbandoned: false,
    };
  }

  let silverMedalists = 0;
  let silverMedalistsFailed = false;
  try {
    if (signal?.aborted) {
      finishReceipt(jobId, workspaceId, attempt, {
        state: "abandoned",
        sourced,
        skipped,
        failureCode: "ABORTED",
      });
      return {
        alreadyPublished: mode === "resume",
        resumed: mode === "resume",
        sourced,
        skipped,
        silverMedalists: 0,
        sourcingWarning: null,
        sourcingAbandoned: true,
      };
    }
    const raise = await raiseFn(jobId, { signal, workspaceId });
    silverMedalists = raise.raised;
    silverMedalistsFailed = raise.failed;
  } catch {
    if (signal?.aborted) {
      finishReceipt(jobId, workspaceId, attempt, {
        state: "abandoned",
        sourced,
        skipped,
        failureCode: "ABORTED",
      });
      return {
        alreadyPublished: mode === "resume",
        resumed: mode === "resume",
        sourced,
        skipped,
        silverMedalists: 0,
        sourcingWarning: null,
        sourcingAbandoned: true,
      };
    }
    silverMedalistsFailed = true;
  }

  finishReceipt(jobId, workspaceId, attempt, {
    state: silverMedalistsFailed ? "raise_failed" : "done",
    sourced,
    skipped,
    silverMedalists,
  });

  return {
    alreadyPublished: mode === "resume",
    resumed: mode === "resume",
    sourced,
    skipped,
    silverMedalists,
    silverMedalistsFailed,
    sourcingWarning,
    sourcingAbandoned: false,
  };
}
