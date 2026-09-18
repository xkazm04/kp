// Shared vocabulary for the voice-interview view components (VoiceInterview.tsx
// and the leaf components it composes). Kept in a .ts of its own so the pill,
// the settings row and the transcript can all name a Phase without importing
// the 700-line orchestrator.

import type { VoiceProviderId } from "@/app/_lib/voice/types";
import { isLocale, type Locale } from "@/i18n/locales";

export type Phase = "idle" | "connecting" | "live" | "ending" | "ended" | "error";
/** The spoken-language hint a call starts with: a shipped locale, or "auto"
 *  (the lab's picker default — let the agent detect). */
export type LangHint = "auto" | Locale;

/** The candidate portal's spoken-language hint, seeded from the page locale.
 *
 *  It used to be `locale === "cs" ? "cs" : "en"`, so a German or French applicant —
 *  reading a German or French portal, with a brief that tells the agent to OPEN in
 *  their language — had English pinned into the ElevenLabs agent language and the
 *  OpenAI transcription language, the two transport settings that outrank a prompt
 *  (voice-interview-fidelity: per-turn language drift). Every shipped locale now
 *  passes through; anything else is "auto" rather than a wrong guess. */
export function portalLanguageHint(locale: string): LangHint {
  return isLocale(locale) ? locale : "auto";
}

export const PROVIDER_LABEL: Record<VoiceProviderId, string> = {
  openai: "OpenAI Realtime",
  elevenlabs: "ElevenLabs Agents",
};
