// Publish one version of a job's interview kit (spark interview-kit-template, WP-A).
//   POST /api/jobs/[id]/interview-kit/publish { kitId } -> { kit: StoredInterviewKit }
//   refusals: JOB_NOT_FOUND 404 · INTERVIEW_KIT_NOT_FOUND 404 (unknown, another role's,
//        or already published — one answer on purpose) · PAYLOAD_TOO_LARGE 413 ·
//        FORBIDDEN_CAPABILITY 403
import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { canWriteJobLifecycle, getJob } from "@/app/_lib/db/jobs";
import { interviewKitById, interviewKitPublish } from "@/app/_lib/db/interview-kits";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// Make ONE stored version of a job's interview kit the live one: the version every NEW
// candidate link for this role is minted from.
//
// This is the human step the generator deliberately cannot take. A generated draft is a
// machine's proposal about what real people are about to be asked in a real conversation,
// and the versioned table exists so that proposal cannot become the live kit until
// somebody says so (app/_lib/interview-kit-run.ts states it from the other side).
//
// It is also the ONE update the append-only table permits, and only because it does not
// change what the version ASKS — every link already pinned to it keeps asking exactly
// what it asked. The store does the flip in a single guarded UPDATE, so two publishes
// racing each other resolve to one winner and one honest 404 rather than both callers
// believing they did it.

/** A body of `{ kitId }` — two short fields at the outside. */
const MAX_PUBLISH_BODY_BYTES = 4 * 1024;

/** The kit id the body may name. Bounded at the boundary so a crafted value can't reach
 *  the store as a multi-megabyte bind parameter. */
const MAX_KIT_ID_LEN = 64;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Publishing decides what candidates are asked, so it asks the same capability every
  // other recruiter write on this surface does — and it runs FIRST, so a refused seat
  // learns nothing about which job or kit ids exist.
  // IDENTITY, then AUTHORITY. requireOperator proves a trusted session is present (the
  // proxy gate is not defence in depth on its own, ADR 0005); the capability below is
  // what decides this seat may write. Same order as the sibling job-write doors.
  const unauth = await requireOperator();
  if (unauth) return unauth;
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    // Ownership before anything else: the same gate /publish and /close use. 404, not
    // 403, so the door can't be used to probe another team's job ids.
    if (!getJob(id) || !canWriteJobLifecycle(id, ws)) return jsonRefusal("JOB_NOT_FOUND", 404);

    const body = await readJsonWithLimit<{ kitId?: unknown }>(request, MAX_PUBLISH_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_PUBLISH_BODY_BYTES });
    const kitId = typeof body.kitId === "string" ? body.kitId.trim() : "";
    if (!kitId || kitId.length > MAX_KIT_ID_LEN) return jsonRefusal("INTERVIEW_KIT_NOT_FOUND", 404);

    // Read BEFORE the flip, and re-assert the job. The store read is workspace-bound, so
    // another team's kit id resolves to nothing here; the job check is what stops a kit
    // id belonging to a DIFFERENT role of this team's being published under this URL.
    // Deliberately not folded into the UPDATE's own predicate: a flip that then had to be
    // refused would already have happened, and this table has no way to take it back.
    // (`job_id` is immutable on a row, so reading it first is not a race — the only
    // racing field is `status`, which the store's UPDATE re-asserts itself.)
    const existing = interviewKitById(kitId, ws);
    if (!existing || existing.jobId !== id) return jsonRefusal("INTERVIEW_KIT_NOT_FOUND", 404);
    const published = interviewKitPublish(kitId, ws);
    // One refusal for "no such version", "belongs to another role" and "already
    // published": the recruiter's next step is the same (reload and look at the version
    // list), and telling them apart would make this an existence oracle.
    if (!published) return jsonRefusal("INTERVIEW_KIT_NOT_FOUND", 404);
    return NextResponse.json({ kit: published });
  } catch (error) {
    return safeJsonError(error, "api:jobs/interview-kit/publish", "INTERVIEW_KIT_FAILED");
  }
}
