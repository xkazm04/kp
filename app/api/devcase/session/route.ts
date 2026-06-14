import { NextResponse } from "next/server";
import { getPostingByToken, startDevSession } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

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
    const candidateRef = typeof body.candidateRef === "string" ? body.candidateRef.trim() || null : null;
    const session = startDevSession({ token, candidateRef });
    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    return jsonError(error, "Failed to start the work session.");
  }
}
