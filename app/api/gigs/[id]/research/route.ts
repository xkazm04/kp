import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGig } from "@/app/_lib/db/gigs";
import { researchGig } from "@/app/_lib/gigs/research";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/gigs/[id]/research - re-run research for ONE gig, now (gigs/research.ts): read
// the links its listing names (egress-vetted, through the politeFetch door or the GitHub
// reader, at most three), run the honeypot scan over every page, and write a fresh brief -
// the model's when a provider answers, the deterministic one otherwise. This is also how a
// deterministic brief is upgraded once a key arrives: the scan never re-researches a gig
// that already has a brief.
//
// Synchronous and bounded by research's own 90-second budget (GIG_RESEARCH_BUDGET_MS):
// the page reads stop between links when it runs out, and the model call is not started
// without 15 seconds left. `next start` never kills a long handler, so this bound is the
// real one.
//
//   200 { gig }  - the gig as stored, with its new `brief`
//   404 GIG_NOT_FOUND · 500 GIG_STORE_FAILED
//
// Throttled per IP BEFORE any read: every accepted call makes third-party page reads under
// the politeness budget the install shares, and may spend a model call.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-research:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    // Not bound to request.signal: a client that walks away mid-read would otherwise leave
    // a "budget" deterministic brief in place of a model brief it already had.
    const out = await researchGig(ws, gig);
    if (!out.gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    return NextResponse.json({ gig: out.gig });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/research", "GIG_STORE_FAILED");
  }
}
