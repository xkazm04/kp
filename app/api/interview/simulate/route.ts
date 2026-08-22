import { NextRequest, NextResponse } from "next/server";
import { createInterviewSession } from "@/app/_lib/db/interviews";
import { meterGate } from "@/app/_lib/billing";
import { maxBillableInterviewMin } from "@/app/_lib/billing/enforce";
import { safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { coerceLanguage, defaultInterviewerInstructions, isSelfHostedProvider, pickDefaultProvider, voiceAvailability, type VoiceProviderId } from "@/app/_lib/voice";
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
    const provider: VoiceProviderId = pickDefaultProvider(body.provider, avail);

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

    // Billing hard gate (same meter as a real candidate screen): a simulation mints
    // a REAL voice session and /complete debits its minutes just like /create, so an
    // ungated sim let a near-empty meter burn paid voice on kp's dime. Reserve the
    // WORST CASE /complete can debit for this session — maxBillableInterviewMin =
    // bookedMin*2, the exact ceiling that debit clamps to — not the booked length.
    // Gating on the booked length alone is the under-reservation /create already
    // closed (see enforce.ts::meterGate): a demo booked for 8 minutes can bill 16,
    // so a meter with 8 minutes left passed the gate and landed the overage as
    // unfunded usage on the priciest meter.
    // ...unless the voice is served from a machine we run (ELEVENLABS_BASE_URL →
    // a loopback/private service), where the call spends no allowance to gate.
    // Metering a free simulation would make a self-hosted install run out of a
    // budget it is not consuming — which is the whole reason to self-host.
    // Resolved ONCE and used for both the gate and the session's tenant stamp. A
    // simulation has no pipeline entry, so without this the gate checked the caller's
    // allowance while /complete debited the DEFAULT team's meter — two tenants for one
    // call, and a self-serve org could burn a demo on somebody else's budget.
    const workspace = await currentWorkspace();
    if (!isSelfHostedProvider(provider)) {
      const quota = meterGate("interview_minutes", { minUnits: maxBillableInterviewMin(durationMin), workspace });
      if (quota) return NextResponse.json(quota, { status: 402 });
    }

    const session = createInterviewSession({
      workspaceId: workspace,
      provider,
      mode: "candidate",
      candidateLabel,
      jobTitle,
      instructions,
      runOfShow,
      durationMin,
      // Validate at the trust boundary rather than trusting the cast above
      // (idea-c7df6b55): `body.language` is JSON, not the `string | undefined`
      // the local type asserts. /create and /connect both narrow it through
      // coerceLanguage; this route — the third session MINTER — still stored it
      // verbatim, which is the exact "unbounded attacker-controlled string
      // persisted to the session row and echoed into provider connect calls"
      // that helper was written for.
      language: coerceLanguage(body.language),
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
    // Same class as its siblings (idea-ab117371): this catch sits on better-sqlite3
    // (createInterviewSession, the billing-state read behind meterGate) whose thrown
    // messages carry the db path and constraint names, and `jsonError` forwarded
    // `err.message` verbatim. The route MINTS an interview like /create, so it shares
    // that route's stable code rather than inventing a parallel one.
    return safeJsonError(error, "api:interview:simulate", "INTERVIEW_CREATE_FAILED");
  }
}
