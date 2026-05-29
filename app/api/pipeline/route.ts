import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, listPipeline, PIPELINE_STAGES } from "@/app/_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ entries: listPipeline(), stages: PIPELINE_STAGES });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load pipeline.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      candidateId?: string;
      candidateLabel?: string;
      archetype?: string | null;
      roleFamily?: string | null;
      jobId?: string;
      jobTitle?: string;
      matchScore?: number | null;
      stage?: string;
    };
    if (!body.candidateId || !body.jobId) {
      return NextResponse.json({ error: "candidateId and jobId are required." }, { status: 400 });
    }
    const result = createPipelineEntry({
      candidateId: body.candidateId,
      candidateLabel: body.candidateLabel || body.candidateId,
      archetype: body.archetype ?? null,
      roleFamily: body.roleFamily ?? null,
      jobId: body.jobId,
      jobTitle: body.jobTitle || body.jobId,
      matchScore: body.matchScore ?? null,
      stage: body.stage,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add to pipeline.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
