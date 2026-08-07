// KP_OFFLINE — hard no-egress mode for air-gapped self-host installs (E-SH-4,
// docs/SELF_HOSTING.md §7). When on, the app makes NO outbound network call except
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

/** Hostnames still reachable in offline mode: loopback (the app's own routes, the
 *  container healthcheck, same-host sidecars) plus the hosts of every private
 *  endpoint the operator configured, plus an explicit KP_OFFLINE_ALLOW_HOSTS list. */
export function egressAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
  // Hosts derived from configured private endpoints — the customer's own inference,
  // observability, and app origin.
  for (const key of [
    "OPENAI_BASE_URL",
    "AZURE_OPENAI_ENDPOINT",
    "LIGHTTRACK_URL",
    "NEXT_PUBLIC_APP_BASE_URL",
    "APP_BASE_URL",
    "COMMS_WEBHOOK_URL",
  ]) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname.toLowerCase());
    } catch {
      /* ignore a malformed configured URL — it just doesn't widen the allowlist */
    }
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
