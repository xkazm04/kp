import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { listRecentInterviewSessions } from "@/app/_lib/db/interviews";
import { safeJsonError } from "@/app/_lib/api-response";

// Workspace-wide AI-interview history for the Schedule tab's AI-round ledger:
// candidate-mode sessions newest-first as summary rows (verdict + timing +
// has-transcript, never the transcript blob). Operator-gated + tenant-scoped
// like the rest of /api/interview/*.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    return NextResponse.json({ sessions: listRecentInterviewSessions(ws) });
  } catch (error) {
    return safeJsonError(error, "api:interview:sessions", "INTERVIEW_LOOKUP_FAILED");
  }
}
