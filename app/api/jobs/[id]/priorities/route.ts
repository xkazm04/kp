import { NextResponse } from "next/server";
import { getJob, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";
import { getRolePriorities, setRolePriorities } from "@/app/_lib/role-priorities-store";

// The role coach's PATTERN PRIORITIES — the three-level weight (critical / important /
// minor) a recruiter hangs on each pattern their candidate pool shows against this role.
// The grading itself stays on GET /api/jobs/[id]/winnability (read-only, spawns the
// scorer); this pair is the tiny durable half, so tagging a pattern never re-runs a CLI.
//
// Both methods re-apply the by-id visibility predicate every other job route applies
// (docs/features/jobs README § "By-id job routes re-apply the list's visibility
// predicate"): 404, not 403, so the endpoint cannot confirm another team's id exists.
// The store is keyed (job_id, workspace_id), so a shared seeded corpus role is taggable
// by every team without any of them reading or clobbering each other's weighting.
//
// No rate limit: neither method spawns a child or spends money — this is a point read
// and a single upsert of a bounded map (sanitizePriorities caps both the key length and
// the entry count), the same posture as the other pure-DB job reads.

async function resolve(id: string): Promise<{ ws: string } | null> {
  const ws = await currentWorkspace();
  const job = getJob(id);
  if (!job || !jobVisibleToWorkspace(id, ws)) return null;
  return { ws };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const scope = await resolve(id);
    if (!scope) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ priorities: getRolePriorities(id, scope.ws) });
  } catch (error) {
    return safeJsonError(error, "api:jobs/priorities", "JOB_PRIORITIES_FAILED");
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const scope = await resolve(id);
    if (!scope) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    // A malformed body is not a failure: the panel sends the WHOLE map on every tag
    // change, so an unparseable payload is treated as "no tags" by the store's
    // sanitizer rather than throwing a 500 at a recruiter mid-click.
    const body: unknown = await request.json().catch(() => null);
    const raw = body && typeof body === "object" ? (body as { priorities?: unknown }).priorities : null;
    const priorities = setRolePriorities(id, raw, scope.ws);
    // Echo what was STORED, not what was sent: the panel reconciles its optimistic
    // state against this, so a dropped junk entry is visible rather than lingering on
    // screen as a tag the server never kept.
    return NextResponse.json({ ok: true, priorities });
  } catch (error) {
    return safeJsonError(error, "api:jobs/priorities", "JOB_PRIORITIES_FAILED");
  }
}
