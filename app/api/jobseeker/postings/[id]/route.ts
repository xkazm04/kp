import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getPostingSummary, setPostingStatus } from "@/app/_lib/db/jobseeker-postings";
import { DISMISS_REASONS, isDismissReason, isPostingStatus } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// PATCH /api/jobseeker/postings/[id] { status, dismissReason?, note? } — the seeker's own
// status move (WP4c): shortlisted / applied / dismissed / new. `dismissed` REQUIRES a
// `dismissReason` from DISMISS_REASONS — the reason is what the feed learns from — else
// 400. Answers the refreshed summary row so the feed can replace it in place.
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
    if (!setPostingStatus(id, body.status, dismiss, ws)) return jsonRefusal("POSTING_NOT_FOUND", 404);
    return NextResponse.json({ posting: getPostingSummary(id, ws) });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/postings/[id]", "JOBSEEKER_STORE_FAILED");
  }
}
