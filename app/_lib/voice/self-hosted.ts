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
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
  return false;
}

/** Whether voice is being served from a machine we run, and therefore costs no
 *  per-minute credits.
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

/** Whether THIS session's provider is self-hosted. OpenAI Realtime has no
 *  self-hosted path in this app, so only the ElevenLabs adapter can be local. */
export function isSelfHostedProvider(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return provider === "elevenlabs" && isSelfHostedVoice(env);
}
