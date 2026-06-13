import { NextRequest, NextResponse } from "next/server";
import { getJob, getPipelineEntry } from "@/app/_lib/db";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { candidateStatusFor } from "@/app/_lib/application-status";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// Public, token-gated candidate application status (idea-e76a6fb2). Returns a
// candidate-safe projection only — the friendly status, the role title/company,
// and when it last changed. Never the internal entry id, candidate name, score,
// archetype, or reasoning.
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const entryId = getEntryIdByStatusToken(token);
    if (!entryId) return NextResponse.json({ error: "not found" }, { status: 404 });
    const entry = getPipelineEntry(entryId);
    if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
    const company = entry.jobId ? getJob(entry.jobId)?.company ?? null : null;
    return jsonOk({
      status: candidateStatusFor(entry.status, entry.stage),
      jobTitle: entry.jobTitle ?? null,
      company,
      updatedAt: entry.stageChangedAt ?? entry.createdAt ?? null,
    });
  } catch (error) {
    // Raw err.message would surface SQLite internals on a public token route.
    return safeJsonError(error, "api:status", "STATUS_LOOKUP_FAILED");
  }
}
