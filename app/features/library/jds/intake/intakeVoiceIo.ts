// The decisions behind the intake composer's voice pair — PURE, and since WP1 the
// Studio kit's (app/_components/studio/studioVoiceIo.ts), where every consumer of
// the desk shares one latch rule, one auto-speak decision and one append. This
// path keeps the intake names: `intakeVoiceIo.test.ts` pins the rules through
// it, and what is genuinely intake's stays here — the storage key the auto-speak
// preference lives under, bound into the two readers below.
//
// Runner:
//   node scripts/run-unit-tests.mjs app/features/library/jds/intake/intakeVoiceIo.test.ts

import { readAutoSpeak as readAutoSpeakAt, storeAutoSpeak as storeAutoSpeakAt } from "@/app/_components/studio/studioVoiceIo";

export {
  DEFAULT_AUTO_SPEAK,
  STT_UNAVAILABLE_CODE,
  TTS_UNAVAILABLE_CODE,
  appendDictation,
  latchUnavailable,
  parseAutoSpeak,
  shouldAutoSpeak,
  type AutoSpeakInput,
} from "@/app/_components/studio/studioVoiceIo";

/* ── The preference. Per-BROWSER UX, not workspace data: it describes how this
 *    screen is being used right now and carries nothing another operator needs,
 *    so localStorage, the same call the desk's studioContract and the companion's
 *    prefs already made. The KEY is intake's; the reader is the kit's. ── */

export const INTAKE_AUTO_SPEAK_KEY = "kp-intake-auto-speak";

export function readAutoSpeak(): boolean {
  return readAutoSpeakAt(INTAKE_AUTO_SPEAK_KEY);
}

export function storeAutoSpeak(value: boolean): void {
  storeAutoSpeakAt(INTAKE_AUTO_SPEAK_KEY, value);
}
