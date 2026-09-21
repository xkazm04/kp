// KP_OFFLINE — hard no-egress mode for air-gapped self-host installs (E-SH-4,
// docs/architecture/self-hosting.md §7). When on, the app makes NO outbound network call except
// to loopback and the private endpoints the operator explicitly configured. This
// is the TS half: a global `fetch` guard installed once at server startup
// (instrumentation.ts) that catches ALL fetch-based egress — GitHub repo analysis,
// Polar billing, the JS Gemini/OpenAI SDKs, voice token exchanges — in one place,
// instead of gating each call site. The Python half (cloud LLM engines refuse) is
// pipeline/jobfit/llm/offline.py. Both are application backstops; the ultimate
// guarantee is a network egress policy at the deployment layer.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** True when KP_OFFLINE is set to a truthy value. */
export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY.has((env.KP_OFFLINE ?? "").trim().toLowerCase());
}

/** Hostname suffixes that only ever name an on-box / private-network service —
 *  the mDNS / Docker / Kubernetes / LAN conventions a self-host actually uses.
 *  Mirrors `_LOCAL_HOST_SUFFIXES` in pipeline/jobfit/llm/offline.py. */
const LOCAL_HOST_SUFFIXES = [".local", ".internal", ".lan", ".home.arpa"];

/** True when a hostname names a genuinely on-box or private-network service, so it
 *  may keep being reached under KP_OFFLINE. Loopback, a private-IP literal, a bare
 *  single-label container/service name, or one of the LAN suffixes above.
 *
 *  This is the TS mirror of `is_local_url` in the Python half, and it exists
 *  because the two halves disagreed. The Python docstring is explicit that a
 *  configured endpoint "is NOT trusted just because it was configured … so a stray
 *  OPENAI_BASE_URL=https://api.openai.com/v1 can never defeat the seal" — and this
 *  half trusted every configured endpoint unconditionally, which is precisely the
 *  hole that sentence describes. An operator who really does reach a private
 *  service through a public-looking name still has KP_OFFLINE_ALLOW_HOSTS, which
 *  is an explicit act rather than a side effect of naming an inference endpoint. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // A bare single-label name is a container or service name, never a public FQDN.
  if (!host.includes(".") && !host.includes(":")) return true;
  // IPv4 private / loopback / link-local literals.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (host.includes(":")) return /^(f[cd]|fe[89ab])/.test(host);
  return false;
}

/** The hostname of a configured URL, or null when unset or malformed. A malformed
 *  value simply fails to widen the allowlist rather than throwing. */
function hostOf(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hostnames still reachable in offline mode: loopback (the app's own routes, the
 *  container healthcheck, same-host sidecars) plus the hosts of every configured
 *  endpoint THAT IS ACTUALLY PRIVATE, plus an explicit KP_OFFLINE_ALLOW_HOSTS list. */
export function egressAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
  // The app's OWN origin, always. Reaching yourself is not egress, and an
  // air-gapped deployment may still be published under a perfectly ordinary
  // public-looking name that only resolves inside its own network.
  for (const key of ["NEXT_PUBLIC_APP_BASE_URL", "APP_BASE_URL"]) {
    const host = hostOf(env[key]);
    if (host) hosts.add(host);
  }
  // OUTBOUND service endpoints — the customer's own inference, observability and
  // webhook targets. Each is admitted only if it names a private host, because
  // configuring an endpoint says where a service is, not that reaching it is
  // compatible with an air-gap. The observability collector is the clearest case:
  // pointed at a hosted endpoint it would keep telemetry leaving a deployment
  // whose entire premise is that nothing does. An operator who genuinely reaches
  // a private service through a public-looking name says so in
  // KP_OFFLINE_ALLOW_HOSTS, which is a deliberate act rather than a side effect.
  for (const key of ["OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT", "LIGHTTRACK_URL", "COMMS_WEBHOOK_URL"]) {
    const host = hostOf(env[key]);
    if (host && isPrivateHost(host)) hosts.add(host);
  }
  for (const host of (env.KP_OFFLINE_ALLOW_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)) {
    hosts.add(host);
  }
  return hosts;
}

/** Whether a URL may be fetched in offline mode. Unparseable → blocked (fail closed). */
export function egressAllowed(url: string | URL, env: NodeJS.ProcessEnv = process.env): boolean {
  let host: string;
  try {
    // A relative URL (server-side same-origin fetch) resolves to loopback → allowed.
    host = (url instanceof URL ? url : new URL(String(url), "http://localhost")).hostname.toLowerCase();
  } catch {
    return false;
  }
  return egressAllowlist(env).has(host);
}

/** Extract the target URL from a fetch() first argument (string | URL | Request). */
function fetchTargetUrl(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof (input as { url?: unknown }).url === "string") return (input as { url: string }).url;
  return null;
}

let installed = false;

/** Install the global fetch egress guard. No-op unless KP_OFFLINE is on; idempotent
 *  (guards against duplicate wraps across HMR). Called once from instrumentation.ts. */
export function installOfflineFetchGuard(env: NodeJS.ProcessEnv = process.env): void {
  if (installed || !isOffline(env)) return;
  installed = true;
  const original = globalThis.fetch;
  const allow = egressAllowlist(env);
  const guarded: typeof fetch = (input, init) => {
    const target = fetchTargetUrl(input);
    let host: string | null = null;
    if (target !== null) {
      try {
        host = new URL(target, "http://localhost").hostname.toLowerCase();
      } catch {
        host = null;
      }
    }
    if (host === null || !allow.has(host)) {
      return Promise.reject(
        new Error(`KP_OFFLINE: blocked outbound request to ${host ?? "an unparseable URL"} (not in the egress allowlist).`)
      );
    }
    return original(input as Parameters<typeof fetch>[0], init);
  };
  globalThis.fetch = guarded;
  console.warn(`[offline] KP_OFFLINE on — outbound fetch restricted to: ${[...allow].sort().join(", ")}`);
}
