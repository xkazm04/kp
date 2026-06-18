// Render-time trust boundary for model-supplied URLs. LLM analysis output —
// grounded market-evidence sources, web-grounded salary citations — reaches the
// UI as bare strings and used to be dropped straight into an anchor `href`. That
// string is untrusted: the model can emit a `javascript:`/`data:`/`vbscript:`
// URL that executes on click, and an opaque "Source N"/"[1]" label hides where
// the link actually points (a disguised link in a recruiter-facing report). This
// is the single place those strings are vetted before they become a clickable
// link, so the guard can't be forgotten at one render site and skipped at the
// next.

/** A model-supplied URL that passed the http(s) guard and is safe to link. */
export interface SafeLink {
  /** The parse-normalized URL — safe to use as an anchor `href`. */
  href: string;
  /**
   * Bare host with a leading `www.` dropped (e.g. "glassdoor.com"). Render this
   * as the link text so the destination is never disguised behind an opaque
   * label.
   */
  hostname: string;
}

// Only web schemes are linkable. Everything else — javascript:, data:,
// vbscript:, mailto:, tel:, file:, blob: — is rejected.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Vet one model-supplied URL string for use in a link. Returns a
 * `{ href, hostname }` pair only for a well-formed http(s) URL; anything else —
 * an unparseable string, or a non-web scheme like `javascript:`/`data:` —
 * returns `null` so the caller drops it instead of rendering a dangerous or
 * misleading anchor.
 */
export function safeHttpUrl(raw: string): SafeLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null; // relative, scheme-less, or otherwise malformed
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  const hostname = url.hostname.replace(/^www\./, "");
  if (!hostname) return null; // e.g. "http://" with no host
  return { href: url.href, hostname };
}

/**
 * Map a list of model-supplied URL strings to render-safe links, dropping every
 * entry that fails the http(s) guard. First-occurrence order is preserved.
 */
export function safeHttpLinks(raws: readonly string[]): SafeLink[] {
  const out: SafeLink[] = [];
  for (const raw of raws) {
    const link = safeHttpUrl(raw);
    if (link) out.push(link);
  }
  return out;
}

/** True for a host that is a bare IP literal (IPv4 dotted-quad or IPv6 — the URL
 *  parser leaves IPv6 hostnames bracketed and always containing `:`). A provider
 *  endpoint is always a DNS name, so a literal IP is rejected outright (no need
 *  to range-check: that closes 169.254.169.254 metadata, 127.x loopback and every
 *  RFC-1918 LAN in one rule). */
function isIpLiteralHost(host: string): boolean {
  if (host.includes(":")) return true; // IPv6 literal (bracketed) — never a DNS name
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * SSRF-grade check for an operator-supplied service endpoint that the SERVER will
 * call with a bearer key (e.g. an Azure OpenAI resource URL). Unlike
 * `safeHttpUrl` (render-time, permissive about host), this URL is fetched
 * server-side, so a bad value is a classic SSRF + key-exfiltration pivot: an
 * attacker who can store the endpoint can point it at cloud metadata
 * (169.254.169.254), a loopback/LAN service, or their own host to capture the
 * key. We require `https:` and a public DNS host — never a bare IP, loopback,
 * link-local, or an internal/`.local`/`.internal` name. Returns the
 * parse-normalized href on success; THROWS an `Error` with an operator-facing
 * message on rejection so the caller can surface it as a 400 at store time.
 */
export function assertPublicHttpsEndpoint(raw: string, label = "endpoint"): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${label}: not a URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Invalid ${label}: must use https://.`);
  }
  const host = url.hostname.toLowerCase();
  if (!host) throw new Error(`Invalid ${label}: missing host.`);
  if (isIpLiteralHost(host)) {
    throw new Error(`Invalid ${label}: a bare IP address is not allowed — use the provider hostname.`);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`Invalid ${label}: internal/loopback hosts are not allowed.`);
  }
  return url.href;
}
