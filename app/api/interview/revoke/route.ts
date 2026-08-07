import { NextRequest, NextResponse } from "next/server";
import { revokeOpenInterviewSessions } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";


// W6-4 (VOX1) — recruiter-triggered revoke: pull every open interview link for
// an entry (wrong candidate, changed mind, link shared too widely) without
// minting a replacement. /connect refuses revoked sessions; the portal shows a
// friendly closed message.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
    if (!entryId || entryId.length > 120) {
      return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    }
    const revoked = revokeOpenInterviewSessions(entryId);
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    return safeJsonError(error, "api:interview:revoke", "INTERVIEW_CREATE_FAILED");
  }
}
