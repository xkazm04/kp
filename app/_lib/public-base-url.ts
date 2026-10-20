import { siteUrl } from "./site-url.ts";

// The ONE resolver for candidate-facing link origins (idea-e6c66bcd).
//
// Offer, voice-screen, self-scheduling and apply links are all sent to EXTERNAL
// candidates, so their base URL must point at the deployment's PUBLIC host — not
// a recruiter's localhost and not a proxy-internal address. Before this helper,
// the server built the offer link from `APP_BASE_URL ?? request origin` while the
// client built voice/scheduling/apply links from `window.location.origin`; behind
// a proxy, or when a recruiter works on localhost while candidates need a public
// host, those two silently diverged and candidate links broke only in non-local
// deploys. Route every candidate-facing link through here so both sides resolve
// the same documented origin.
//
// Precedence (highest first):
//   1. APP_BASE_URL              — server-only explicit override (Node only; never
//                                  exposed to the browser bundle). Honored for
//                                  backward compatibility with the prior offer route.
//   2. NEXT_PUBLIC_APP_BASE_URL  — the SAME value mirrored into the client bundle.
//                                  Next.js inlines only NEXT_PUBLIC_-prefixed vars
//                                  client-side, so this is what lets the browser
//                                  honor the configured origin. SET THIS per deploy
//                                  (the canonical knob); it is read on both sides.
//   3. the supplied runtime origin — request origin on the server, or
//                                  window.location.origin on the client. The
//                                  localhost-friendly fallback when nothing is set.
//
// Pass the runtime origin the caller already has; the helper decides whether a
// configured override should win. The returned base has no trailing slash, so
// callers can always do `${publicBaseUrl(origin)}${path}` with `path` like
// "/offer/<token>".
//
// VALIDATION (bug-ui-scan-2026-07-09 #3). The result MUST be an absolute, non-empty,
// deployment-owned http(s) origin. Two gaps this closes:
//   (a) origin-less callers (background reminder sweeps call publicBaseUrl() with no
//       request origin): when nothing was configured the old chain returned "" and
//       an outbound email baked a dead relative "/offer/<token>" link. We now fall
//       back to the canonical site origin (NEXT_PUBLIC_SITE_URL / its documented
//       default) so an outbound link is ALWAYS absolute.
//   (b) request-derived callers on PUBLIC routes pass `new URL(request.url).origin`,
//       which reflects the attacker-influenceable Host header. A configured override
//       now wins outright (a spoofed Host can never override it), and an UN-configured
//       runtime origin is trusted only when it is a localhost/dev host OR its host
//       matches the configured canonical site origin — a poisoned public Host that
//       matches neither is dropped, not emitted into a candidate-delivered link.

/** True iff `value` parses as an absolute http:// or https:// URL — the only shape
 *  safe to prepend to a candidate-facing path. Rejects "", relative paths, and
 *  non-web schemes (which `new URL` would either throw on or accept as a non-origin). */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Localhost/dev hosts a developer legitimately runs on — a runtime origin on one of
 *  these is trusted as-is so local development keeps resolving to the dev server. The
 *  port is ignored (localhost:3000). Anything else must match the configured public
 *  host to be trusted (the Host-header poisoning defense). */
function isLocalDevHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name === "::1" || name.endsWith(".localhost");
}

const stripTrailingSlash = (base: string): string => base.replace(/\/+$/, "");

/** The two public-origin overrides, when both are set to absolute http(s) URLs
 *  whose origins (scheme + host + port; trailing slash ignored) disagree.
 *
 *  On the server `publicBaseUrl` honors APP_BASE_URL; the browser bundle only
 *  sees NEXT_PUBLIC_APP_BASE_URL. When both are set and they name different
 *  hosts, candidate emails and copied invite links silently point at two
 *  places — the original proxy/localhost footgun, restored whenever a Helm
 *  values file sets one and a leftover .env sets the other. This reports the
 *  pair so a boot can warn (and a health/ops consumer can fail closed later)
 *  without changing the documented single-var precedence. */
export function publicOriginConflict(): { server: string; client: string } | null {
  const server = typeof process !== "undefined" ? process.env.APP_BASE_URL?.trim() : undefined;
  const client = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim();
  if (!server || !client) return null;
  if (!isAbsoluteHttpUrl(server) || !isAbsoluteHttpUrl(client)) return null;
  if (new URL(server).origin === new URL(client).origin) return null;
  return { server: stripTrailingSlash(server), client: stripTrailingSlash(client) };
}

let originConflictWarned = false;

/** Test seam: the once-per-process origin-conflict warning latch. */
export function resetPublicOriginConflictWarnForTests(): void {
  originConflictWarned = false;
}

function warnPublicOriginConflictOnce(): void {
  if (originConflictWarned) return;
  const conflict = publicOriginConflict();
  if (!conflict) return;
  originConflictWarned = true;
  console.warn(
    `[public-base-url] APP_BASE_URL (${conflict.server}) and NEXT_PUBLIC_APP_BASE_URL (${conflict.client}) disagree; candidate emails and copied invite links will silently point at two hosts`,
  );
}

/** True when `publicBaseUrl(origin)` had to fall back to the canonical site default
 *  because nothing deployment-specific was configured AND no trusted runtime origin was
 *  supplied (a detached sweep, or a dropped untrusted Host). The link is still absolute
 *  and correct, but it uses the DEFAULT origin — which may be wrong for this deploy — so
 *  the caller should warn the operator to set APP_BASE_URL. Mirrors publicBaseUrl's own
 *  precedence so the two never disagree. */
export function publicOriginIsFallback(runtimeOrigin?: string | null): boolean {
  const serverOverride = typeof process !== "undefined" ? process.env.APP_BASE_URL?.trim() : undefined;
  const configured = serverOverride || process.env.NEXT_PUBLIC_APP_BASE_URL?.trim();
  if (configured && isAbsoluteHttpUrl(configured)) return false;
  const origin = runtimeOrigin?.trim();
  if (origin && isAbsoluteHttpUrl(origin)) {
    const host = new URL(origin).host;
    if (isLocalDevHost(host) || host === siteUrl().host) return false;
  }
  return true;
}

/** Deployment health for origin-less candidate messages sent by background work. */
export function publicOriginHealth(): { ok: boolean; reason: string | null } {
  if (publicOriginConflict()) {
    return { ok: false, reason: "public-origin: APP_BASE_URL and NEXT_PUBLIC_APP_BASE_URL disagree" };
  }
  if (publicOriginIsFallback()) {
    return { ok: false, reason: "public-origin: no usable APP_BASE_URL or NEXT_PUBLIC_APP_BASE_URL for detached candidate links" };
  }
  return { ok: true, reason: null };
}

export function publicBaseUrl(runtimeOrigin?: string | null): string {
  warnPublicOriginConflictOnce();
  // Server-only override. `typeof process` guards the read so this module is safe
  // to import from client components, where `process` may be absent and a
  // non-public var would never be exposed anyway.
  const serverOverride =
    typeof process !== "undefined" ? process.env.APP_BASE_URL?.trim() : undefined;
  // Public mirror — statically inlined into both server and client bundles.
  const publicOverride = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim();
  const configured = serverOverride || publicOverride;

  // 1. An explicit deploy override is the authoritative public origin: it WINS over
  //    any runtime origin, so a spoofable request Host can never redirect a candidate
  //    link. Validate it — a misconfigured, non-absolute override is ignored (warned),
  //    never emitted as a broken base.
  if (configured) {
    if (isAbsoluteHttpUrl(configured)) return stripTrailingSlash(configured);
    console.warn(`[public-base-url] ignoring non-absolute APP_BASE_URL override ${JSON.stringify(configured)}`);
  }

  // 2. No usable override → the supplied runtime origin, but the request Host is
  //    attacker-influenceable on a server route. Trust it ONLY when it is itself a
  //    valid absolute http(s) origin AND (a localhost/dev host OR the configured
  //    canonical site host). A relative/blank value, or a poisoned public Host that
  //    matches neither, is dropped rather than concatenated into a candidate link.
  const origin = runtimeOrigin?.trim();
  if (origin && isAbsoluteHttpUrl(origin)) {
    const originHost = new URL(origin).host;
    if (isLocalDevHost(originHost) || originHost === siteUrl().host) return stripTrailingSlash(origin);
    console.warn(`[public-base-url] ignoring untrusted runtime origin ${JSON.stringify(origin)}`);
  }

  // 3. Nothing trustworthy resolved (origin-less background job, a blank SSR origin,
  //    or a dropped untrusted Host) → the canonical, deployment-owned site origin, so
  //    an outbound link is ALWAYS absolute and on our own domain: never the "" that
  //    became a dead relative "/offer/<token>", never a poisoned host.
  return stripTrailingSlash(siteUrl().toString());
}
