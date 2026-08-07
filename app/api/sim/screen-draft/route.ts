import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, setApproval } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";


// Deterministic screening recommendation for the simulation — NO LLM. Sets the
// screening_review approval so a real card appears in the Decisions queue for the
// driver to click "Advance" on (the genuine human-decision gate).
export async function POST(request: NextRequest) {
  try {
    const { entryId } = (await request.json()) as { entryId?: string };
    if (!entryId) return NextResponse.json({ error: "entryId is required." }, { status: 400 });
    const entry = getPipelineEntry(entryId);
    if (!entry) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });

    const draft = {
      recommendation: "advance",
      confidence: 72,
      rationale: `Strong fit for ${entry.jobTitle ?? "the role"} — core skills present, seniority aligned.`,
      strengths: ["Relevant stack & domain", "Seniority matches the role"],
      redFlags: [],
    };
    setApproval(entryId, "screening_review", JSON.stringify(draft));
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return jsonError(error, "Screen draft failed.");
  }
}
