import { NextResponse } from "next/server";
import {
  loadAnalysis,
  parseStoredGithubAnalysis,
  recordAnalysisDispositionEvents,
  setAnalysisDisposition,
  setAnalysisGithub,
} from "@/app/_lib/db";
import { githubAnalysisSchema } from "@/app/_lib/schemas";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

export const runtime = "nodejs";

// Defensive ceiling for an attached GitHub payload. A real GithubAnalysis is
// tens of KB; anything near this is malformed or hostile, not a deep-dive.
const MAX_GITHUB_JSON_BYTES = 256 * 1024;

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const found = loadAnalysis(slug, await currentWorkspace());
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
      // GH1 — the attached GitHub deep-dive, when one was persisted. Parsed
      // defensively: a corrupt column yields null, never a 500.
      githubAnalysis: parseStoredGithubAnalysis(found.row.github_json, slug),
    });
  } catch (error) {
    // Log the full error server-side; return a generic, stable message so the
    // SQLite path and engine internals never reach the client.
    console.error(`[api:analyses] failed to load analysis "${slug}"`, error);
    return NextResponse.json({ error: "Failed to load analysis." }, { status: 500 });
  }
}

// PATCH → record the recruiter's disposition + note on this analysis (RES5),
// OR attach the GitHub deep-dive result (GH1). The two writes are independent:
// a body carrying `githubAnalysis` is the deep-dive attach (validated against
// githubAnalysisSchema so only a real payload is ever persisted); otherwise
// disposition semantics are unchanged ("advance"|"hold"|"pass", else clears).
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as {
      disposition?: unknown;
      note?: unknown;
      githubAnalysis?: unknown;
    };

    if (body.githubAnalysis !== undefined) {
      const parsed = githubAnalysisSchema.safeParse(body.githubAnalysis);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid GitHub analysis payload." }, { status: 400 });
      }
      const json = JSON.stringify(parsed.data);
      if (json.length > MAX_GITHUB_JSON_BYTES) {
        return NextResponse.json({ error: "GitHub analysis payload too large." }, { status: 413 });
      }
      const ok = setAnalysisGithub(slug, json, ws);
      if (!ok) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    const disposition = typeof body.disposition === "string" ? body.disposition : "";
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
    const ok = setAnalysisDisposition(slug, disposition, note, ws);
    if (!ok) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
    // d95fed6d — echo the decision onto the candidate's pipeline record(s) so
    // it shows in the drawer history instead of living only on the history
    // page. Best-effort and clear-skipping: clearing a disposition isn't a
    // decision worth narrating, and a failed echo must not fail the save.
    if (disposition) {
      try {
        const saved = loadAnalysis(slug, ws);
        if (saved) recordAnalysisDispositionEvents(saved.row.candidate_label, disposition, note);
      } catch (error) {
        console.error(`[api:analyses] disposition echo failed for "${slug}"`, error);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api:analyses] failed to update analysis "${slug}"`, error);
    return NextResponse.json({ error: "Failed to save the decision." }, { status: 500 });
  }
}
