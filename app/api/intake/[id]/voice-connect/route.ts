import { NextRequest, NextResponse } from "next/server";
import { getIntake } from "@/app/_lib/db/intakes";
import { intakeVoiceBrief } from "@/app/_lib/intake-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getVoiceAdapter, isSelfHostedVoice, missingVoiceEnv, voiceAvailability } from "@/app/_lib/voice";
import { rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// Voice plane for the role-intake dialog (docs/features/intake/README.md):
// mint short-lived OpenAI Realtime credentials so the requestor can TALK the
// intake instead of typing it. AUTHENTICATED-internal — this is the operator's
// own workspace session, so the candidate-link machinery (token, consent
// record, expiry/revoke, minute billing) deliberately does not apply; the
// guards that remain are the ones about money and tenancy.
//
// v1 is OPENAI-ONLY by design: OpenAI receives the intake brief SERVER-SIDE in
// the session config, while ElevenLabs' signed-url flow takes its prompt
// override from the CLIENT — a seam we don't need to open for an internal
// surface (the interview feature carries a whole candidate-safe-brief
// apparatus for it; the intake brief is internal and stays off the wire).

// GET → provider availability (the mic button enables/disables from this).
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ availability: voiceAvailability() });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    if (!intake) return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    if (intake.status !== "open") {
      return NextResponse.json({ error: "This intake session is closed." }, { status: 409 });
    }

    // THROTTLE (rate-limit-contract.test.ts): credential minting burns provider
    // credits — the same "most expensive operation" premise as
    // /api/interview/connect, so the same budget: 6/10min per intake (one start
    // + five reconnects after dropped calls), raised on self-hosted voice where
    // nothing billable is minted. Keyed by intake id, not IP (an operator's
    // legitimate retries share a NAT with the whole office). Sits AFTER the
    // 404/409 lifecycle refusals and BEFORE the adapter mint.
    const voiceConnectLimit = isSelfHostedVoice() ? 120 : 6;
    if (!rateLimit(`intake-voice-connect:${id}`, { limit: voiceConnectLimit, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const adapter = getVoiceAdapter("openai");
    if (!adapter.available()) {
      const need = missingVoiceEnv(adapter).join(" and ");
      return NextResponse.json(
        { error: `openai is not configured — set ${need} in .env.local and restart.`, provider: "openai" },
        { status: 503 }
      );
    }

    const lang = intake.lang === "cs" ? "cs" : "en";
    // The spoken-variant brief (persona + technique, no JSON contract) goes to
    // OpenAI server-side in the session config — it never rides this response.
    const instructions = await intakeVoiceBrief(lang);
    const connect = await adapter.connect({ instructions, language: lang });
    return NextResponse.json({ provider: connect.provider, connect });
  } catch (error) {
    return safeJsonError(error, "api:intake/voice-connect", "INTAKE_VOICE_CONNECT_FAILED");
  }
}
