import { NextResponse } from "next/server";
import { listReconsiderQueue } from "@/app/_lib/db";
import { requireOperator } from "@/app/_lib/auth/require-operator";


// Recruiter-facing "Reconsider" queue (idea-e43fa801): the auto-rejected cohort a
// recruiter can put back for a fresh look. Projects only what the Decisions UI
// renders — the rejection time + the match number the board already shows.
// Operator-gated (backlog #30 / SD-L1-010): rejected candidates' names/roles are
// adverse-action data, so the handler re-verifies the session (and rejects the
// anonymous demo session) like the rest of /api/decisions/*.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
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
