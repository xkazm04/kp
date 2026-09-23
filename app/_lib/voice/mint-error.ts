import type { VoiceProviderId } from "./types.ts";

// A realtime credential mint that failed, with the failure CLASSIFIED where it
// happened (challenge-r09 voice-provider-io/B).
//
// The adapters used to throw plain Errors with the HTTP status inside an English
// sentence ("OpenAI client_secrets 401: ..."), so the only way to tell a revoked key
// from a dead self-hosted voice service was a regex over that sentence. The operator's
// readiness probe (readiness.ts) needs exactly that distinction: each cause has a
// different fix. The MESSAGE is kept byte-for-byte, so every log line the connect
// route writes through safeJsonError reads as it did, and connectWithFailover, which
// catches anything, fails over exactly as before.
//
// Pure and browser-safe (type-only import), like provider-traits.ts.

export const VOICE_MINT_CAUSES = ["auth", "not_found", "timeout", "unreachable", "upstream", "malformed"] as const;
/** auth: the key was refused. not_found: the endpoint or the agent/model does not
 *  exist. timeout: no answer inside the mint budget. unreachable: the connection
 *  itself failed (DNS, refused, a KP_OFFLINE block). upstream: the provider answered
 *  with any other failure. malformed: a 200 without a usable credential. */
export type VoiceMintCause = (typeof VOICE_MINT_CAUSES)[number];

export class VoiceMintError extends Error {
  readonly provider: VoiceProviderId;
  /** Narrows Error.cause on purpose: for a mint failure the cause IS the class. The
   *  underlying rejection, when there was one, is kept on `original`. */
  override readonly cause: VoiceMintCause;
  readonly status: number | undefined;
  readonly original: unknown;

  constructor(opts: { provider: VoiceProviderId; cause: VoiceMintCause; message: string; status?: number; original?: unknown }) {
    super(opts.message);
    this.name = "VoiceMintError";
    this.provider = opts.provider;
    this.cause = opts.cause;
    this.status = opts.status;
    this.original = opts.original;
  }
}

/** The class of a non-2xx mint answer. */
export function mintCauseFromStatus(status: number): VoiceMintCause {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  return "upstream";
}

/** A rejected fetch: the mint's own AbortSignal.timeout surfaces as TimeoutError (an
 *  AbortError on older runtimes); anything else never reached an HTTP answer. */
function causeOfRejection(err: unknown): VoiceMintCause {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable";
}

/** Run one mint fetch, turning a REJECTION (no HTTP answer at all) into a typed
 *  failure that keeps the original message. An HTTP answer, good or bad, is returned
 *  for the adapter to judge. */
export async function mintFetch(provider: VoiceProviderId, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    throw new VoiceMintError({
      provider,
      cause: causeOfRejection(err),
      message: err instanceof Error ? err.message : String(err),
      original: err,
    });
  }
}

/** The cause of any mint failure: a typed one carries it; anything else (a throw no
 *  adapter classified) is the provider's side until shown otherwise. */
export function classifyMintFailure(err: unknown): VoiceMintCause {
  return err instanceof VoiceMintError ? err.cause : "upstream";
}
