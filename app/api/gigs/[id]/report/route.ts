import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGig } from "@/app/_lib/db/gigs";
import { GIG_REPORT_CSP, readGigReportFile, servedReportsRoot } from "@/app/_lib/gigs/report/serve";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { startTask } from "@/app/_lib/tasks";

// /api/gigs/[id]/report - the gig's HTML report (docs/features/gigs/README.md "The report").
// The report is a FILE under the gigs root (gigs/report/file.ts, read back by gigs/report/serve.ts); the gig's `report` record
// says where it is, the stage it was written at and whether a rewrite is running.
//
// GET  -> 200 text/html - the report file itself, SANDBOXED: its body was written by a model
//         from strangers' text (then allow-list sanitised, gigs/report/sanitize.ts), so it
//         must never run in kp's origin. The response carries
//           Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline';
//             img-src data:; base-uri 'none'; form-action 'none'
//           X-Content-Type-Options: nosniff, Cache-Control: no-store
//         - an opaque origin, no script, no request, no form. Open it in a new tab.
//         404 GIG_NOT_FOUND · 404 GIG_REPORT_NOT_FOUND (none yet, or the file is gone) ·
//         500 GIG_STORE_FAILED
//
// POST -> 202 { taskId } - rewrite the report NOW (a `gig_report` task with `force`, even when
//         the current one is up to date): one pinned model call (gig_report_cli.py), or kp's
//         own body keyless. Poll the task or the gig (its `report.status` reads `writing`).
//         404 GIG_NOT_FOUND · 409 GIG_ACTION_NOT_ALLOWED { reason: "no_brief" } - a report
//         is written from the research brief, so research the gig first · 429
//         TOO_MANY_REQUESTS · 500 GIG_STORE_FAILED
//         Throttled per IP BEFORE any read (`gigs-report`, 20/10min): every accepted POST
//         spends a model call.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    const html = gig.report ? readGigReportFile(servedReportsRoot(), gig.report.path) : null;
    if (html === null) return jsonRefusal("GIG_REPORT_NOT_FOUND", 404);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": GIG_REPORT_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/report", "GIG_STORE_FAILED");
  }
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-report:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    if (!gig.brief) return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { reason: "no_brief" });
    // workspaceId rides in params for the dedupe builder (task-dedupe.ts sees params only).
    const task = startTask("gig_report", { workspaceId: ws, gigId: id, force: true }, ws);
    return NextResponse.json({ taskId: task.id }, { status: 202 });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/report", "GIG_STORE_FAILED");
  }
}
