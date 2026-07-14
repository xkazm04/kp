import { ElevenLabsVoiceAdapter } from "./elevenlabs.ts";
import { OpenAiVoiceAdapter } from "./openai.ts";
import { QUICK_SCREEN_MIN } from "../interview-duration.mjs";
import { PERSONA_CRAFT_RULES, PERSONA_GENDER_GRAMMAR, PERSONA_LANGUAGE_DETECT, PERSONA_ONE_QUESTION } from "../student-interview";
import { coerceProviderId, VOICE_PROVIDER_ORDER, DEFAULT_VOICE_PROVIDER } from "./types.ts";
import type { VoiceAdapter, VoiceAvailability, VoiceProviderId } from "./types.ts";

export type { VoiceConnect, VoiceProviderId, VoiceAvailability, VoiceTurn, VoiceAdapter } from "./types.ts";
export { coerceLanguage, coerceProviderId, missingVoiceEnv } from "./types.ts";
export { connectWithFailover, otherProvider, type FailoverResult } from "./connect-failover.ts";

const adapters: Record<VoiceProviderId, VoiceAdapter> = {
  openai: new OpenAiVoiceAdapter(),
  elevenlabs: new ElevenLabsVoiceAdapter(),
};

export function getVoiceAdapter(id: VoiceProviderId): VoiceAdapter {
  return adapters[id];
}

export function voiceAvailability(): VoiceAvailability {
  return { openai: adapters.openai.available(), elevenlabs: adapters.elevenlabs.available() };
}

/** The house default-provider policy: honor an explicitly requested provider,
 *  otherwise prefer the first CONFIGURED provider in the canonical
 *  VOICE_PROVIDER_ORDER, defaulting to DEFAULT_VOICE_PROVIDER. Shared by the
 *  create + simulate routes AND the browser picker (both walk the same ordered
 *  list) so a recruiter-created link, a simulator link, and the lab picker can't
 *  default to different providers. */
export function pickDefaultProvider(
  requested: unknown,
  avail: VoiceAvailability = voiceAvailability(),
): VoiceProviderId {
  return coerceProviderId(requested) ?? (VOICE_PROVIDER_ORDER.find((p) => avail[p]) ?? DEFAULT_VOICE_PROVIDER);
}

/** A neutral first-round interviewer brief. For OpenAI it's the session prompt;
 *  for ElevenLabs the dashboard agent holds the prompt, so this is advisory.
 *  CANDIDATE-SAFE BY CONSTRUCTION: built only from the public role title and the
 *  booked call length — never from per-candidate assessment material — so
 *  /connect may hand it to the browser as the ElevenLabs prompt override without
 *  leaking the recruiter's private brief (backlog #29 / TP-L2-VOICE-01). */
export function defaultInterviewerInstructions(opts?: { role?: string | null; durationMin?: number | null }): string {
  const role = opts?.role || "an AI / engineering role";
  const durationMin = opts?.durationMin || QUICK_SCREEN_MIN;
  return [
    `You are a warm, professional first-round screening interviewer for ${role}.`,
    PERSONA_ONE_QUESTION,
    ...PERSONA_CRAFT_RULES,
    // Gender-grammar + language lock stay ADJACENT and LAST (see student-interview.ts).
    PERSONA_GENDER_GRAMMAR,
    PERSONA_LANGUAGE_DETECT,
    "Open with one sentence stating you are an AI assistant running a short first-round screen and that the call is transcribed.",
    "Ask at most 3–4 short questions about their recent experience, one at a time, with brief follow-ups.",
    `Do not give feedback, scores, or any hiring decision, and never praise or judge the quality of an answer or tell the candidate their thinking, instinct, or approach is right (avoid “great”, “impressive”, “exactly right”, “the right instinct”, “on the right track”) — stay warm by showing interest and inviting them to continue (“thank you”, “understood”, “tell me more”), not by approving. Keep the whole call under ${durationMin} minutes,`,
    "then thank them and say a human recruiter will review the conversation.",
  ].join(" ");
}
