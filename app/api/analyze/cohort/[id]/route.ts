import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { getAnalysisCohort } from "@/app/_lib/db/analysis-cohorts";
import { cohortJdContext, cohortJdDeps } from "@/app/_lib/analyze-cohort-proposal";
import { assembleAnalysisCohortView, cohortViewDeps } from "@/app/_lib/analyze-cohort-view";

// GET /api/analyze/cohort/[id] -> CohortView (Cohort Studio, Analyze v2).
//
// Assembled at READ time from the run sheet, each member's saved analysis (under the same
// consent scrub as /api/analyses/[slug]) and the stored reorder-surviving comments; a
// running cohort answers its partial view (pending members project as pending). A blind
// cohort's labels are "Candidate A".."T" by neutral order — the name never reaches the
// wire. Workspace-scoped: another team's id is the same 404 as an unknown one. The session
// is re-verified (requireOperator) before the seat is asked, like every cohort door.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const opDenied = await requireOperator();
  if (opDenied) return opDenied;
  const { id } = await context.params;
  const denied = await requireCapabilityCoded("read", requireCapability);
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const rec = getAnalysisCohort(id, ws);
    if (!rec) return jsonRefusal("COHORT_NOT_FOUND", 404);
    const ctx = cohortJdContext(rec.jdSlug, ws, cohortJdDeps()) ?? { jdTitle: rec.jdSlug, companyText: null, orgName: null, job: null };
    return jsonOk(assembleAnalysisCohortView(rec, ctx, cohortViewDeps()));
  } catch (error) {
    return safeJsonError(error, `api:analyze/cohort/${id}`, "COHORT_LOAD_FAILED");
  }
}
