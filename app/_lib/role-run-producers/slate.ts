import { getJob } from "../db/jobs.ts";
import { createPipelineEntry, listEntriesForJob } from "../db/pipeline.ts";
import { rediscoverForJob, type RediscoverResult } from "../rediscover.ts";
import { withheldCandidateIds } from "../rediscovery-eligibility.ts";
import { SLATE_CAP, type StageContext, type StageOutcome } from "../role-run-engine.ts";
import type { SlatePayload } from "../role-run-stages.ts";
import { opsLog } from "../ops-telemetry.ts";
import type { RoleRunProducer } from "./index.ts";

// S1 - slate, backed by candidate-pool + rediscoverForJob (idea cb089fa9).
//
// The slate is the run's branch list, so this stage decides the SHAPE of everything after
// it. The keyless floor follows what is already on the board. This producer follows the
// board AND the role's silver medalists - people the team met for another role who clear
// the bar for this one - without ever exceeding SLATE_CAP.
//
// ORDER OF PRIORITY under the cap: people a recruiter or an applicant already put on THIS
// role's board come first (they are in the pipeline on purpose), rediscovered candidates
// fill what is left, best rank first. `truncated` is true when ANY of the three cuts
// applied: board entries past the cap, qualifiers past the room left, or a candidate pool
// the ranker itself could not cover.
//
// CONSENT, BEFORE ANYTHING IS WRITTEN (ADR-0011 P1). rediscoverForJob already withholds
// an erased, lapsed-consent or opted-out person before it ranks. This producer asks the
// SAME predicate (withheldCandidateIds) again immediately before it mints a board entry,
// so a person who was withheld - or became withheld between the rank and the write - is
// never re-surfaced, never gets an entry, and never gets a branch. Their id and label are
// not logged.
//
// WHAT A BRANCH IS. Every later stage keys on a pipeline ENTRY id. A rediscovered
// candidate has none for this role, so one is created through the board's own idempotent
// door (createPipelineEntry) - and ONLY when the candidate has no entry for this role at
// all: a candidate the team already declined or rejected FROM this role must not be
// revived by a re-add transition. The entry carries no outreach: reaching out stays the
// recruiter's own consent-gated action.

export type SlateProducerDeps = {
  rediscover?: (job: NonNullable<ReturnType<typeof getJob>>, opts: { workspaceId: string }) => Promise<RediscoverResult>;
  /** The consent + opt-out gate, asked once more right before the board write. */
  withheld?: (candidateIds: readonly string[]) => ReadonlyMap<string, unknown>;
};

/** A non-identifying, closed-shape reference to the prior outcome that justified the
 *  rediscovery: `prior:<kind>:<terminal stage>`. Never a role title or a name. */
function priorRef(kind: string, stage: string): string {
  return `prior:${kind}:${stage}`.replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 80);
}

export function slateProducer(deps: SlateProducerDeps = {}): RoleRunProducer {
  const rediscover = deps.rediscover ?? ((job, opts) => rediscoverForJob(job, opts));
  const withheld = deps.withheld ?? ((ids) => withheldCandidateIds(ids));

  const run = async (ctx: StageContext): Promise<StageOutcome> => {
    const board = listEntriesForJob(ctx.run.jobId, ctx.workspaceId);
    const boardKept = board.slice(0, SLATE_CAP);
    const candidates: SlatePayload["candidates"] = boardKept.map((e) => ({
      candidateRef: e.id,
      origin: e.sourceChannel ? "inbound" : "pool",
    }));
    let truncated = board.length > boardKept.length;

    const job = getJob(ctx.run.jobId);
    let found: RediscoverResult | null = null;
    if (job) {
      try {
        found = await rediscover(job, { workspaceId: ctx.workspaceId });
      } catch (err) {
        // Rediscovery is additive: a ranking failure must not cost the run its board slate.
        opsLog("warn", "role-run:rediscovery-failed", { runId: ctx.run.id, errorName: err instanceof Error ? err.name : "unknown" });
      }
    }

    if (job && found) {
      if (found.poolTruncated || found.more > 0) truncated = true;
      const onBoard = new Set(board.map((e) => e.candidateId).filter((id): id is string => Boolean(id)));
      // Candidates the team already has an entry for under THIS role are not rediscoveries, whatever their status.
      const fresh = found.rediscovered.filter((r) => !onBoard.has(r.candidateId));
      const gate = withheld(fresh.map((r) => r.candidateId));
      for (const r of fresh) {
        if (gate.has(r.candidateId)) continue;
        if (candidates.length >= SLATE_CAP) {
          truncated = true;
          break;
        }
        const { entry } = createPipelineEntry({
          candidateId: r.candidateId,
          candidateLabel: r.label,
          jobId: job.id,
          jobTitle: job.title,
          matchScore: r.score,
          workspaceId: ctx.workspaceId,
        });
        candidates.push({ candidateRef: entry.id, origin: "rediscovery", priorOutcomeRef: priorRef(r.prior.kind, r.prior.stage) });
      }
    }

    return { status: "complete", payload: { candidates, truncated } satisfies SlatePayload };
  };

  // The ranker is deterministic and local (recruiter_cli); no model is called.
  return { kind: "slate", usesLlm: false, run };
}
