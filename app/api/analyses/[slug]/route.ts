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
    // Log the full error server-side; return a generic, stable message so the
    // SQLite path and engine internals never reach the client.
    console.error(`[api:analyses] failed to load analysis "${slug}"`, error);
    return NextResponse.json({ error: "Failed to load analysis." }, { status: 500 });
  }
}
