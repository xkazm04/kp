// kp's binding of the portable @kazm/voice-tts package (packages/voice-tts).
// This file is the ONLY place the app names the package's host seam: secrets
// come from process.env, local engines from the shared per-user sidecar home,
// and the preference from two vars the onboarding skill writes:
//   KP_TTS_PROVIDER   - the preferred provider (elevenlabs | piper | kokoro)
//   KP_TTS_PROVIDERS  - comma list the UI may offer for side-by-side compare;
//                       unset = every registered provider (local install), a
//                       single id = locked (team deploy)
// Keyless/engineless behavior is a product property: status() reports each
// provider as absent/broken/ready with a setup hint, and speak() throws a typed
// `unavailable` — the host renders text, never a broken speaker.
import os from "node:os";
import { createTts, preferenceFromEnv, type Tts, type TtsHost, type TtsLogEvent } from "@/packages/voice-tts/src/index";

export { TtsError, TTS_PROVIDER_IDS, isTtsProviderId } from "@/packages/voice-tts/src/index";
export type { TtsProviderId, TtsStatus, TtsProbe } from "@/packages/voice-tts/src/index";

const host: TtsHost = {
  env: (name) => process.env[name],
  homeDir: () => os.homedir(),
  cwd: () => process.cwd(),
  log: (event: TtsLogEvent) => {
    if (event.type === "fallback" || event.type === "error") console.warn("[tts]", JSON.stringify(event));
    else if (process.env.KP_TTS_DEBUG) console.debug("[tts]", JSON.stringify(event));
  },
};

let singleton: Tts | null = null;

/** Lazily bound so tests and build-time imports never probe engines. */
export function getTts(): Tts {
  if (!singleton) {
    singleton = createTts({ host, preference: preferenceFromEnv(host, { preferred: "KP_TTS_PROVIDER", allowed: "KP_TTS_PROVIDERS" }) });
  }
  return singleton;
}

/** Test seam: drop the bound instance so env changes are re-read. */
export function resetTtsForTests(): void {
  singleton = null;
}
