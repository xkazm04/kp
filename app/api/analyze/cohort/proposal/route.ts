import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { loadJd } from "@/app/_lib/db/jobs";
import { listEntriesForJob } from "@/app/_lib/db/pipeline";
import { listAnalysisCohortReuseRows } from "@/app/_lib/db/analysis-cohorts";
import { buildCandidatePool, resolveCandidatePoolEntry } from "@/app/_lib/candidate-pool";
import { rankPoolForJob } from "@/app/_lib/recruiter-run";
import {
  buildCohortProposal,
  cohortJdDeps,
  cohortSourceReaders,
  type ProposalDeps,
  type RankedRow,
} from "@/app/_lib/analyze-cohort-proposal";

/** The production wiring. Here, not in the shared module: only this door ranks, so the
 *  pool and the recruiter_cli bridge stay off the POST route and the runner. */
function cohortProposalDeps(signal: AbortSignal): ProposalDeps {
  return {
    ...cohortSourceReaders(),
    ...cohortJdDeps(),
    listApplicants: (jobId, workspaceId) => listEntriesForJob(jobId, workspaceId),
    poolEntryExists: (candidateId, label, workspaceId) => resolveCandidatePoolEntry(candidateId, label, workspaceId) !== null,
    buildPool: (workspaceId) => buildCandidatePool(workspaceId),
    rankPool: (jobId, pool, job) => rankPoolForJob<{ candidates?: RankedRow[] }>(jobId, pool, job, { signal }),
    reuseRows: (jdSlug, workspaceId) => listAnalysisCohortReuseRows(jdSlug, workspaceId),
  };
}

// GET /api/analyze/cohort/proposal?jd=<slug> -> CohortProposal (Cohort Studio, Analyze v2).
//
// Who the comparison would hold and what it would spend: the JD's applicants with a
// readable CV, topped up from the workspace pool by the deterministic recruiter_cli rank
// (analyze-cohort-proposal.ts states the rules). A read seat may ask; nothing is written.
// The ranking spawns a Python child, so it sits behind a per-IP limiter (the same 30/10min
// shape as /api/jobs/[id]/candidates); the unknown-JD 404 answers before it, free.
// Never on the wire: payload_json, the CV text, cv_hash.
export async function GET(request: Request) {
  const denied = await requireCapabilityCoded("read", requireCapability);
  if (denied) return denied;
  const jd = new URL(request.url).searchParams.get("jd")?.trim() ?? "";
  try {
    const ws = await currentWorkspace();
    // 404 for an unknown AND for another team's JD: indistinguishable to a non-holder.
    if (!jd || !loadJd(jd, ws)) return jsonRefusal("JD_NOT_FOUND", 404);
    if (!rateLimit(`analyze-cohort-proposal:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const proposal = await buildCohortProposal(jd, ws, cohortProposalDeps(request.signal));
    if (!proposal) return jsonRefusal("JD_NOT_FOUND", 404);
    return jsonOk(proposal);
  } catch (error) {
    return safeJsonError(error, "api:analyze/cohort/proposal", "COHORT_PROPOSAL_FAILED");
  }
}
