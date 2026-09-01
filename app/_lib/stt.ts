// kp's binding of the portable @kazm/voice-stt package (packages/voice-stt).
// This file is the ONLY place the app names the package's host seam: secrets
// come from process.env, local engines from the shared per-user sidecar home
// (the SAME one the TTS package uses — one folder of voice engines per machine,
// not one per direction), and the preference from two vars onboarding writes:
//   KP_STT_PROVIDER   - the preferred provider (whisper_cpp | assemblyai)
//   KP_STT_PROVIDERS  - comma list the UI may offer; unset = every registered
//                       provider (local install), a single id = locked.
//
// That second var is this plane's RESIDENCY control, and it is the reason the
// binding is worth reading twice. Spoken output speaks kp's own sentences;
// transcription carries a candidate's voice. A deploy that must keep interview
// audio on the machine sets KP_STT_PROVIDERS=whisper_cpp and no per-request
// field can widen it — the package filters the allowed set before it probes.
//
// Keyless/engineless behavior is a product property: status() reports each
// provider as absent/broken/ready with a setup hint, and transcribe() throws a
// typed `unavailable` — the host says it cannot listen, rather than returning
// an empty transcript that reads as silence.
import os from "node:os";
import { createStt, preferenceFromEnv, type Stt, type SttHost, type SttLogEvent } from "@/packages/voice-stt/src/index";

export { SttError, STT_PROVIDER_IDS, isSttProviderId, STT_MIME_TYPES, isSttMimeType } from "@/packages/voice-stt/src/index";
export type { SttProviderId, SttStatus, SttProbe, SttNeeds, SttTranscript } from "@/packages/voice-stt/src/index";

const host: SttHost = {
  env: (name) => process.env[name],
  homeDir: () => os.homedir(),
  cwd: () => process.cwd(),
  log: (event: SttLogEvent) => {
    // Never the transcript, and never the audio: a log line is the one place a
    // candidate's words would otherwise leak into an operator's terminal and
    // from there into whatever ships logs off the box. Lengths and timings only.
    if (event.type === "fallback" || event.type === "error") console.warn("[stt]", JSON.stringify(event));
    else if (process.env.KP_STT_DEBUG) console.debug("[stt]", JSON.stringify(event));
  },
};

let singleton: Stt | null = null;

/** Lazily bound so tests and build-time imports never probe engines. */
export function getStt(): Stt {
  if (!singleton) {
    singleton = createStt({ host, preference: preferenceFromEnv(host, { preferred: "KP_STT_PROVIDER", allowed: "KP_STT_PROVIDERS" }) });
  }
  return singleton;
}

/** Test seam: drop the bound instance so env changes are re-read. */
export function resetSttForTests(): void {
  singleton = null;
}
