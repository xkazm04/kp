// Shared voice selection rule across local TTS adapters (Piper, Kokoro).
import type { TtsVoice } from "./types.ts";

export type PickVoiceQuery = {
  voiceId?: string | null;
  language?: string | null;
};

export type PickVoiceResult<V extends TtsVoice = TtsVoice> = {
  voice: V;
  matched: boolean;
};

/**
 * The single voice-selection rule across local adapters:
 * 1. An explicit voiceId must match by id; if not found, returns null (adapter throws invalid_voice).
 * 2. Otherwise, if language is given, finds the first voice declaring that language tag.
 * 3. Falls back to catalog[0] with matched: false (or matched: true if no language was requested).
 */
export function pickVoice<V extends TtsVoice>(
  catalog: readonly V[],
  query: PickVoiceQuery
): PickVoiceResult<V> | null {
  if (!catalog.length) return null;

  if (query.voiceId) {
    const found = catalog.find((v) => v.id === query.voiceId);
    return found ? { voice: found, matched: true } : null;
  }

  const lang = query.language ?? null;
  if (lang) {
    const byLang = catalog.find((v) => v.language === lang);
    if (byLang) return { voice: byLang, matched: true };
    return { voice: catalog[0], matched: false };
  }

  return { voice: catalog[0], matched: true };
}
