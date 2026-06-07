import { NextRequest, NextResponse } from "next/server";
import { getDevCase } from "@/app/_lib/db";

export const runtime = "nodejs";

// GET → the case's materialized seed ({files: [{path, contents}], note}) — the
// concrete starter tree every candidate receives. Read-only; the seed is
// generated once by the lifecycle (seed_materializer.py) so distribution and the
// recruiter UI read ONE shared fixture rather than re-materializing per request.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const devCase = getDevCase(id);
  if (!devCase) return NextResponse.json({ error: "dev case not found" }, { status: 404 });
  if (!devCase.seed) return NextResponse.json({ error: "no materialized seed for this case yet" }, { status: 404 });
  return NextResponse.json({ caseId: id, seed: devCase.seed });
}
