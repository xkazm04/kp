import { NextRequest, NextResponse } from "next/server";
import { createInterviewSession, type InterviewProvider } from "@/app/_lib/db";
import { buildGroundedInterview } from "@/app/_lib/interview-run";
import { jsonError } from "@/app/_lib/api-response";
import { coerceProviderId, voiceAvailability } from "@/app/_lib/voice";

export const runtime = "nodejs";

// POST → recruiter creates a candidate-mode voice screen for a pipeline entry.
// Builds grounded interviewer questions (Task 4) and returns a tokenized link
// to hand to the candidate. After the call, /complete runs the scorecard.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      entryId?: string;
      provider?: string;
      language?: string;
    };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const avail = voiceAvailability();
    // Honor an explicitly requested provider; otherwise prefer a configured one,
    // defaulting to openai.
    const provider: InterviewProvider =
      coerceProviderId(body.provider) ?? (avail.openai ? "openai" : avail.elevenlabs ? "elevenlabs" : "openai");

    const grounded = await buildGroundedInterview(body.entryId);
    const session = createInterviewSession({
      provider,
      mode: "candidate",
      entryId: body.entryId,
      candidateLabel: grounded.candidateLabel,
      jobId: grounded.jobId,
      jobTitle: grounded.jobTitle,
      instructions: grounded.instructions,
      runOfShow: grounded.runOfShow,
      durationMin: grounded.durationMin,
      language: body.language ?? null,
    });

    return NextResponse.json({
      token: session.token,
      url: `/interview/${session.token}`,
      provider,
      configured: avail[provider],
      candidateLabel: session.candidateLabel,
      jobTitle: session.jobTitle,
    });
  } catch (error) {
    return jsonError(error, "create failed");
  }
}
