import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, getJob, listMatrixProfiles, listPipeline } from "@/app/_lib/db";

export const runtime = "nodejs";

// Simulate an inbound application arriving via a channel (the careers/apply page):
// a candidate lands at "Accepted" — the new pipeline front for inbound apps.
export async function POST(request: NextRequest) {
  try {
    const { jobId } = (await request.json()) as { jobId?: string };
    if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // Pick someone not already in this job's pipeline as the "applicant".
    const inPipeline = new Set(listPipeline().filter((e) => e.jobId === jobId).map((e) => e.candidateId));
    const applicant = listMatrixProfiles(200).find((p) => !inPipeline.has(p.id));
    if (!applicant) return NextResponse.json({ error: "No available applicant." }, { status: 404 });

    // Deterministic mid score so the inbound applicant survives screening (demo).
    const score = 62 + (applicant.id.charCodeAt(applicant.id.length - 1) % 10);
    const { entry } = createPipelineEntry({
      candidateId: applicant.id,
      candidateLabel: applicant.label,
      archetype: applicant.archetype,
      roleFamily: job.roleFamily ?? null,
      jobId,
      jobTitle: job.title,
      matchScore: score,
      stage: "Accepted",
    });
    return NextResponse.json({ ok: true, label: applicant.label, score, entryId: entry.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inbound failed." }, { status: 500 });
  }
}
