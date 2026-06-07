import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, listPipeline, PIPELINE_STAGES } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ entries: listPipeline(), stages: PIPELINE_STAGES });
  } catch (error) {
    return safeJsonError(error, "api:pipeline", "PIPELINE_LIST_FAILED");
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
    // Reject an unknown stage at the boundary: createPipelineEntry inserts any
    // string, but PipelineBoard only renders lanes for PIPELINE_STAGES, so a typo'd
    // or renamed stage would persist then silently vanish from the board. Omitting
    // stage is fine — createPipelineEntry defaults it to "Screened".
    if (body.stage !== undefined && !(PIPELINE_STAGES as readonly string[]).includes(body.stage)) {
      return NextResponse.json(
        { error: `Unknown stage "${body.stage}". Expected one of: ${PIPELINE_STAGES.join(", ")}.` },
        { status: 400 }
      );
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
    // Raw err.message surfaces better-sqlite3 internals (constraint names, the
    // absolute db path) — log server-side, return the generic catalogue message.
    return safeJsonError(error, "api:pipeline", "PIPELINE_CREATE_FAILED");
  }
}
