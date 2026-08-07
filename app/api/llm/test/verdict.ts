// Shape the canary "Test" spawn result into a SAFE client verdict.
//
// The canary runs with the decrypted provider key in env (KP_LLM_CONFIG), so any
// text the child emits — the failure envelope test_cli prints to stdout, a broken
// spawn's stderr traceback, an SDK error that echoes the auth header — can carry
// key material. test_cli exits 0 even on failure (the verdict IS the payload), so
// the failure envelope always arrives on the exit-0 path. The bug this closes:
// that path used to be returned to the panel VERBATIM (only exit!=0 was scrubbed),
// leaking raw provider/transport text to whoever can press Test.
//
// The fix: NEVER forward raw provider text to the client. We read the raw error
// ONLY to classify it into one of a fixed set of error codes, and return a
// constant, generic reason mapped from that code — plus, as defense in depth, a
// scrub that strips the actual key bytes (and known secret shapes) from whatever
// string does reach the response.
import { parsePythonJson } from "@/app/_lib/python-runner";
import { redactSecrets } from "@/app/_lib/redact-secrets";

export type TestErrorCode =
  | "auth"
  | "rate_limit"
  | "connection"
  | "timeout"
  | "invalid_model"
  | "permission"
  | "unavailable"
  | "bad_payload"
  | "provider_error";

// Constant, provider-text-free reasons. The client renders exactly these — never
// the SDK/stderr text. Mapped from the error CLASS/known markers, not the message.
const REASON: Record<TestErrorCode, string> = {
  auth: "authentication failed — the provider rejected the key",
  rate_limit: "rate limited by the provider",
  connection: "connection to the provider failed",
  timeout: "the provider request timed out",
  invalid_model: "invalid model or request",
  permission: "the key lacks permission for this model",
  unavailable: "provider unavailable (missing key or SDK/CLI)",
  bad_payload: "the provider returned an unexpected response",
  provider_error: "the provider rejected the test",
};

export type TestVerdict =
  | { ok: true; provider?: string; model?: string; latencyMs?: number }
  | { ok: false; code: TestErrorCode; error: string; provider?: string; model?: string };

/**
 * Pick a stable error code from a raw provider/transport error string. The raw
 * text is inspected ONLY here and ONLY to choose a code — it is never returned.
 * Ordering encodes precedence: test_cli's own markers first, then the SDK error
 * families (rate-limit before the broad model/4xx bucket).
 */
export function classifyProviderError(raw: string): TestErrorCode {
  const t = (raw || "").toLowerCase();
  // Leading exception-class token (a Python identifier before the first colon,
  // e.g. "AuthenticationError: ..."). An identifier can't contain key material.
  const cls = (raw.match(/^\s*([a-z_][a-z0-9_.]*)\s*:/i)?.[1] ?? "").toLowerCase();
  const has = (...markers: string[]) => markers.some((m) => t.includes(m) || cls.includes(m));

  if (has("unavailable", "missing key")) return "unavailable";
  if (has("unexpected canary payload", "unexpected")) return "bad_payload";
  if (has("authentication", "unauthorized", "invalid_api_key", "invalid api key", "no api key", "api key", "401"))
    return "auth";
  if (has("permissiondenied", "permission denied", "permissionerror", "forbidden", "403")) return "permission";
  if (has("ratelimit", "rate limit", "rate_limit", "resource_exhausted", "overloaded", "quota", "429"))
    return "rate_limit";
  if (has("timeout", "timed out", "deadline")) return "timeout";
  if (has("connection", "connect", "network", "dns", "econnrefused", "getaddrinfo", "ssl", "handshake", "unreachable"))
    return "connection";
  if (has("notfound", "not found", "badrequest", "bad request", "unprocessable", "invalid model", "model", "404", "400", "422"))
    return "invalid_model";
  return "provider_error";
}

/**
 * Defense-in-depth backstop: strip literal occurrences of the submitted key(s)
 * and known secret shapes from any text bound for the response. The primary fix
 * is not passing raw provider text at all; this guarantees that even a future
 * change (or a reason that ever interpolated raw text) cannot leak a key byte.
 */
export function scrubKeyMaterial(text: string, keys: readonly string[] = []): string {
  let out = text;
  for (const key of keys) {
    // Only scrub plausibly-secret strings (avoid nuking a 1-char value to "***").
    if (typeof key === "string" && key.length >= 6) out = out.split(key).join("***");
  }
  return redactSecrets(out);
}

/**
 * Pull the actual provider key strings out of a built KP_LLM_CONFIG env fragment
 * (see buildLlmConfigEnv) so scrubKeyMaterial can remove the exact bytes even if
 * an SDK echoes them — a prefixless Azure/custom key that redactSecrets' shape
 * rules would miss.
 */
export function extractConfigKeys(env: Record<string, string | undefined>): string[] {
  const raw = env.KP_LLM_CONFIG;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { keys?: Record<string, { apiKey?: unknown }> };
    const out: string[] = [];
    for (const entry of Object.values(parsed.keys ?? {})) {
      if (entry && typeof entry.apiKey === "string" && entry.apiKey) out.push(entry.apiKey);
    }
    return out;
  } catch {
    return [];
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Turn the raw spawn result into the verdict the panel receives. Success is
 * passed through unchanged (ok + provider/model/latency). Failure on ANY
 * path — exit-0 failure envelope, non-zero exit, unparseable output — returns a
 * generic reason mapped from the error class, NEVER the raw provider/stderr text.
 */
export function shapeVerdict(
  spawn: { stdout: string; stderr: string; exitCode: number | null },
  keys: readonly string[] = [],
): TestVerdict {
  const { stdout, stderr, exitCode } = spawn;

  let envelope: Record<string, unknown> | null = null;
  try {
    // Parse tolerantly; on non-JSON output we must NOT surface the thrown error
    // (it embeds raw stdout/stderr) — fall through to a generic failure.
    envelope = parsePythonJson<Record<string, unknown>>(stdout, "");
  } catch {
    envelope = null;
  }

  const provider = pickString(envelope?.provider);
  const model = pickString(envelope?.model);

  if (exitCode === 0 && envelope && envelope.ok === true) {
    const latencyMs = typeof envelope.latencyMs === "number" ? envelope.latencyMs : undefined;
    return {
      ok: true,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(latencyMs != null ? { latencyMs } : {}),
    };
  }

  // Failure. Read raw text ONLY to pick a code; the returned reason is a constant.
  const rawForClassOnly =
    pickString(envelope?.error) ?? (stderr.trim() || (exitCode !== 0 ? `exit ${exitCode}` : ""));
  const code = classifyProviderError(rawForClassOnly);
  return {
    ok: false,
    code,
    error: scrubKeyMaterial(REASON[code], keys),
    ...(provider ? { provider: scrubKeyMaterial(provider, keys) } : {}),
    ...(model ? { model: scrubKeyMaterial(model, keys) } : {}),
  };
}
