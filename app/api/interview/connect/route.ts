import { NextRequest, NextResponse } from "next/server";
import {
  createInterviewSession,
  getInterviewSessionByToken,
  markInterviewStarted,
  type InterviewProvider,
} from "@/app/_lib/db";
import { defaultInterviewerInstructions, getVoiceAdapter, voiceAvailability } from "@/app/_lib/voice";

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
    const requested = body.provider === "elevenlabs" ? "elevenlabs" : body.provider === "openai" ? "openai" : null;
    const provider: InterviewProvider | null = requested ?? session0?.provider ?? null;
    if (!provider) {
      return NextResponse.json({ error: "provider must be 'openai' or 'elevenlabs'" }, { status: 400 });
    }

    const adapter = getVoiceAdapter(provider);
    if (!adapter.available()) {
      const need = provider === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID";
      return NextResponse.json(
        { error: `${provider} is not configured — set ${need} in .env.local and restart.`, provider },
        { status: 503 }
      );
    }

    const instructions =
      session0?.instructions ||
      defaultInterviewerInstructions({ role: session0?.jobTitle });

    const session =
      session0 ?? createInterviewSession({ provider, language: body.language ?? null, mode: "test", instructions });

    markInterviewStarted(session.id, Boolean(body.consent));

    const connect = await adapter.connect({ instructions, language: body.language ?? session.language });
    // Candidate-mode sessions carry grounded questions; the browser passes this
    // to ElevenLabs as a prompt override (OpenAI gets it server-side already).
    const groundedPrompt = session.mode === "candidate" ? instructions : null;
    return NextResponse.json({ sessionId: session.id, provider, instructions, groundedPrompt, connect });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "connect failed" },
      { status: 500 }
    );
  }
}
