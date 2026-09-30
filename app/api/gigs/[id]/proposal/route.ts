import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGig } from "@/app/_lib/db/gigs";
import { proposalDownloadName, servedProposalsRoot } from "@/app/_lib/gigs/proposal/serve";
import { GIG_REPORT_CSP, readGigReportFile } from "@/app/_lib/gigs/report/serve";
import { gigTrackOf } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { startTask } from "@/app/_lib/tasks";

// /api/gigs/[id]/proposal - a freelance gig's CLIENT PROPOSAL (docs/features/gigs/README.md
// "Two tracks"). A freelance gig is the proposal track: kp prepares a plan the client reads,
// the questions and artifacts to ask for and the bid message - never the work. The proposal
// is a FILE under the gigs root (gigs/proposal/file.ts); the gig's `proposal` record says
// where it is, who wrote it and whether a rewrite is running.
//
// GET  -> 200 text/html - the proposal file, served under the SAME sandbox policy as the
//         report (Content-Security-Policy: sandbox; default-src 'none'; ... ,
//         X-Content-Type-Options: nosniff, Cache-Control: no-store, Referrer-Policy:
//         no-referrer). `?download=1` adds Content-Disposition: attachment;
//         filename="<slug>-proposal.html", to attach to a bid or print.
//         404 GIG_NOT_FOUND · 404 GIG_PROPOSAL_NOT_FOUND (none yet, or the file is gone) ·
//         500 GIG_STORE_FAILED
//
// POST -> 202 { taskId } - write the proposal NOW (a `gig_proposal` task): one pinned model
//         call (gig_proposal_cli.py), or kp's own composition keyless. A plan is NOT required
//         (a brief-only proposal says the detailed plan follows the client's answers). A
//         qualified gig then carries it as its draft; a drafted one keeps its draft.
//         404 GIG_NOT_FOUND · 409 GIG_ACTION_NOT_ALLOWED { reason: "build_track" } - not a
//         freelance gig · 409 GIG_ACTION_NOT_ALLOWED { reason: "no_brief" } - research it
//         first · 429 TOO_MANY_REQUESTS · 500 GIG_STORE_FAILED
//         Throttled per IP BEFORE any read (`gigs-proposal`, 20/10min): every accepted POST
//         spends a model call.

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    const html = gig.proposal ? readGigReportFile(servedProposalsRoot(), gig.proposal.path) : null;
    if (html === null || !gig.proposal) return jsonRefusal("GIG_PROPOSAL_NOT_FOUND", 404);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": GIG_REPORT_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        ...(download ? { "Content-Disposition": `attachment; filename="${proposalDownloadName(gig.proposal.path)}"` } : {}),
      },
    });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/proposal", "GIG_STORE_FAILED");
  }
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-proposal:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    if (gigTrackOf(gig.arena) !== "proposal") return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { reason: "build_track" });
    if (!gig.brief) return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { reason: "no_brief" });
    // workspaceId rides in params for the dedupe builder (task-dedupe.ts sees params only).
    const task = startTask("gig_proposal", { workspaceId: ws, gigId: id }, ws);
    return NextResponse.json({ taskId: task.id }, { status: 202 });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/proposal", "GIG_STORE_FAILED");
  }
}
