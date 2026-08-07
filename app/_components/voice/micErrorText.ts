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
  if (name === "NotAllowedError" || name === "SecurityError" || /permission|denied|dismiss/i.test(msg)) {
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
