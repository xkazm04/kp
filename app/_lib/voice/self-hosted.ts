// Pointing the ElevenLabs voice path at a voice service you run yourself.
//
// The Agents API this app speaks — `get-signed-url` then a stateful WebSocket —
// is a protocol, not a company, and it can be served locally. Gravitone
// (github.com/xkazm04/gravitone) does exactly that: CPU-only speech-to-text,
// text-to-speech and turn-taking behind the same endpoints, so setting ONE base
// URL moves an interview off per-minute billing without touching the browser
// client, the consent flow, the transcript store or the failover layer.
//
//   ELEVENLABS_BASE_URL=http://127.0.0.1:8080
//   ELEVENLABS_AGENT_ID=local-interviewer
//   ELEVENLABS_API_KEY=local        # still required; a local service may ignore it
//
// The signed URL that comes back points at that host (ws://…), and the
// @elevenlabs/react SDK connects to whatever URL the server hands it — which is
// why no client change is needed.
//
// Why this is derived from the URL rather than a separate "free" flag: two
// switches that must agree is a bug waiting to happen. A run either talks to a
// service on this machine or it does not, and the base URL already says which.

const HOSTED_BASE_URL = "https://api.elevenlabs.io";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** The ElevenLabs-compatible API to call. Defaults to the hosted service, so an
 *  install that sets nothing behaves exactly as it did before this existed. */
export function elevenLabsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ELEVENLABS_BASE_URL?.trim() || HOSTED_BASE_URL).replace(/\/+$/, "");
}

/** True for a host that cannot be the hosted service: loopback, an RFC1918 /
 *  link-local / carrier-NAT address, or a `.local` name. */
function isPrivateHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // The ranges below describe IP ADDRESSES, so they may only be read off an IPv4
  // literal. Matched against a NAME they also fired on anything whose first label
  // happens to be one of those numbers — "https://10.voice-vendor.example.com" is
  // a public, per-minute host that this function then declared free, which is the
  // one direction the contract below says must never happen (it skips /simulate's
  // interview_minutes gate and raises /connect's credential-mint throttle 6 → 120).
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
  return false;
}

/** ENV-LEVEL: is a self-hosted ElevenLabs endpoint CONFIGURED on this install?
 *
 *  This is a question about the deployment, NOT about any particular session,
 *  and it is never on its own an answer to "does this call cost money". An
 *  install can serve ElevenLabs locally and still run OpenAI Realtime sessions
 *  — those are billed per minute exactly as before. Use
 *  {@link isSelfHostedProvider} with the provider that is actually serving
 *  whenever the answer decides a gate, a debit or a throttle; this export is
 *  only for questions that are genuinely about the endpoint (which URL to call,
 *  whether the local voice stack is deployed at all).
 *
 *  Deliberately CONSERVATIVE: only a private/loopback host counts. An override
 *  pointing at some other public host is still treated as paid, because this
 *  app cannot know that it is not — and the failure modes are not symmetric.
 *  Wrongly believing a session is free disables a billing gate; wrongly
 *  believing it is paid only means a meter is debited for a call that was
 *  free. */
export function isSelfHostedVoice(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ELEVENLABS_BASE_URL?.trim();
  if (!raw) return false;
  try {
    return isPrivateHost(new URL(raw).hostname.toLowerCase());
  } catch {
    return false; // a malformed override is not a claim about anything
  }
}

/** SESSION-LEVEL: is THIS session being served by the free provider — and
 *  therefore spending no per-minute credits? OpenAI Realtime has no self-hosted
 *  path in this app, so only the ElevenLabs adapter can be local.
 *
 *  This is the export every money decision belongs on (billing gate, meter
 *  debit, credential-mint throttle, cost estimate). Pass the provider that will
 *  actually SERVE the call — after failover that is `connect.provider`, not the
 *  one the session requested. */
export function isSelfHostedProvider(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return provider === "elevenlabs" && isSelfHostedVoice(env);
}
