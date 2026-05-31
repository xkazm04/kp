import { NextRequest, NextResponse } from "next/server";
import { getOpenOfferForEntry } from "@/app/_lib/offers-store";

export const runtime = "nodejs";

// After the recruiter real-clicks "Send offer", the extend mints a token the
// Decisions UI discards. The simulation reads it back here to open the
// candidate's actual /offer/[token] page (and click Accept inside it).
export async function GET(request: NextRequest) {
  const entryId = new URL(request.url).searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId is required." }, { status: 400 });
  const offer = getOpenOfferForEntry(entryId);
  return NextResponse.json({ token: offer?.token ?? null });
}
