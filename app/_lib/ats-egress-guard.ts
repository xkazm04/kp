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
// NOTE — this is resolve-and-reject, not a pin: a caller that then hands the URL to
// `fetch` lets fetch do its own second lookup, which a rebinding name can win
// (TOCTOU). The pin is `pinnedRequest` (pinned-request.ts): one resolution inside
// the request, refused with the same `isPrivateAddress`, and that address dialled.
// The comms relay and the ATS webhook dial through it; the other callers of this
// guard (connect probes, posting import, llm-config, pull pass, edge drain,
// jobseeker) still use fetch and are the follow-up adoption set.

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

/** An IPv6 string as its eight 16-bit groups, or null when it is not one. A trailing
 *  dotted quad (`::ffff:1.2.3.4`) is folded into the last two groups. */
function v6Groups(ip: string): number[] | null {
  let a = ip;
  const dotted = a.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const o = dotted[2].split(".").map(Number);
    if (o.some((x) => x > 255)) return null;
    a = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

/** True for an IPv6 address in a non-public range. Every form that CARRIES an IPv4
 *  address — mapped, SIIT-translated, compatible, NAT64, 6to4 — is unwrapped and
 *  judged as that IPv4, in whatever spelling it arrives: the URL parser and
 *  dns.lookup hand back `::ffff:a9fe:a9fe`, not `::ffff:169.254.169.254`, so a check
 *  on the dotted spelling alone let the metadata host through. Malformed = unsafe. */
function isPrivateV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(5) && g[5] === 0xffff) return isPrivateV4(v4Of(g[6], g[7])); // ::ffff:0:0/96 mapped
  if (zeroTo(4) && g[4] === 0xffff && g[5] === 0) return isPrivateV4(v4Of(g[6], g[7])); // ::ffff:0:0:0/96 SIIT
  if (zeroTo(6)) return true; // ::/96 — unspecified, loopback, IPv4-compatible (deprecated, never public)
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
    if (g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(v4Of(g[6], g[7])); // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) return isPrivateV4(v4Of(g[1], g[2])); // 2002::/16 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo (the v4 is obfuscated — refuse)
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Classify a numeric IP string (v4, v6, or any IPv4-in-IPv6 form) as non-public.
 *  Used to vet every address a hostname resolves to before the server fetches it. */
export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone); // strip IPv6 zone id (…%eth0)
  return addr.includes(":") ? isPrivateV6(addr) : isPrivateV4(addr);
}

/** How a hostname is resolved to its A/AAAA addresses. The default lazily imports
 *  node:dns (kept out of any client bundle — this module is server-only), but a
 *  caller/test can inject a deterministic resolver so the resolve-and-reject logic
 *  is unit-testable offline. */
export type HostLookup = (host: string) => Promise<Array<{ address: string }>>;

export async function defaultHostLookup(host: string): Promise<Array<{ address: string }>> {
  // Lazy so node:dns never enters a client bundle (safe-url.ts, which IS imported
  // by "use client" components, must never gain this dependency — the guard lives
  // here on purpose).
  const { lookup } = await import("node:dns/promises");
  return lookup(host, { all: true, verbatim: true });
}

/**
 * GENERIC server-only SSRF guard for an operator-supplied endpoint the SERVER will
 * fetch with a secret (an ATS webhook URL, or an LLM provider base URL). First runs
 * the string-level `assertPublicHttpsEndpoint` (https-only; rejects IP literals +
 * internal names) — the same first gate as before — then RESOLVES the host and
 * rejects if ANY resolved address is non-public. That resolution step is what closes
 * the DNS-rebinding pivot (`https://rebind.attacker.com` → 169.254.169.254): the
 * string check alone vets only the literal name. Returns the parse-normalized href
 * on success; THROWS an `Error` with an operator-facing message on rejection.
 *
 * Shared so the ATS delivery boundary and the llm-config write boundary vet the
 * host identically (extract-once; do NOT copy this into safe-url.ts, which is
 * client-imported).
 */
export async function assertPublicHttpsEndpointResolved(
  raw: string,
  label = "endpoint",
  lookupFn: HostLookup = defaultHostLookup,
): Promise<string> {
  const href = assertPublicHttpsEndpoint(raw, label); // https + no literal-IP/internal host (FIRST gate)
  const parsed = new URL(href);
  // Userinfo is refused here, by name only: fetch throws on it with the WHOLE URL in
  // its message ("…includes credentials: https://user:pass@host/"), and the callers
  // render a failure reason to the operator, the probe memory and the delivery ledger.
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid ${label}: credentials in the URL are not allowed — use the secret field.`);
  }
  const host = parsed.hostname.toLowerCase();
  let results: Array<{ address: string }>;
  try {
    results = await lookupFn(host);
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

/**
 * Full delivery-time vet for the ATS webhook URL — a thin, domain-labelled wrapper
 * over the shared `assertPublicHttpsEndpointResolved`. Kept as the ATS caller's
 * name/label so ats-egress.ts is unchanged.
 */
export async function assertDeliverableWebhookUrl(
  raw: string,
  label = "webhook URL",
  lookupFn: HostLookup = defaultHostLookup,
): Promise<string> {
  return assertPublicHttpsEndpointResolved(raw, label, lookupFn);
}
