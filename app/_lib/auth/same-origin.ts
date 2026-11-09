// Same-origin rule for state-changing /api requests (finding 13 of
// docs/security/2026-11-08-offer-scorecard-doors-scan.md).
//
// Pure and edge-safe (no node:*, no next/*) so it is unit-testable; `proxy.ts` sits
// outside the unit runner's glob and only calls `crossSiteWriteRefused`.
//
// WHY: in open mode there is no cookie, and the write doors parse JSON without
// requiring its content type, so a cross-site `text/plain` POST is a *simple* CORS
// request a hostile page can fire at an open instance. Browsers always send `Origin`
// and/or `Sec-Fetch-Site` on such a request; a server-to-server or CLI caller sends
// neither, and is allowed.

export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths external SENDERS legitimately call (machines, mail providers). Exact list,
 *  each a subset of the public-routes allow-list. Candidate token pages are NOT here:
 *  they call same-origin from the browser. A trailing slash = strict descendants. */
export const SAME_ORIGIN_EXEMPT_PATHS: readonly string[] = [
  "/api/billing/webhook",
  "/api/devcase/inbound",
  "/api/comms/callback",
  "/api/channels/inbound",
  "/api/agents/report/",
];

export function isSameOriginExempt(pathname: string): boolean {
  return SAME_ORIGIN_EXEMPT_PATHS.some((e) =>
    e.endsWith("/") ? pathname.startsWith(e) : pathname === e || pathname.startsWith(e + "/")
  );
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  if (!first) return null;
  try {
    return new URL(first.includes("://") ? first : `http://${first}`).host.toLowerCase();
  } catch {
    return null;
  }
}

export interface SameOriginInput {
  method: string;
  pathname: string;
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  forwardedHost: string | null;
  /** Configured public base URL (APP_BASE_URL / NEXT_PUBLIC_APP_BASE_URL), if any. */
  baseUrl?: string | null;
  /** Host of the request URL as Next saw it — last-resort fallback. */
  urlHost?: string | null;
}

/** True when the request must be refused as cross-site. */
export function crossSiteWriteRefused(i: SameOriginInput): boolean {
  if (!STATE_CHANGING_METHODS.has(i.method.toUpperCase())) return false;
  if (!i.pathname.startsWith("/api/")) return false;
  if (isSameOriginExempt(i.pathname)) return false;

  if (i.secFetchSite?.trim().toLowerCase() === "cross-site") return true;

  if (i.origin !== null && i.origin !== undefined) {
    if (i.origin.trim().toLowerCase() === "null") return true; // sandboxed / opaque origin
    const originHost = hostOf(i.origin);
    if (!originHost) return true;
    // Same host as the one the app is reached on — directly or behind a reverse proxy.
    const allowed = [i.forwardedHost, i.host, i.baseUrl, i.urlHost]
      .map(hostOf)
      .filter((h): h is string => h !== null);
    return !allowed.includes(originHost);
  }
  return false;
}
