import { NextResponse } from "next/server";
import { loadAnalysis, setAnalysisDisposition } from "@/app/_lib/db";

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
      disposition: found.row.disposition ?? null,
      decisionNote: found.row.decision_note ?? null,
      analysis: found.payload,
    });
  } catch (error) {
    // Log the full error server-side; return a generic, stable message so the
    // SQLite path and engine internals never reach the client.
    console.error(`[api:analyses] failed to load analysis "${slug}"`, error);
    return NextResponse.json({ error: "Failed to load analysis." }, { status: 500 });
  }
}

// PATCH → record the recruiter's disposition + note on this analysis (RES5).
// disposition: "advance" | "hold" | "pass" (anything else, incl. "", clears it).
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { disposition?: unknown; note?: unknown };
    const disposition = typeof body.disposition === "string" ? body.disposition : "";
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
    const ok = setAnalysisDisposition(slug, disposition, note);
    if (!ok) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api:analyses] failed to set disposition "${slug}"`, error);
    return NextResponse.json({ error: "Failed to save the decision." }, { status: 500 });
  }
}
