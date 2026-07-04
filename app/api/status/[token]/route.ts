import { NextRequest, NextResponse } from "next/server";
import { getJob, getPipelineEntry } from "@/app/_lib/db";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { candidateStatusFor } from "@/app/_lib/application-status";
import { isRelayConfigured } from "@/app/_lib/comms-truth";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";


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
      // REC-10 — gates the page's "watch your email" promises: with no relay
      // configured no email will ever arrive, so the copy says "the team will
      // reach out" instead. Capability only — no secrets on the public wire.
      relayConfigured: isRelayConfigured(),
    });
  } catch (error) {
    // Raw err.message would surface SQLite internals on a public token route.
    return safeJsonError(error, "api:status", "STATUS_LOOKUP_FAILED");
  }
}
