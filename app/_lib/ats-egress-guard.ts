// SSRF guard for the OUTBOUND webhook fetch — the delivery-time half of the
// egress trust boundary. `ats-config-store` vets the URL *string* at write time
// via `assertPublicHttpsEndpoint` (https-only, no IP literals / internal names),
// but that alone is defeated by DNS rebinding: an attacker stores
// `https://rebind.attacker.com` (passes every string check) whose DNS later
// answers `169.254.169.254` / `127.0.0.1` / an RFC-1918 host at fetch time. So
// immediately before each outbound POST we ALSO resolve the host and reject if any
// resolved A/AAAA address is loopback/link-local/RFC-1918/CGNAT/ULA/metadata.
//
// This lives in its own server-only module (never imported by a client bundle) so
// the node:dns dependency stays out of `safe-url.ts`, which IS imported by
// "use client" components. Import-light on purpose (only `./safe-url.ts` + a lazy
// node:dns) so it stays unit-loadable under `node --test`.
//
// NOTE — this is resolve-and-reject, not a hard IP pin: `fetch` performs its own
// DNS lookup after this check, so a sub-second rebind between the two lookups is
// still theoretically possible (TOCTOU). True pinning needs a custom undici
// dispatcher that dials the vetted IP while preserving SNI/Host; that is out of
// scope here. Resolve-and-reject blocks the practical rebind and is the minimum
// the sibling finding asks for.

import { assertPublicHttpsEndpoint } from "./safe-url.ts";

/** True for an IPv4 address in a non-public range (loopback, RFC-1918 private,
 *  link-local incl. 169.254 metadata, CGNAT, benchmark, multicast/reserved). A
 *  malformed value is treated as unsafe (returns true) — fail closed. */
function isPrivateV4(ip: string): boolean {
  const octets = ip.split(".");
  if (octets.length !== 4) return true;
  const n = octets.map((o) => Number(o));
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b, c] = n;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (+ cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24 IETF protocol
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
  return false;
}

/** True for an IPv6 address in a non-public range (unspecified, loopback,
 *  unique-local fc00::/7, link-local fe80::/10). IPv4-mapped/embedded forms are
 *  unwrapped to their v4 and range-checked there. */
function isPrivateV6(ip: string): boolean {
  const a = ip.replace(/^\[/, "").replace(/\]$/, "");
  if (a === "::" || a === "::1") return true; // unspecified / loopback
  if (/^f[cd]/.test(a)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(a)) return true; // fe80::/10 link-local
  return false;
}

/** Classify a numeric IP string (v4, v6, or IPv4-mapped v6) as non-public. Used to
 *  vet every address a hostname resolves to before the server fetches it. */
export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone); // strip IPv6 zone id (…%eth0)
  if (addr.includes(":")) {
    // IPv4-mapped / -embedded IPv6, e.g. ::ffff:169.254.169.254 or ::a9fe:a9fe → v4.
    const embedded = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (embedded) return isPrivateV4(embedded[1]);
    return isPrivateV6(addr);
  }
  return isPrivateV4(addr);
}

/**
 * Full delivery-time vet for the webhook URL. First runs the string-level
 * `assertPublicHttpsEndpoint` (https-only; rejects IP literals + internal names),
 * then RESOLVES the host and rejects if any resolved address is non-public — this
 * is what closes the DNS-rebinding pivot. Returns the parse-normalized href on
 * success; THROWS an `Error` with an operator-facing message on rejection so the
 * caller can turn it into a delivery failure (never a leaked target status).
 */
export async function assertDeliverableWebhookUrl(raw: string, label = "webhook URL"): Promise<string> {
  const href = assertPublicHttpsEndpoint(raw, label); // https + no literal-IP/internal host
  const host = new URL(href).hostname.toLowerCase();
  const { lookup } = await import("node:dns/promises");
  let results: Array<{ address: string }>;
  try {
    results = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Invalid ${label}: host "${host}" could not be resolved.`);
  }
  if (results.length === 0) {
    throw new Error(`Invalid ${label}: host "${host}" did not resolve to any address.`);
  }
  for (const { address } of results) {
    if (isPrivateAddress(address)) {
      throw new Error(`Invalid ${label}: host "${host}" resolves to a non-public address (${address}).`);
    }
  }
  return href;
}
