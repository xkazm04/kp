import { NextRequest, NextResponse } from "next/server";
import { createInterviewSession, type InterviewProvider } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";
import { coerceProviderId, defaultInterviewerInstructions, voiceAvailability } from "@/app/_lib/voice";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import {
  caseGroundedInterviewerInstructions,
  DEMO_CASE_SCENARIO,
  REGULAR_DEMO_RUN_OF_SHOW,
  scenarioRunOfShow,
  STUDENT_SCRIPT_MIN,
  studentInterviewerInstructions,
  studentRunOfShow,
} from "@/app/_lib/student-interview";

export const runtime = "nodejs";

type SimMode = "student" | "student-case" | "regular";

// POST → spin up a DEMO voice screen with no pipeline entry, so a recruiter can
// experience the agent-led conversation exactly as a candidate would.
// "student" runs the generic early-career thought-script; "student-case" runs the
// CASE-DESIGNED variant (the middle phases work a shared demo case, the hint comes
// from the case's trap); "regular" runs the standard quick-screen brief. The
// session is mode "candidate" so both providers receive the scripted brief, but
// entryId/jobId stay null: completion stores the transcript and deliberately
// never synthesizes a scorecard or touches the pipeline.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string;
      provider?: string;
      language?: string;
    };
    const mode: SimMode = body.mode === "student" || body.mode === "student-case" ? body.mode : "regular";

    const avail = voiceAvailability();
    const provider: InterviewProvider =
      coerceProviderId(body.provider) ?? (avail.openai ? "openai" : avail.elevenlabs ? "elevenlabs" : "openai");

    let candidateLabel = "Demo candidate";
    let jobTitle = "Senior Backend Engineer (demo)";
    let instructions = defaultInterviewerInstructions({ role: jobTitle });
    let runOfShow: string[] = REGULAR_DEMO_RUN_OF_SHOW;
    let durationMin = QUICK_SCREEN_MIN;
    if (mode === "student") {
      candidateLabel = "Demo student";
      jobTitle = "Junior Backend Developer (demo)";
      instructions = studentInterviewerInstructions({ roleLine: "Junior Backend Developer (entry-eligible)" });
      runOfShow = studentRunOfShow();
      durationMin = STUDENT_SCRIPT_MIN;
    } else if (mode === "student-case") {
      candidateLabel = "Demo student";
      jobTitle = "Junior Backend Developer (case demo)";
      instructions = caseGroundedInterviewerInstructions(DEMO_CASE_SCENARIO);
      runOfShow = scenarioRunOfShow(DEMO_CASE_SCENARIO);
      durationMin = DEMO_CASE_SCENARIO.durationMin;
    }

    const session = createInterviewSession({
      provider,
      mode: "candidate",
      candidateLabel,
      jobTitle,
      instructions,
      runOfShow,
      durationMin,
      language: body.language ?? null,
    });

    return NextResponse.json({
      token: session.token,
      url: `/interview/${session.token}`,
      provider,
      configured: avail[provider],
      simMode: mode,
      candidateLabel: session.candidateLabel,
      jobTitle: session.jobTitle,
      runOfShow: session.runOfShow ?? [],
      durationMin: session.durationMin,
    });
  } catch (error) {
    return jsonError(error, "simulate failed");
  }
}
