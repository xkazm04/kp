// The job-seeker's egress guard: which URLs the server may request on the seeker's
// behalf. Every job-seeker fetch goes to a THIRD-PARTY board, and three things the
// seeker (or the board) writes decide the URL — a source's config (listing URLs, a
// sitemap, a feed URL), a preview's `url`, and whatever a sitemap <loc>, a rule-extracted
// link or a redirect points at. None of them may turn the server into a proxy onto its
// own network (SSRF): loopback, RFC 1918, link-local 169.254.169.254 metadata, CGNAT…
//
// The check is the one the gig researcher already uses (research.ts vetLink): the
// string-level public-host gate plus resolve-and-reject over every A/AAAA address
// (ats-egress-guard.ts — and its note on the residual TOCTOU applies here too). `http:`
// boards are vetted in their https form, since only the host is being judged.
//
// KP_OFFLINE never resolves a hostname: the string-level gate alone answers, and the
// fetch itself then answers `offline` before any network.

import { assertPublicHttpsEndpointResolved, type HostLookup } from "../../ats-egress-guard";
import { isOffline } from "../../offline";
import { assertPublicHttpsEndpoint } from "../../safe-url";
import type { FetchOutcome, PoliteFetch } from "./politeFetch";

/** Why a URL may not leave: unparseable / not http(s), a non-public host, or a name
 *  that does not resolve (an outage, not a verdict on the source). */
export type EgressRefusal = "bad_url" | "not_public_host" | "dns_unresolved";

let testLookup: HostLookup | null = null;

/** Tests pin DNS: a unit run never resolves a real hostname. `null` restores the real resolver. */
export function _setEgressLookupForTests(lookup: HostLookup | null): void {
  testLookup = lookup;
}

async function systemLookup(host: string): Promise<Array<{ address: string }>> {
  const { lookup } = await import("node:dns/promises");
  return lookup(host, { all: true, verbatim: true });
}

function httpsForm(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href.replace(/^http:/i, "https:");
}

/** Null when `href` may be requested; otherwise the reason it may not. */
export async function vetEgressUrl(href: string, lookup?: HostLookup): Promise<EgressRefusal | null> {
  const form = httpsForm(href);
  if (!form) return "bad_url";
  if (isOffline()) {
    try {
      assertPublicHttpsEndpoint(form, "job source URL");
      return null;
    } catch {
      return "not_public_host";
    }
  }
  const resolve = lookup ?? testLookup ?? systemLookup;
  let lookupFailed = false;
  const probe: HostLookup = async (host) => {
    try {
      const found = await resolve(host);
      if (found.length === 0) lookupFailed = true;
      return found;
    } catch (error) {
      lookupFailed = true;
      throw error;
    }
  };
  try {
    await assertPublicHttpsEndpointResolved(form, "job source URL", probe);
    return null;
  } catch {
    return lookupFailed ? "dns_unresolved" : "not_public_host";
  }
}

/** Is `href` on the source's recorded host — the host itself or a subdomain of it? The
 *  host the owner confirmed (and whose tier and terms were judged) is the only one a
 *  source's own URLs may name. */
export function isOnSourceHost(href: string, sourceHost: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const want = sourceHost.trim().toLowerCase().replace(/\.+$/, "");
  if (!want) return false;
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  return hostname === want || url.host.toLowerCase() === want || hostname.endsWith(`.${want}`);
}

/** A URL a source's owner hands in (a preview/propose `url`, a config URL): it must be
 *  on the source's recorded host AND public. `off_source_host` is the owner's mistake
 *  (or a probe); the egress refusals are the network's answer. */
export async function vetSourceUrl(href: string, sourceHost: string, lookup?: HostLookup): Promise<EgressRefusal | "off_source_host" | null> {
  if (!httpsForm(href)) return "bad_url";
  if (!isOnSourceHost(href, sourceHost)) return "off_source_host";
  return vetEgressUrl(href, lookup);
}

/** Every URL a source config names — the MPSV/feed `url`, a board's `sitemapUrl`, each
 *  `listingUrls` template (its `{page}` filled) — the set a create must vet. */
export function sourceConfigUrls(config: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["url", "sitemapUrl"]) {
    const v = config[key];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  if (Array.isArray(config.listingUrls)) {
    for (const v of config.listingUrls) if (typeof v === "string" && v.trim()) out.push(v.trim().replace("{page}", "1"));
  }
  return out;
}

/** A politeFetch hopGuard: every redirect target (robots.txt's included) is vetted before it is requested. */
export function egressHopGuard(lookup?: HostLookup): (next: URL) => Promise<string | null> {
  return (next) => vetEgressUrl(next.href, lookup);
}

/** How a refused URL reads to an adapter: a non-public host is a denial (the source is
 *  pointing the server somewhere it must not go — `blocked` pauses it for the owner);
 *  a name that does not resolve is an outage. */
export function egressRefusalOutcome(refusal: EgressRefusal): FetchOutcome {
  if (refusal === "not_public_host") return { kind: "blocked", detail: "egress_refused:not_public_host" };
  return { kind: "outage", detail: refusal };
}

/** `inner` with the egress guard in front: the URL itself is vetted before the first
 *  byte, and every redirect hop through the hopGuard (composed with any the caller set). */
export function egressGuardedFetch(inner: PoliteFetch, lookup?: HostLookup): PoliteFetch {
  const hop = egressHopGuard(lookup);
  return async (url, opts) => {
    if (isOffline()) return inner(url, opts);
    const refused = await vetEgressUrl(url, lookup);
    if (refused) return egressRefusalOutcome(refused);
    const callerGuard = opts.hopGuard;
    const hopGuard = callerGuard ? async (next: URL) => (await hop(next)) ?? (await callerGuard(next)) : hop;
    return inner(url, { ...opts, hopGuard });
  };
}
