// Scrub secret-like substrings from text before it crosses a trust boundary —
// e.g. a provider-SDK error tail surfaced to the Models "Test" panel. A decrypted
// provider key and the assembled KP_LLM_CONFIG live in the same process as the
// canary, so a stack trace, an SDK error that echoes the auth header, or a logged
// env var could leak key material to the caller. This strips the known shapes so
// a diagnostic message stays useful ("AuthenticationError: invalid key") without
// the secret. Best-effort by design — pair it with NOT echoing raw stderr whole.
//
// WHICH shapes is not a judgement call made here. `scripts/security/secret-scan.mjs`
// already holds this repository's answer to "what does a credential look like", and
// it is the gate that stops one being COMMITTED. This table mirrors it row for row,
// by `id`, so the same bytes that cannot enter the repo also cannot leave it through
// a diagnostic. `redact-secrets.test.ts` reads that scan source and fails when a row
// there has no counterpart here — the pairing is enforced, not remembered.
//
// The mirror is deliberately ONE-WAY-BROADER: a redaction rule may match MORE than
// the scan's detection rule (the scan must not cry wolf on a commit; the redactor
// may over-scrub a diagnostic), never less. Where the two differ the comment says so.
// `redact-secrets.ts` stays a pure string module with no imports: it is reached from
// server routes and must remain safe to pull into any bundle.

type Shape = { id: string; re: RegExp; repl: string };

/**
 * The mirrored rows. `id` matches `SECRET_PATTERNS[].id` in the scan table; the
 * regex is that row's shape widened where a partial key is still worth hiding, and
 * carries the `g` flag the scan does not need.
 */
const SCAN_SHAPES: Shape[] = [
  // Anthropic. Wider than the scan's `sk-ant-api\d{2}-…{20,}`: any sk-ant- prefix
  // with a plausible tail is redacted, so a truncated key in an error tail still goes.
  { id: "anthropic", re: /sk-ant-[A-Za-z0-9_-]{6,}/g, repl: "sk-ant-***" },
  { id: "openai-project", re: /sk-proj-[A-Za-z0-9_-]{8,}/g, repl: "sk-proj-***" },
  { id: "openrouter", re: /sk-or-v1-[A-Za-z0-9_-]{8,}/g, repl: "sk-or-v1-***" },
  // Must precede the generic `sk-` rule so the marker names the vendor.
  { id: "openai-legacy", re: /sk-[A-Za-z0-9]{48}/g, repl: "sk-***" },
  { id: "elevenlabs", re: /\bsk_[a-f0-9]{20,}/g, repl: "sk_***" },
  { id: "google", re: /AIza[A-Za-z0-9_-]{10,}/g, repl: "AIza***" },
  // The envelope line of a service-account JSON. Redacting the marker line is what
  // stops the blob being recognisable as one; the `private_key` inside it is caught
  // by the private-key rule below.
  { id: "gcp-service-account", re: /("type"\s*:\s*)"service_account"/g, repl: "$1***" },
  { id: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g, repl: "AKIA***" },
  { id: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, repl: "gh*_***" },
  { id: "github-fine-grained", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, repl: "github_pat_***" },
  { id: "npm", re: /\bnpm_[A-Za-z0-9]{20,}/g, repl: "npm_***" },
  { id: "slack", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, repl: "xox-***" },
  // The whole block when the closing line is present, the header alone when it is
  // not: an error tail that echoes a pasted key would otherwise keep every base64
  // byte after the header, while an unterminated header must NOT swallow the rest of
  // the diagnostic (the tail after it is the part that says what actually failed).
  {
    id: "private-key",
    re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----(?:[\s\S]*?-----END [^\n]*-----)?/g,
    repl: "***PRIVATE KEY REDACTED***",
  },
];

/**
 * Shapes with NO scan counterpart: they are not credential literals a commit could
 * leak, they are how a credential shows up in a RUNTIME message (an echoed auth
 * header, a config env var, a JSON field). The lockstep test ignores these.
 */
const RUNTIME_SHAPES: Shape[] = [
  // Generic OpenAI-style fallback, after every vendor-prefixed rule above.
  { id: "generic-sk", re: /sk-[A-Za-z0-9_-]{8,}/g, repl: "sk-***" },
  { id: "bearer", re: /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, repl: "$1***" },
  { id: "api-key-field", re: /("?api[-_]?key"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi, repl: "$1***" },
  // The assembled config env var (carries keys).
  { id: "kp-llm-config", re: /(KP_LLM_CONFIG\s*=\s*)\S+/g, repl: "$1***" },
];

const PATTERNS: Shape[] = [...SCAN_SHAPES, ...RUNTIME_SHAPES];

/** Every shape this module knows, by id — read by the lockstep test. */
export const SECRET_SHAPE_IDS: string[] = PATTERNS.map((s) => s.id);

/** Replace every known secret shape in `text` with a redacted marker. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, repl } of PATTERNS) out = out.replace(re, repl);
  return out;
}
