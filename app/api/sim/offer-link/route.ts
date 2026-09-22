import { NextRequest, NextResponse } from "next/server";
import { openSimOfferToken, resolveSimEntry } from "@/app/_lib/sim-entry";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";


// After the recruiter real-clicks "Send offer", the extend mints a token the
// Decisions UI discards. The simulation reads it back here to open the
// candidate's actual /offer/[token] page (and click Accept inside it).
export async function GET(request: NextRequest) {
  try {
    const entryId = new URL(request.url).searchParams.get("entryId");
    if (!entryId) return jsonRefusal("SIM_ENTRY_REQUIRED", 400);
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
    //
    // And the team is not enough on its own: this door asks no capability, so a viewer
    // seat reaches it too, and a REAL candidate's offer token in a viewer's hands is an
    // accept/decline on that candidate's behalf. resolveSimEntry admits only a
    // (SIM)-marked entry, so a real id 404s exactly like a missing one (sim-entry.ts).
    const workspaceId = await currentWorkspace();
    const entry = resolveSimEntry(entryId, workspaceId);
    if (!entry) return jsonRefusal("SIM_ENTRY_NOT_FOUND", 404);

    // openSimOfferToken keeps the belt and braces: the offer row carries its own
    // workspace (inherited from the entry at mint), so an offer that disagrees with
    // the entry we just authorized is not this caller's to read either.
    return NextResponse.json({ token: openSimOfferToken(entry) });
  } catch (error) {
    // Match the four sibling sim routes' try/catch: without it a DB throw becomes an opaque
    // non-JSON 500 that crashes the offer step's .json() instead of surfacing a clean error.
    return safeJsonError(error, "api:sim/offer-link", "SIM_OFFER_LINK_FAILED");
  }
}
