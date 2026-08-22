import { NextRequest, NextResponse } from "next/server";
import { getOpenOfferForEntry } from "@/app/_lib/offers-store";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError } from "@/app/_lib/api-response";


// After the recruiter real-clicks "Send offer", the extend mints a token the
// Decisions UI discards. The simulation reads it back here to open the
// candidate's actual /offer/[token] page (and click Accept inside it).
export async function GET(request: NextRequest) {
  try {
    const entryId = new URL(request.url).searchParams.get("entryId");
    if (!entryId) return NextResponse.json({ error: "entryId is required." }, { status: 400 });
    // Tenant: resolve the entry in the CALLER'S team FIRST, exactly like the two
    // sibling sim routes (screen-draft / offer-draft) — "the scoping doubles as the
    // authorization check, since a stranger's entryId simply doesn't resolve".
    //
    // This route hands back an OFFER CAPABILITY TOKEN, and /api/offer/<token> is a
    // PUBLIC route whose POST accepts or declines on the candidate's behalf. The
    // lookup used to be `getOpenOfferForEntry(entryId)` with no workspace at all, so
    // any caller the proxy admits — including the anonymous demo-workspace session
    // /api/demo mints, and any member of another team once KP_MULTI_WORKSPACE is on —
    // could exchange an entry id for another tenant's live offer link. Entry ids are
    // DERIVED, not secret (`m-<candidateId>-<jobId>` on the default team, see
    // createPipelineEntry), so "you'd have to know the id" was never the guard it
    // looked like. A 404 for an entry outside the caller's team closes it; the
    // simulation only ever asks about the entry its own run just created.
    const workspaceId = await currentWorkspace();
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });

    const offer = getOpenOfferForEntry(entryId);
    // Belt and braces: the offer row carries its own workspace (inherited from the
    // entry at mint), so an offer that somehow disagrees with the entry we just
    // authorized is not this caller's to read either.
    const token = offer && offer.workspaceId === entry.workspaceId ? offer.token : null;
    return NextResponse.json({ token: token ?? null });
  } catch (error) {
    // Match the four sibling sim routes' try/catch: without it a DB throw becomes an opaque
    // non-JSON 500 that crashes the offer step's .json() instead of surfacing a clean error.
    return jsonError(error, "Failed to read offer link.");
  }
}
