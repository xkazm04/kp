// Scrub secret-like substrings from text before it crosses a trust boundary —
// e.g. a provider-SDK error tail surfaced to the Models "Test" panel. A decrypted
// provider key and the assembled KP_LLM_CONFIG live in the same process as the
// canary, so a stack trace, an SDK error that echoes the auth header, or a logged
// env var could leak key material to the caller. This strips the known shapes so
// a diagnostic message stays useful ("AuthenticationError: invalid key") without
// the secret. Best-effort by design — pair it with NOT echoing raw stderr whole.

const PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{6,}/g, "sk-ant-***"], // Anthropic — match before the generic sk- rule
  [/sk-[A-Za-z0-9_-]{8,}/g, "sk-***"], // OpenAI-style
  [/AIza[A-Za-z0-9_-]{10,}/g, "AIza***"], // Google API key
  [/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1***"],
  [/("?api[-_]?key"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi, "$1***"], // api-key: / "apiKey":"..."
  [/(KP_LLM_CONFIG\s*=\s*)\S+/g, "$1***"], // the assembled config env var (carries keys)
];

/** Replace every known secret shape in `text` with a redacted marker. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  return out;
}
