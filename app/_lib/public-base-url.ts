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
export function publicBaseUrl(runtimeOrigin?: string | null): string {
  // Server-only override. `typeof process` guards the read so this module is safe
  // to import from client components, where `process` may be absent and a
  // non-public var would never be exposed anyway.
  const serverOverride =
    typeof process !== "undefined" ? process.env.APP_BASE_URL?.trim() : undefined;
  // Public mirror — statically inlined into both server and client bundles.
  const publicOverride = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim();
  const configured = serverOverride || publicOverride;
  const base = configured || runtimeOrigin?.trim() || "";
  // Strip any trailing slash(es) so appending an absolute path never doubles up.
  return base.replace(/\/+$/, "");
}
