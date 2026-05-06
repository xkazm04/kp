import { NextResponse } from "next/server";
import { loadAnalysis } from "@/app/_lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const found = loadAnalysis(slug);
    if (!found) {
      return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
    }
    return NextResponse.json({
      slug: found.row.slug,
      candidateLabel: found.row.candidate_label,
      jdSlug: found.row.jd_slug,
      score: found.row.score,
      roleFamily: found.row.role_family,
      seniority: found.row.seniority,
      createdAt: found.row.created_at,
      analysis: found.payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load analysis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
