import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, listOutboxFiltered } from "@/app/_lib/db";
import { coerceOutboxStatus } from "@/app/_lib/comms-status";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// W6-2 (SIM1) — the recruiter comms read. Every candidate-facing message (8
// kinds) lands in dev_outbox with ref = pipeline entry id, but the only UI was
// the Dev tab's display-only table: "what did this candidate actually receive?"
// and "did anything fail to send?" needed server logs. This serves the Comms
// Center on Channels and the drawer's Messages section.
// ?entry=<id> scopes to one candidate; ?status=failed is the dead-letter view.
export async function GET(request: NextRequest) {
  try {
    const entry = request.nextUrl.searchParams.get("entry")?.trim() || undefined;
    const statusRaw = request.nextUrl.searchParams.get("status")?.trim();
    const status = statusRaw ? coerceOutboxStatus(statusRaw) : undefined;
    const messages = listOutboxFiltered({ ref: entry, status, limit: 200 });

    // Resolve each distinct ref to the candidate it names, so the center can
    // group/label rows without N client round-trips. Refs that aren't pipeline
    // entries (e.g. dev-case submission ids) resolve to null and render raw.
    const entries: Record<string, { label: string; jobTitle: string | null }> = {};
    for (const m of messages) {
      if (!m.ref || entries[m.ref] !== undefined) continue;
      const e = getPipelineEntry(m.ref);
      if (e) entries[m.ref] = { label: e.candidateLabel, jobTitle: e.jobTitle };
    }
    return NextResponse.json({ messages, entries });
  } catch (error) {
    return safeJsonError(error, "api:comms", "OUTREACH_FAILED");
  }
}
