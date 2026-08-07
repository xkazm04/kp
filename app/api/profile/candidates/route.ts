import { NextResponse } from "next/server";
import { listAnalysisRecords } from "@/app/_lib/db";


// Candidate overview for the Profile tab matrix: every saved CV analysis with
// the archetype it was routed to (read off its v2Profile), so the UI can group
// candidates into archetype columns. A click on a row opens that analysis's full
// Analyze output at /history/<slug>. score/role come straight off the analysis.
export async function GET() {
  try {
    const records = listAnalysisRecords(200);
    const candidates = records.map(({ row, payload }) => {
      const v2 = (payload as { v2Profile?: { archetype?: string } } | null)?.v2Profile;
      return {
        slug: row.slug,
        name: row.candidate_label,
        role: row.role_family,
        seniority: row.seniority,
        score: row.score,
        archetype: v2?.archetype ?? "bau",
      };
    });
    return NextResponse.json({ candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list candidates.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
