import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry } from "@/app/_lib/db";
import { createScheduleInvite } from "@/app/_lib/schedule-store";

export const runtime = "nodejs";

// POST → recruiter mints a self-scheduling link for a pipeline entry. The
// candidate opens /schedule/<token> and picks a slot.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { entryId?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    const entry = getPipelineEntry(body.entryId);
    if (!entry) return NextResponse.json({ error: "pipeline entry not found" }, { status: 404 });

    const invite = createScheduleInvite({
      entryId: entry.id,
      candidateLabel: entry.candidateLabel,
      jobTitle: entry.jobTitle,
    });
    return NextResponse.json({ token: invite.token, url: `/schedule/${invite.token}` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invite failed" }, { status: 500 });
  }
}
