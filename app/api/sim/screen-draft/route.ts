import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, setApproval } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError } from "@/app/_lib/api-response";


// Deterministic screening recommendation for the simulation — NO LLM. Sets the
// screening_review approval so a real card appears in the Decisions queue for the
// driver to click "Advance" on (the genuine human-decision gate).
export async function POST(request: NextRequest) {
  try {
    const { entryId } = (await request.json()) as { entryId?: string };
    if (!entryId) return NextResponse.json({ error: "entryId is required." }, { status: 400 });
    // Tenant: look the entry up in the CALLER'S team. Unscoped, this read only ever
    // found DEFAULT-team entries, so on any other team the sim's own freshly created
    // entry came back null and the run died on "Pipeline entry not found" at the
    // screening step — and the scoping doubles as the authorization check, since a
    // stranger's entryId simply doesn't resolve.
    const workspaceId = await currentWorkspace();
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });

    const draft = {
      recommendation: "advance",
      confidence: 72,
      rationale: `Strong fit for ${entry.jobTitle ?? "the role"} — core skills present, seniority aligned.`,
      strengths: ["Relevant stack & domain", "Seniority matches the role"],
      redFlags: [],
    };
    // The entry we just read is the tenant authority for the write (same row, same
    // team) — an unscoped setApproval matched nothing off the default team, so the
    // Decisions queue never got its card and the walk stalled with nothing to advance.
    setApproval(entryId, "screening_review", JSON.stringify(draft), entry.workspaceId);
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return jsonError(error, "Screen draft failed.");
  }
}
