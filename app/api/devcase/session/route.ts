import { NextResponse } from "next/server";
import { countRecentDevSessionsForToken, devSessionWatermark, getPostingByToken, startDevSession } from "@/app/_lib/db/devcase";
import { jsonError } from "@/app/_lib/api-response";
// The per-token/day session throttle lives in a sibling module: Next's generated
// route types reject any non-handler `export const` here (backlog item 57).
import { MAX_SESSIONS_PER_TOKEN_DAY, SESSION_WINDOW_MS } from "./session-limits";

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
    // LLM-era controls #4 — the per-session watermark. The work surface stamps it
    // into the DECISIONS log as an innocuous session reference; evaluation scans
    // submissions for FOREIGN marks (a circulated/relayed solution). Derived, never
    // stored; disclosing the candidate's own mark to them is fine — absence is a
    // mild note, a foreign mark is the decisive tell.
    return NextResponse.json({ sessionId: session.id, watermark: devSessionWatermark(session.id) });
  } catch (error) {
    return jsonError(error, "Failed to start the work session.");
  }
}
