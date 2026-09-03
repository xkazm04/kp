import { NextResponse } from "next/server";
import { countRecentDevSessionsForToken, devSessionWatermark, getPostingByToken, startDevSession } from "@/app/_lib/db/devcase";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
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
    // A PUBLIC door rendered in en/cs/de/fr for someone with no account: "token is
    // required" was bare English with no code, so the work surface had nothing to
    // resolve and painted the server's sentence (or nothing at all) at the reader.
    if (!token) return jsonRefusal("DEVCASE_APPLY_TOKEN_REQUIRED", 400);
    const posting = getPostingByToken(token);
    if (!posting || posting.status === "closed") {
      // A CODE, not English prose: this is a public candidate surface the app renders
      // in cs/de/fr, and the work surface resolves the code through the reader's
      // `errors` catalog. The two causes stay lumped on purpose (see the code's note in
      // api-response.ts) — separating them would make this an apply-token oracle.
      return jsonRefusal("DEVCASE_SESSION_UNAVAILABLE", 404);
    }
    // Per-token/day throttle (bug-ui-scan-2026-07-09 #2): reject once a token has minted
    // its daily quota of sessions, so a leaked link can't amplify into unbounded rows.
    const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
    if (countRecentDevSessionsForToken(token, since) >= MAX_SESSIONS_PER_TOKEN_DAY) {
      return jsonRefusal("DEVCASE_SESSION_QUOTA", 429);
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
    // The thrown message here is better-sqlite3 detail plus the absolute db path,
    // on an unauthenticated candidate surface. Log it, answer the code.
    return safeJsonError(error, "api:devcase/session", "DEVCASE_SESSION_START_FAILED");
  }
}
