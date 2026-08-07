import { NextRequest, NextResponse } from "next/server";
import { getOpenOfferForEntry } from "@/app/_lib/offers-store";
import { jsonError } from "@/app/_lib/api-response";


// After the recruiter real-clicks "Send offer", the extend mints a token the
// Decisions UI discards. The simulation reads it back here to open the
// candidate's actual /offer/[token] page (and click Accept inside it).
export async function GET(request: NextRequest) {
  try {
    const entryId = new URL(request.url).searchParams.get("entryId");
    if (!entryId) return NextResponse.json({ error: "entryId is required." }, { status: 400 });
    const offer = getOpenOfferForEntry(entryId);
    return NextResponse.json({ token: offer?.token ?? null });
  } catch (error) {
    // Match the four sibling sim routes' try/catch: without it a DB throw becomes an opaque
    // non-JSON 500 that crashes the offer step's .json() instead of surfacing a clean error.
    return jsonError(error, "Failed to read offer link.");
  }
}
