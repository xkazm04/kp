import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jdSlugOfJobId } from "@/app/_lib/jd-limits";
import { jdLastEditedAt } from "@/app/_lib/db";

// Direction 2 (queue-staleness) — the JD content-freshness fact the AI review
// cards need to flag a score computed BEFORE the JD was last edited. The client
// already holds each entry's score timestamp (scoreProvenance.at); this supplies
// the OTHER half — the JD's last content-edit time per job — so the card applies
// the same isScoreStale rule the library roster + prep chips use. Server derives
// the JD fact (workspace-scoped, the honest jdLastEditedAt over jd_revisions), the
// client renders. Operator-gated + tenant-scoped like the rest of /api/decisions/*.
export async function GET(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  const ws = await currentWorkspace();
  const raw = new URL(request.url).searchParams.get("jobs") ?? "";
  // De-duped, trimmed, capped — a corpus/non-JD-backed job resolves to null (no chip).
  const jobIds = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 200);
  const editedAt: Record<string, string | null> = {};
  for (const jobId of jobIds) {
    const slug = jdSlugOfJobId(jobId);
    editedAt[jobId] = slug ? jdLastEditedAt(slug, ws) : null;
  }
  return NextResponse.json({ editedAt });
}
