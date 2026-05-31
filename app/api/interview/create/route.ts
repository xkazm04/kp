import { NextRequest, NextResponse } from "next/server";
import { createInterviewSession, type InterviewProvider } from "@/app/_lib/db";
import { buildGroundedInterview } from "@/app/_lib/interview-run";
import { voiceAvailability } from "@/app/_lib/voice";

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
    const provider: InterviewProvider =
      body.provider === "elevenlabs"
        ? "elevenlabs"
        : body.provider === "openai"
          ? "openai"
          : avail.openai
            ? "openai"
            : avail.elevenlabs
              ? "elevenlabs"
              : "openai";

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
    return NextResponse.json({ error: error instanceof Error ? error.message : "create failed" }, { status: 500 });
  }
}
