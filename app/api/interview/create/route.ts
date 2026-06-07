import { NextRequest, NextResponse } from "next/server";
import { createInterviewSession } from "@/app/_lib/db";
import { buildGroundedInterview } from "@/app/_lib/interview-run";
import { safeJsonError } from "@/app/_lib/api-response";
import { coerceLanguage, coerceProviderId, voiceAvailability, type VoiceProviderId } from "@/app/_lib/voice";

export const runtime = "nodejs";

// POST → recruiter creates a candidate-mode voice screen for a pipeline entry.
// Builds grounded interviewer questions (Task 4) and returns a tokenized link
// to hand to the candidate. After the call, /complete runs the scorecard.
export async function POST(request: NextRequest) {
  try {
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): entryId must be a plausibly-sized string and
    // language must look like a language tag — anything else is rejected or
    // dropped rather than passed into the DB layer.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
    if (!entryId || entryId.length > 120) {
      return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    }

    const avail = voiceAvailability();
    // Honor an explicitly requested provider; otherwise prefer a configured one,
    // defaulting to openai.
    const provider: VoiceProviderId =
      coerceProviderId(body.provider) ?? (avail.openai ? "openai" : avail.elevenlabs ? "elevenlabs" : "openai");

    const grounded = await buildGroundedInterview(entryId);
    const session = createInterviewSession({
      provider,
      mode: "candidate",
      entryId,
      candidateLabel: grounded.candidateLabel,
      jobId: grounded.jobId,
      jobTitle: grounded.jobTitle,
      instructions: grounded.instructions,
      runOfShow: grounded.runOfShow,
      durationMin: grounded.durationMin,
      language: coerceLanguage(body.language),
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
    // buildGroundedInterview's not-found is a client-safe business rule, not an
    // internal leak — keep it specific. Everything else (SQLite, automation,
    // prep-generation errors) goes through the generic safe responder so raw
    // err.message never crosses the wire (idea-ab117371).
    if (error instanceof Error && error.message === "pipeline entry not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return safeJsonError(error, "api:interview:create", "INTERVIEW_CREATE_FAILED");
  }
}
