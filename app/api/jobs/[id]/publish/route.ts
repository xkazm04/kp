import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, getJob } from "@/app/_lib/db";
import { getJobStatus, setJobStatus } from "@/app/_lib/job-ingest";
import { runSourceForRole } from "@/app/_lib/devcase-run";

export const runtime = "nodejs";
export const maxDuration = 60;

// Publish a draft job: flip its status to 'published' and source candidates into
// the pipeline (the step that used to happen implicitly on save). Idempotent —
// re-publishing doesn't re-source.
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const already = getJobStatus(id) === "published";
    setJobStatus(id, "published");

    let sourced = 0;
    if (!already) {
      try {
        const reqs = ((job as { requirements?: { skill: string; kind?: string }[] }).requirements ?? []);
        const role = {
          title: job.title,
          seniority: job.seniority,
          roleFamily: job.roleFamily,
          languages: job.languages ?? [],
          mustHaves: reqs.filter((r) => r.kind !== "nice_to_have").map((r) => r.skill),
          niceToHaves: reqs.filter((r) => r.kind === "nice_to_have").map((r) => r.skill),
          responsibilities: job.description ? [job.description] : [],
        };
        for (const m of await runSourceForRole(role)) {
          if (!m.candidateId) continue;
          createPipelineEntry({
            candidateId: m.candidateId,
            candidateLabel: m.label,
            archetype: m.archetype,
            roleFamily: job.roleFamily ?? null,
            jobId: id,
            jobTitle: job.title,
            matchScore: m.score,
            stage: "Sourced",
          });
          sourced += 1;
        }
      } catch {
        /* sourcing is best-effort — publishing still succeeds */
      }
    }

    return NextResponse.json({ ok: true, status: "published", sourced, alreadyPublished: already });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Publish failed." }, { status: 500 });
  }
}
