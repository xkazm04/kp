// What a realtime-transport failure IS, as a code — not as the provider's prose.
//
// The bug this replaces: `startOpenAiCall` threw exactly one Error whose message
// was `OpenAI calls ${status}: ${body.slice(0, 200)}` — the upstream response body,
// verbatim — and the shell rendered `e.message` into the candidate's error banner.
// So a candidate on a keyless/misconfigured install read a slice of OpenAI's JSON
// ("Incorrect API key provided: sk-..."), in English, in every locale, with no
// recovery step; and an expired ephemeral credential looked exactly like a network
// blip. The provider's body is operator information (it goes to the console), never
// candidate copy.
//
// Four causes, because four different next actions:
//   NETWORK  — we never reached the provider. Check the connection, try again.
//   AUTH     — the minted credential was rejected. The operator must re-check keys;
//              retrying changes nothing.
//   TIMEOUT  — the provider accepted the call and then didn't answer in time.
//   PROVIDER — the provider answered with a fault of its own (5xx, 4xx we can't
//              name). Try again; if it persists it is theirs, not yours.
//
// These are CLIENT-origin codes, so they deliberately do NOT live in
// api-response.ts's STORE_ERRORS / REFUSAL_ERRORS: those two registries are the
// vocabulary a ROUTE HANDLER emits, and listing a code there that no handler can
// ever return would make the server contract lie. They resolve through the same
// `errors` catalog namespace via useErrorMessage(), and transport-error.test.ts
// pins every code to all four catalogs exactly as i18n:check pins the server pair.

export const VOICE_TRANSPORT_ERRORS = {
  /** The fetch/ICE never reached the provider (offline, DNS, blocked, CORS). */
  VOICE_TRANSPORT_NETWORK: "The voice provider could not be reached.",
  /** The provider rejected our minted credential (401/403). */
  VOICE_TRANSPORT_AUTH: "The voice provider rejected the session credential.",
  /** The provider took too long to answer (408/504/aborted). */
  VOICE_TRANSPORT_TIMEOUT: "The voice provider did not answer in time.",
  /** The provider answered with a fault of its own. */
  VOICE_TRANSPORT_PROVIDER: "The voice provider could not start the call.",
} as const;

export type VoiceTransportCode = keyof typeof VOICE_TRANSPORT_ERRORS;

/** A transport failure carrying its CODE. Still an `Error` subclass on purpose:
 *  every existing consumer catches `unknown` and runs it through `micErrorText`
 *  (`app/features/library/jds/intake/voicePhase.ts`'s `micFailure`), which reads
 *  `e instanceof Error ? e.message : …` — so the intake surface keeps classifying
 *  exactly as it did, and only gains the option of reading `.code`. */
export class VoiceTransportError extends Error {
  readonly code: VoiceTransportCode;
  /** The provider's own response body / cause, for the console and the server log
   *  ONLY. Never rendered: that is the whole point of the code. */
  readonly detail: string;

  constructor(code: VoiceTransportCode, detail = "") {
    super(`${VOICE_TRANSPORT_ERRORS[code]}${detail ? ` (${detail})` : ""}`);
    this.name = "VoiceTransportError";
    this.code = code;
    this.detail = detail;
  }
}

/** Classify a non-ok response from the provider's call-negotiation endpoint. */
export function classifyCallsStatus(status: number): VoiceTransportCode {
  if (status === 401 || status === 403) return "VOICE_TRANSPORT_AUTH";
  if (status === 408 || status === 504 || status === 522 || status === 524) return "VOICE_TRANSPORT_TIMEOUT";
  return "VOICE_TRANSPORT_PROVIDER";
}

/** Classify a THROWN failure from the negotiation fetch. `fetch` rejects only when
 *  the request never completed — offline, DNS, CORS, a blocked request — except for
 *  an abort, which is a timeout we caused. */
export function classifyThrownTransportFailure(cause: unknown): VoiceTransportCode {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "VOICE_TRANSPORT_TIMEOUT";
  return "VOICE_TRANSPORT_NETWORK";
}

/** True for anything the shell may resolve through `errors.<CODE>`. */
export function isVoiceTransportError(e: unknown): e is VoiceTransportError {
  return e instanceof VoiceTransportError;
}
