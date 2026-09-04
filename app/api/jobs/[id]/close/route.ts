import { NextResponse } from "next/server";
import { canWriteJobLifecycle, getJob } from "@/app/_lib/db/jobs";
import { closeEntriesByJobId } from "@/app/_lib/db/pipeline";
import { getJobStatus, setJobStatus } from "@/app/_lib/job-ingest";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";


// W8-1 (JOB1) — retire a role. The lifecycle was a one-way ratchet (NULL/draft
// → published, full stop): a filled role kept its apply link live, kept
// appearing open in the catalog, and kept being ranked against the pool.
// Idempotent mirror of /publish; the apply page + API gate on the status.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // Tenancy (job-postings-lifecycle #1): mirror /publish, which scopes its entry
  // operations to the caller's workspace. Without this, closeEntriesByJobId fell to
  // DEFAULT_WORKSPACE_ID and withdrew NONE of a non-default team's in-flight
  // candidates — the close "succeeded" with withdrawn:0 while the funnel kept
  // chasing a retired role.
  const ws = await currentWorkspace();
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    // Ownership gate: the entry withdrawal below is workspace-scoped, but the STATUS
    // WRITE (setJobStatus) is a bare by-id UPDATE — without this, workspace B could
    // dark workspace A's live role. Seeded corpus rows (workspace_id NULL) stay
    // closable by every tenant; see canWriteJobLifecycle for the reasoning. 404
    // (not 403) so the endpoint doesn't confirm that another tenant's id exists.
    if (!canWriteJobLifecycle(id, ws)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const already = getJobStatus(id) === "closed";
    let withdrawn = 0;
    // Set when the withdrawal step ITSELF threw: the close committed but the pipeline
    // was NOT reconciled. Without it, "nobody was in flight" and "withdrawing them
    // broke" were the same ok:true/withdrawn:0 response and the UI rendered neither —
    // mirrors publish's sourcingWarning. false = the step ran (even if it found nobody).
    let withdrawalFailed = false;
    if (!already) {
      setJobStatus(id, "closed");
      // JOB2 — withdraw the role's still-in-flight candidates (mark them role_closed) so
      // a filled role isn't chased and doesn't inflate the active funnel. The Hired
      // candidate is left active. Best-effort: the close already committed, so a
      // withdrawal failure is logged, not surfaced as a failed close.
      try {
        withdrawn = closeEntriesByJobId(id, ws);
      } catch (e) {
        withdrawalFailed = true;
        console.error(`[api:jobs/close] job ${id} closed but withdrawing its entries failed:`, e);
      }
    }
    return NextResponse.json({ ok: true, status: "closed", alreadyClosed: already, withdrawn, withdrawalFailed });
  } catch (error) {
    return safeJsonError(error, "api:jobs/close", "JOB_CLOSE_FAILED");
  }
}
