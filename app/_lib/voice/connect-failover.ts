import type { VoiceAvailability, VoiceConnect, VoiceProviderId } from "./types.ts";

// Provider FAILOVER at connect (Direction 3). connect/route.ts flips the session
// in_progress BEFORE the adapter connects; if the preferred provider's connect
// throws (an ElevenLabs signed-url 5xx, an OpenAI client_secrets outage) the call
// used to dead-end with INTERVIEW_CONNECT_FAILED even when the OTHER provider is
// configured and could serve. This retries the connect with the alternate provider
// IN THE SAME REQUEST, building ITS brief via ITS path (the route's resolveAgentPrompt
// closure: OpenAI = full grounded brief server-side, so no client prompt; ElevenLabs
// = candidate-safe brief pushed as an override).
//
// Kept pure + adapter-injected (no DB, no env) so the failover contract is
// unit-testable by seam injection (connect-failover.test.ts) without the route's
// NextRequest. The route persists the served provider + logs the failover.

/** The minimal adapter surface failover needs — just connect(). */
export type ConnectableAdapter = {
  connect(opts: { instructions: string; language?: string | null }): Promise<VoiceConnect>;
};

export type FailoverResult = {
  /** The provider that ACTUALLY served (connect.provider) — authoritative over the
   *  requested one, so the route persists it and the client branches on it. */
  provider: VoiceProviderId;
  connect: VoiceConnect;
  /** The client-sent prompt for the served provider (ElevenLabs candidate brief),
   *  or null when the provider is grounded server-side (OpenAI). */
  agentPrompt: string | null;
  /** True when the preferred provider threw and the alternate served instead. */
  failedOver: boolean;
};

/** The other provider in the two-provider matrix. */
export function otherProvider(id: VoiceProviderId): VoiceProviderId {
  return id === "openai" ? "elevenlabs" : "openai";
}

/** Connect to the preferred provider, failing over to the other one (when it is
 *  available) if the preferred provider's connect throws. Single-provider
 *  deployments — or a deployment where only the preferred provider is configured —
 *  re-throw the ORIGINAL error unchanged, so today's INTERVIEW_CONNECT_FAILED
 *  behavior is preserved exactly. If BOTH providers throw, the preferred provider's
 *  error is the one surfaced (the alternate was a best-effort rescue). */
export async function connectWithFailover(opts: {
  preferred: VoiceProviderId;
  instructions: string;
  language: string | null;
  getAdapter: (id: VoiceProviderId) => ConnectableAdapter;
  availability: VoiceAvailability;
  /** Build the served provider's client-sent prompt (null for a server-grounded
   *  provider). Closes over the session + candidate-safe builder in the route. */
  resolveAgentPrompt: (served: VoiceProviderId, connect: VoiceConnect) => string | null;
}): Promise<FailoverResult> {
  const dial = (id: VoiceProviderId): Promise<VoiceConnect> =>
    opts.getAdapter(id).connect({ instructions: opts.instructions, language: opts.language });

  let connect: VoiceConnect;
  let failedOver = false;
  try {
    connect = await dial(opts.preferred);
  } catch (primaryErr) {
    const alternate = otherProvider(opts.preferred);
    if (!opts.availability[alternate]) throw primaryErr;
    try {
      connect = await dial(alternate);
    } catch {
      throw primaryErr;
    }
    failedOver = true;
  }

  // The prompt build sits OUTSIDE the failover trigger deliberately: ONLY a
  // connect may cause a failover. Built inside it, a resolveAgentPrompt that
  // threw was indistinguishable from a dead provider — the preferred provider
  // had ALREADY minted a real credential, and the "rescue" minted a SECOND one
  // on the other provider (the PAID one whenever the preferred is a self-hosted
  // service), flipped the session onto it and logged a failover that never
  // happened. A failing brief build must surface as itself.
  return {
    provider: connect.provider,
    connect,
    agentPrompt: opts.resolveAgentPrompt(connect.provider, connect),
    failedOver,
  };
}
