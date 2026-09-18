// The JOB-level interview kit (spark interview-kit-template, WP-A).
//   GET  /api/jobs/[id]/interview-kit -> { published: StoredInterviewKit | null,
//        draft: StoredInterviewKit | null, versions: StoredInterviewKitSummary[] }
//   POST /api/jobs/[id]/interview-kit (no body) -> { taskId }   (background `interview_kit`
//        task; spends one model call; the result lands as a new DRAFT version)
//   PUT  /api/jobs/[id]/interview-kit { kit: InterviewKit } -> { kit: StoredInterviewKit,
//        adjusted: KitAdjustment[] }   (a NEW version, source "edited", status "draft")
//   refusals: JOB_NOT_FOUND 404 · INTERVIEW_KIT_INVALID 400 {reason, at} ·
//        PAYLOAD_TOO_LARGE 413 · TOO_MANY_REQUESTS 429 · FORBIDDEN_CAPABILITY 403
import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { canWriteJobLifecycle, getJob, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
import {
  interviewKitAppendVersion,
  interviewKitLatestDraft,
  interviewKitLatestPublished,
  interviewKitVersions,
} from "@/app/_lib/db/interview-kits";
import { normalizeInterviewKit } from "@/app/_lib/interview-kit-validate";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { startTask } from "@/app/_lib/tasks";

// POST ./publish/ flips one version to published. There is no DELETE and no in-place
// edit by design: the table is append-only because a candidate's interview link is pinned
// to the version it was minted with (db/interview-kits.ts states the whole argument).
//
// VISIBILITY, every verb. `getJob` is a by-id point read over a globally-unique PK, so
// without the predicate this route answers for ANY tenant's role — and the kit IS the
// role's private hiring judgement (which competencies it is bought on, what is asked, the
// FAQ). 404 rather than 403, so the door cannot confirm another team's job id exists;
// seeded corpus rows (workspace_id NULL) stay visible to every tenant exactly as the
// browse list shows them.

/** Per-IP, over the shared 10-minute window — the same budget every once-per-role spend
 *  door on this surface carries (ingest, campaign, publish, agent-fit). The generate POST
 *  starts a BACKGROUNDED model call over the role's own text; it is capability-gated, but
 *  open mode (KP_OPERATOR_PASSWORD unset) makes that a documented no-op for the whole API,
 *  so the door must self-limit. 20 sits far above a recruiter re-drafting one role's kit
 *  and below any scripted loop. */
const INTERVIEW_KIT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

/** A whole kit is at most 8 competencies x 6 questions plus a 12-entry FAQ, each field
 *  capped in the low hundreds of characters — tens of kilobytes at the absolute ceiling.
 *  64 KB leaves room for whitespace and a client that sends its own extra keys, and stops
 *  a crafted body from being JSON.parsed before the normalizer ever sees it. */
const MAX_KIT_BODY_BYTES = 64 * 1024;

/** The job this request is allowed to act on, or null. One resolver for all three verbs
 *  so the existence check and the visibility predicate can never come apart. */
function visibleJob(id: string, ws: string) {
  const job = getJob(id);
  return job && jobVisibleToWorkspace(id, ws) ? job : null;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    if (!visibleJob(id, ws)) return jsonRefusal("JOB_NOT_FOUND", 404);
    // Three reads rather than one payload: the editor opens the DRAFT, the interview
    // mints from the PUBLISHED one, and the history panel needs neither's questions —
    // `interviewKitVersions` deliberately returns summaries, not eight kits.
    return NextResponse.json({
      published: interviewKitLatestPublished(id, ws),
      draft: interviewKitLatestDraft(id, ws),
      versions: interviewKitVersions(id, ws),
    });
  } catch (error) {
    return safeJsonError(error, "api:jobs/interview-kit", "INTERVIEW_KIT_FAILED");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // AUTHORIZATION FIRST, ahead of the 404 and the throttle: a refused seat must neither
  // spend rate-limit budget nor learn which job ids exist. `pipeline:write` is what the
  // sibling job-write doors ask (priorities, translations).
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    // Ownership, not just visibility: authoring a role's kit is a lifecycle write, and
    // this is the same gate /publish and /close use (canWriteJobLifecycle — which also
    // encodes the decision that a shared corpus role is adoptable by every tenant).
    const job = getJob(id);
    if (!job || !canWriteJobLifecycle(id, ws)) return jsonRefusal("JOB_NOT_FOUND", 404);
    // AFTER the cheap refusals, BEFORE the task is accepted: a refused call must cost
    // nothing, so it must neither consume the budget nor be masked by it.
    if (!rateLimit(`jobs-interview-kit:${clientIpFrom(request.headers)}`, INTERVIEW_KIT_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // Backgrounded, and deduped on the job id (task-dedupe.ts): a double-clicked
    // "Draft the kit" coalesces onto the run already in flight instead of appending a
    // second version that nobody asked for and nothing can remove.
    const task = startTask("interview_kit", { jobId: job.id, jobTitle: job.title }, ws);
    return NextResponse.json({ taskId: task.id });
  } catch (error) {
    return safeJsonError(error, "api:jobs/interview-kit", "INTERVIEW_KIT_FAILED");
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    if (!canWriteJobLifecycle(id, ws) || !getJob(id)) return jsonRefusal("JOB_NOT_FOUND", 404);

    const body = await readJsonWithLimit<{ kit?: unknown }>(request, MAX_KIT_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_KIT_BODY_BYTES });

    // ONE trust boundary, shared with the generator (interview-kit-validate.ts). A kit
    // that cannot be stored is a coded REFUSAL, never a throw: a half-authored kit is an
    // expected outcome on an editor's save button, not a fault. `reason`/`at` ride beside
    // the code as data so the editor can point at the field without the server shipping
    // an English sentence to a Czech reader.
    const normalized = normalizeInterviewKit(body.kit);
    if (!normalized.ok) {
      return jsonRefusal("INTERVIEW_KIT_INVALID", 400, { reason: normalized.reason, at: normalized.at ?? null });
    }
    // An edit is a NEW DRAFT version, never a rewrite of the one it was based on — that
    // is the whole point of the table. It stays a draft until someone publishes it, so a
    // live round keeps asking what it was already asking while the kit is being reworked.
    const record = interviewKitAppendVersion({ jobId: id, kit: normalized.kit, source: "edited" }, ws);
    // `adjusted` names the repairs the normalizer made (a cap trimmed, an id minted) so
    // the editor can say what changed rather than silently returning something else than
    // what was sent.
    return NextResponse.json({ kit: record, adjusted: normalized.adjusted });
  } catch (error) {
    return safeJsonError(error, "api:jobs/interview-kit", "INTERVIEW_KIT_FAILED");
  }
}
