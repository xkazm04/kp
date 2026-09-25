import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { prepareGigProject } from "@/app/_lib/gigs/project";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/gigs/[id]/workspace - prepare the gig's workspace now (gigs/project.ts): make its
// folder under the gigs root (GIG.md, NOTES.md, deliverable/ - only files that are not there
// yet), ensure the arena's Personas workspace and the Personas project rooted at the folder,
// and record both on the gig. Dispatch runs the same step before every attempt; this door is
// for the operator who wants the folder (or the link) before that.
//
//   200 { gig, personas: { linked: true, projectId, workspaceId, created }
//                      | { linked: false, reason } }
//        - the folder is ready either way; an unpaired, unreachable or older Personas is a
//          `reason`, not a failure (the folder does not depend on Personas)
//   404 GIG_NOT_FOUND · 500 GIG_WORKSPACE_FAILED (`detail` = workdir_outside_root |
//   workdir_io_error) · 500 GIG_STORE_FAILED
//
// Throttled per IP BEFORE any read, at the research door's budget: every accepted call
// writes to disk and makes up to two calls to the local Personas app.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-workspace:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const res = await prepareGigProject(ws, id);
    if (!res.ok) {
      if (res.code === "GIG_NOT_FOUND") return jsonRefusal("GIG_NOT_FOUND", 404);
      return jsonRefusal("GIG_WORKSPACE_FAILED", 500, { detail: res.reason });
    }
    return NextResponse.json({ gig: res.gig, personas: res.personas });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/workspace", "GIG_STORE_FAILED");
  }
}
