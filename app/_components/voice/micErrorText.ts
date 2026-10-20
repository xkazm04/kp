// Map a getUserMedia / connection failure to specific, actionable recovery copy — mic denial
// is the most common real failure of a voice screen, and the raw DOMException message ("Permission
// denied") tells the candidate nothing about how to recover.
//
// Extracted from VoiceInterview.tsx. `useTranslations` is a hook, so this module cannot resolve
// its own copy: the caller passes the three already-translated strings (the keys — errMicDenied /
// errMicNotFound / errMicBusy — are unchanged and still live in the `interview.voice` namespace).

export type MicErrorCopy = {
  /** t("errMicDenied") */
  denied: string;
  /** t("errMicNotFound") */
  notFound: string;
  /** t("errMicBusy") */
  busy: string;
};

export function micErrorText(e: unknown, copy: MicErrorCopy): string | null {
  const name = e instanceof DOMException ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e ?? "");
  // The message fallback is for a rejection that lost its DOMException name in a relay,
  // and it must match only what getUserMedia itself says. `/permission|denied|dismiss/`
  // matched a bare "denied" anywhere in arbitrary text — and this classifier is reached
  // with PROVIDER text too: the ElevenLabs path hands it the SDK's own English message
  // (VoiceInterview.tsx), so "Agent access denied" rendered "click the microphone icon
  // in your address bar" for an auth failure the candidate cannot fix that way, and the
  // intake surface turned the same string into a mic verdict instead of a transport
  // fault. Returning null is what lets each caller describe its own failure honestly.
  if (name === "NotAllowedError" || name === "SecurityError" || /permission (denied|dismissed)/i.test(msg)) {
    return copy.denied;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || /no .*(microphone|audio)|device not found/i.test(msg)) {
    return copy.notFound;
  }
  if (name === "NotReadableError" || name === "AbortError" || /in use|already in use|busy/i.test(msg)) {
    return copy.busy;
  }
  return null;
}
