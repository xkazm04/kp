// Shared vocabulary for the voice-interview view components (VoiceInterview.tsx
// and the leaf components it composes). Kept in a .ts of its own so the pill,
// the settings row and the transcript can all name a Phase without importing
// the 700-line orchestrator.

import type { VoiceProviderId } from "@/app/_lib/voice/types";

export type Phase = "idle" | "connecting" | "live" | "ending" | "ended" | "error";
export type LangHint = "auto" | "cs" | "en";

export const PROVIDER_LABEL: Record<VoiceProviderId, string> = {
  openai: "OpenAI Realtime",
  elevenlabs: "ElevenLabs Agents",
};
