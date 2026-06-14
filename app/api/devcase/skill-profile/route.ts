import { NextResponse } from "next/server";
import { issueSkillProfile } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// Durable Skill Profile (moonshot A) — mint a signed credential from an evaluated
// dev-case submission (recruiter-triggered from the dev studio). Idempotent per
// submission. Returns the candidate-owned token for the public score-card.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { submissionId?: unknown };
    const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
    if (!submissionId) return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
    const result = issueSkillProfile(submissionId);
    if (!result.ok) {
      return result.reason === "not_found"
        ? NextResponse.json({ error: "Submission not found." }, { status: 404 })
        : NextResponse.json({ error: "Only an evaluated submission can mint a Durable Skill Profile." }, { status: 409 });
    }
    return NextResponse.json({ token: result.token, created: result.created });
  } catch (error) {
    return jsonError(error, "Failed to issue the skill profile.");
  }
}
