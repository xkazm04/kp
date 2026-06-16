import { NextResponse } from "next/server";
import { listReconsiderQueue } from "@/app/_lib/db";

export const runtime = "nodejs";

// Recruiter-facing "Reconsider" queue (idea-e43fa801): the auto-rejected cohort a
// recruiter can put back for a fresh look. Projects only what the Decisions UI
// renders — the rejection time + the match number the board already shows.
export async function GET() {
  const items = listReconsiderQueue();
  return NextResponse.json({
    items: items.map(({ entry, rejectedAt }) => ({
      id: entry.id,
      candidateLabel: entry.candidateLabel,
      jobTitle: entry.jobTitle,
      archetype: entry.archetype,
      matchScore: entry.matchScore,
      rejectedAt,
    })),
  });
}
