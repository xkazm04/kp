import { failoverOrder } from "./provider-traits.ts";
import { isSelfHostedProvider } from "./self-hosted.ts";
import type { VoiceAvailability, VoiceConnect, VoiceProviderId, VoiceToolDef } from "./types.ts";

// Provider FAILOVER at connect (Direction 3). connect/route.ts flips the session
// in_progress BEFORE the adapter connects; if the preferred provider's connect
// throws (an ElevenLabs signed-url 5xx, an OpenAI client_secrets outage) the call
// used to dead-end with INTERVIEW_CONNECT_FAILED even when the OTHER provider is
// configured and could serve. This retries the connect with the alternates IN THE
// SAME REQUEST, in canonical order (failoverOrder, provider-traits.ts), building the
// served provider's brief via ITS path (the route's resolveAgentPrompt closure: a
// `prompt: "server"` provider is grounded server-side, so no client prompt; a
// `client-override` one gets the candidate-safe brief pushed as an override).
//
// The helper that fails over also holds the money rule about failing over: a FREE
// (self-hosted) preferred provider is never rescued onto a paid one. That rule used
// to live in one route as an availability override that zeroed the paid provider
// by name, so any other caller of this helper silently lost it.
//
// Kept pure + adapter-injected (no DB; env only through isFree's default) so the failover contract is
// unit-testable by seam injection (connect-failover.test.ts) without the route's
// NextRequest. The route persists the served provider + logs the failover.

/** The minimal adapter surface failover needs — just connect(). */
export type ConnectableAdapter = {
  connect(opts: {
    instructions: string;
    language?: string | null;
    sessionToken?: string | null;
    tools?: readonly VoiceToolDef[] | null;
  }): Promise<VoiceConnect>;
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

/** Connect to the preferred provider, failing over to each available alternate in
 *  canonical order if the preferred provider's connect throws. Single-provider
 *  deployments — or a deployment where only the preferred provider is configured —
 *  re-throw the ORIGINAL error unchanged, so today's INTERVIEW_CONNECT_FAILED
 *  behavior is preserved exactly. If EVERY provider throws, the preferred provider's
 *  error is the one surfaced (the alternates were a best-effort rescue). A free
 *  preferred provider is only rescued onto another free one (see failoverOrder). */
export async function connectWithFailover(opts: {
  preferred: VoiceProviderId;
  instructions: string;
  language: string | null;
  /** The session's capability token, forwarded so the adapter can bind the minted
   *  credential to this session (as a hash — see voice/openai.ts). Optional: the
   *  tokenless lab path has none. */
  sessionToken?: string | null;
  /** The interview director's tools for an agenda-backed candidate session, handed to
   *  WHICHEVER provider dials (OpenAI mints them into the session; ElevenLabs declares
   *  them on the agent and ignores this), so a failover never drops the protocol. */
  tools?: readonly VoiceToolDef[] | null;
  getAdapter: (id: VoiceProviderId) => ConnectableAdapter;
  availability: VoiceAvailability;
  /** Is this provider free for THIS install (costs no per-minute credits)? Defaults
   *  to isSelfHostedProvider, the one money predicate every gate, debit and throttle
   *  reads. Injectable so the rule is unit-testable without env. */
  isFree?: (id: VoiceProviderId) => boolean;
  /** The canonical provider order the alternates are walked in. Injectable for tests;
   *  defaults to VOICE_PROVIDER_ORDER. */
  order?: readonly VoiceProviderId[];
  /** Build the served provider's client-sent prompt (null for a server-grounded
   *  provider). Closes over the session + candidate-safe builder in the route. */
  resolveAgentPrompt: (served: VoiceProviderId, connect: VoiceConnect) => string | null;
}): Promise<FailoverResult> {
  const dial = (id: VoiceProviderId): Promise<VoiceConnect> =>
    opts.getAdapter(id).connect({
      instructions: opts.instructions,
      language: opts.language,
      sessionToken: opts.sessionToken ?? null,
      tools: opts.tools ?? null,
    });

  let connect: VoiceConnect;
  let failedOver = false;
  try {
    connect = await dial(opts.preferred);
  } catch (primaryErr) {
    const isFree = opts.isFree ?? ((id: VoiceProviderId) => isSelfHostedProvider(id));
    let rescued: VoiceConnect | null = null;
    for (const alternate of failoverOrder(opts.preferred, opts.availability, isFree, opts.order)) {
      try {
        rescued = await dial(alternate);
        break;
      } catch {
        /* an alternate is a best-effort rescue: try the next one; the preferred error is what surfaces */
      }
    }
    if (!rescued) throw primaryErr;
    connect = rescued;
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
