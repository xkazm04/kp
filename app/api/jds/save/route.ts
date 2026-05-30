import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, saveJd } from "@/app/_lib/db";
import { runSourceForRole } from "@/app/_lib/devcase-run";

export const runtime = "nodejs";
export const maxDuration = 60;

// Save a generated JD to the library AND make the role appear in the Pipeline:
// rank existing candidates against it (runSourceForRole) and seed them at the
// "Sourced" stage. The position then also shows as a Matrix column.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      role?: Record<string, unknown>;
    };
    const title = (body.title ?? "").trim();
    const markdown = body.body ?? "";
    if (!title || !markdown.trim()) {
      return NextResponse.json({ error: "A title and body are required." }, { status: 400 });
    }

    const { slug } = saveJd({ title, body: markdown });

    // Best-effort sourcing — never block the save if matching fails.
    let sourced = 0;
    try {
      const role = body.role ?? {};
      const roleFamily = (role.roleFamily as string) ?? "software_engineering";
      for (const m of await runSourceForRole(role)) {
        if (!m.candidateId) continue;
        createPipelineEntry({
          candidateId: m.candidateId,
          candidateLabel: m.label,
          archetype: m.archetype,
          roleFamily,
          jobId: `jd-${slug}`,
          jobTitle: title,
          matchScore: m.score,
          stage: "Sourced",
        });
        sourced += 1;
      }
    } catch {
      /* sourcing is best-effort */
    }

    return NextResponse.json({ slug, sourced });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed." }, { status: 500 });
  }
}
