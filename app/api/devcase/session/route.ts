import { NextResponse } from "next/server";
import { countRecentDevSessionsForToken, getPostingByToken, startDevSession } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";

// bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2): a per-token/day session
// throttle. Apply tokens are shareable public links, so an unauthenticated holder could
// mint unbounded sessions (each then flushing events) — a cheap storage-exhaustion vector.
// The cap is generous vs. legitimate use: one posting rarely sees this many genuine live
// starts in a day, so real candidates are never blocked.
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_SESSIONS_PER_TOKEN_DAY = 50;

// Live Work Surface (moonshot E) — start an in-product work session for a dev-case
// apply token. Validates the token maps to an OPEN posting (don't orphan sessions
// against a closed/missing posting), then mints a session.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown; candidateRef?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
    const posting = getPostingByToken(token);
    if (!posting || posting.status === "closed") {
      return NextResponse.json({ error: "This case is not accepting submissions." }, { status: 404 });
    }
    // Per-token/day throttle (bug-ui-scan-2026-07-09 #2): reject once a token has minted
    // its daily quota of sessions, so a leaked link can't amplify into unbounded rows.
    const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
    if (countRecentDevSessionsForToken(token, since) >= MAX_SESSIONS_PER_TOKEN_DAY) {
      return NextResponse.json({ error: "Too many sessions started for this case. Try again later." }, { status: 429 });
    }
    const candidateRef = typeof body.candidateRef === "string" ? body.candidateRef.trim() || null : null;
    const session = startDevSession({ token, candidateRef });
    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    return jsonError(error, "Failed to start the work session.");
  }
}
