import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { latestFitDialogForPosting } from "@/app/_lib/db/jobseeker-dialogs";
import { getJobseekerPosting, getPostingSummary, postingTargetAlignment, setJobseekerPostingStatus } from "@/app/_lib/db/jobseeker-postings";
import { getJobseekerSource } from "@/app/_lib/db/jobseeker-sources";
import { catalogEntryForHost } from "@/app/_lib/jobseeker/sources-catalog";
import { DISMISS_REASONS, isDismissReason, isPostingStatus } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { postingDetailView } from "@/app/features/jobseeker/postingView";

// GET /api/jobseeker/postings/[id] → { view, fit, source, targetAlignment } — one posting as the /me flow's
// Weigh step reads it: the SAME projection the server page used to hand its client
// (postingView.ts: body as text, skill lists with provenance, breakdown, confidence,
// eligibility, reasoning — never the raw JSON-LD or the structured Job), the latest
// CLOSED fit dialog's verdict for the row, and the source's label, tier and attribution.
// POSTING_NOT_FOUND for an unknown or foreign id (the point read binds the workspace).
// 240/10min per IP — the Weigh step reads one posting per J/K step through the list.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`jobseeker-posting-read:${clientIpFrom(request.headers)}`, { limit: 240, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const posting = getJobseekerPosting(id, ws);
    if (!posting) return jsonRefusal("POSTING_NOT_FOUND", 404);
    const source = getJobseekerSource(posting.sourceId, ws);
    const entry = source ? catalogEntryForHost(source.host) : null;
    const settled = latestFitDialogForPosting(posting.id, ws);
    const fit = settled?.artifact && "verdict" in settled.artifact ? { artifact: settled.artifact, at: settled.updatedAt } : null;
    return NextResponse.json({
      view: postingDetailView(posting, entry?.label ?? source?.host ?? posting.sourceId, entry?.attribution ?? null),
      fit,
      source: source ? { id: source.id, tier: source.tier, host: source.host } : null,
      // The direction the matcher read — the SAME projection the feed's summary carries
      // (a filtered row's comes from its as-if result); null when no target was stated.
      targetAlignment: postingTargetAlignment(posting.match),
    });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/postings/[id]", "JOBSEEKER_STORE_FAILED");
  }
}

// PATCH /api/jobseeker/postings/[id] { status, dismissReason?, note? } — the seeker's own
// status move (WP4c): shortlisted / applied / dismissed / new. `dismissed` REQUIRES a
// `dismissReason` from DISMISS_REASONS — the reason is what the feed learns from — else
// 400. Answers the refreshed summary row so the feed can replace it in place. A row the
// scan marked `gone` is not moved at all (400, field `status`, no options): the opening
// was withdrawn, and a status move would bring it back into the live feed.
//
// Codes, deliberately reused rather than minted: APPLY_SELECTION_INVALID ("not one of the
// options offered") for a status / reason outside its vocabulary, with `field` and the
// `options` beside it; POSTING_NOT_FOUND ("That job posting could not be found") for an
// unknown or foreign id — the row is a job posting, and a 404 must not become an
// existence oracle across workspaces (the store binds workspace_id on the point read).
//
// Operator-gated by the proxy AND re-verified here; the limiter is the real bound in
// open mode. 120/10min per IP — triage is one click per card.

type PatchBody = { status?: unknown; dismissReason?: unknown; note?: unknown };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // The seeker's own data, but still a WRITE behind a seat: a viewer seat may read the
  // feed, not spend a scan, a model turn or a source acknowledgement (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-postings-write:${clientIpFrom(request.headers)}`, { limit: 120, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PatchBody;
    if (!isPostingStatus(body.status) || body.status === "gone") {
      // `gone` is the scan's verdict (two consecutive misses), never the seeker's.
      return jsonRefusal("APPLY_SELECTION_INVALID", 400, { field: "status", options: ["new", "shortlisted", "applied", "dismissed"] });
    }
    let dismiss: { reason: (typeof DISMISS_REASONS)[number]; note: string | null } | null = null;
    if (body.status === "dismissed") {
      if (!isDismissReason(body.dismissReason)) {
        return jsonRefusal("APPLY_SELECTION_INVALID", 400, { field: "dismissReason", options: DISMISS_REASONS });
      }
      dismiss = { reason: body.dismissReason, note: typeof body.note === "string" ? body.note : null };
    }
    const ws = await currentWorkspace();
    if (!setJobseekerPostingStatus(id, body.status, dismiss, ws)) {
      // The store refuses a move OUT of 'gone' (a withdrawn opening, the scan's verdict)
      // the same way it misses an unknown id; the point read tells the two apart. The
      // /me flow offers no status control on a gone row, and this door agrees with it.
      const current = getJobseekerPosting(id, ws);
      if (current?.status === "gone") {
        return jsonRefusal("APPLY_SELECTION_INVALID", 400, { field: "status", options: [] });
      }
      return jsonRefusal("POSTING_NOT_FOUND", 404);
    }
    return NextResponse.json({ posting: getPostingSummary(id, ws) });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/postings/[id]", "JOBSEEKER_STORE_FAILED");
  }
}
