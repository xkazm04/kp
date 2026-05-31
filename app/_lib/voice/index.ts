import { ElevenLabsVoiceAdapter } from "./elevenlabs";
import { OpenAiVoiceAdapter } from "./openai";
import type { VoiceAdapter, VoiceAvailability, VoiceProviderId } from "./types";

export type { VoiceConnect, VoiceProviderId, VoiceAvailability } from "./types";

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

/** A neutral first-round interviewer brief. For OpenAI it's the session prompt;
 *  for ElevenLabs the dashboard agent holds the prompt, so this is advisory. */
export function defaultInterviewerInstructions(opts?: { role?: string | null }): string {
  const role = opts?.role || "an AI / engineering role";
  return [
    `You are a warm, professional first-round screening interviewer for ${role}.`,
    "You are male — when you speak Czech, use masculine grammatical forms for yourself (e.g. „rád bych“, „zeptal bych se“, „řekl jsem“).",
    "Detect whether the candidate speaks Czech or English and respond in that language; follow them if they switch.",
    "Open with one sentence stating you are an AI assistant running a short first-round screen and that the call is transcribed.",
    "Ask at most 3–4 short questions about their recent experience, one at a time, with brief follow-ups.",
    "Do not give feedback, scores, or any hiring decision. Keep the whole call under five minutes,",
    "then thank them and say a human recruiter will review the conversation.",
  ].join(" ");
}
