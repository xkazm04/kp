import { NextResponse } from "next/server";
import { getActiveRegimeId } from "@/app/_lib/decision-config-store";

export const runtime = "nodejs";

// P1-1 — the workspace's active compliance jurisdiction, read by the public
// candidate-facing AiDisclosure (a client component that can't reach the DB) so
// the transparency note names the right legal framework. Returns only the regime
// id — no candidate data — so it's safe to expose unauthenticated, like the rest
// of the public apply/offer/interview token surfaces that render the disclosure.
export async function GET() {
  return NextResponse.json({ jurisdiction: getActiveRegimeId() });
}
