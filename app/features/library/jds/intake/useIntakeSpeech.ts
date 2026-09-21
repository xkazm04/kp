"use client";

import { useStudioSpeech, type StudioSpeech } from "@/app/_components/studio/useStudioSpeech";
import { INTAKE_AUTO_SPEAK_KEY } from "./intakeVoiceIo";

// The intake composer's OUTPUT pipeline is the Studio kit's now
// (app/_components/studio/useStudioSpeech.ts). What is intake's is ONE fact: the
// localStorage key its auto-speak preference lives under — bound here so the
// legacy voice bar's call shape is unchanged.

export type IntakeSpeech = StudioSpeech;

export function useIntakeSpeech({
  speakText,
  lang,
  sessionKey = null,
}: {
  speakText: string | null;
  lang: string;
  /** The intake session this text belongs to. Switching sessions re-primes and
   *  silences: the last answer of a session just opened is not an arrival, and
   *  the previous session's utterance must not keep playing over it. */
  sessionKey?: string | null;
}): IntakeSpeech {
  return useStudioSpeech({ speakText, lang, sessionKey, autoSpeakStorageKey: INTAKE_AUTO_SPEAK_KEY });
}
