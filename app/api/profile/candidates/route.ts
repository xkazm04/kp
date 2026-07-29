import { NextResponse } from "next/server";
import { cachedProfileRecords, listAnalysisRecords } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";


// Candidate overview for the Profile tab matrix — a UNION of BOTH candidate stores,
// each row tagged with its `source` so the matrix can group everything into archetype
// columns and mark where a cell came from with a cheap chip (no per-source columns):
//
//   - source "analysis": a saved CV analysis, archetype read off its v2Profile; the
//     cell opens the full Analyze output at /history/<slug>. `score` is the analysis
//     total (0-100).
//   - source "profile": a saved v2 intake profile (previously listed nowhere in the
//     matrix); the cell opens the editor via the ?edit=<id> deep link. A saved profile
//     has no MATCH score — that's an honest null (never fabricated), so it renders a
//     neutral em-dash badge; its readiness lives as `completeness` on the roster.
export async function GET() {
  try {
    const ws = await currentWorkspace();

    const analysisRows = listAnalysisRecords(200, ws).map(({ row, payload }) => {
      const v2 = (payload as { v2Profile?: { archetype?: string } } | null)?.v2Profile;
      return {
        key: `analysis:${row.slug}`,
        source: "analysis" as const,
        slug: row.slug,
        id: null,
        name: row.candidate_label,
        role: row.role_family,
        seniority: row.seniority,
        score: row.score,
        // Honest fail-closed sentinel (NOT "bau"): collapsing an unrouted candidate
        // to "bau" mislabels a fairness-protected class. The matrix renders "unknown"
        // as the "Unrouted" column via archetypeDisplayKey.
        archetype: v2?.archetype ?? "unknown",
      };
    });

    const profileRows = cachedProfileRecords(ws).map(({ row, payload }) => {
      const p = (payload as ProfilePayload | null) ?? {};
      return {
        key: `profile:${row.id}`,
        source: "profile" as const,
        slug: null,
        id: row.id,
        name: row.label,
        role: row.role_family ?? p.roleFamily ?? null,
        seniority: p.seniority ?? null,
        // No match score for a saved profile — null-honest, never fabricated.
        score: null as number | null,
        archetype: row.archetype ?? "unknown",
      };
    });

    return NextResponse.json({ candidates: [...profileRows, ...analysisRows] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list candidates.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
