import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, saveJd } from "@/app/_lib/db";
import { runSourceForRole } from "@/app/_lib/devcase-run";
import { ingestStructuredJob } from "./ingest-job";

export const runtime = "nodejs";
export const maxDuration = 60;

// Save a generated JD to the library, turn its role into a structured, matchable
// Job in the corpus (so it ranks like any seeded job), AND make it appear in the
// Pipeline: rank existing candidates against it and seed them at "Sourced".
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      role?: Record<string, unknown>;
      salary?: { suggestedMinimum?: number; suggestedMaximum?: number };
      company?: string;
    };
    const title = (body.title ?? "").trim();
    const markdown = body.body ?? "";
    if (!title || !markdown.trim()) {
      return NextResponse.json({ error: "A title and body are required." }, { status: 400 });
    }

    const { slug } = saveJd({ title, body: markdown });
    const role = body.role ?? {};

    // Ingest the role into the corpus as a structured Job (best-effort).
    let jobIngested = false;
    try {
      jobIngested = await ingestStructuredJob({ slug, title, markdown, role, salary: body.salary, company: body.company });
    } catch {
      /* job ingestion is best-effort — never block the JD save */
    }

    // Best-effort sourcing — never block the save if matching fails.
    let sourced = 0;
    try {
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

    return NextResponse.json({ slug, sourced, jobIngested });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed." }, { status: 500 });
  }
}
