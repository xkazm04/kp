import { NextRequest, NextResponse } from "next/server";
import { createInterviewSession, type InterviewProvider } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";
import { coerceProviderId, defaultInterviewerInstructions, voiceAvailability } from "@/app/_lib/voice";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import {
  REGULAR_DEMO_RUN_OF_SHOW,
  STUDENT_SCRIPT_MIN,
  studentInterviewerInstructions,
  studentRunOfShow,
} from "@/app/_lib/student-interview";

export const runtime = "nodejs";

// POST → spin up a DEMO voice screen with no pipeline entry, so a recruiter can
// experience the agent-led conversation exactly as a candidate would.
// "student" runs the early-career thought-script (the agent LEADS phase by
// phase, including the deliberate coachability hint); "regular" runs the
// standard quick-screen brief. The session is mode "candidate" so both
// providers receive the scripted brief, but entryId/jobId stay null: completion
// stores the transcript and deliberately never synthesizes a scorecard or
// touches the pipeline.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string;
      provider?: string;
      language?: string;
    };
    const student = body.mode === "student";

    const avail = voiceAvailability();
    const provider: InterviewProvider =
      coerceProviderId(body.provider) ?? (avail.openai ? "openai" : avail.elevenlabs ? "elevenlabs" : "openai");

    const jobTitle = student ? "Junior Backend Developer (demo)" : "Senior Backend Engineer (demo)";
    const session = createInterviewSession({
      provider,
      mode: "candidate",
      candidateLabel: student ? "Demo student" : "Demo candidate",
      jobTitle,
      instructions: student
        ? studentInterviewerInstructions({ roleLine: "Junior Backend Developer (entry-eligible)" })
        : defaultInterviewerInstructions({ role: jobTitle }),
      runOfShow: student ? studentRunOfShow() : REGULAR_DEMO_RUN_OF_SHOW,
      durationMin: student ? STUDENT_SCRIPT_MIN : QUICK_SCREEN_MIN,
      language: body.language ?? null,
    });

    return NextResponse.json({
      token: session.token,
      url: `/interview/${session.token}`,
      provider,
      configured: avail[provider],
      simMode: student ? "student" : "regular",
      candidateLabel: session.candidateLabel,
      jobTitle: session.jobTitle,
      runOfShow: session.runOfShow ?? [],
      durationMin: session.durationMin,
    });
  } catch (error) {
    return jsonError(error, "simulate failed");
  }
}
