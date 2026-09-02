import { NextRequest, NextResponse } from "next/server";
import { getIntake } from "@/app/_lib/db/intakes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getVoiceAdapter, missingVoiceEnv, voiceAvailability } from "@/app/_lib/voice";
import { intakeLang } from "@/app/_lib/intake-lang";
import { rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// Voice plane for the role-intake dialog
// (docs/architecture/voice-conversation-plane.md): mint short-lived realtime
// credentials so the requestor can TALK the intake. AUTHENTICATED-internal —
// the operator's own workspace session, so the candidate-link machinery
// (token, consent record, expiry/revoke, minute billing) deliberately does
// not apply; the guards that remain are the ones about money and tenancy.
//
// TRANSPORT-ONLY session: the provider receives the RELAY instruction below —
// never the intake persona. The conversational brain is OUR engine
// (/voice-turn → run_voice_turn); the provider transcribes the requestor and
// speaks the utterances we inject (relay: true ⇒ create_response: false).
// That is what removes the vendor lock: any provider that can transcribe and
// speak-on-command can carry this conversation, and the persona/brief never
// leave our infrastructure. Residual provider exposure (the AUDIO transits
// the provider) is a Terms-of-Service disclosure item, not an architecture
// dependency.

// The transport relay instruction — deliberately persona-free. English on
// purpose (a meta-instruction to the transport, not dialog content); verbatim
// delivery in the utterance's own language is pinned per response.create.
const RELAY_INSTRUCTIONS =
  "You are a speech relay for an internal business conversation. You never answer, comment, or speak " +
  "on your own initiative. When instructed to say something, say exactly that text, verbatim, in its " +
  "own language, with natural spoken delivery.";

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
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status !== "open") return jsonRefusal("INTAKE_CLOSED", 409);

    // THROTTLE (rate-limit-contract.test.ts): credential minting burns provider
    // credits — the same "most expensive operation" premise as
    // /api/interview/connect, so the same budget: 6/10min per intake (one start
    // + five reconnects after dropped calls). Keyed by intake id, not IP (an
    // operator's legitimate retries share a NAT with the whole office). Sits
    // AFTER the 404/409 lifecycle refusals and BEFORE the adapter mint.
    //
    // NOT raised on self-hosted voice, unlike /api/interview/connect (scan-sweep
    // 2026-08-22). That raise reads ELEVENLABS_BASE_URL — an ENV fact about
    // whether a free local service is configured — but this route mints
    // getVoiceAdapter("openai") credentials and ONLY those: it is a transport-only
    // OpenAI Realtime relay and ElevenLabs is never reachable from it. So the
    // "nothing billable is minted" premise is false here in principle, not just
    // in some sessions, and the raise let one open intake id mint 120 PAID
    // ephemeral credentials per 10 minutes on an install that merely has a local
    // ElevenLabs configured for a different feature.
    const voiceConnectLimit = 6;
    if (!rateLimit(`intake-voice-connect:${id}`, { limit: voiceConnectLimit, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const adapter = getVoiceAdapter("openai");
    if (!adapter.available()) {
      // The env vars an operator must set ride alongside as DATA (`need`), not
      // baked into an English sentence: the note is for the person running the
      // install, and they read it in their own language like everything else.
      return jsonRefusal("INTAKE_VOICE_NOT_CONFIGURED", 503, { provider: "openai", need: missingVoiceEnv(adapter) });
    }

    const lang = intakeLang(intake.lang);
    const connect = await adapter.connect({ instructions: RELAY_INSTRUCTIONS, language: lang, relay: true });
    return NextResponse.json({ provider: connect.provider, connect });
  } catch (error) {
    return safeJsonError(error, "api:intake/voice-connect", "INTAKE_VOICE_CONNECT_FAILED");
  }
}
