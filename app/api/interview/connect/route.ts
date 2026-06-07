import { NextRequest, NextResponse } from "next/server";
import {
  createInterviewSession,
  getInterviewSessionByToken,
  markInterviewStarted,
} from "@/app/_lib/db";
import {
  coerceProviderId,
  defaultInterviewerInstructions,
  getVoiceAdapter,
  missingVoiceEnv,
  voiceAvailability,
  type VoiceProviderId,
} from "@/app/_lib/voice";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import { jsonError } from "@/app/_lib/api-response";
import { CONSENT_REQUIRED_ERROR, isConnectConsentSatisfied } from "@/app/_lib/interview-consent";

export const runtime = "nodejs";

// GET → which providers are configured (used by the UI to enable/disable the switcher).
export async function GET() {
  return NextResponse.json({ availability: voiceAvailability() });
}

// POST → mint short-lived browser credentials for the chosen provider and
// create/load the interview session. The browser connects directly afterward.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      provider?: string;
      token?: string;
      language?: string;
      consent?: boolean;
    };

    // The browser picks the provider (the picker defaults to ElevenLabs and
    // disables any provider whose keys are missing). Honor that choice; fall
    // back to a token-bound session's stored provider when none is requested.
    const session0 = body.token ? getInterviewSessionByToken(body.token) : null;
    const requested = coerceProviderId(body.provider);
    const provider: VoiceProviderId | null = requested ?? session0?.provider ?? null;
    if (!provider) {
      return NextResponse.json({ error: "provider must be 'openai' or 'elevenlabs'" }, { status: 400 });
    }

    const adapter = getVoiceAdapter(provider);
    if (!adapter.available()) {
      // Ask the adapter which of its keys are missing rather than re-encoding
      // provider-specific var names here — the adapter owns that knowledge.
      const need = missingVoiceEnv(adapter).join(" and ");
      return NextResponse.json(
        { error: `${provider} is not configured — set ${need} in .env.local and restart.`, provider },
        { status: 503 }
      );
    }

    const instructions =
      session0?.instructions ||
      defaultInterviewerInstructions({ role: session0?.jobTitle });

    // An untokened lab session is the ungrounded quick screen, so it carries the
    // canonical quick-screen length (matches the "under 5 minutes" persona).
    const session =
      session0 ??
      createInterviewSession({
        provider,
        language: body.language ?? null,
        mode: "test",
        instructions,
        durationMin: QUICK_SCREEN_MIN,
      });

    // Consent is the legal basis for processing an AI-conducted, transcribed
    // candidate interview, so enforce it server-side (idea-98e6cf23) — not just
    // via the browser's disabled Start button. A candidate session without
    // explicit consent never mints credentials below nor flips to in_progress.
    if (!isConnectConsentSatisfied(session.mode, body.consent)) {
      return NextResponse.json({ error: CONSENT_REQUIRED_ERROR }, { status: 403 });
    }

    markInterviewStarted(session.id, Boolean(body.consent));

    const connect = await adapter.connect({ instructions, language: body.language ?? session.language });
    // Candidate-mode sessions carry grounded questions; the browser passes this
    // to ElevenLabs as a prompt override (OpenAI gets it server-side already).
    const groundedPrompt = session.mode === "candidate" ? instructions : null;
    return NextResponse.json({ sessionId: session.id, provider, instructions, groundedPrompt, connect });
  } catch (error) {
    return jsonError(error, "connect failed");
  }
}
